// Captures a frozen copy of a web page: rendered in headless Chrome, then stripped of
// scripts so nothing on it runs, animates or reacts. The game destroys this copy.
const puppeteer = require('puppeteer');

const VIEWPORT = { width: 1366, height: 900 };
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
const CAPTURE_BUDGET_MS = 5000;    // whole capture; whatever has loaded by then is saved
const LATE_PAGE_GRACE_MS = 2000;   // extra wait only if the page has shown nothing at all yet
const MAX_SCROLL_STEPS = 8;        // lazy-load pass: players start at the top, so 8 screens deep
const SCROLL_PAUSE_MS = 100;
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHED = 30;
const MAX_CONCURRENT = 2;          // pages being captured at once
const BLOCKED_TYPES = new Set(['image', 'media', 'font']);

let browserPromise = null;
function getBrowser() {
    if (!browserPromise) {
        browserPromise = puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
        browserPromise.then(b => b.on('disconnected', () => { browserPromise = null; }));
    }
    return browserPromise;
}

// Small queue so a burst of visitors can't open dozens of Chrome tabs
let running = 0;
const waiting = [];
async function withSlot(fn) {
    if (running >= MAX_CONCURRENT) await new Promise(resolve => waiting.push(resolve));
    running++;
    try {
        return await fn();
    } finally {
        running--;
        if (waiting.length) waiting.shift()();
    }
}

// Runs inside the captured page, after it has loaded and been scrolled through
function freezePage() {
    // Anything dimmer now than it ever was on screen gets its best look back
    for (const [el, opacity] of window.__wdSeen || []) {
        if (el.isConnected && parseFloat(getComputedStyle(el).opacity) < opacity) {
            el.style.setProperty('opacity', String(opacity), 'important');
        }
    }

    // Finish one-shot animations and pause endless ones, then write each animated element's
    // current look into its inline style; the copy disables animations and would lose it
    for (const anim of document.getAnimations()) {
        try {
            if (anim.effect.getTiming().iterations === Infinity) anim.pause();
            else anim.finish();
            const el = anim.effect.target;
            if (!el || !el.style) continue;
            const cs = getComputedStyle(el);
            el.style.setProperty('opacity', cs.opacity, 'important');
            el.style.setProperty('transform', cs.transform, 'important');
            el.style.setProperty('visibility', cs.visibility, 'important');
        } catch (e) { /* detached or cross-origin effect: skip */ }
    }

    // Styles injected through the CSSOM (CSS-in-JS) never appear in the HTML text
    for (const sheet of document.styleSheets) {
        const owner = sheet.ownerNode;
        if (!owner || owner.tagName !== 'STYLE') continue;
        try {
            const text = Array.from(sheet.cssRules, r => r.cssText).join('\n');
            if (text.length > owner.textContent.length) owner.textContent = text;
        } catch (e) { /* unreadable sheet: keep its text */ }
    }
    for (const sheet of document.adoptedStyleSheets || []) {
        const style = document.createElement('style');
        style.textContent = Array.from(sheet.cssRules, r => r.cssText).join('\n');
        document.head.appendChild(style);
    }

    // Canvases are drawn by scripts that won't run in the copy: keep their pixels as images
    for (const c of document.querySelectorAll('canvas')) {
        try {
            const img = document.createElement('img');
            img.src = c.toDataURL();
            img.width = c.width;
            img.style.cssText = c.style.cssText;
            img.className = c.className;
            const r = c.getBoundingClientRect();
            img.style.width = r.width + 'px';
            img.style.height = r.height + 'px';
            c.replaceWith(img);
        } catch (e) { /* tainted canvas: leave it blank */ }
    }

    // Make every image load eagerly in the copy, using whatever the lazy loader found
    for (const img of document.querySelectorAll('img')) {
        img.removeAttribute('loading');
        if (img.currentSrc && !img.getAttribute('src')) img.setAttribute('src', img.currentSrc);
        for (const attr of ['data-src', 'data-lazy-src', 'data-original']) {
            if (img.getAttribute(attr) && !img.getAttribute('src')) img.setAttribute('src', img.getAttribute(attr));
        }
        if (img.getAttribute('data-srcset') && !img.getAttribute('srcset')) img.setAttribute('srcset', img.getAttribute('data-srcset'));
    }

    // Keep what was typed into form fields
    for (const input of document.querySelectorAll('input')) {
        if (input.type === 'checkbox' || input.type === 'radio') {
            if (input.checked) input.setAttribute('checked', '');
        } else if (input.value) {
            input.setAttribute('value', input.value);
        }
    }

    // Nothing in the copy may run or navigate
    document.querySelectorAll('script, noscript, link[rel="preload"][as="script"], link[rel="modulepreload"], meta[http-equiv]').forEach(el => el.remove());
    for (const el of document.querySelectorAll('*')) {
        for (const attr of Array.from(el.attributes)) {
            if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
            else if ((attr.name === 'href' || attr.name === 'src' || attr.name === 'action') && /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
        }
    }
    for (const v of document.querySelectorAll('video, audio')) {
        v.removeAttribute('autoplay');
        v.pause && v.pause();
    }

    window.scrollTo(0, 0);
    return '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
}

// Remember how visible each on-screen element gets. Sites often fade content in when it
// scrolls into view and back out when it leaves, so the end of the scroll would leave it hidden.
function recordVisible() {
    const seen = window.__wdSeen || (window.__wdSeen = new Map());
    for (const el of document.body.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (!r.width || r.bottom < 0 || r.top > window.innerHeight) continue;
        const opacity = parseFloat(getComputedStyle(el).opacity);
        if (!(seen.get(el) >= opacity)) seen.set(el, opacity);
    }
}

const wait = ms => new Promise(r => setTimeout(r, ms));

async function scrollThrough(page, timeLeft) {
    await page.evaluate(recordVisible);
    for (let i = 0; i < MAX_SCROLL_STEPS && timeLeft() > 600; i++) {
        const atBottom = await page.evaluate(() => {
            window.scrollBy(0, window.innerHeight);
            return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
        });
        await wait(SCROLL_PAUSE_MS);
        await page.evaluate(recordVisible);
        if (atBottom) break;
    }
    // Back to the top so scroll-driven effects settle the way a visitor first sees the page
    await page.evaluate(() => window.scrollTo(0, 0));
    await wait(300);
    await page.evaluate(recordVisible);
}

async function captureFresh(url) {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
        const t0 = Date.now();
        const timeLeft = () => CAPTURE_BUDGET_MS - (Date.now() - t0);
        await page.setViewport(VIEWPORT);
        await page.setUserAgent(USER_AGENT);
        // Run the site's own animations 10x faster so reveal effects finish while we scroll
        const cdp = await page.createCDPSession();
        await cdp.send('Animation.enable');
        await cdp.send('Animation.setPlaybackRate', { playbackRate: 10 });
        // The copy only keeps image, font and video addresses (the player's browser fetches
        // them), so the capture doesn't need to download them at all
        await page.setRequestInterception(true);
        page.on('request', req => {
            if (BLOCKED_TYPES.has(req.resourceType())) req.abort().catch(() => {});
            else req.continue().catch(() => {});
        });

        // Load within the budget. A slow site is saved as far as it got, as long as it has
        // shown something; one that has shown nothing gets a short grace period, then fails.
        try {
            const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CAPTURE_BUDGET_MS });
            if (response && response.status() >= 400) {
                throw new Error(`The site answered with HTTP ${response.status()}`);
            }
        } catch (err) {
            if (err.name !== 'TimeoutError') throw err;
            await page.waitForFunction(() => document.body && document.body.innerText.trim().length > 0,
                { timeout: LATE_PAGE_GRACE_MS }).catch(() => {
                throw new Error('The site took too long to show anything');
            });
        }
        if (timeLeft() > 800) {
            await page.waitForNetworkIdle({ idleTime: 400, timeout: Math.min(2000, timeLeft() - 600) }).catch(() => {});
        }
        const tLoaded = Date.now();
        await scrollThrough(page, timeLeft);
        const tScrolled = Date.now();
        const html = await page.evaluate(freezePage);
        console.log(`Snapshot ${url}: load ${tLoaded - t0} ms, scroll ${tScrolled - tLoaded} ms, freeze ${Date.now() - tScrolled} ms, total ${Date.now() - t0} ms, ${Math.round(html.length / 1024)} KB`);
        return { html, finalUrl: page.url() };
    } finally {
        await page.close().catch(() => {});
    }
}

// Recent snapshots are reused for a few minutes, and visitors asking for the same URL at
// the same time share one capture
const cache = new Map();    // url -> { result, time }, oldest first
const inFlight = new Map(); // url -> promise

// Returns { html, finalUrl }. Throws with a readable message when the page can't be captured.
function capturePage(url) {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.time < CACHE_TTL_MS) {
        console.log(`Snapshot ${url}: from cache`);
        return Promise.resolve(hit.result);
    }
    if (inFlight.has(url)) return inFlight.get(url);

    const job = withSlot(() => captureFresh(url))
        .then(result => {
            cache.delete(url);
            cache.set(url, { result, time: Date.now() });
            while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value);
            return result;
        })
        .finally(() => inFlight.delete(url));
    inFlight.set(url, job);
    return job;
}

module.exports = { capturePage };
