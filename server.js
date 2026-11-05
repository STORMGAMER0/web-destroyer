const express = require('express');
const axios = require('axios');
const path = require('path');
const { capturePage } = require('./snapshot');
const app = express();
const PORT = process.env.PORT || 3000;

// Behind a tunnel like ngrok the request reaches us as plain http; trust its forwarded headers
// so req.protocol says https and the injected engine script isn't blocked as mixed content
app.set('trust proxy', true);

// Character sprites and sounds rarely change: let browsers keep them for an hour, so the
// loading screen's downloads are reused by the game page instead of fetched again
app.use('/characters', express.static(path.join(__dirname, 'public', 'characters'), { maxAge: '1h' }));
// Serve your public assets (spritesheet, json data, game engine logic)
app.use(express.static(path.join(__dirname, 'public')));

// Snapshots are kept for 10 minutes, so the loading screen can capture the site while the
// player waits and the game page then gets the same copy straight away. A request that
// arrives while a capture is still running waits for that capture instead of starting another.
const SNAPSHOT_TTL = 10 * 60 * 1000;
const snapshots = new Map(); // url -> { promise, time }

function getSnapshot(targetUrl) {
    const hit = snapshots.get(targetUrl);
    if (hit && Date.now() - hit.time < SNAPSHOT_TTL) return hit.promise;

    const promise = (async () => {
        // Render the page in headless Chrome and take a frozen copy with no scripts in it.
        // If Chrome can't capture it, fall back to the raw HTML with its scripts cut out. The
        // raw HTML downloads alongside the capture, so the fallback costs no extra wait.
        const rawPage = axios.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        rawPage.catch(() => {}); // only awaited if the capture fails
        try {
            return await capturePage(targetUrl);
        } catch (captureError) {
            console.warn('Snapshot failed, using raw HTML:', captureError.message);
            const response = await rawPage;
            return {
                html: String(response.data)
                    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
                    .replace(/<meta[^>]*http-equiv=[^>]*>/gi, ''),
                finalUrl: (response.request.res && response.request.res.responseUrl) || targetUrl
            };
        }
    })();
    snapshots.set(targetUrl, { promise, time: Date.now() });
    promise.catch(() => snapshots.delete(targetUrl)); // a failure can be retried
    // Keep the cache small: drop the oldest entries
    while (snapshots.size > 20) snapshots.delete(snapshots.keys().next().value);
    return promise;
}

// The loading screen calls this to capture the site ahead of time
app.get('/prepare', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: 'No URL given' });
    try {
        await getSnapshot(targetUrl);
        res.json({ ok: true });
    } catch (error) {
        console.error('Prepare Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// THE PROXY ROUTE: Fetches the target site and strips its security headers
app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;

    if (!targetUrl) {
        return res.status(400).send('Please provide a URL parameter. Example: /proxy?url=https://example.com');
    }

    try {
        let { html, finalUrl } = await getSnapshot(targetUrl);

        // Point the page's relative links (CSS, images, fonts) back at the real site,
        // and freeze it: no animations, transitions, text cursor or selection.
        const baseTag = `<base href="${finalUrl.replace(/"/g, '&quot;')}">`;
        const freezeStyle = '<style id="wd-freeze">' +
            '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' +
            'html,body,body *{cursor:none!important;user-select:none!important}' +
            '</style>';
        html = /<head[^>]*>/i.test(html)
            ? html.replace(/<head[^>]*>/i, match => match + baseTag + freezeStyle)
            : baseTag + freezeStyle + html;

        // CRUCIAL: Inject your frontend MUGEN game engine right before the website's closing </body> tag.
        // The <base> tag above would send a relative src to the target site, so use our own origin.
        const ownOrigin = `${req.protocol}://${req.get('host')}`;
        const injectScript = `<script src="${ownOrigin}/game-engine.js"></script>`;
        html = /<\/body>/i.test(html)
            ? html.replace(/<\/body>/i, injectScript + '</body>')
            : html + injectScript;

        // Send the modified, vulnerable website back to the browser
        res.send(html);

    } catch (error) {
        console.error('Proxy Error:', error.message);
        res.status(500).send(`Failed to load target website: ${error.message}`);
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`🚀 Proxy server running at http://localhost:${PORT}`);
    console.log(`🔗 Try visiting: http://localhost:${PORT}/proxy?url=https://example.com`);
});
