(async function() {
    console.log("⚡ M.U.G.E.N Void Engine Initialized! Ranged Jutsu Loaded...");

    // The proxy adds a <base> tag pointing at the target site, so our own files
    // must be loaded from the origin this script came from.
    const ENGINE_ORIGIN = new URL(document.currentScript.src).origin;
    const html = document.documentElement;
    const body = document.body;

    // ==========================================
    // 1. PAGE PREP: BACKGROUND STAGE & CANVAS
    // ==========================================
    // Remember the page's own background before we take over <html>'s background.
    function readPageBg() {
        for (const el of [body, html]) {
            const c = getComputedStyle(el).backgroundColor;
            if (c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c)) return c;
        }
        return 'rgb(255, 255, 255)';
    }
    const pageBg = readPageBg();

    // The backdrop shows through holes and above the page; body keeps the page colour.
    html.style.setProperty('background', '#120a24', 'important');
    html.style.setProperty('padding-top', '38vh', 'important');
    // Sites with smooth scrolling turn every camera move into a slow animation that restarts
    // each frame and never catches up; the camera needs instant scrolling
    html.style.setProperty('scroll-behavior', 'auto', 'important');
    body.style.setProperty('scroll-behavior', 'auto', 'important');
    // Only the camera moves the page: no scrollbars anywhere (the mouse wheel picks attacks)
    const noScrollbars = document.createElement('style');
    noScrollbars.textContent = '* { scrollbar-width: none !important; } *::-webkit-scrollbar { display: none !important; }';
    document.head.appendChild(noScrollbars);
    // Page y where the website starts. Everything above is backdrop: never solid, never damaged.
    const skyHeight = () => parseFloat(getComputedStyle(html).paddingTop) || 0;
    // A top margin on <body> (or one its first child pushes through it) also shows the backdrop,
    // so the page really starts where the body's box does. Refreshed on every page scan.
    let pageTop = 0;
    const measurePageTop = () => { pageTop = Math.max(skyHeight(), body.getBoundingClientRect().top + window.scrollY); };
    measurePageTop();
    body.style.setProperty('background-color', pageBg, 'important');
    html.style.cursor = 'none';
    body.style.cursor = 'none';

    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = 320;
    bgCanvas.height = 180;
    Object.assign(bgCanvas.style, {
        position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
        objectFit: 'cover', imageRendering: 'pixelated', zIndex: '-2147483647', pointerEvents: 'none'
    });
    html.appendChild(bgCanvas);

    // The page's colour under the whole page, from its top to the bottom of the document. The
    // site's own background used to do this; with the backdrop in its place, a page shorter
    // than the screen, or a body boxed in smaller than its content, would show the backdrop
    // below and beside it. It sits over the backdrop and under everything the site draws.
    const pageFill = document.createElement('div');
    Object.assign(pageFill.style, {
        position: 'absolute', left: '0', zIndex: '-2147483646', pointerEvents: 'none', background: pageBg
    });
    html.appendChild(pageFill);
    function sizePageFill() {
        const bottom = Math.max(html.scrollHeight, body.scrollHeight);
        pageFill.style.top = pageTop + 'px';
        pageFill.style.width = Math.max(html.scrollWidth, window.innerWidth) + 'px';
        pageFill.style.height = Math.max(0, bottom - pageTop) + 'px';
    }

    // Game canvas lives on <html>, outside <body>, so the hole mask never cuts it
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    Object.assign(canvas.style, {
        position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
        // The canvas catches the mouse across the whole screen, so the page underneath never
        // sees it: no hover effects, no hand cursor. Our window listeners still get every event.
        zIndex: '2147483646', pointerEvents: 'auto', cursor: 'none'
    });
    html.appendChild(canvas);

    // The page element under a screen point, looking through our own layers
    function pageElementAt(screenX, screenY) {
        for (const el of document.elementsFromPoint(screenX, screenY)) {
            if (el !== canvas && el !== bgCanvas && el !== html) return el;
        }
        return null;
    }

    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // ==========================================
    // 2. ASSET LOADER
    // ==========================================
    // naruto.json is built by tools/build_atlas.py straight from the MUGEN
    // character files: sprites keep their real axis (feet / center point) and
    // anims keep MUGEN frame timing (ticks at 60 per second).
    // Which character to play: ?char=sasuke on the page URL (Naruto when missing or unknown)
    const CHARACTERS = ['naruto', 'sasuke', 'goku', 'luffy', 'natsu', 'ichigo'];
    // Characters with transformations: form names in the order the transform key cycles them
    const FORMS = {
        goku: ['Base', 'Super Saiyan', 'Super Saiyan 2', 'Super Saiyan 3', 'Super Saiyan God',
               'Super Saiyan Blue', 'Blue Kaioken', 'Ultra Instinct Sign', 'Mastered Ultra Instinct'],
        luffy: ['Base', 'Gear 4 Boundman', 'Gear 4 Snakeman']
    };
    const requested = (new URLSearchParams(location.search).get('char') || '').toLowerCase();
    const CHAR_ID = CHARACTERS.includes(requested) ? requested : 'naruto';
    const ASSET_DIR = ENGINE_ORIGIN + '/characters/' + CHAR_ID + '/';
    let charData = null;
    let sheets = [];

    try {
        const response = await fetch(ASSET_DIR + CHAR_ID + '.json');
        charData = await response.json();
        sheets = await Promise.all(charData.sheets.map(file => new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = ASSET_DIR + file;
        })));
        console.log(`✅ ${CHAR_ID} assets loaded`);
    } catch (err) {
        console.error("❌ Asset loading failed:", err);
        return;
    }

    // ==========================================
    // 2b. SOUND
    // ==========================================
    // Character sounds come from the MUGEN .snd (tools/snd_extract.py) and load in the
    // background. Destruction sounds (tearing, clinks, thuds, crackle) are generated here.
    // Browsers only allow audio after the player's first key press or click.
    const audio = new (window.AudioContext || window.webkitAudioContext)();
    const master = audio.createGain();
    master.connect(audio.destination);
    const sfx = {};          // name -> AudioBuffer
    const lastPlayed = {};   // name -> audio time it last started, so repeats don't stack
    const MAX_VOICES = 24;
    let liveVoices = 0;

    let volume = parseFloat(readSetting('wd-volume', '0.7'));
    let muted = readSetting('wd-muted', '0') === '1';
    function applyVolume() {
        master.gain.value = muted ? 0 : volume;
    }
    applyVolume();

    // All clips arrive in one file (sounds.bin, MP3s back to back) with an index of where
    // each one sits: one request, and download managers don't grab them as audio files
    (async () => {
        try {
            const [index, pack] = await Promise.all([
                fetch(ASSET_DIR + 'sounds/sounds.json').then(r => r.json()),
                fetch(ASSET_DIR + 'sounds/sounds.bin').then(r => r.arrayBuffer())
            ]);
            await Promise.all(Object.entries(index).map(async ([name, [offset, length]]) => {
                // decodeAudioData takes ownership of its buffer, so give it a copy of the slice
                sfx[name] = await audio.decodeAudioData(pack.slice(offset, offset + length));
            }));
        } catch (err) {
            console.warn('Sounds failed to load:', err);
        }
    })();

    const unlockAudio = () => { if (audio.state !== 'running') audio.resume(); };
    window.addEventListener('keydown', unlockAudio, true);
    window.addEventListener('mousedown', unlockAudio, true);

    function canPlay(name, minGap) {
        if (audio.state !== 'running' || liveVoices >= MAX_VOICES) return false;
        if (audio.currentTime - (lastPlayed[name] ?? -1) < minGap) return false;
        lastPlayed[name] = audio.currentTime;
        return true;
    }

    function track(src) {
        liveVoices++;
        src.onended = () => liveVoices--;
    }

    function playSound(name, { volume: v = 1, rate = 1, minGap = 0.03 } = {}) {
        const buf = sfx[name];
        if (!buf || !canPlay(name, minGap)) return;
        const src = audio.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = rate;
        const gain = audio.createGain();
        gain.gain.value = v;
        src.connect(gain).connect(master);
        track(src);
        src.start();
    }

    // Quieter the further a sound is from the middle of the screen (page coordinates). Uses the
    // scroll position from the start of the tick: debris sounds play between moves of the
    // broken-off cards, and reading it there would make the browser lay the page out each time.
    let viewX = window.scrollX, viewY = window.scrollY;
    function nearVolume(x, y) {
        const cx = viewX + window.innerWidth / 2, cy = viewY + window.innerHeight / 2;
        return Math.max(0, 1 - Math.hypot(x - cx, y - cy) / 1600);
    }

    const noiseBuffer = (() => {
        const buf = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        return buf;
    })();

    // A short filtered burst of noise: the building block for tearing, thuds and crackle
    function noiseBurst({ duration, freq, q = 1, type = 'bandpass', volume: v }) {
        if (audio.state !== 'running' || liveVoices >= MAX_VOICES) return;
        const t = audio.currentTime;
        const src = audio.createBufferSource();
        src.buffer = noiseBuffer;
        src.playbackRate.value = 0.6 + Math.random() * 0.8;
        const filter = audio.createBiquadFilter();
        filter.type = type;
        filter.frequency.value = freq;
        filter.Q.value = q;
        const gain = audio.createGain();
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(v, t + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
        src.connect(filter).connect(gain).connect(master);
        track(src);
        src.start(t, Math.random() * 0.5);
        src.stop(t + duration + 0.05);
    }

    const generated = {
        // Paper ripping: a few quick bright bursts
        tear(v = 1) {
            if (!canPlay('tear', 0.08)) return;
            for (let i = 0; i < 4; i++) {
                setTimeout(() => noiseBurst({ duration: 0.05 + Math.random() * 0.09, freq: 2200 + Math.random() * 2600, q: 0.8, volume: 0.22 * v }), i * 35 + Math.random() * 25);
            }
        },
        // Rubble landing: a low, dull knock
        thud(v = 1) {
            if (!canPlay('thud', 0.05)) return;
            noiseBurst({ duration: 0.12, freq: 260, q: 0.7, type: 'lowpass', volume: 0.3 * v });
        },
        // A letter landing: a tiny high tick
        clink(v = 1) {
            if (!canPlay('clink', 0.04) || liveVoices >= MAX_VOICES) return;
            const t = audio.currentTime;
            const osc = audio.createOscillator();
            osc.type = 'triangle';
            osc.frequency.value = 1700 + Math.random() * 1600;
            const gain = audio.createGain();
            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.exponentialRampToValueAtTime(0.06 * v, t + 0.003);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
            osc.connect(gain).connect(master);
            track(osc);
            osc.start(t);
            osc.stop(t + 0.08);
        },
        // Fire: random dry pops
        crackle(v = 1) {
            if (!canPlay('crackle', 0.03)) return;
            noiseBurst({ duration: 0.025 + Math.random() * 0.03, freq: 2500 + Math.random() * 3500, q: 2, volume: 0.07 * v });
        }
    };

    // ==========================================
    // 3. ANIMATION PLAYER
    // ==========================================
    function createAnim(name, startIndex = 0) {
        return { name, index: startIndex, tick: 0, done: false };
    }

    // Advance one tick. Non-looping anims stop on their last frame with done = true.
    function stepAnim(state) {
        const anim = charData.anims[state.name];
        if (state.done) return;
        state.tick++;
        if (state.tick >= anim.frames[state.index].t) {
            state.tick = 0;
            state.index++;
            if (state.index >= anim.frames.length) {
                if (anim.loop) {
                    state.index = 0;
                } else {
                    state.index = anim.frames.length - 1;
                    state.done = true;
                }
            }
        }
    }

    // Draw the current frame with its axis at (x, y). facing -1 mirrors around the axis.
    // centered ignores the axis and centers the sprite on (x, y) instead.
    // rotation (radians) turns the sprite around (x, y), e.g. to point an arrow along its flight.
    // stretchX lengthens it along its own x axis only (beams reaching a target).
    function drawAnim(state, x, y, facing = 1, scale = 1, alpha = 1, centered = false, rotation = 0, stretchX = 1) {
        const anim = charData.anims[state.name];
        const frame = anim.frames[state.index];
        const spr = charData.sprites[frame.s];
        const flipH = (facing === -1) !== frame.flip.includes('H');
        const flipV = frame.flip.includes('V');
        const ax = centered ? spr.w / 2 : spr.ax;
        const ay = centered ? spr.h / 2 : spr.ay;

        ctx.save();
        ctx.globalAlpha = alpha;
        if (anim.blend === 'add' || frame.a) ctx.globalCompositeOperation = 'lighter';
        ctx.translate(x + frame.x * facing * scale, y + frame.y * scale);
        if (rotation) ctx.rotate(rotation);
        ctx.scale((flipH ? -scale : scale) * stretchX, flipV ? -scale : scale);
        ctx.drawImage(sheets[spr.sheet], spr.x, spr.y, spr.w, spr.h, -ax, -ay, spr.w, spr.h);
        ctx.restore();
    }

    // ==========================================
    // 4. PIXEL-ART BACKGROUNDS
    // ==========================================
    // Drawn at 320x180 and scaled up with pixelated rendering. Seeded so each theme
    // looks the same every time.
    const BW = 320, BH = 180;
    const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

    function makeRng(seed) {
        return () => {
            seed = (seed + 0x6D2B79F5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function hexRgb(hex) {
        const n = parseInt(hex.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    // Vertical gradient with ordered dithering between colour bands
    function paintSky(g, stops, y0, y1) {
        const rgb = stops.map(hexRgb);
        const img = g.getImageData(0, 0, BW, BH);
        for (let y = y0; y < y1; y++) {
            const t = ((y - y0) / Math.max(1, y1 - y0 - 1)) * (rgb.length - 1);
            const i = Math.min(Math.floor(t), rgb.length - 2);
            const f = t - i;
            for (let x = 0; x < BW; x++) {
                const c = f > BAYER[(y & 3) * 4 + (x & 3)] / 16 ? rgb[i + 1] : rgb[i];
                const p = (y * BW + x) * 4;
                img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2]; img.data[p + 3] = 255;
            }
        }
        g.putImageData(img, 0, 0);
    }

    function pixelCircle(g, cx, cy, r, color) {
        g.fillStyle = color;
        for (let y = -r; y <= r; y++) {
            const w = Math.floor(Math.sqrt(r * r - y * y));
            g.fillRect(cx - w, cy + y, w * 2 + 1, 1);
        }
    }

    // A jagged ridge line, filled down to the bottom of the image
    function ridge(g, rng, base, amp, roughness, color) {
        g.fillStyle = color;
        let h = base - rng() * amp;
        let slope = 0;
        for (let x = 0; x < BW; x++) {
            slope += (rng() - 0.5) * roughness;
            slope = Math.max(-1.4, Math.min(1.4, slope));
            h += slope;
            if (h < base - amp) { h = base - amp; slope = Math.abs(slope); }
            if (h > base) { h = base; slope = -Math.abs(slope); }
            g.fillRect(x, Math.round(h), 1, BH - Math.round(h));
        }
    }

    function drawCities(g) {
        const rng = makeRng(7);
        paintSky(g, ['#1a0f3a', '#3b1858', '#6e2177', '#b23a7d', '#ec6a6e', '#ffa45c', '#ffd56b'], 0, BH);
        pixelCircle(g, 228, 118, 20, '#ffe9a0');
        // Streaky sunset clouds
        for (let i = 0; i < 16; i++) {
            const y = 14 + Math.floor(rng() * 80);
            const x = Math.floor(rng() * BW) - 30;
            const len = 30 + Math.floor(rng() * 70);
            g.fillStyle = y < 50 ? '#5a2272' : '#c4507a';
            g.fillRect(x, y, len, 2);
            g.fillStyle = y < 50 ? '#7a3088' : '#f07a7a';
            g.fillRect(x + 4, y - 1, len - 10, 1);
        }
        // Back row of towers
        for (let x = -4; x < BW;) {
            const w = 10 + Math.floor(rng() * 18);
            const h = 55 + Math.floor(rng() * 60);
            g.fillStyle = '#4b1f63';
            g.fillRect(x, BH - h, w, h);
            g.fillStyle = '#7a3b8f';
            for (let wy = BH - h + 4; wy < BH - 4; wy += 5) {
                for (let wx = x + 2; wx < x + w - 2; wx += 4) if (rng() < 0.12) g.fillRect(wx, wy, 2, 2);
            }
            x += w + Math.floor(rng() * 4);
        }
        // Front row with lit windows and antennas
        for (let x = -6; x < BW;) {
            const w = 14 + Math.floor(rng() * 22);
            const h = 28 + Math.floor(rng() * 50);
            g.fillStyle = '#22103a';
            g.fillRect(x, BH - h, w, h);
            if (rng() < 0.4) g.fillRect(x + Math.floor(w / 2), BH - h - 8, 1, 8);
            for (let wy = BH - h + 3; wy < BH - 3; wy += 4) {
                for (let wx = x + 2; wx < x + w - 2; wx += 3) {
                    if (rng() < 0.22) {
                        g.fillStyle = rng() < 0.6 ? '#ff8fc8' : '#ffd56b';
                        g.fillRect(wx, wy, 1, 2);
                    }
                }
            }
            x += w + 1 + Math.floor(rng() * 3);
        }
    }

    function drawMountainDusk(g) {
        const rng = makeRng(21);
        paintSky(g, ['#0b1030', '#1d1b4f', '#43286b', '#83386f', '#d0605f', '#f6a05a'], 0, 135);
        g.fillStyle = '#f6a05a';
        g.fillRect(0, 135, BW, BH - 135);
        for (let i = 0; i < 70; i++) {
            g.fillStyle = rng() < 0.7 ? '#ffffff' : '#bcb6ff';
            g.fillRect(Math.floor(rng() * BW), Math.floor(rng() * 70), 1, 1);
        }
        pixelCircle(g, 70, 36, 9, '#fff1c9');
        g.fillStyle = '#e8d7a8';
        g.fillRect(66, 33, 2, 2);
        g.fillRect(72, 39, 3, 2);
        ridge(g, rng, 120, 55, 0.5, '#3d2b63');
        ridge(g, rng, 140, 40, 0.6, '#2a1d4a');
        ridge(g, rng, 162, 26, 0.7, '#140d26');
    }

    function drawSunnyLand(g) {
        const rng = makeRng(3);
        paintSky(g, ['#3d8bff', '#5fb0ff', '#8fd0ff', '#c4ecff'], 0, 150);
        pixelCircle(g, 262, 32, 13, '#fff6a8');
        pixelCircle(g, 262, 32, 10, '#ffffe0');
        // Puffy clouds
        for (let i = 0; i < 7; i++) {
            const cx = Math.floor(rng() * BW);
            const cy = 20 + Math.floor(rng() * 60);
            const puffs = 3 + Math.floor(rng() * 3);
            for (let p = 0; p < puffs; p++) {
                const r = 5 + Math.floor(rng() * 6);
                pixelCircle(g, cx + p * 8 - puffs * 4, cy + 3, r, '#cfe6ff');
                pixelCircle(g, cx + p * 8 - puffs * 4, cy, r, '#ffffff');
            }
        }
        // Rolling hills
        const hill = (base, amp, freq, phase, color) => {
            g.fillStyle = color;
            for (let x = 0; x < BW; x++) {
                const h = Math.round(base - amp * (0.5 + 0.5 * Math.sin(x * freq + phase)) - Math.sin(x * freq * 2.7 + phase) * amp * 0.25);
                g.fillRect(x, h, 1, BH - h);
            }
        };
        hill(138, 18, 0.025, 1, '#7ccf5a');
        hill(156, 14, 0.035, 4, '#4fa83a');
        // Dithered grass texture and little trees
        g.fillStyle = '#3f8f2c';
        for (let i = 0; i < 260; i++) g.fillRect(Math.floor(rng() * BW), 150 + Math.floor(rng() * 30), 1, 1);
        for (let i = 0; i < 12; i++) {
            const tx = Math.floor(rng() * BW);
            const ty = 140 + Math.floor(rng() * 20);
            g.fillStyle = '#6b4a2b';
            g.fillRect(tx, ty, 1, 4);
            pixelCircle(g, tx, ty - 2, 3, '#2e7d32');
        }
    }

    const BACKGROUNDS = {
        'Mountain dusk': drawMountainDusk,
        'Sunny land': drawSunnyLand,
        'Cities': drawCities
    };

    function readSetting(key, fallback) {
        try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
    }
    function writeSetting(key, value) {
        try { localStorage.setItem(key, value); } catch (e) { /* storage blocked: keep in memory only */ }
    }

    let currentBg = readSetting('wd-background', 'Cities');
    if (!BACKGROUNDS[currentBg]) currentBg = 'Cities';

    function setBackground(name) {
        currentBg = name;
        writeSetting('wd-background', name);
        const g = bgCanvas.getContext('2d');
        g.clearRect(0, 0, BW, BH);
        BACKGROUNDS[name](g);
        updateSettingsUi();
    }

    // ==========================================
    // 5. SETTINGS PANEL (shadow DOM so page CSS can't touch it)
    // ==========================================
    const uiHost = document.createElement('div');
    Object.assign(uiHost.style, { position: 'fixed', top: '10px', right: '10px', zIndex: '2147483647' });
    html.appendChild(uiHost);
    const ui = uiHost.attachShadow({ mode: 'open' });
    ui.innerHTML = `
        <style>
            * { box-sizing: border-box; font: 600 12px/1.3 system-ui, sans-serif; cursor: default; }
            .gear { background: rgba(20, 12, 36, 0.85); color: #fff; border: 1px solid #ffffff33;
                    border-radius: 6px; padding: 6px 10px; cursor: pointer; float: right; }
            .panel { clear: both; margin-top: 6px; width: 240px; background: rgba(20, 12, 36, 0.92);
                     color: #fff; border: 1px solid #ffffff33; border-radius: 8px; padding: 10px; }
            .panel[hidden] { display: none; }
            h4 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #ffb74d; }
            .row { display: flex; gap: 6px; margin-bottom: 10px; }
            .row button { flex: 1; background: #ffffff14; color: #fff; border: 1px solid #ffffff2a;
                          border-radius: 5px; padding: 6px 4px; cursor: pointer; }
            .row button.on { background: #ff9800; color: #000; border-color: #ff9800; }
            .sound { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
            .sound button { background: #ffffff14; color: #fff; border: 1px solid #ffffff2a; border-radius: 5px;
                            padding: 5px 8px; cursor: pointer; min-width: 64px; }
            .sound input { flex: 1; accent-color: #ff9800; cursor: pointer; }
            .keys { color: #d8d0ee; font-weight: 500; }
            .keys b { color: #fff; }
        </style>
        <button class="gear" part="gear">⚙ Settings</button>
        <div class="panel" hidden>
            <h4>Background</h4>
            <div class="row" id="bgs"></div>
            <h4>Sound</h4>
            <div class="sound">
                <button id="mute"></button>
                <input id="volume" type="range" min="0" max="1" step="0.05" aria-label="Volume">
            </div>
            <h4>Controls</h4>
            <div class="keys">
                <b>A / D</b> run · <b>W / Space</b> jump, hold to fly<br>
                <b>S</b> drop through · <b>Number keys</b> jutsu · <b>Click</b> fire<br>
                <b>T</b> transform (characters with forms)
            </div>
        </div>`;
    const panel = ui.querySelector('.panel');
    ui.querySelector('.gear').addEventListener('click', () => { panel.hidden = !panel.hidden; });
    const bgRow = ui.querySelector('#bgs');
    for (const name of Object.keys(BACKGROUNDS)) {
        const b = document.createElement('button');
        b.textContent = name;
        b.addEventListener('click', () => setBackground(name));
        bgRow.appendChild(b);
    }
    const muteButton = ui.querySelector('#mute');
    const volumeSlider = ui.querySelector('#volume');
    volumeSlider.value = volume;
    volumeSlider.addEventListener('input', () => {
        volume = parseFloat(volumeSlider.value);
        writeSetting('wd-volume', String(volume));
        applyVolume();
    });
    // Keys pressed on the slider shouldn't also move the character
    volumeSlider.addEventListener('keydown', e => e.stopPropagation());
    muteButton.addEventListener('click', () => {
        muted = !muted;
        writeSetting('wd-muted', muted ? '1' : '0');
        applyVolume();
        updateSettingsUi();
    });

    function updateSettingsUi() {
        for (const b of bgRow.children) b.classList.toggle('on', b.textContent === currentBg);
        muteButton.textContent = muted ? 'Unmute' : 'Mute';
    }
    setBackground(currentBg);

    function isUiEvent(e) {
        return e.composedPath().includes(uiHost);
    }

    // ==========================================
    // 6. WORLD: PLATFORMS FROM PAGE CONTENT
    // ==========================================
    // Everything in the world (the character, effects, holes) uses page coordinates, so it
    // stays attached to the page while it scrolls. Rendering subtracts the scroll.
    let platforms = [];   // { x1, x2, y } one-way ledges (land on them from above)
    let textBoxes = [];   // { node, x1, y1, x2, y2 } text nodes, for knocking letters loose
    let wallBands = new Map(); // card-sized solid boxes { x1, x2, y1, y2 }: their sides stop broken-off cards
    let platformBands = new Map(); // ledges grouped by height, for fast landing checks
    const BAND = 64;

    const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME']);
    const LOOSE = 'data-wd-loose'; // marks page elements knocked off as debris (see section 8)

    // Sticky headers and fixed bars would follow the screen. Pin them to the page instead,
    // where they currently are, so they scroll away and become ground like everything else.
    function unpinBars() {
        const pinned = [];
        for (const el of body.querySelectorAll('*')) {
            const pos = getComputedStyle(el).position;
            if (pos === 'fixed' || pos === 'sticky') pinned.push({ el, pos, r: el.getBoundingClientRect() });
        }
        const sx = window.scrollX, sy = window.scrollY;
        for (const { el, pos, r } of pinned) {
            const set = (k, v) => el.style.setProperty(k, v, 'important');
            if (pos === 'sticky') {
                set('position', 'relative');
                set('top', 'auto');
                set('bottom', 'auto');
                continue;
            }
            set('position', 'absolute');
            set('right', 'auto');
            set('bottom', 'auto');
            set('width', r.width + 'px');
            // Offsets are relative to the containing block; a static <body> means the page itself
            const parent = el.offsetParent;
            // A fixed element's spot on screen is where the site meant it on its page, which now
            // starts below the sky strip, so it moves down by the sky's height either way
            let ox = -sx, oy = -sy - skyHeight();
            if (parent && !(parent === body && getComputedStyle(body).position === 'static')) {
                const pr = parent.getBoundingClientRect();
                ox = pr.left + parent.clientLeft;
                oy = pr.top + parent.clientTop - skyHeight();
            }
            set('left', (r.left - ox) + 'px');
            set('top', (r.top - oy) + 'px');
        }
    }

    function scanPage() {
        const sx = window.scrollX, sy = window.scrollY;
        const nextPlatforms = [];
        const nextText = [];
        const nextWalls = [];
        const range = document.createRange();
        unpinBars();

        const b = body.getBoundingClientRect();
        nextPlatforms.push({ x1: b.left + sx, x2: b.right + sx, y: b.top + sy });

        // Each rendered line of text is a ledge
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                const parent = node.parentElement;
                if (!parent || SKIP_TAGS.has(parent.tagName) || !node.data.trim()) return NodeFilter.FILTER_REJECT;
                if (parent.closest(`[${LOOSE}]`)) return NodeFilter.FILTER_REJECT; // knocked off the page
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        while (walker.nextNode()) {
            const node = walker.currentNode;
            range.selectNodeContents(node);
            let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
            for (const r of range.getClientRects()) {
                if (r.width < 2 || r.height < 2) continue;
                nextPlatforms.push({ x1: r.left + sx, x2: r.right + sx, y: r.top + sy });
                x1 = Math.min(x1, r.left + sx); y1 = Math.min(y1, r.top + sy);
                x2 = Math.max(x2, r.right + sx); y2 = Math.max(y2, r.bottom + sy);
            }
            if (x2 > x1) nextText.push({ node, x1, y1, x2, y2 });
        }

        // Images, form controls and visibly coloured boxes are ledges too
        const boxes = body.querySelectorAll('img, svg, video, canvas, input, button, select, textarea, hr, table, th, td, header, nav, div, section, aside');
        for (let i = 0; i < boxes.length && i < 6000; i++) {
            const el = boxes[i];
            if (el.closest(`[${LOOSE}]`)) continue;
            const r = el.getBoundingClientRect();
            if (r.width < 12 || r.height < 4) continue;
            const tag = el.tagName;
            const media = tag === 'IMG' || tag === 'svg' || tag === 'VIDEO' || tag === 'CANVAS';
            let solid = media || tag === 'INPUT' || tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'HR';
            if (!solid) {
                const cs = getComputedStyle(el);
                const bg = cs.backgroundColor;
                const hasBg = bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg) && bg !== pageBg;
                const hasBorder = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none';
                solid = hasBg || hasBorder;
            }
            if (!solid) continue;
            nextPlatforms.push({ x1: r.left + sx, x2: r.right + sx, y: r.top + sy });
            if (r.width < window.innerWidth * 0.8 && r.height < window.innerHeight * 1.2) {
                nextWalls.push({ x1: r.left + sx, x2: r.right + sx, y1: r.top + sy, y2: r.bottom + sy });
            }
        }

        measurePageTop();
        sizePageFill();
        const sky = pageTop;
        platforms = nextPlatforms.filter(pl => pl.y >= sky - 1);
        textBoxes = nextText;
        wallBands = new Map();
        for (const w of nextWalls) {
            for (let k = Math.floor(w.y1 / BAND); k <= Math.floor(w.y2 / BAND); k++) {
                if (!wallBands.has(k)) wallBands.set(k, []);
                wallBands.get(k).push(w);
            }
        }
        platformBands = new Map();
        for (const pl of platforms) {
            const k = Math.floor(pl.y / BAND);
            if (!platformBands.has(k)) platformBands.set(k, []);
            platformBands.get(k).push(pl);
        }
    }

    let rescanTimer = null;
    function scheduleRescan() {
        clearTimeout(rescanTimer);
        rescanTimer = setTimeout(scanPage, 300);
    }
    scanPage();
    window.addEventListener('load', scheduleRescan);
    window.addEventListener('resize', scheduleRescan);
    new ResizeObserver(scheduleRescan).observe(body);

    // ==========================================
    // 7. CRATERS: ONE DAMAGE MAP FOR THE WHOLE PAGE
    // ==========================================
    // Every blast adds a lumpy blob. Blobs that overlap form one crater (the shape is the
    // union of all blobs), so repeated hits grow a hole instead of stacking rings.
    // The map is stored at 1/DMG resolution and scaled up with hard edges for the pixel look:
    //   holeMap - opaque where the page is gone (the background is painted through it)
    //   decalMap - soot halo, charred rim and the torn paper lip
    const DMG = 3;
    const MAP_MAX = 16384;
    const craters = []; // { x, y, R, waves, soot, age, burn }
    const holeMap = document.createElement('canvas');
    const decalMap = document.createElement('canvas');
    const lowRes = document.createElement('canvas'); // per-frame viewport composite
    const pageRgb = (pageBg.match(/\d+/g) || [255, 255, 255]).slice(0, 3).map(Number);

    function hash(x, y) {
        const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        return s - Math.floor(s);
    }

    const RIM_STEPS = 512;
    function radiusAt(c, angle) {
        const i = Math.round((angle + Math.PI) / (Math.PI * 2) * RIM_STEPS) % RIM_STEPS;
        return c.rim[i];
    }

    // The crater's outline: its radius at RIM_STEPS angles around it
    function buildRim(c) {
        c.rim = new Float32Array(RIM_STEPS);
        for (let i = 0; i < RIM_STEPS; i++) {
            const angle = i / RIM_STEPS * Math.PI * 2 - Math.PI;
            let r = 1;
            for (const w of c.waves) r += w.a * Math.sin(w.k * angle + w.p);
            c.rim[i] = c.R * r;
        }
        rimBounds(c);
    }

    function rimBounds(c) {
        // Squared distances inside which a point is deep in the hole (below even the lowest rim,
        // the torn lip and the edge jitter) and beyond which it's past the soot
        let lo = Infinity, hi = 0;
        for (const r of c.rim) { lo = Math.min(lo, r); hi = Math.max(hi, r); }
        c.inner2 = Math.max(0, lo - c.R * 0.17 - DMG * 3) ** 2;
        c.outer2 = (hi + c.soot + DMG * 3) ** 2;
    }

    // Signed distance from one crater's edge to a point (dx, dy) from its centre: < 0 inside.
    // A blob's edge is its lumpy rim; a groove's runs straight along both sides of its line.
    function edgeDistance(c, dx, dy) {
        if (!c.seg) return Math.sqrt(dx * dx + dy * dy) - radiusAt(c, Math.atan2(dy, dx));
        const g = c.seg;
        const px = dx + c.x - g.x1, py = dy + c.y - g.y1;
        const t = Math.max(0, Math.min(1, (px * g.dx + py * g.dy) / g.len2));
        return Math.hypot(px - t * g.dx, py - t * g.dy) - c.w;
    }

    // A random point on a crater's edge, `out` times as far out as the edge
    function rimPoint(c, out = 1) {
        if (c.seg) {
            const g = c.seg, t = Math.random(), n = Math.sqrt(g.len2);
            const d = c.w * out * (Math.random() < 0.5 ? 1 : -1);
            return [g.x1 + g.dx * t - g.dy / n * d, g.y1 + g.dy * t + g.dx / n * d];
        }
        const a = Math.random() * Math.PI * 2, d = radiusAt(c, a) * out;
        return [c.x + Math.cos(a) * d, c.y + Math.sin(a) * d];
    }

    // Signed distance-ish to the crater union: < 0 inside a hole. Also returns the nearest blob.
    function craterField(x, y, list = craters) {
        let best = Infinity, owner = null;
        for (const c of list) {
            const dx = x - c.x, dy = y - c.y;
            if (Math.abs(dx) > c.R * 1.5 + c.soot || Math.abs(dy) > c.R * 1.5 + c.soot) continue;
            const f = edgeDistance(c, dx, dy);
            if (f < best) { best = f; owner = c; }
        }
        return { f: best, owner };
    }

    function inHole(x, y) {
        return y >= pageTop && craterField(x, y).f < 0;
    }

    function ensureMapSize() {
        const w = Math.min(MAP_MAX, Math.ceil(Math.max(html.scrollWidth, window.innerWidth) / DMG) + 2);
        const h = Math.min(MAP_MAX, Math.ceil(Math.max(html.scrollHeight, body.scrollHeight) / DMG) + 2);
        for (const map of [holeMap, decalMap]) {
            if (map.width >= w && map.height >= h) continue;
            const copy = document.createElement('canvas');
            copy.width = map.width; copy.height = map.height;
            if (map.width && map.height) copy.getContext('2d').drawImage(map, 0, 0);
            map.width = Math.max(w, map.width);
            map.height = Math.max(h, map.height);
            map.getContext('2d').drawImage(copy, 0, 0);
        }
    }

    // Recompute every map pixel in a page-space box from all craters touching it
    function paintDamage(x0, y0, x1, y1) {
        const mx0 = Math.max(0, Math.floor(x0 / DMG)), my0 = Math.max(0, Math.floor(y0 / DMG));
        const mx1 = Math.min(holeMap.width, Math.ceil(x1 / DMG)), my1 = Math.min(holeMap.height, Math.ceil(y1 / DMG));
        const w = mx1 - mx0, h = my1 - my0;
        if (w <= 0 || h <= 0) return;
        const near = craters.filter(c => c.x + c.R * 1.5 + c.soot > x0 && c.x - c.R * 1.5 - c.soot < x1 &&
                                         c.y + c.R * 1.5 + c.soot > y0 && c.y - c.R * 1.5 - c.soot < y1);
        const sky = pageTop;
        const holes = new ImageData(w, h);
        const decal = new ImageData(w, h);
        const put = (img, p, r, g, b, a) => { img.data[p] = r; img.data[p + 1] = g; img.data[p + 2] = b; img.data[p + 3] = a; };

        for (let my = 0; my < h; my++) {
            for (let mx = 0; mx < w; mx++) {
                const gx = mx0 + mx, gy = my0 + my;
                const px = (gx + 0.5) * DMG, py = (gy + 0.5) * DMG;
                // A cell straddling the page's top edge still opens (it only shows backdrop);
                // skipping it would leave a thin strip of page to stand on
                if ((gy + 1) * DMG <= sky) continue;
                const inSky = py < sky;
                const qy = Math.max(py, sky);
                let raw = Infinity, c = null;
                for (const k of near) {
                    const dx = px - k.x, dy = qy - k.y, d2 = dx * dx + dy * dy;
                    if (d2 > k.outer2) continue;
                    if (d2 < k.inner2) { raw = -Infinity; c = k; break; } // deep in the hole: no rim here
                    const f = edgeDistance(k, dx, dy);
                    if (f < raw) { raw = f; c = k; }
                }
                if (!c) continue;
                const f = raw + (hash(gx, gy) - 0.5) * DMG * 1.6; // ragged pixel edge
                const p = (my * w + mx) * 4;
                if (f < 0) {
                    put(holes, p, 0, 0, 0, 255);
                    if (inSky) continue;
                    // Torn paper lip hanging into the bottom of the hole
                    const lip = c.R * (0.07 + hash(gx, 7) * 0.09);
                    if (!c.clean && py - c.y > c.R * 0.25 && f > -lip) {
                        const edge = f > -lip * 0.35;
                        put(decal, p, ...(edge ? pageRgb.map(v => v - 30) : pageRgb), 255);
                    } else if (f > -DMG * 1.2) {
                        put(decal, p, 24, 16, 14, 255); // charred rim
                    }
                } else if (f < c.soot && !inSky) {
                    // Soot halo: solid near the edge, dithered further out
                    const t = f / c.soot;
                    const keep = Math.pow(1 - t, 1.3) > BAYER[(gy & 3) * 4 + (gx & 3)] / 16;
                    if (t < 0.12) put(decal, p, 30, 24, 22, 255);
                    else if (keep) put(decal, p, ...(t < 0.45 ? [52, 46, 46] : [118, 112, 112]), t < 0.45 ? 235 : 200);
                }
            }
        }
        holeMap.getContext('2d').putImageData(holes, mx0, my0);
        decalMap.getContext('2d').putImageData(decal, mx0, my0);
    }

    const FRESH_STEP = 6; // sampling grid for newly destroyed page, in page pixels
    function addCrater(x, y, R) {
        const waves = [];
        for (let k = 2; k <= 6; k++) {
            waves.push({ k, a: (0.04 + Math.random() * 0.07) / (k * 0.45), p: Math.random() * Math.PI * 2 });
        }
        const c = { x, y, R, waves, soot: R * 0.25 + 6, age: 0, burn: 300 + Math.random() * 300 };
        buildRim(c);
        const reach = R * 1.5;
        return openCrater(c, x - reach, y - reach, x + reach, y + reach);
    }

    // The spikes of a starburst fanned out toward dir (radians): a handful of jagged points of
    // different lengths, longest in the middle. Lengths are fractions of the burst's radius, so
    // the same spikes can burst out again bigger.
    function starSpikes(dir) {
        const spikes = [];
        const n = 6 + Math.floor(Math.random() * 3);
        for (let k = 0; k < n; k++) {
            const t = (k + 0.5) / n * 2 - 1; // -1..1 across the fan
            spikes.push({
                a: dir + t * 1.05 + (Math.random() - 0.5) * 0.2,
                len: (0.6 + Math.random() * 0.4) * (1 - 0.3 * Math.abs(t)),
                w: 0.16 + Math.random() * 0.1 // half-width at the base, in radians
            });
        }
        return spikes;
    }

    // A starburst: jagged spikes splayed out ahead of `dir`, the way lightning bursts out of a
    // strike, out to R. Behind, it narrows to `back` either side, the width of the groove that
    // led in.
    function addStarburst(x, y, R, dir, back, spikes) {
        const c = { x, y, R, soot: 7, age: 0, burn: 200 + Math.random() * 200, clean: true };
        c.rim = new Float32Array(RIM_STEPS);
        for (let i = 0; i < RIM_STEPS; i++) {
            const a = i / RIM_STEPS * Math.PI * 2 - Math.PI;
            const off = Math.abs(Math.atan2(Math.sin(a - dir), Math.cos(a - dir)));
            // The core: a small knot ahead of the groove's end, as narrow as the groove behind it
            let r = back + (R * 0.28 - back) * Math.max(0, Math.cos(off * 0.8));
            for (const sp of spikes) {
                const d = Math.abs(Math.atan2(Math.sin(a - sp.a), Math.cos(a - sp.a)));
                if (d < sp.w) r = Math.max(r, R * 0.25 + (sp.len * R - R * 0.25) * (1 - d / sp.w));
            }
            c.rim[i] = r;
        }
        rimBounds(c);
        return openCrater(c, x - R, y - R, x + R, y + R);
    }

    // A straight groove from (x1, y1) to (x2, y2), w either side of the line: the cut a beam or a
    // dash leaves. Its sides run straight, ragged only at the pixel level like every hole.
    function addGroove(x1, y1, x2, y2, w) {
        const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
        const c = {
            x: (x1 + x2) / 2, y: (y1 + y2) / 2, R: len / 2 + w, w, len,
            seg: { x1, y1, dx, dy, len2: len * len || 1 },
            soot: w * 0.25 + 4, age: 0, burn: 120 + Math.random() * 120, inner2: 0, clean: true
        };
        c.outer2 = (c.R + c.soot + DMG * 3) ** 2;
        return openCrater(c, Math.min(x1, x2) - w, Math.min(y1, y2) - w, Math.max(x1, x2) + w, Math.max(y1, y2) + w);
    }

    // Add a crater over the page box x0..x1, y0..y1 that holds it. The page this removes: inside
    // the new crater, not sky, not already a hole. Debris comes only from here, so hitting the
    // same spot again tears nothing new.
    function openCrater(c, x0, y0, x1, y1) {
        const before = craters.slice();
        const fresh = [];
        for (let py = y0; py <= y1; py += FRESH_STEP) {
            if (py < pageTop) continue;
            for (let px = x0; px <= x1; px += FRESH_STEP) {
                if (craterField(px, py, [c]).f < 0 && craterField(px, py, before).f >= 0) fresh.push([px, py]);
            }
        }
        craters.push(c);
        disturbDebris(c.x, c.y, c.R * 1.6 + 40, 0);
        ensureMapSize();
        const pad = c.soot + DMG * 2;
        paintDamage(x0 - pad, y0 - pad, x1 + pad, y1 + pad);
        return { c, before, fresh };
    }

    // Paint the backdrop into the holes at low resolution, add soot, scale up with hard edges
    function drawCraters() {
        if (!craters.length) return;
        const vw = canvas.width, vh = canvas.height;
        const sx = window.scrollX, sy = window.scrollY;
        const mx0 = Math.floor(sx / DMG), my0 = Math.floor(sy / DMG);
        const offX = mx0 * DMG - sx, offY = my0 * DMG - sy;
        const lw = Math.ceil(vw / DMG) + 2, lh = Math.ceil(vh / DMG) + 2;
        if (lowRes.width !== lw || lowRes.height !== lh) { lowRes.width = lw; lowRes.height = lh; }
        const g = lowRes.getContext('2d');
        g.imageSmoothingEnabled = false;
        g.globalCompositeOperation = 'source-over';
        g.clearRect(0, 0, lw, lh);

        // Same "cover" fit as the CSS backdrop, so holes line up with what's around the page
        const scale = Math.max(vw / BW, vh / BH);
        const dw = BW * scale, dh = BH * scale;
        g.drawImage(bgCanvas, ((vw - dw) / 2 - offX) / DMG, ((vh - dh) / 2 - offY) / DMG, dw / DMG, dh / DMG);
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(holeMap, mx0, my0, lw, lh, 0, 0, lw, lh);
        g.globalCompositeOperation = 'source-over';
        g.drawImage(decalMap, mx0, my0, lw, lh, 0, 0, lw, lh);

        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(lowRes, offX, offY, lw * DMG, lh * DMG);
        ctx.restore();
    }

    // ==========================================
    // 8. DEBRIS: SHARDS, LOOSE LETTERS, FIRE
    // ==========================================
    const shards = [];
    const letters = [];
    const letterQueue = []; // { span, delay } letters waiting to drop one at a time
    const flames = [];
    const puffs = [];       // grey smoke clouds drifting off blasts and burning edges
    const particles = [];
    const MAX_LETTERS_PER_BLAST = 220;

    const MAX_SHARDS = 350;
    const MAX_LETTERS = 1200;
    const blocks = [];      // whole page elements (cards, images, buttons) knocked off the page
    const MAX_BLOCKS = 60;
    const pageWidth = Math.max(html.scrollWidth, window.innerWidth);

    // The colour actually showing at a screen point: the nearest opaque background behind it
    function colorAt(screenX, screenY) {
        let el = pageElementAt(screenX, screenY);
        if (!el) return null;
        for (; el && el !== html; el = el.parentElement) {
            const c = getComputedStyle(el).backgroundColor;
            if (c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c)) return c;
        }
        return pageBg;
    }

    // Torn pieces of whatever was hit (its colour, or the image showing there). They fall,
    // land on ledges and stay as rubble.
    function spawnShards(cx, cy, r, fresh) {
        if (!fresh.length) return; // nothing new was destroyed: nothing to tear out
        const area = fresh.length * FRESH_STEP * FRESH_STEP;
        const count = Math.min(6 + Math.floor(r / 9), Math.ceil(area / 450));
        const maxSize = Math.sqrt(area / count) * 1.3; // a sliver of new damage gives small pieces
        for (let i = 0; i < count; i++) {
            const [x, y] = fresh[Math.floor(Math.random() * fresh.length)];
            const a = Math.atan2(y - cy, x - cx) + (Math.random() - 0.5) * 0.6;
            const color = colorAt(x - window.scrollX, y - window.scrollY);
            if (!color) continue;

            // Use the image actually visible at this spot (carousels stack hidden images)
            const under = pageElementAt(x - window.scrollX, y - window.scrollY);
            const image = under && under.tagName === 'IMG' ? imageSource(under) : null;
            makeShard(x, y, a, Math.min(8 + Math.random() * r * 0.4, maxSize), color, image, x, y);
        }
    }

    function imageSource(img) {
        if (!img.complete || !img.naturalWidth) return null;
        const ir = img.getBoundingClientRect();
        return {
            copy: imageCopy(img, ir.width, ir.height),
            x1: ir.left + window.scrollX, y1: ir.top + window.scrollY, x2: ir.right + window.scrollX, y2: ir.bottom + window.scrollY
        };
    }

    // Debris shows a page image from a copy decoded in the background at the size it's shown:
    // drawing the page's own <img> makes the browser decode the full image there and then.
    // Pieces show their plain colour until the copy is ready.
    const imageCopies = new WeakMap();
    function imageCopy(img, w, h) {
        let c = imageCopies.get(img);
        if (!c) {
            c = { bitmap: null };
            imageCopies.set(img, c);
            createImageBitmap(img, { resizeWidth: Math.max(1, Math.round(w)), resizeHeight: Math.max(1, Math.round(h)), resizeQuality: 'medium' })
                .then(b => { c.bitmap = b; }, () => {});
        }
        return c;
    }

    // An image's average colour, read in the background from a 1-pixel copy of it
    function imageColor(img, done) {
        createImageBitmap(img, { resizeWidth: 1, resizeHeight: 1, resizeQuality: 'medium' }).then(b => {
            try {
                const t = document.createElement('canvas');
                t.width = t.height = 1;
                const tg = t.getContext('2d', { willReadFrequently: true });
                tg.drawImage(b, 0, 0);
                const [r, g, bl, a] = tg.getImageData(0, 0, 1, 1).data;
                if (a > 40) done(`rgb(${r}, ${g}, ${bl})`);
            } catch (e) { /* another site's image: can't be read */ }
        }, () => {});
    }

    // One torn piece flying off at angle a. (ox, oy) is where it was on the page, which is the
    // part of `image` it shows.
    function makeShard(x, y, a, size, color, image, ox, oy) {
        // Mostly plank-like quads, some triangles
        const pts = [];
        if (Math.random() < 0.7) {
            const w = size * (0.8 + Math.random() * 1.4), h = size * (0.25 + Math.random() * 0.45);
            for (const [qx, qy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
                pts.push([qx * w / 2 * (0.8 + Math.random() * 0.4), qy * h / 2 * (0.8 + Math.random() * 0.4)]);
            }
        } else {
            for (let k = 0; k < 3; k++) {
                const pa = (k / 3) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
                pts.push([Math.cos(pa) * size * 0.6, Math.sin(pa) * size * 0.6]);
            }
        }
        shards.push({
            x, y, ox, oy, pts, color, image,
            vx: Math.cos(a) * (2 + Math.random() * 5),
            vy: Math.sin(a) * (2 + Math.random() * 4) - 3 - Math.random() * 3,
            rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.35,
            lines: color === pageBg && Math.random() < 0.6 ? Math.floor(Math.random() * 4) : 0,
            resting: false
        });
        if (shards.length > MAX_SHARDS) shards.splice(0, shards.length - MAX_SHARDS);
    }

    // Bounding box of a piece's outline at its current rotation, relative to its centre
    function shapeBounds(o) {
        const c = Math.cos(o.rot), sn = Math.sin(o.rot);
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const [px, py] of o.pts) {
            const rx = px * c - py * sn, ry = px * sn + py * c;
            if (rx < minX) minX = rx;
            if (rx > maxX) maxX = rx;
            if (ry < minY) minY = ry;
            if (ry > maxY) maxY = ry;
        }
        return { minX, maxX, minY, maxY };
    }

    // Resting rubble is solid: its top edge is a ledge for the character and for other rubble.
    // Rebuilt (grouped by height like page ledges) whenever something settles or wakes.
    let rubbleBands = new Map();
    let rubbleDirty = false;

    function rebuildRubble() {
        rubbleBands = new Map();
        for (const list of [shards, letters, blocks]) {
            for (const o of list) {
                if (!o.resting) continue;
                const b = shapeBounds(o);
                const ledge = { x1: o.x + b.minX * 0.85, x2: o.x + b.maxX * 0.85, y: o.y + b.minY, o };
                if (ledge.x2 - ledge.x1 < 2) continue;
                const k = Math.floor(ledge.y / BAND);
                if (!rubbleBands.has(k)) rubbleBands.set(k, []);
                rubbleBands.get(k).push(ledge);
            }
        }
        rubbleDirty = false;
    }

    function settle(o, resting) {
        if (o.resting !== resting) rubbleDirty = true;
        o.resting = resting;
    }

    // One step of falling for a piece of debris: gravity, then land on the first ledge crossed
    function stepDebris(o, gravity) {
        if (o.resting) return;
        const prevBottom = o.y + shapeBounds(o).maxY;
        o.vy = Math.min(o.vy + gravity, 14);
        o.vx *= 0.995;
        o.x += o.vx;
        o.y += o.vy;
        o.rot += o.vr;
        if ((o.x < 0 && o.vx < 0) || (o.x > pageWidth && o.vx > 0)) {
            o.x = o.x < 0 ? 0 : pageWidth;
            o.vx = -o.vx * 0.4;
        }
        if (o.heavy) hitWalls(o);
        if (o.vy < 0) return;
        const b = shapeBounds(o);
        const bottom = o.y + b.maxY;
        const span = o.heavy ? 0.9 : 0.5; // a card rests on anything under most of its width
        let land = findLanding(o.x + b.minX * span, o.x + b.maxX * span, prevBottom, bottom, o);
        const floor = docBottom();
        if (land === null && bottom >= floor) land = floor; // bottom of the page
        if (land === null) return;
        o.y = land - b.maxY;
        const v = nearVolume(o.x, o.y) * Math.min(1, o.vy / 8);
        if (v > 0.05) o.ch ? generated.clink(v) : generated.thud(v);
        if (o.vy > 2.5) {
            o.vy = -o.vy * 0.25; // small bounce
            o.vx *= 0.55;
            o.vr *= 0.5;
        } else {
            o.vy = 0; o.vx = 0; o.vr = 0;
            if (o.heavy) {
                const flat = restingAngle(o);
                if (Math.abs(o.rot - flat) > 0.03) {
                    o.rot += (flat - o.rot) * 0.2; // still tipping over
                    return;
                }
                o.rot = flat;
            }
            settle(o, true);
        }
    }

    // A broken-off card doesn't balance on a corner: it tips onto its nearest side. A long card
    // that would end up standing on a short end keeps going and falls flat, toward its lean.
    function restingAngle(o) {
        const q = Math.PI / 2;
        const k = Math.round(o.rot / q);
        let flat = k * q;
        const upright = Math.abs(k) % 2 === 1;
        const tall = upright ? o.w / o.h : o.h / o.w; // height over width as it would stand
        if (tall > 1.4) flat += o.rot >= flat ? q : -q;
        return flat;
    }

    // Broken-off cards have mass: the sides of solid boxes on the page stop them (they still
    // land on tops like everything else). Only boxes they run into count, not ones they start in.
    function hitWalls(o) {
        if (!o.vx) return;
        const b = shapeBounds(o);
        const top = o.y + b.minY + 4, bot = o.y + b.maxY - 4;
        if (bot <= top) return;
        const l0 = o.x - o.vx + b.minX, r0 = o.x - o.vx + b.maxX;
        const l1 = o.x + b.minX, r1 = o.x + b.maxX;
        const checked = new Set();
        for (let k = Math.floor(top / BAND); k <= Math.floor(bot / BAND); k++) {
            for (const w of wallBands.get(k) || []) {
                if (checked.has(w)) continue;
                checked.add(w);
                if (w.y1 >= bot || w.y2 <= top) continue;
                if (inHole((w.x1 + w.x2) / 2, Math.max(w.y1, top))) continue; // blasted away there
                let push = 0;
                if (o.vx > 0 && r0 <= w.x1 && r1 > w.x1) push = w.x1 - r1;
                else if (o.vx < 0 && l0 >= w.x2 && l1 < w.x2) push = w.x2 - l1;
                if (!push) continue;
                o.x += push;
                o.vx = -o.vx * 0.3;
                o.vr *= 0.5;
                const v = nearVolume(o.x, o.y) * 0.6;
                if (v > 0.05) generated.thud(v);
                return;
            }
        }
    }

    // Rubble whose support is gone (blasted away, or under a new crater) starts falling again.
    // Pieces stacked on it follow on later checks once it has moved.
    function checkRubbleSupport() {
        if (rubbleDirty) rebuildRubble();
        const floor = docBottom();
        for (const list of [shards, letters, blocks]) {
            for (const o of list) {
                if (!o.resting) continue;
                const b = shapeBounds(o);
                const bottom = o.y + b.maxY;
                if (bottom >= floor - 1) continue;
                if (findLanding(o.x + b.minX * 0.5, o.x + b.maxX * 0.5, bottom - 1, bottom + 1, o) === null) {
                    settle(o, false);
                }
            }
        }
    }

    // Wake resting debris near a point (its ledge may be gone) and optionally blast it outward
    function disturbDebris(cx, cy, reach, force) {
        for (const list of [shards, letters, blocks]) {
            for (const o of list) {
                const dx = o.x - cx, dy = o.y - cy;
                const d = Math.hypot(dx, dy);
                if (d > reach) continue;
                settle(o, false);
                if (force) {
                    const k = force * (1 - d / reach) / (o.heavy || 1);
                    o.vx += (dx / (d || 1)) * k;
                    o.vy += (dy / (d || 1)) * k - k * 0.6;
                    o.vr += (Math.random() - 0.5) * 0.4;
                }
            }
        }
    }

    // ---- Shockwave: a pressure front racing out from (x, y). Everything loose it reaches is
    // hurled away from the centre, the nearer the harder. Debris that comes loose behind the
    // front (letters dropping a tick later) is caught too, for as long as the wave lasts.
    const shockwaves = [];

    function startShockwave(x, y, reach, force, speed = 36) {
        shockwaves.push({ x, y, reach, force, speed, front: 0, hit: new Set() });
    }

    function updateShockwaves() {
        for (let i = shockwaves.length - 1; i >= 0; i--) {
            const w = shockwaves[i];
            w.front += w.speed;
            for (const list of [shards, letters, blocks]) {
                for (const o of list) {
                    if (w.hit.has(o)) continue;
                    const dx = o.x - w.x, dy = o.y - w.y;
                    const d = Math.hypot(dx, dy);
                    if (d > w.front || d > w.reach) continue;
                    w.hit.add(o);
                    settle(o, false);
                    const mass = Math.sqrt(o.heavy || 1);
                    const k = w.force * (0.35 + 0.65 * (1 - d / w.reach)) / mass;
                    const ux = d > 1 ? dx / d : Math.random() - 0.5, uy = d > 1 ? dy / d : -1;
                    o.vx += ux * k;
                    o.vy += uy * k - k * 0.25;
                    o.vr += (Math.random() - 0.5) * k * 0.05 / mass;
                }
            }
            if (w.front >= w.reach) shockwaves.splice(i, 1);
        }
    }

    // Shinra Tensei repels everything around it, not just what its crater removes: cards nearby
    // break off whole, and the text around the crater is torn off letter by letter, each piece
    // released as the front reaches it.

    // Cards: the outermost card under each point of a grid over the circle. Returns true if any
    // came off (the ledges changed).
    function tearCards(cx, cy, reach) {
        const seen = new Set();
        const picked = [], gone = [];
        const step = 80;
        for (let gy = cy - reach; gy <= cy + reach && picked.length < 10; gy += step) {
            for (let gx = cx - reach; gx <= cx + reach && picked.length < 10; gx += step) {
                if (Math.hypot(gx - cx, gy - cy) > reach || gy < pageTop) continue;
                const sx = gx - window.scrollX, sy = gy - window.scrollY;
                if (sx < 0 || sy < 0 || sx >= window.innerWidth || sy >= window.innerHeight) continue;
                for (const top of document.elementsFromPoint(sx, sy)) {
                    if (top === canvas || top === bgCanvas || top === html || top === body) continue;
                    if (seen.has(top) || top.closest(`[${LOOSE}]`)) continue;
                    let card = null;
                    for (let el = top; el && el !== body; el = el.parentElement) {
                        if (seen.has(el)) break;
                        seen.add(el);
                        const r = el.getBoundingClientRect();
                        if (isCard(el, r)) card = { el, r };
                    }
                    if (!card || picked.some(p => p.el.contains(card.el) || card.el.contains(p.el))) continue;
                    if (card.el.querySelector(`[${LOOSE}]`)) continue;
                    const { r } = card;
                    const mx = r.left + r.width / 2 + window.scrollX, my = r.top + r.height / 2 + window.scrollY;
                    if (Math.hypot(mx - cx, my - cy) > reach) continue;
                    if (damageShare(r) > 0.9) gone.push(card.el); // nothing left of it
                    else picked.push(card);
                }
            }
        }
        detachCards(picked, cx, cy);
        for (const el of gone) el.style.visibility = 'hidden';
        return picked.length > 0;
    }

    // Letters: the nearest ones still on the page
    function tearLetters(cx, cy, letterReach, maxLetters) {
        const range = document.createRange();
        const found = [];
        for (const t of textBoxes) {
            if (t.x2 < cx - letterReach || t.x1 > cx + letterReach || t.y2 < cy - letterReach || t.y1 > cy + letterReach) continue;
            const node = t.node;
            if (!node.isConnected || node.parentNode.wdLetter || node.parentElement.closest(`[${LOOSE}]`)) continue;
            const text = node.data;
            for (let i = 0; i < text.length; i++) {
                if (/\s/.test(text[i])) continue;
                range.setStart(node, i);
                range.setEnd(node, i + 1);
                const r = range.getBoundingClientRect();
                if (!r.width) continue;
                const px = r.left + r.width / 2 + window.scrollX;
                const py = r.top + r.height / 2 + window.scrollY;
                const d = Math.hypot(px - cx, py - cy);
                if (d > letterReach || py < pageTop || inHole(px, py)) continue;
                found.push({ node, i, d });
            }
        }
        found.sort((a, b) => a.d - b.d);
        const picks = found.slice(0, maxLetters);
        // Split from the highest index down so earlier indices in the same node stay valid
        picks.sort((a, b) => a.node === b.node ? b.i - a.i : 0);
        for (const { node, i, d } of picks) {
            if (!node.isConnected || i >= node.data.length) continue;
            const ch = node.splitText(i);
            ch.splitText(1);
            const span = document.createElement('span');
            span.wdLetter = true;
            ch.replaceWith(span);
            span.appendChild(ch);
            letterQueue.push({ span, delay: Math.floor(d / 36), from: { x: cx, y: cy } });
        }
    }

    // Wrap individual characters in hidden-able spans and queue them to fall. Letters the blast
    // destroyed (inside the new hole, not in an older one) all fly out; a few right at the new
    // rim shake loose. Letters already under a hole were destroyed before and stay gone.
    function loosenLetters({ c, before }) {
        const cx = c.x, cy = c.y, rim = (c.w || c.R) * 0.3, rOut = c.R * 1.5 + rim;
        const range = document.createRange();
        const picks = [];
        for (const t of textBoxes) {
            if (picks.length >= MAX_LETTERS_PER_BLAST) break;
            if (t.x2 < cx - rOut || t.x1 > cx + rOut || t.y2 < cy - rOut || t.y1 > cy + rOut) continue;
            const node = t.node;
            if (!node.isConnected) continue;
            const text = node.data;
            for (let i = 0; i < text.length && picks.length < MAX_LETTERS_PER_BLAST; i++) {
                if (/\s/.test(text[i])) continue;
                range.setStart(node, i);
                range.setEnd(node, i + 1);
                const r = range.getBoundingClientRect();
                if (!r.width) continue;
                const px = r.left + r.width / 2 + window.scrollX;
                const py = r.top + r.height / 2 + window.scrollY;
                if (py < pageTop) continue;
                const f = craterField(px, py, [c]).f;
                if (f > rim || craterField(px, py, before).f < 0) continue;
                const inside = f < 0;
                if (!inside && Math.random() > 0.35 * (1 - f / rim)) continue;
                picks.push({ node, i, inside });
            }
        }

        // Split from the highest index down so earlier indices in the same node stay valid
        picks.sort((a, b) => a.node === b.node ? b.i - a.i : 0);
        for (const { node, i, inside } of picks) {
            if (!node.isConnected || i >= node.data.length) continue;
            const ch = node.splitText(i);
            ch.splitText(1);
            const span = document.createElement('span');
            span.wdLetter = true;
            ch.replaceWith(span);
            span.appendChild(ch);
            // Blasted letters leave with the blast, outward; rim letters drop a little later
            letterQueue.push(inside
                ? { span, delay: Math.floor(Math.random() * 4), from: { x: cx, y: cy } }
                : { span, delay: 10 + Math.floor(Math.random() * 60) });
        }
    }

    // Roughly the ink of a glyph, centred on where it's drawn (the line box has extra space)
    function glyphBox(w, h) {
        const hw = w * 0.4, hh = h * 0.28;
        return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
    }

    function dropLetter(span, from) {
        if (!span.isConnected) return;
        const r = span.getBoundingClientRect();
        const cs = getComputedStyle(span);
        span.style.visibility = 'hidden';
        if (!r.width) return;
        const x = r.left + r.width / 2 + window.scrollX, y = r.top + r.height / 2 + window.scrollY;
        const a = from ? Math.atan2(y - from.y, x - from.x) : 0;
        const kick = from ? 3 + Math.random() * 5 : 0;
        letters.push({
            ch: span.textContent,
            font: cs.font || `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`,
            color: cs.color,
            x, y,
            pts: glyphBox(r.width, r.height),
            vx: (Math.random() - 0.5) * 3 + Math.cos(a) * kick,
            vy: -1 - Math.random() * 3 + Math.sin(a) * kick,
            rot: 0, vr: (Math.random() - 0.5) * 0.3,
            resting: false
        });
        if (letters.length > MAX_LETTERS) letters.splice(0, letters.length - MAX_LETTERS);
    }

    // ---- Loose blocks: a card, image or button that a blast tears partly away breaks off whole.
    // It is lifted out of the site's layout (where sections that hide their overflow would clip it
    // and later sections would cover it) into a debris layer of its own: a copy with every style
    // frozen inline, carrying the bite the blast took out of it as a mask. The original is hidden
    // in place so nothing reflows. The copy falls and becomes rubble.
    const debrisLayer = document.createElement('div');
    Object.assign(debrisLayer.style, {
        position: 'absolute', left: '0', top: '0', width: '0', height: '0', overflow: 'visible',
        zIndex: '2147483645', pointerEvents: 'none'
    });
    html.appendChild(debrisLayer);

    // Root box properties the copy gets from its spot in the debris layer instead
    const ROOT_OWN = new Set(['position', 'top', 'left', 'right', 'bottom', 'inset', 'margin', 'margin-top',
        'margin-right', 'margin-bottom', 'margin-left', 'transform', 'translate', 'rotate', 'scale', 'float',
        'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'visibility', 'z-index']);

    function freezeStyles(src, dst, root) {
        const cs = getComputedStyle(src);
        for (let i = 0; i < cs.length; i++) {
            const name = cs[i];
            if (name === 'pointer-events' || (root && ROOT_OWN.has(name))) continue; // debris is never clickable
            dst.style.setProperty(name, cs.getPropertyValue(name));
        }
        const kids = src.children, copies = dst.children;
        for (let i = 0; i < kids.length && i < copies.length; i++) freezeStyles(kids[i], copies[i], false);
    }
    function isOpaque(c) {
        return c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c);
    }

    // A self-contained visual box of a sensible size: media, a control, or a box with its own
    // background, border or shadow. Plain text and big layout sections don't qualify.
    function isCard(el, r) {
        if (el === body || el === html || el === uiHost || el === canvas || el === bgCanvas) return false;
        const vw = window.innerWidth, vh = window.innerHeight;
        if (r.width < 24 || r.height < 16 || r.width > vw * 0.55 || r.height > vh * 0.6) return false;
        if (r.width * r.height > vw * vh * 0.18) return false;
        const tag = el.tagName;
        if (tag === 'IMG' || tag === 'svg' || tag === 'VIDEO' || tag === 'CANVAS' || tag === 'PICTURE' || tag === 'BUTTON') return true;
        const cs = getComputedStyle(el);
        if (cs.display === 'inline') return false;
        const bg = cs.backgroundColor;
        return (isOpaque(bg) && bg !== pageBg) || cs.backgroundImage !== 'none' || cs.boxShadow !== 'none' ||
            (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' && parseFloat(cs.borderLeftWidth) > 0);
    }

    // Share of an element's box that is now hole
    function damageShare(r) {
        let hit = 0;
        for (let i = 0; i < 8; i++) {
            for (let j = 0; j < 8; j++) {
                const px = r.left + window.scrollX + (i + 0.5) / 8 * r.width;
                const py = r.top + window.scrollY + (j + 0.5) / 8 * r.height;
                if (inHole(px, py)) hit++;
            }
        }
        return hit / 64;
    }

    // The outermost card under the newly destroyed page; a card that lost part (not all) of
    // itself breaks off
    function breakOffCards(cx, cy, fresh) {
        if (!fresh.length) return false;
        const seen = new Set();
        const picked = [], gone = [];
        const stride = Math.max(1, Math.floor(fresh.length / 40));
        for (let k = 0; k < fresh.length && picked.length < 4; k += stride) {
            const sx = fresh[k][0] - window.scrollX, sy = fresh[k][1] - window.scrollY;
            if (sx < 0 || sy < 0 || sx >= window.innerWidth || sy >= window.innerHeight) continue;
            // Everything stacked at this point was hit, not just the topmost element (an
            // image can sit under a transparent overlay of links)
            for (const top of document.elementsFromPoint(sx, sy)) {
                if (top === canvas || top === bgCanvas || top === html || top === body) continue;
                if (seen.has(top) || top.closest(`[${LOOSE}]`)) continue;
                // Cards from the inside out; the outermost one that really took damage goes
                const chain = [];
                for (let el = top; el && el !== body; el = el.parentElement) {
                    if (seen.has(el)) break;
                    seen.add(el);
                    const r = el.getBoundingClientRect();
                    if (isCard(el, r)) chain.push({ el, r });
                }
                for (let i = chain.length - 1; i >= 0; i--) {
                    const { el, r } = chain[i];
                    if (picked.some(p => p.el.contains(el) || el.contains(p.el)) || el.querySelector(`[${LOOSE}]`)) break;
                    const share = damageShare(r);
                    if (share < 0.05) continue; // barely scratched: maybe a smaller card inside took the hit
                    if (share > 0.9) gone.push(el); // blown away entirely
                    else picked.push({ el, r });
                    break;
                }
            }
        }
        detachCards(picked, cx, cy);
        for (const el of gone) el.style.visibility = 'hidden';
        return picked.length > 0;
    }

    // Cut the holes the card already has out of it, so the bite travels with it. Returns the
    // mask canvas (opaque = card still there), kept so later blasts can bite into it. The holes
    // are worked out from the craters the same way paintDamage does it: reading them back from
    // the hole map stalls while the browser fetches that whole canvas off the GPU.
    function maskOutHoles(el, r) {
        const left = r.left + window.scrollX, top = r.top + window.scrollY;
        const mw = Math.max(1, Math.ceil(r.width / DMG)), mh = Math.max(1, Math.ceil(r.height / DMG));
        const near = craters.filter(c => c.x + c.R * 1.5 > left && c.x - c.R * 1.5 < left + r.width &&
                                         c.y + c.R * 1.5 > top && c.y - c.R * 1.5 < top + r.height);
        const img = new ImageData(mw, mh);
        for (let my = 0; my < mh; my++) {
            const gy = Math.floor((top + (my + 0.5) * r.height / mh) / DMG);
            const open = (gy + 1) * DMG > pageTop; // the sky never has page to cut
            const py = Math.max((gy + 0.5) * DMG, pageTop);
            for (let mx = 0; mx < mw; mx++) {
                const gx = Math.floor((left + (mx + 0.5) * r.width / mw) / DMG);
                const hole = open && near.length &&
                    craterField((gx + 0.5) * DMG, py, near).f + (hash(gx, gy) - 0.5) * DMG * 1.6 < 0;
                if (!hole) img.data[(my * mw + mx) * 4 + 3] = 255;
            }
        }
        const m = document.createElement('canvas');
        m.width = mw; m.height = mh;
        // Kept in memory, not on the GPU: turning a GPU canvas into an image waits on the GPU
        m.getContext('2d', { willReadFrequently: true }).putImageData(img, 0, 0);
        applyMask(el, m);
        return m;
    }

    function applyMask(el, m) {
        const url = `url(${m.toDataURL()})`;
        for (const pre of ['', '-webkit-']) {
            el.style.setProperty(pre + 'mask-image', url, 'important');
            el.style.setProperty(pre + 'mask-size', '100% 100%', 'important');
            el.style.setProperty(pre + 'mask-repeat', 'no-repeat', 'important');
        }
    }

    // The colour a card's torn pieces get: its own background, else grey until its image's
    // average colour has been read (in the background, see imageColor)
    function cardColor(el, block) {
        const bg = getComputedStyle(el).backgroundColor;
        if (isOpaque(bg)) return bg;
        const img = el.tagName === 'IMG' ? el : el.querySelector('img');
        if (img && img.complete && img.naturalWidth) imageColor(img, c => { block.color = c; });
        return '#8a8f99';
    }

    // A blast that reaches a broken-off card bites into it like into the page: the bitten part
    // tears off as shards, and a card with almost nothing left shatters.
    function damageBlocks(c) {
        for (let i = blocks.length - 1; i >= 0; i--) {
            const o = blocks[i];
            if (Math.hypot(o.x - c.x, o.y - c.y) > c.R * 1.5 + Math.hypot(o.w, o.h) / 2) continue;
            const m = o.mask, mw = m.width, mh = m.height;
            const g = m.getContext('2d');
            const img = g.getImageData(0, 0, mw, mh);
            const cos = Math.cos(o.rot), sin = Math.sin(o.rot);
            const bitten = [];
            let left = 0;
            for (let j = 0; j < mh; j++) {
                for (let k = 0; k < mw; k++) {
                    const p = (j * mw + k) * 4 + 3;
                    if (!img.data[p]) continue;
                    const lx = (k + 0.5) / mw * o.w - o.w / 2, ly = (j + 0.5) / mh * o.h - o.h / 2;
                    const wx = o.x + lx * cos - ly * sin, wy = o.y + lx * sin + ly * cos;
                    if (craterField(wx, wy, [c]).f < 0) {
                        img.data[p] = 0;
                        bitten.push([wx, wy, o.ox + lx, o.oy + ly]);
                    } else left++;
                }
            }
            if (!bitten.length) continue;
            const area = bitten.length * (o.w / mw) * (o.h / mh);
            const shatter = left < (left + bitten.length) * 0.15;
            // Shattering tears up what's left too
            let pieces = bitten;
            if (shatter) {
                pieces = [];
                for (let j = 0; j < mh; j++) for (let k = 0; k < mw; k++) {
                    const lx = (k + 0.5) / mw * o.w - o.w / 2, ly = (j + 0.5) / mh * o.h - o.h / 2;
                    pieces.push([o.x + lx * cos - ly * sin, o.y + lx * sin + ly * cos, o.ox + lx, o.oy + ly]);
                }
            }
            const total = shatter ? o.w * o.h : area;
            const count = Math.min(14, Math.ceil(total / 450));
            const size = Math.min(Math.sqrt(total / count) * 1.3, 8 + (c.w || c.R) * 0.4);
            for (let n = 0; n < count; n++) {
                const [wx, wy, ox, oy] = pieces[Math.floor(Math.random() * pieces.length)];
                const a = Math.atan2(wy - c.y, wx - c.x) + (Math.random() - 0.5) * 0.6;
                makeShard(wx, wy, a, size * (0.6 + Math.random() * 0.4), o.color, o.image, ox, oy);
            }
            if (shatter) {
                o.el.remove();
                blocks.splice(i, 1);
                rubbleDirty = true;
                continue;
            }
            g.putImageData(img, 0, 0);
            applyMask(o.el, m);
            settle(o, false);
        }
    }

    // Every card's styles are read before the page is changed at all: reading styles after a
    // change makes the browser restyle the whole page, once per card
    function detachCards(picked, cx, cy) {
        const lifted = picked.map(({ el, r }) => liftCard(el, r));
        for (const card of lifted) dropCard(card, cx, cy);
    }

    // The frozen copy of a card, not yet on the page
    function liftCard(el, r) {
        const copy = el.cloneNode(true);
        freezeStyles(el, copy, true);
        copy.removeAttribute('id');
        const base = getComputedStyle(el).transform;
        const left = r.left + window.scrollX, top = r.top + window.scrollY;
        const set = (k, v) => copy.style.setProperty(k, v, 'important');
        set('position', 'absolute');
        set('left', left + 'px');
        set('top', top + 'px');
        set('margin', '0');
        set('box-sizing', 'border-box');
        set('width', r.width + 'px');
        set('height', r.height + 'px');
        set('visibility', 'visible');
        set('pointer-events', 'none');
        if (getComputedStyle(el).display === 'inline') set('display', 'inline-block');
        set('transform-origin', '50% 50%');
        set('will-change', 'transform');
        const block = {}; // filled in by dropCard; the colour may arrive before or after
        block.color = cardColor(el, block);
        return {
            el, copy, r, left, top, base, block, mask: maskOutHoles(copy, r),
            image: el.tagName === 'IMG' ? imageSource(el) : null
        };
    }

    // Swap the card for its copy and send the copy flying away from (cx, cy)
    function dropCard({ el, copy, r, left, top, base, block, mask, image }, cx, cy) {
        debrisLayer.appendChild(copy);
        el.setAttribute(LOOSE, '');
        el.style.setProperty('visibility', 'hidden', 'important');

        const x = left + r.width / 2, y = top + r.height / 2;
        const a = Math.atan2(y - cy, x - cx);
        const heavy = 1 + (r.width * r.height) / 6000;
        const hw = r.width / 2, hh = r.height / 2;
        blocks.push(Object.assign(block, {
            el: copy, base: base === 'none' ? '' : ' ' + base,
            x, y, ox: x, oy: y, heavy, w: r.width, h: r.height, mask, image,
            pts: [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]],
            vx: Math.cos(a) * (2 + Math.random() * 3) / Math.sqrt(heavy),
            vy: Math.sin(a) * 2 - 3 - Math.random() * 2,
            rot: 0, vr: (Math.random() - 0.5) * 0.12 / Math.sqrt(heavy),
            resting: false, shown: ''
        }));
        if (blocks.length > MAX_BLOCKS) {
            for (const old of blocks.splice(0, blocks.length - MAX_BLOCKS)) old.el.remove();
        }
    }

    function placeBlock(o) {
        const t = `translate(${(o.x - o.ox).toFixed(1)}px, ${(o.y - o.oy).toFixed(1)}px) rotate(${o.rot.toFixed(3)}rad)${o.base}`;
        if (t === o.shown) return;
        o.el.style.setProperty('transform', t, 'important');
        o.shown = t;
    }

    // Flames sit on the crater's outer edge; points swallowed by a neighbouring blob are skipped
    function spawnFlame(c) {
        const [x, y] = rimPoint(c, 0.97 + Math.random() * 0.1);
        if (y < pageTop || craterField(x, y).f < -DMG * 2) return;
        flames.push({
            x, y,
            vx: (Math.random() - 0.5) * 0.4,
            vy: -(0.5 + Math.random() * 1.1),
            size: 3 + Math.random() * 5,
            life: 0,
            max: 22 + Math.random() * 30
        });
    }

    function spawnPuff(x, y, big) {
        puffs.push({
            x, y,
            r: big ? 10 + Math.random() * 16 : 5 + Math.random() * 7,
            vx: (Math.random() - 0.5) * 0.6,
            vy: -(0.15 + Math.random() * 0.5),
            shade: 120 + Math.floor(Math.random() * 80),
            life: 0,
            max: 80 + Math.random() * 90
        });
    }

    function flameColor(t) {
        if (t < 0.2) return '#fff3a0';
        if (t < 0.45) return '#ffb02e';
        if (t < 0.7) return '#ff5a1f';
        return `rgba(60, 54, 54, ${Math.min(1, (1 - t) * 1.6).toFixed(2)})`; // smoke
    }

    // ==========================================
    // 9. STATE VECTORS & INPUT
    // ==========================================
    const mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const projectiles = [];
    const effects = [];     // one-shot or timed animations drawn in the world
    const timers = [];      // scheduled jutsu steps, counted in ticks

    const player = {
        x: 120,
        y: window.scrollY + 60, // feet (sprite axis) position, in page coordinates
        vx: 0,
        vy: 0,
        speed: 6,
        gravity: 0.6,
        jumpForce: -13,
        isGrounded: false,
        airTicks: 0,
        dropTicks: 0,        // > 0 while dropping through ledges
        direction: 1,
        hidden: false,       // true while a summon (Kurama, Susanoo) stands in for the character
        casting: false,
        floatTicks: 0,       // > 0 while hovering in place (e.g. after Instant Transmission)
        form: 0,             // index into FORMS[CHAR_ID] for characters that transform
        anim: null
    };

    // A character with forms has one body animation per form ("idle_3"); others just "idle"
    function formAnim(name) {
        const perForm = `${name}_${player.form}`;
        return charData.anims[perForm] ? perForm : name;
    }
    player.anim = createAnim(formAnim('jump_down'));

    const ROSTER = {
        naruto: [
            { name: 'Rasenshuriken', cast: castRasenshuriken },
            { name: 'Tailed Beast Bomb', cast: castTailedBeastBomb },
            { name: 'Kurama Bijuudama', cast: castKuramaBijuudama },
            { name: 'Twin Rasenshuriken', cast: castTwinRasenshuriken },
            { name: 'Lava Rasenshuriken', cast: castLavaRasenshuriken },
            { name: 'Sage Rasengan', cast: castSageRasengan }
        ],
        sasuke: [
            { name: 'Great Fireball', cast: castGreatFireball },
            { name: 'Susanoo Arrow', cast: castSusanooArrow },
            { name: 'Chibaku Tensei', cast: castChibakuTensei },
            { name: "Indra's Arrow", cast: castIndrasArrow },
            { name: 'Chidori Senbon', cast: castChidoriSenbon },
            { name: 'Shinra Tensei', cast: castShinraTensei },
            { name: 'Chidori', cast: castChidori }
        ]
    };
    ROSTER.luffy = [
        { name: 'Red Hawk', cast: castRedHawk, forms: [0] },
        { name: 'Hawk Gatling', cast: castHawkGatling, forms: [0] },
        { name: 'Red Rock', cast: castRedRock, forms: [0] },
        { name: 'Gear Third Smash', cast: castGearThirdSmash, forms: [0] },
        { name: 'Eagle Bazooka', cast: castEagleBazooka, forms: [0] },
        { name: 'Kong Gun', cast: castKongGun, forms: [1] },
        { name: 'King Kong Gun', cast: castKingKongGun, forms: [1] },
        { name: 'Leo Bazooka', cast: castLeoBazooka, forms: [1] },
        { name: 'Rhino Schneider', cast: castRhinoSchneider, forms: [1] },
        { name: 'Culverin', cast: castCulverin, forms: [1] },
        { name: 'Kong Organ', cast: castKongOrgan, forms: [1] },
        { name: 'Jet Culverin', cast: castJetCulverin, forms: [2] },
        { name: 'Jet Python', cast: castJetPython, forms: [2] },
        { name: 'Jet Culverin Gatling', cast: castJetCulverinGatling, forms: [2] },
        { name: 'Black Mamba', cast: castBlackMamba, forms: [2] },
        { name: 'King Cobra', cast: castKingCobra, forms: [2] }
    ];
    ROSTER.ichigo = [
        { name: 'Getsuga Tenshou', cast: castGetsuga },
        { name: 'Rapid Bankai Combo', cast: castBankaiCombo },
        { name: 'Air Bankai Slice', cast: castAirBankaiSlice },
        { name: 'Final Bankai Slash', cast: castFinalBankaiSlash },
        { name: '1000 Slice', cast: castThousandSlice },
        { name: 'Final Getsuga Tenshou', cast: castFinalGetsuga },
        { name: 'Bankai Rave', cast: castBankaiRave }
    ];
    ROSTER.natsu = [
        { name: "Fire Dragon's Iron Fist", cast: castIronFist },
        { name: "Fire Dragon's Brilliant Flame", cast: castBrilliantFlame },
        { name: "Fire Dragon's Claw", cast: castClaw },
        { name: 'Crimson Lotus: Fire Dragon\'s Fist', cast: castLotusFist },
        { name: "Fire Dragon's Roar", cast: castRoar },
        { name: 'Exploding Flame Blade', cast: castFlameBlade },
        { name: 'Phoenix Blade', cast: castPhoenixBlade }
    ];
    ROSTER.goku = [
        { name: 'Kamehameha', cast: castKamehameha },
        { name: 'Instant Kamehameha', cast: castInstantKamehameha },
        { name: 'Ki Blast Volley', cast: castKiVolley },
        { name: 'Spirit Bomb', cast: castSpiritBomb, forms: [0, 4] },
        { name: 'Dragon Fist', cast: castDragonFist, forms: [3, 6] }
    ];
    const CHAR_FORMS = FORMS[CHAR_ID] || null;
    // The attacks available right now (some belong to particular forms); number keys follow this order
    function jutsuList() {
        return ROSTER[CHAR_ID].filter(j => !j.forms || j.forms.includes(player.form));
    }
    let selectedJutsu = 0;

    const GAME_KEYS = new Set([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'pageup', 'pagedown', 'home', 'end']);
    const keys = {};
    window.addEventListener('keydown', e => {
        const k = e.key.toLowerCase();
        keys[k] = true;
        if (GAME_KEYS.has(k)) e.preventDefault(); // don't scroll the page
        const slot = parseInt(e.key, 10) - 1;
        if (slot >= 0 && slot < jutsuList().length) selectedJutsu = slot;
        if (k === 't' && CHAR_FORMS && !player.casting) castTransform();
        if ((k === 's' || k === 'arrowdown') && player.isGrounded) player.dropTicks = 14;
    });
    window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

    // The wheel never scrolls the page; each notch picks the next or previous attack. Trackpads
    // send many small deltas, so they add up to a notch first.
    let wheelSum = 0;
    window.addEventListener('wheel', e => {
        if (isUiEvent(e)) return;
        e.preventDefault();
        const list = jutsuList();
        if (!list.length) return;
        wheelSum += e.deltaMode === 0 ? e.deltaY : e.deltaY * 40;
        if (Math.abs(wheelSum) < 40) return;
        const step = Math.sign(wheelSum);
        wheelSum = 0;
        selectedJutsu = (selectedJutsu + step + list.length) % list.length;
    }, { passive: false, capture: true });

    window.addEventListener('mousemove', e => {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
    });

    window.addEventListener('mousedown', e => {
        if (isUiEvent(e)) return;
        e.preventDefault(); // no text selection or focusing page inputs
        if (e.button === 0 && !player.casting) {
            const jutsu = jutsuList()[selectedJutsu];
            if (jutsu) jutsu.cast(e.clientX + window.scrollX, e.clientY + window.scrollY);
        }
    }, true);

    // Clicks are attacks: stop them from following links or pressing page buttons
    window.addEventListener('click', e => {
        if (isUiEvent(e)) return;
        e.preventDefault();
        e.stopPropagation();
    }, true);

    // The snapshot has no scripts, but form fields still work on their own: a search box with
    // autofocus would type every movement key. Lock them and keep focus off the page.
    for (const el of document.querySelectorAll('input, textarea, select, [contenteditable]')) {
        el.removeAttribute('autofocus');
        if (el.isContentEditable) el.contentEditable = 'false';
        else if (el.tagName !== 'SELECT') el.readOnly = true; // disabling would grey it out
        el.tabIndex = -1;
    }
    const blurPage = () => {
        const el = document.activeElement;
        if (el && el !== body && el !== uiHost) el.blur();
    };
    blurPage();
    window.addEventListener('focusin', e => { if (!isUiEvent(e)) blurPage(); }, true);

    function setPlayerAnim(name) {
        name = formAnim(name);
        if (player.anim.name !== name) player.anim = createAnim(name);
    }

    function after(ticks, fn) {
        timers.push({ ticks, fn });
    }

    function spawnEffect(name, x, y, opts = {}) {
        const fx = {
            anim: createAnim(name), x, y,
            facing: opts.facing || 1,
            scale: opts.scale || 1,
            centered: !!opts.centered,
            behind: !!opts.behind,       // draw behind the character
            life: opts.life || null,     // ticks; null = until a non-looping anim ends
            fade: opts.fade || 0,        // ticks of fade-out at the end of life
            growTo: opts.growTo || null, // scale reached after growTime ticks
            growTime: opts.growTime || 30,
            rotation: opts.rotation || 0,
            stretchX: opts.stretchX || 1,     // beams: length multiplier along the sprite's x axis
            stretchTime: opts.stretchTime || 0, // ticks for the stretch to grow from 0
            follow: !!opts.follow,       // stay on the character's feet (auras)
            offsetX: opts.offsetX || 0,  // with follow: offset from his feet, mirrored with his facing
            offsetY: opts.offsetY || 0,
            spin: opts.spin || 0,        // radians turned per tick
            age: 0
        };
        effects.push(fx);
        return fx;
    }

    // ==========================================
    // 10. RANGED JUTSU
    // ==========================================
    function faceTarget(targetX) {
        player.direction = targetX >= player.x ? 1 : -1;
    }

    function startCast(bodyAnim) {
        player.casting = true;
        player.vx = 0;
        setPlayerAnim(bodyAnim);
    }

    function endCast() {
        player.casting = false;
        player.hidden = false;
    }

    function launch(x, y, tx, ty, speed, layers, onHit) {
        const angle = Math.atan2(ty - y, tx - x);
        projectiles.push({
            x, y, tx, ty,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            layers: layers.map(l => ({ ...l, anim: createAnim(l.name) })),
            onHit,
            age: 0
        });
    }

    // A dashing strike flies the character in a straight line at the target (his chest heads
    // for it), at most `reach` far: no gravity, and page ledges don't stop him. onStep(i) runs
    // after each of the steps; onArrive when he gets there.
    const DASH_STEP = 22;
    function dashAt(tx, ty, reach, onStep, onArrive) {
        const sx = player.x, sy = player.y - 40;
        const d = Math.hypot(tx - sx, ty - sy) || 1;
        const dist = Math.min(reach, d);
        const steps = Math.max(3, Math.ceil(dist / DASH_STEP));
        const stepX = (tx - sx) / d * dist / steps, stepY = (ty - sy) / d * dist / steps;
        for (let i = 1; i <= steps; i++) {
            after(i, () => {
                player.vx = stepX || 0.001; // nonzero, so the camera follows him
                player.y += stepY;
                player.floatTicks = 2;
                onStep(i);
            });
        }
        after(steps + 1, () => {
            player.vx = 0;
            onArrive();
        });
    }

    // ---------------- Naruto ----------------

    // [1] Rasenshuriken: Naruto raises it overhead and throws; it explodes into a wind dome.
    function castRasenshuriken(tx, ty) {
        faceTarget(tx);
        startCast('rs_throw');
        spawnEffect('charge', player.x, player.y - 60, { life: 30 });
        playSound('voice_rasenshuriken');
        after(5, () => playSound('rs_spin', { volume: 0.5 }));

        // rs_throw frame 3 (after 5 + 25 + 3 ticks) is the release
        after(33, () => {
            playSound('throw', { volume: 0.6 });
            const startX = player.x + 20 * player.direction;
            const startY = player.y - 55;
            launch(startX, startY, tx, ty, 9, [
                { name: 'rs_core', scale: 0.8 },
                { name: 'rs_spin', scale: 0.9 },
            ], (x, y) => {
                const v = Math.max(0.3, nearVolume(x, y));
                playSound('rs_hit', { volume: 0.8 * v });
                after(20, () => { playSound('blast_rumble', { volume: 0.6 * v }); playSound('rs_hit_tail', { volume: 0.5 * v }); });
                spawnEffect('rs_flash', x, y, { scale: 0.5 });
                spawnEffect('rs_explode', x, y, { scale: 1.3 });
                createExplosion(x, y, { radius: 120, colors: ['#e3f6ff', '#4fc3f7', '#ffffff'] });
            });
        });
        after(70, endCast);
    }

    // [2] Tailed Beast Bomb: Kurama rises behind Naruto in a chakra pillar and fires the bomb.
    function castTailedBeastBomb(tx, ty) {
        faceTarget(tx);
        startCast('tbb_body');
        const facing = player.direction;
        const baseX = player.x;
        const baseY = player.y;

        spawnEffect('tbb_pillar', baseX, baseY, { behind: true });
        spawnEffect('tbb_sparks', baseX, baseY, { behind: true });
        spawnEffect('tbb_fox', baseX - 120 * facing, baseY, { facing, behind: true, life: 100, fade: 20 });
        playSound('voice_tbb_call');
        playSound('charge_small', { volume: 0.5 });
        after(20, () => playSound('fox_appear', { volume: 0.6 }));

        after(45, () => {
            playSound('voice_tbb_fire');
            playSound('fox_fire', { volume: 0.6 });
            const mouthX = baseX - 120 * facing + 220 * facing;
            const mouthY = baseY - 170;
            spawnEffect('charge', mouthX, mouthY, { scale: 1.6, life: 30 });
            launch(mouthX, mouthY, tx, ty, 7, [
                { name: 'tbb_glow', scale: 3, grow: true },
                { name: 'tbb_ball', scale: 0.35, grow: true },
            ], (x, y) => {
                const v = Math.max(0.3, nearVolume(x, y));
                playSound('bomb_hit', { volume: 0.8 * v });
                playSound('bomb_boom', { volume: 0.8 * v });
                after(25, () => playSound('bomb_boom_end', { volume: 0.7 * v }));
                spawnEffect('tbb_explode', x, y, { centered: true, scale: 0.6, life: 40, fade: 25 });
                spawnEffect('shock2', x, y, { scale: 1.5 });
                spawnEffect('shock', x, y, { scale: 3 });
                createExplosion(x, y, { radius: 180, colors: ['#b388ff', '#7c4dff', '#ff9800'] });
            });
        });
        after(80, endCast);
    }

    // [3] Kurama Bijuudama: Naruto becomes Kurama, who fires a fast bomb that bursts in gold.
    function castKuramaBijuudama(tx, ty) {
        faceTarget(tx);
        startCast('idle');
        player.hidden = true;
        const facing = player.direction;
        const baseX = player.x;
        const baseY = player.y;

        spawnEffect('charge', baseX, baseY - 40, { scale: 2, life: 40 });
        spawnEffect('kb_fox', baseX, baseY, { facing, life: 85, fade: 15 });
        playSound('voice_kurama');
        playSound('charge_big', { volume: 0.5 });

        after(40, () => {
            playSound('fox_fire', { volume: 0.7 });
            const mouthX = baseX + 220 * facing;
            const mouthY = baseY - 170;
            launch(mouthX, mouthY, tx, ty, 12, [
                { name: 'tbb_glow', scale: 2 },
                { name: 'tbb_ball', scale: 0.25 },
            ], (x, y) => {
                const v = Math.max(0.3, nearVolume(x, y));
                playSound('bomb_hit', { volume: 0.8 * v });
                playSound('bomb_boom', { volume: 0.7 * v });
                playSound('rs_hit_tail', { volume: 0.5 * v });
                after(25, () => playSound('bomb_boom_end', { volume: 0.7 * v }));
                spawnEffect('kb_explode', x, y, { centered: true });
                spawnEffect('shock', x, y, { scale: 2.5 });
                createExplosion(x, y, { radius: 150, colors: ['#ffd54f', '#ff9800', '#ffffff'] });
            });
        });
        after(85, endCast);
    }

    // [4] Twin Rasenshuriken: Naruto takes his nine-tails chakra form and fires a giant
    // Rasenshuriken alongside a Tailed Beast Bomb wrapped in purple wind.
    function castTwinRasenshuriken(tx, ty) {
        faceTarget(tx);
        startCast('tw_form');
        player.anim = createAnim('tw_form', 2); // skip the crouch/leap, start at the chakra form
        const facing = player.direction;
        const baseX = player.x;
        const baseY = player.y;

        spawnEffect('tbb_pillar', baseX, baseY, { behind: true });
        spawnEffect('tbb_sparks', baseX, baseY, { behind: true });
        spawnEffect('tw_tails', baseX - 10 * facing, baseY - 150, { facing, behind: true, life: 100, fade: 20 });
        playSound('voice_twin_start');
        playSound('charge_big', { volume: 0.5 });
        after(5, () => playSound('twin_charge', { volume: 0.5 }));
        after(10, () => playSound('dash', { volume: 0.5 }));
        after(20, () => playSound('fox_appear', { volume: 0.5 }));

        // tw_form reaches its held pose after 30 + 5 + 5 ticks
        after(40, () => {
            playSound('voice_twin_fire');
            playSound('twin_fire', { volume: 0.7 });
            playSound('twin_ball', { volume: 0.6 });
            const startX = baseX + 60 * facing;
            const startY = baseY - 230;
            launch(startX, startY - 40, tx, ty, 8, [
                { name: 'rs_core', scale: 1.4 },
                { name: 'rs_spin', scale: 1.8 },
            ], (x, y) => {
                const v = Math.max(0.3, nearVolume(x, y));
                playSound('rs_hit', { volume: 0.9 * v });
                after(20, () => { playSound('blast_rumble', { volume: 0.7 * v }); playSound('bomb_boom_end', { volume: 0.7 * v }); });
                spawnEffect('rs_flash', x, y, { scale: 0.8 });
                spawnEffect('rs_explode', x, y, { scale: 2.2 });
                spawnEffect('shock2', x, y, { scale: 2 });
                createExplosion(x, y, { radius: 240, colors: ['#e3f6ff', '#4fc3f7', '#b388ff'] });
            });
            launch(startX, startY + 40, tx, ty, 8, [
                { name: 'tbb_glow', scale: 3, grow: true },
                { name: 'tbb_ball', scale: 0.4, grow: true },
                { name: 'tw_wind', scale: 1 },
            ], (x, y) => {
                playSound('bomb_hit', { volume: 0.7 * Math.max(0.3, nearVolume(x, y)) });
                spawnEffect('shock', x, y, { scale: 3 });
                createExplosion(x, y, { radius: 140, colors: ['#b388ff', '#7c4dff'] });
            });
        });
        after(100, endCast);
    }

    // [5] Lava Rasenshuriken: a molten Rasenshuriken that bursts into a red-hot dome and fire ring.
    function castLavaRasenshuriken(tx, ty) {
        faceTarget(tx);
        startCast('rs_throw');
        spawnEffect('charge', player.x, player.y - 60, { life: 30 });
        playSound('voice_lava');
        playSound('charge_big', { volume: 0.5 });
        after(15, () => playSound('lava_sizzle', { volume: 0.6 }));

        // Same throw as the Rasenshuriken: release on rs_throw frame 3
        after(33, () => {
            playSound('throw', { volume: 0.6 });
            playSound('rs_spin', { volume: 0.4 });
            const startX = player.x + 20 * player.direction;
            const startY = player.y - 55;
            launch(startX, startY, tx, ty, 8, [
                { name: 'lv_crust', scale: 0.9 },
                { name: 'lv_core', scale: 0.9 },
                { name: 'lv_wind', scale: 0.8 },
            ], (x, y) => {
                const v = Math.max(0.3, nearVolume(x, y));
                playSound('rs_hit', { volume: 0.8 * v });
                playSound('bomb_hit', { volume: 0.6 * v });
                playSound('bomb_boom', { volume: 0.6 * v });
                after(20, () => playSound('blast_rumble', { volume: 0.6 * v }));
                spawnEffect('lv_ring', x, y, { centered: true, scale: 1.2 });
                spawnEffect('lv_dome', x, y, { scale: 1.1 });
                spawnEffect('tbb_explode', x, y, { centered: true, scale: 0.45, life: 30, fade: 20 });
                createExplosion(x, y, { radius: 200, colors: ['#ff5722', '#ffab00', '#ffeb3b'] });
            });
        });
        after(70, endCast);
    }

    // [6] Sage Rasengan: a Rasengan swirls up in Naruto's hand, he rushes at the cursor and
    // slams it in. A huge Rasengan grinds into the page for a second, then blows out.
    const RASENGAN_REACH = 600;
    function castSageRasengan(tx, ty) {
        faceTarget(tx);
        startCast('rg_charge');
        playSound('voice_rasengan');
        playSound('charge_small', { volume: 0.5 });
        spawnEffect('charge', player.x, player.y - 30, { scale: 0.7, life: 30 });

        // 30 ticks in, as in the original: the Rasengan forms in his hand and the air stirs
        let ball = null;
        after(30, () => {
            playSound('rg_form', { volume: 0.8 });
            spawnEffect('rg_gust', player.x, player.y - 3, { facing: player.direction });
            ball = spawnEffect('rg_form', player.x, player.y, { follow: true, offsetX: -25, offsetY: -36 });
        });
        after(41, () => {
            ball.life = ball.age; // fully formed: it keeps spinning
            ball = spawnEffect('rg_held', player.x, player.y, { follow: true, offsetX: -25, offsetY: -36 });
        });

        after(60, () => {
            setPlayerAnim('rg_rush');
            playSound('dash', { volume: 0.8 });
            playSound('whoosh', { volume: 0.6 });
            ball.offsetX = -10; // held out at his side for the rush
            ball.offsetY = -40;
            // The ball shoves loose rubble aside as he goes
            dashAt(tx, ty, RASENGAN_REACH, () => disturbDebris(player.x, player.y - 40, 90, 6), () => rasenganStrike(ball));
        });
    }

    function rasenganStrike(ball) {
        player.floatTicks = 90; // he holds it in, even in mid-air
        player.anim = createAnim('rg_strike');
        ball.life = ball.age;
        const dir = player.direction;
        const hx = player.x + 85 * dir, hy = player.y - 39;
        const v = Math.max(0.4, nearVolume(hx, hy));
        after(4, () => playSound('rg_strike', { volume: v }));
        // The big Rasengan: the original draws it at 0.09 of its sprite, baked at 0.27
        const big = spawnEffect('rg_big', hx, hy, { centered: true, scale: 0.33, spin: -0.25, life: 65 });
        spawnEffect('rg_wind', hx, player.y, { facing: dir });
        createExplosion(hx, hy, { radius: 120, colors: ['#e1f5fe', '#4fc3f7', '#ffffff'], smoke: 0.3 });
        // It grinds: the hole widens bit by bit while he keeps pushing
        for (let t = 6; t < 65; t += 6) {
            after(t, () => {
                player.anim = createAnim('rg_strike');
                playSound('rg_grind', { volume: 0.6 * v, minGap: 0 });
                const a = Math.random() * Math.PI * 2, r = 20 + t * 0.6;
                createExplosion(hx + Math.cos(a) * r, hy + Math.sin(a) * r, { radius: 70 + t, colors: ['#e1f5fe', '#81d4fa', '#ffffff'], smoke: 0.15 });
                if (t % 18 === 0) spawnEffect('rg_wind', hx + (Math.random() - 0.5) * 60, player.y, { facing: dir });
            });
        }
        // Then it blows out: the ball swells and bursts
        after(65, () => {
            big.life = big.age;
            playSound('rg_burst', { volume: v });
            playSound('bomb_boom', { volume: 0.7 * v });
            spawnEffect('rg_big', hx, hy, { centered: true, scale: 0.33, growTo: 1, growTime: 20, spin: -0.25, life: 22, fade: 12 });
            createExplosion(hx, hy, { radius: 280, colors: ['#e1f5fe', '#4fc3f7', '#ffffff'], smoke: 0.6 });
            startShockwave(hx, hy, 380, 12);
            setPlayerAnim('rg_end');
        });
        after(85, endCast);
    }

    // ---------------- Sasuke ----------------

    // [1] Great Fireball: Sasuke breathes a fireball that bursts into a ring of flame.
    function castGreatFireball(tx, ty) {
        faceTarget(tx);
        startCast('fb_body');
        player.anim = createAnim('fb_body', 3); // skip the wind-up, start at the inhale
        spawnEffect('charge', player.x, player.y - 40, { scale: 0.7, life: 25 });
        playSound('voice_fireball');
        playSound('charge_small', { volume: 0.5 });

        // fb_body's exhale frame comes 25 ticks after the inhale
        after(25, () => {
            const facing = player.direction;
            const mouthX = player.x + 30 * facing, mouthY = player.y - 35;
            playSound('voice_fireball_fire');
            playSound('fire_roar', { volume: 0.6 });
            spawnEffect('fb_mouth', mouthX, mouthY, { facing });
            launch(mouthX + 20 * facing, mouthY, tx, ty, 7, [
                { name: 'fb_ball', scale: 0.8, grow: true },
            ], (x, y) => {
                const v = Math.max(0.3, nearVolume(x, y));
                playSound('fire_explode', { volume: 0.8 * v });
                spawnEffect('fb_explode', x, y, { scale: 1.2 });
                createExplosion(x, y, { radius: 170, colors: ['#ff6d00', '#ffab00', '#ffe082'] });
            });
        });
        after(60, endCast);
    }

    // [2] Susanoo Arrow: a purple Susanoo rises behind Sasuke and looses an arrow.
    function castSusanooArrow(tx, ty) {
        faceTarget(tx);
        startCast('sa_body');
        player.anim = createAnim('sa_body', 7); // the pointing pose
        const facing = player.direction;
        const baseX = player.x, baseY = player.y;
        spawnEffect('sa_aura', baseX, baseY + 20, { behind: true });
        spawnEffect('charge', baseX, baseY - 40, { scale: 0.7, life: 25 });
        playSound('voice_arrow');
        playSound('susanoo_summon', { volume: 0.6 });

        after(8, () => {
            spawnEffect('sa_susanoo', baseX - 40 * facing, baseY, { facing, behind: true, life: 60, fade: 15 });
            playSound('susanoo_appear', { volume: 0.6 });
            playSound('bow_draw', { volume: 0.6 });
        });

        // The Susanoo's draw finishes on its last frame (5 + 16 ticks after it appears)
        after(30, () => {
            playSound('voice_arrow_fire');
            playSound('bow_fire', { volume: 0.7 });
            launch(baseX + 70 * facing, baseY - 110, tx, ty, 13, [
                { name: 'sa_arrow', scale: 1, aim: 44 },
            ], (x, y) => {
                const v = Math.max(0.3, nearVolume(x, y));
                playSound('arrow_hit', { volume: 0.8 * v });
                playSound('fire_explode', { volume: 0.5 * v });
                spawnEffect('sa_explode', x, y, { centered: true, scale: 0.8, life: 30, fade: 20 });
                spawnEffect('spark', x, y, { scale: 1.2 });
                createExplosion(x, y, { radius: 160, colors: ['#ce93d8', '#7e57c2', '#ffab40'] });
            });
        });
        after(70, endCast);
    }

    // [3] Chibaku Tensei: a core opens at the cursor, rocks gather into a sphere, and it bursts.
    function castChibakuTensei(tx, ty) {
        faceTarget(tx);
        startCast('ct_body');
        player.anim = createAnim('ct_body', 1); // the raised hand
        spawnEffect('charge', player.x, player.y - 40, { scale: 0.9, life: 30 });
        playSound('voice_chibaku');
        playSound('charge_big', { volume: 0.5 });

        after(15, () => {
            playSound('chibaku_start', { volume: 0.7 });
            spawnEffect('ct_core', tx, ty, { centered: true, scale: 0.1, growTo: 0.5, growTime: 30, life: 45, fade: 10 });
        });
        // Rocks gather around the core
        after(25, () => spawnEffect('ct_rocks', tx, ty, { centered: true, scale: 1.1, life: 50, fade: 8 }));
        for (let t = 25; t <= 55; t += 6) after(t, () => playSound('rocks', { volume: 0.5, minGap: 0 }));

        after(75, () => {
            const v = Math.max(0.3, nearVolume(tx, ty));
            playSound('chibaku_drop', { volume: 0.7 * v });
            playSound('chibaku_boom', { volume: 0.9 * v });
            spawnEffect('ct_explode', tx, ty, { centered: true, scale: 1.2 });
            spawnEffect('ct_shock', tx, ty, { centered: true, scale: 1.3 });
            for (let i = 0; i < 4; i++) {
                const a = Math.random() * Math.PI * 2;
                spawnEffect('ct_fire', tx + Math.cos(a) * 90, ty + Math.sin(a) * 60, { scale: 0.9 });
            }
            createExplosion(tx, ty, { radius: 260, colors: ['#8d6e63', '#ff7043', '#ffcc80'] });
        });
        after(45, endCast);
    }

    // [4] Indra's Arrow: Sasuke's Perfect Susanoo draws its bow and fires a lightning arrow.
    function castIndrasArrow(tx, ty) {
        faceTarget(tx);
        startCast('idle');
        player.hidden = true;
        const facing = player.direction;
        const baseX = player.x, baseY = player.y;
        spawnEffect('sa_aura', baseX, baseY + 20, { behind: true, scale: 1.3 });
        spawnEffect('in_flames', baseX - 20 * facing, baseY, { behind: true, scale: 1.4 });
        spawnEffect('in_susanoo', baseX, baseY, { facing, life: 85, fade: 15 });
        playSound('voice_indra');
        playSound('charge_big', { volume: 0.5 });
        after(25, () => playSound('indra_bow', { volume: 0.7 }));

        // in_susanoo looses the arrow on its last frame, 50 ticks in
        after(50, () => {
            playSound('bow_fire', { volume: 0.7 });
            playSound('indra_arrow', { volume: 0.7 });
            launch(baseX + 90 * facing, baseY - 170, tx, ty, 16, [
                { name: 'in_arrow', scale: 1, aim: 36 },
            ], (x, y) => {
                const v = Math.max(0.3, nearVolume(x, y));
                playSound('indra_hit', { volume: 0.9 * v });
                playSound('chibaku_boom', { volume: 0.6 * v });
                spawnEffect('in_flash', x, y, { scale: 0.8 });
                spawnEffect('in_dome', x, y, { scale: 1.3 });
                createExplosion(x, y, { radius: 250, colors: ['#e1f5fe', '#4fc3f7', '#b2ff59'] });
            });
        });
        after(90, endCast);
    }

    // [5] Chidori Senbon: a quick volley of lightning needles that crackle where they land.
    function castChidoriSenbon(tx, ty) {
        faceTarget(tx);
        startCast('cs_body');
        playSound('voice_senbon');

        for (let i = 0; i < 6; i++) {
            after(10 + i * 2, () => {
                const facing = player.direction;
                const sx = player.x + 30 * facing, sy = player.y - 50 - Math.random() * 10;
                // A little spread so the volley peppers the target
                const spread = (Math.random() - 0.5) * 50;
                playSound('needle', { volume: 0.4, minGap: 0 });
                launch(sx, sy, tx + spread, ty + spread * 0.6, 18, [
                    { name: 'cs_needle', scale: 1, aim: 0 },
                ], (x, y) => {
                    generated.crackle(nearVolume(x, y) * 3);
                    spawnEffect('cs_bolt', x + (Math.random() - 0.5) * 20, y - 10, { scale: 1.2 });
                    spawnEffect('spark', x, y, { scale: 0.35 });
                    createExplosion(x, y, { radius: 45, colors: ['#bbdefb', '#64b5f6', '#ffffff'] });
                });
            });
        }
        after(40, endCast);
    }

    // [6] Shinra Tensei: a shockwave bursts out from Sasuke himself. It tears a crater around
    // him, rips the cards and text nearby off the page, and hurls everything loose in its reach
    // violently away. Not aimed: the cursor only sets his facing.
    function castShinraTensei(tx, ty) {
        faceTarget(tx);
        startCast('st_body');
        spawnEffect('charge', player.x, player.y - 35, { scale: 0.7, life: 35 });
        playSound('voice_shinra');
        playSound('charge_small', { volume: 0.5 });

        // st_body throws its arms out 35 ticks in, when the original releases the wave
        after(35, () => {
            const cx = player.x, cy = player.y - 40;
            playSound('shinra_blast', { volume: 0.9 });
            playSound('chibaku_boom', { volume: 0.5 });
            spawnEffect('st_wave', cx, cy, { centered: true, scale: 1, growTo: 1.8, growTime: 30 });
            createExplosion(cx, cy, { radius: 300, colors: ['#eceff1', '#b0bec5', '#ffffff'] });
            startShockwave(cx, cy, 750, 21);
            // The rest is torn loose over the next ticks, while the wave is still close
            after(2, () => { if (tearCards(cx, cy, 420)) scanPage(); });
            after(3, () => tearLetters(cx, cy, 360, 500));
        });
        after(60, endCast);
    }

    // [7] Chidori: lightning gathers in Sasuke's hand, then he dashes straight at the cursor,
    // tearing a trench through the page, and drives it in. Like the original, he keeps thrusting
    // and the lightning bursts again and again where it lands.
    const CHIDORI_REACH = 650; // longest dash
    const CHIDORI_GROOVE = 15; // half the width of the groove it cuts
    function castChidori(tx, ty) {
        faceTarget(tx);
        startCast('cd_charge');
        playSound('voice_chidori');
        playSound('charge_small', { volume: 0.5 });
        spawnEffect('charge', player.x, player.y - 35, { scale: 0.6, life: 30 });

        // The original lights the Chidori 30 ticks in, in the hand he holds low behind him
        let hand = null;
        after(30, () => {
            playSound('chidori_chirp', { volume: 0.7 });
            playSound('chidori_buzz', { volume: 0.6 });
            hand = spawnEffect('cd_hand', player.x, player.y, { follow: true, offsetX: 5, offsetY: -42 });
        });

        after(60, () => {
            setPlayerAnim('cd_dash');
            playSound('chidori_rush');
            playSound('dash', { volume: 0.7 });
            hand.offsetX = 10;  // his arm is out in front for the dash
            hand.offsetY = -30;
            // The lightning cuts a straight groove behind his hand, a piece every few steps
            const handAt = () => [player.x + 25 * player.direction, player.y - 32];
            let last = handAt();
            const cut = () => {
                const [hx, hy] = handAt();
                if (Math.hypot(hx - last[0], hy - last[1]) < 4) return;
                generated.crackle(nearVolume(hx, hy) * 3);
                cutGroove(last[0], last[1], hx, hy, CHIDORI_GROOVE);
                last = [hx, hy];
            };
            const heading = Math.atan2(ty - (player.y - 40), tx - player.x);
            dashAt(tx, ty, CHIDORI_REACH, i => { if (i % 3 === 0) cut(); }, () => {
                cut();
                chidoriStrike(hand, last, heading);
            });
        });
    }

    // The lightning bursts out of the end of the groove (tip) in a starburst along the dash
    function chidoriStrike(hand, tip, heading) {
        player.floatTicks = 45; // he hangs where the strike lands, even in mid-air
        setPlayerAnim('cd_strike');
        hand.life = hand.age; // the Chidori goes into the strike
        const dir = player.direction;
        const hx = player.x + 65 * dir, hy = player.y - 42;
        const star = { dir: heading, back: CHIDORI_GROOVE, spikes: starSpikes(heading) };
        const v = Math.max(0.4, nearVolume(hx, hy));
        playSound('voice_chidori_hit');
        playSound('chidori_hit', { volume: v });
        playSound('chibaku_boom', { volume: 0.5 * v });
        spawnEffect('cd_burst', hx, hy, { scale: 0.9, life: 45, fade: 12 });
        createExplosion(tip[0], tip[1], { radius: 250, colors: ['#e3f2fd', '#64b5f6', '#ffffff'], smoke: 0.3, star });
        startShockwave(hx, hy, 320, 9);
        // He keeps driving it in: thrust after thrust, each one a burst of lightning
        for (let k = 1; k <= 5; k++) {
            after(k * 6, () => {
                player.anim = createAnim('cd_strike'); // from the top: setPlayerAnim won't restart it
                playSound('chidori_hit', { volume: 0.6 * v, minGap: 0 });
                generated.crackle(v * 3);
                // Each thrust drives the same burst further out
                createExplosion(tip[0], tip[1], { radius: 250 + k * 30, colors: ['#e3f2fd', '#90caf9', '#ffffff'], smoke: 0.15, star });
            });
        }
        after(36, () => setPlayerAnim('cd_end'));
        after(58, endCast);
    }

    // ---------------- Luffy ----------------

    // Rubber limbs: Luffy's fist flies out along a path and his arm stretches behind it, back
    // to his shoulder. The arm is drawn as a band in each form's colours; the fist is a sprite
    // from his moves, its far end on the tip of the path.
    const arms = [];
    const ARM_LOOK = [
        { fill: '#eaa271', edge: '#4a1f12', w: 4 },  // Base
        { fill: '#3b1117', edge: '#c3193f', w: 7 },  // Gear 4 Boundman: haki-black, red trim
        { fill: '#3b1117', edge: '#c3193f', w: 5 }   // Gear 4 Snakeman
    ];
    const SHOULDER = [42, 62, 48]; // shoulder height above the feet, per form

    function shoulder() {
        return [player.x + 8 * player.direction, player.y - SHOULDER[player.form]];
    }

    // Stretch an arm along `path` (page points; it starts at his shoulder). Options: tip (fist
    // anim), look (colours, default the current form's), width, speed (px per tick), hold
    // (ticks at full stretch), onStep(x, y) each tick out, onHit(x, y) at full stretch.
    function stretchArm(path, { tip = 'arm_base', look = null, width = null, tipScale = 1, speed = 40, hold = 8, onStep = null, onHit = null } = {}) {
        const arm = {
            path, tip: createAnim(tip), tipScale, look: look || ARM_LOOK[player.form], speed, hold, onStep, onHit,
            len: 0, phase: 'out'
        };
        arm.width = width || arm.look.w;
        arms.push(arm);
        return arm;
    }

    // How many ticks an arm takes out and back over `dist`
    function armTicks(dist, speed, hold) {
        return Math.ceil(dist / speed) + hold + Math.ceil(dist / (speed * 1.5));
    }

    // The arm's points from his shoulder out to its current length, and the heading at the tip
    function armLine(arm) {
        const pts = [shoulder(), ...arm.path];
        const line = [pts[0]];
        let left = arm.len, heading = 0, total = 0;
        for (let i = 1; i < pts.length; i++) {
            const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
            const d = Math.hypot(x1 - x0, y1 - y0) || 1;
            total += d;
            if (left <= 0) continue;
            heading = Math.atan2(y1 - y0, x1 - x0);
            const t = Math.min(1, left / d);
            line.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
            left -= d;
        }
        return { line, heading, total };
    }

    function updateArms() {
        for (let i = arms.length - 1; i >= 0; i--) {
            const a = arms[i];
            stepAnim(a.tip);
            const { line, total } = armLine(a);
            if (a.phase === 'out') {
                a.len = Math.min(total, a.len + a.speed);
                const [x, y] = armLine(a).line.at(-1);
                if (a.onStep) a.onStep(x, y);
                if (a.len >= total) {
                    a.phase = 'hold';
                    if (a.onHit) a.onHit(x, y);
                }
            } else if (a.phase === 'hold') {
                if (--a.hold <= 0) a.phase = 'back';
            } else {
                a.len -= a.speed * 1.5;
                if (a.len <= 0) arms.splice(i, 1);
            }
            if (!line.length) arms.splice(i, 1);
        }
    }

    function drawArms() {
        for (const a of arms) {
            const { line, heading } = armLine(a);
            if (line.length < 2) continue;
            ctx.save();
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            line.forEach(([x, y], k) => k ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
            ctx.strokeStyle = a.look.edge;
            ctx.lineWidth = a.width + 3;
            ctx.stroke();
            ctx.strokeStyle = a.look.fill;
            ctx.lineWidth = a.width;
            ctx.stroke();
            ctx.restore();
            // The fist: its sprite's far end on the tip, pointing along the arm
            const frame = charData.anims[a.tip.name].frames[a.tip.index];
            const spr = charData.sprites[frame.s];
            const reach = (spr.w - spr.ax) * a.tipScale;
            const [tx, ty] = line.at(-1);
            drawAnim(a.tip, tx - Math.cos(heading) * reach, ty - Math.sin(heading) * reach, 1, a.tipScale, 1, false, heading);
        }
    }

    // A path that zigzags out to the target in square turns, like Culverin and Jet Python
    // winding around before they land; `turns` corners, at most `swing` px off the line
    function zigzagPath(tx, ty, turns, swing) {
        const [sx, sy] = shoulder();
        const pts = [];
        let x = sx, y = sy;
        for (let k = 1; k <= turns; k++) {
            const t = k / (turns + 1);
            const nx = sx + (tx - sx) * t;
            pts.push([nx, y]);
            y = sy + (ty - sy) * t + (k % 2 ? -1 : 1) * swing * (0.5 + Math.random() * 0.5);
            pts.push([nx, y]);
            x = nx;
        }
        pts.push([tx, y], [tx, ty]);
        return pts;
    }

    // A path that snakes out to the target in loose diagonal bends (Snakeman's punches)
    function snakePath(tx, ty, bends, swing) {
        const [sx, sy] = shoulder();
        const pts = [];
        for (let k = 1; k <= bends; k++) {
            const t = k / (bends + 1);
            const off = (k % 2 ? 1 : -1) * swing * (0.6 + Math.random() * 0.4);
            const d = Math.hypot(tx - sx, ty - sy) || 1;
            pts.push([sx + (tx - sx) * t - (ty - sy) / d * off, sy + (ty - sy) * t + (tx - sx) / d * off]);
        }
        pts.push([tx, ty]);
        return pts;
    }

    // A flurry of quick punches around (tx, ty): an arm every `every` ticks for `ticks`, each
    // landing at a random spot within `spread` and blasting a small hole there
    function armBarrage(tx, ty, { ticks, every = 3, spread = 90, tip, look = null, width = null, radius = 55, colors, fx = null, fxScale = 1, curve = 0, sound = 'barrage' }) {
        for (let t = 0; t < ticks; t += every) {
            after(t, () => {
                const px = tx + (Math.random() - 0.5) * spread * 2, py = ty + (Math.random() - 0.5) * spread * 1.4;
                const path = curve ? snakePath(px, py, 1, curve) : [[px, py]];
                stretchArm(path, {
                    tip, look, width, speed: 70, hold: 2,
                    onHit: (x, y) => {
                        playSound(sound, { volume: 0.5 * Math.max(0.3, nearVolume(x, y)), minGap: 0.04 });
                        if (fx) spawnEffect(fx, x, y, { centered: true, scale: fxScale * (0.8 + Math.random() * 0.4), rotation: Math.random() * Math.PI * 2 });
                        createExplosion(x, y, { radius, colors, smoke: 0.12 });
                    }
                });
            });
        }
    }

    // A giant limb slams down from high above onto (tx, ty); its sprite's axis is the striking
    // end. onLand runs when it hits.
    function skySlam(anim, tx, ty, { scale = 1, fall = 14, hold = 30, onLand }) {
        const top = ty - 800;
        const fx = spawnEffect(anim, tx, top, { scale, life: fall + hold + 14, fade: 14, facing: player.direction });
        for (let k = 1; k <= fall; k++) {
            after(k, () => { fx.y = top + (ty - top) * (k / fall) ** 2; });
        }
        after(fall, onLand);
        return fx;
    }

    // The end of a cast that runs `ticks` from now
    function finishAt(ticks, anim = null) {
        if (anim) after(Math.max(1, ticks - 12), () => setPlayerAnim(anim));
        after(ticks, endCast);
    }

    const FIRE = ['#ffcc80', '#ff7043', '#ffab00', '#ffffff'];
    const HAKI = ['#3b1117', '#c3193f', '#ff8a80', '#ffffff'];

    function luffyHand() {
        return [player.x + 30 * player.direction, player.y - SHOULDER[player.form] + 4];
    }

    // ---- Base

    // [1] Red Hawk: a flaming fist flies out to the cursor and bursts into fire
    function castRedHawk(tx, ty) {
        faceTarget(tx);
        startCast('rh_charge');
        playSound('voice_rh');
        playSound('charge_small', { volume: 0.5 });
        spawnEffect('charge', player.x, player.y - 30, { centered: true, life: 25 });
        after(30, () => spawnEffect('fire', ...luffyHand(), { centered: true, scale: 0.6 }));
        const [sx, sy] = shoulder();
        const travel = armTicks(Math.hypot(tx - sx, ty - sy), 40, 10);
        after(40, () => {
            setPlayerAnim('rh_punch');
            playSound('stretch');
            playSound('whoosh', { volume: 0.6 });
            stretchArm([[tx, ty]], {
                tip: 'arm_fire', speed: 40, hold: 10,
                onStep: (x, y) => { if (Math.random() < 0.5) spawnEffect('fire', x, y, { centered: true, scale: 0.5 }); },
                onHit: (x, y) => {
                    const v = Math.max(0.4, nearVolume(x, y));
                    playSound('voice_rh_hit');
                    playSound('fire_hit', { volume: v });
                    playSound('hit', { volume: v });
                    spawnEffect('fire_burst', x, y, { centered: true, scale: 1.4 });
                    spawnEffect('fire_ring', x, y, { centered: true, scale: 1.2 });
                    spawnEffect('fire_smoke', x, y + 20, { scale: 1.2 });
                    createExplosion(x, y, { radius: 190, colors: FIRE });
                }
            });
        });
        finishAt(40 + travel + 6);
    }

    // [2] Hawk Gatling: a storm of flaming punches pounds the area around the cursor
    function castHawkGatling(tx, ty) {
        faceTarget(tx);
        startCast('hg_charge');
        playSound('voice_hg');
        playSound('charge_small', { volume: 0.5 });
        spawnEffect('charge', player.x, player.y - 30, { centered: true, life: 25 });
        after(30, () => {
            setPlayerAnim('hg_loop');
            playSound('voice_hg_go');
            playSound('barrage_start');
            armBarrage(tx, ty, { ticks: 90, every: 3, spread: 80, tip: 'arm_fire', radius: 55, colors: FIRE, fx: 'fire', fxScale: 0.8 });
        });
        finishAt(140, 'hg_end');
    }

    // [3] Red Rock: he winds up a burning haki arm and hurls a fist of fire at the cursor
    function castRedRock(tx, ty) {
        faceTarget(tx);
        startCast('rr_wind');
        playSound('voice_rr');
        playSound('charge_big', { volume: 0.5 });
        spawnEffect('charge_red', player.x, player.y - 35, { centered: true, life: 30 });
        after(30, () => playSound('rr_spin', { volume: 0.7 }));
        after(79, () => {
            setPlayerAnim('rr_swing');
            playSound('rr_fire', { volume: 0.8 });
            const [hx, hy] = luffyHand();
            launch(hx, hy, tx, ty, 13, [{ name: 'rr_fist', scale: 1.2, aim: 0 }], (x, y) => {
                const v = Math.max(0.4, nearVolume(x, y));
                playSound('rr_boom', { volume: v });
                playSound('boom', { volume: v });
                spawnEffect('rr_burst', x, y, { centered: true, scale: 1.5 });
                spawnEffect('rr_spiral', x, y, { centered: true, scale: 1.4 });
                spawnEffect('fire_burst', x, y, { centered: true, scale: 1.8 });
                createExplosion(x, y, { radius: 300, colors: FIRE });
                startShockwave(x, y, 420, 10);
            });
        });
        finishAt(130);
    }

    // [4] Gear Third Smash: he blows himself up like a balloon and drops onto the cursor
    function castGearThirdSmash(tx, ty) {
        faceTarget(tx);
        startCast('g3_up');
        playSound('voice_g3');
        playSound('charge_small', { volume: 0.5 });
        spawnEffect('g3_ring', player.x, player.y - 25, { centered: true });
        after(30, () => {
            setPlayerAnim('g3_fall');
            playSound('jump', { volume: 0.7 });
            dashAt(tx, ty, 800, () => {}, () => {
                const x = player.x, y = player.y;
                const v = Math.max(0.4, nearVolume(x, y));
                playSound('thud', { volume: v });
                playSound('voice_g3_hit');
                playSound('boom', { volume: v });
                player.floatTicks = 30;
                spawnEffect('g3_ring', x, y - 30, { centered: true, scale: 2 });
                spawnEffect('dust_burst', x, y + 10, { scale: 1.6 });
                spawnEffect('cracks', x, y, { scale: 1.4 });
                createExplosion(x, y - 30, { radius: 280, colors: ['#ffccbc', '#ff8a65', '#ffffff'] });
                startShockwave(x, y - 30, 420, 11);
                finishAt(45);
            });
        });
    }

    // [5] Eagle Bazooka: giant haki palms swell up and he rams them into the cursor
    function castEagleBazooka(tx, ty) {
        faceTarget(tx);
        startCast('eb_charge');
        playSound('voice_eb');
        playSound('charge_small', { volume: 0.5 });
        after(55, () => {
            setPlayerAnim('eb_rush');
            playSound('voice_eb_go');
            playSound('dash', { volume: 0.8 });
            dashAt(tx, ty, 650, () => disturbDebris(player.x, player.y - 40, 120, 8), () => {
                const x = player.x + 60 * player.direction, y = player.y - 35;
                const v = Math.max(0.4, nearVolume(x, y));
                playSound('eb_hit', { volume: v });
                playSound('hit', { volume: v });
                player.floatTicks = 30;
                spawnEffect('shockwave', x, y, { centered: true, scale: 2 });
                spawnEffect('smoke', x, y, { centered: true, scale: 1.5 });
                spawnEffect('rocks', x, y + 20, { scale: 1.4 });
                createExplosion(x, y, { radius: 270, colors: HAKI });
                startShockwave(x, y, 400, 12);
                finishAt(40);
            });
        });
    }

    // ---- Gear 4 Boundman

    // [1] Kong Gun: his fist, compressed into his arm, springs out at the cursor
    function castKongGun(tx, ty) {
        faceTarget(tx);
        startCast('kg_charge');
        playSound('g4_puff');
        playSound('charge_small', { volume: 0.5 });
        spawnEffect('steam', player.x, player.y, { follow: true });
        const [sx, sy] = shoulder();
        const travel = armTicks(Math.hypot(tx - sx, ty - sy), 55, 12);
        after(31, () => {
            setPlayerAnim('kg_punch');
            playSound('g4_compress');
            playSound('g4_fire', { volume: 0.7 });
            stretchArm([[tx, ty]], {
                tip: 'arm_g4', speed: 55, hold: 12,
                onHit: (x, y) => {
                    const v = Math.max(0.4, nearVolume(x, y));
                    playSound('g4_hit', { volume: v });
                    playSound('hit', { volume: v });
                    spawnEffect('impact', x, y, { centered: true, scale: 1.8, facing: player.direction });
                    spawnEffect('shock', x, y, { centered: true, scale: 1.4 });
                    spawnEffect('burst', x, y, { centered: true, scale: 1.4, facing: player.direction });
                    createExplosion(x, y, { radius: 240, colors: HAKI });
                }
            });
        });
        finishAt(31 + travel + 8);
    }

    // [2] King Kong Gun: he pumps his fist up into a colossal one and drives it down from the
    // sky onto the cursor
    function castKingKongGun(tx, ty) {
        faceTarget(tx);
        startCast('kkg_body');
        playSound('kkg_voice');
        playSound('charge_big', { volume: 0.6 });
        spawnEffect('charge_red', player.x, player.y - 40, { centered: true, life: 30 });
        spawnEffect('steam', player.x, player.y, { follow: true });
        after(31, () => playSound('kkg_grow', { volume: 0.8 }));
        // The fist comes down as his arm swings down at the end of kkg_body
        after(200, () => {
            playSound('kkg_fall', { volume: 0.8 });
            skySlam('kkg_fist', tx, ty, {
                scale: 1.1, fall: 14, hold: 35,
                onLand: () => {
                    const v = Math.max(0.5, nearVolume(tx, ty));
                    playSound('kkg_boom', { volume: v });
                    playSound('kkg_end', { volume: v });
                    playSound('boom', { volume: v });
                    spawnEffect('red_burst', tx, ty, { centered: true, scale: 1.6, life: 40, fade: 15 });
                    spawnEffect('splash', tx, ty, { centered: true, scale: 2.4, life: 30, fade: 15 });
                    spawnEffect('dust_burst', tx, ty + 30, { scale: 2.2 });
                    spawnEffect('cracks', tx, ty + 20, { scale: 2 });
                    createExplosion(tx, ty, { radius: 480, colors: HAKI, smoke: 0.6 });
                    startShockwave(tx, ty, 620, 18);
                }
            });
        });
        finishAt(250);
    }

    // [3] Leo Bazooka: both fists drawn back, he springs in and blasts the cursor with both palms
    function castLeoBazooka(tx, ty) {
        faceTarget(tx);
        startCast('lb_charge');
        playSound('lb_voice');
        playSound('charge_big', { volume: 0.5 });
        spawnEffect('charge_red', player.x, player.y - 40, { centered: true, life: 30 });
        after(31, () => {
            setPlayerAnim('lb_push');
            playSound('dash', { volume: 0.8 });
            dashAt(tx, ty, 550, () => disturbDebris(player.x, player.y - 40, 120, 8), () => {
                const x = player.x + 50 * player.direction, y = player.y - 45;
                const v = Math.max(0.4, nearVolume(x, y));
                playSound('lb_push', { volume: v });
                playSound('hit', { volume: v });
                player.floatTicks = 35;
                spawnEffect('shockwave', x, y, { centered: true, scale: 2.2 });
                spawnEffect('ring', x, y, { centered: true, scale: 1.6 });
                createExplosion(x, y, { radius: 290, colors: HAKI });
                startShockwave(x, y, 420, 13);
                finishAt(40);
            });
        });
    }

    // [4] Rhino Schneider: he rams the cursor feet first
    function castRhinoSchneider(tx, ty) {
        faceTarget(tx);
        startCast('rs_body');
        playSound('rs_voice');
        playSound('charge_small', { volume: 0.5 });
        after(34, () => {
            playSound('g4_compress');
            dashAt(tx, ty, 750, () => disturbDebris(player.x, player.y - 40, 120, 8), () => {
                const x = player.x + 45 * player.direction, y = player.y - 30;
                const v = Math.max(0.4, nearVolume(x, y));
                playSound('rs_hit', { volume: v });
                playSound('hit', { volume: v });
                player.floatTicks = 25;
                spawnEffect('shock', x, y, { centered: true, scale: 1.6 });
                spawnEffect('impact', x, y, { centered: true, scale: 1.5, facing: player.direction });
                createExplosion(x, y, { radius: 250, colors: HAKI });
                finishAt(30);
            });
        });
    }

    // [5] Culverin: his punch winds around in square turns before it lands on the cursor
    function castCulverin(tx, ty) {
        faceTarget(tx);
        startCast('cv_body');
        playSound('cv_voice');
        playSound('charge_small', { volume: 0.5 });
        const path = zigzagPath(tx, ty, 3, 140);
        let dist = 0;
        [shoulder(), ...path].reduce((a, b) => { dist += Math.hypot(b[0] - a[0], b[1] - a[1]); return b; });
        after(35, () => {
            playSound('cv_go');
            stretchArm(path, {
                tip: 'arm_g4', speed: 50, hold: 12,
                onHit: (x, y) => {
                    const v = Math.max(0.4, nearVolume(x, y));
                    playSound('cv_hit', { volume: v });
                    playSound('hit', { volume: v });
                    spawnEffect('burst', x, y, { centered: true, scale: 1.6, rotation: Math.atan2(ty - y, 0.01) });
                    spawnEffect('spark', x, y, { centered: true, scale: 1.5 });
                    createExplosion(x, y, { radius: 220, colors: HAKI });
                }
            });
        });
        finishAt(35 + armTicks(dist, 50, 12) + 6);
    }

    // [6] Kong Organ: a barrage of giant haki fists hammers the area around the cursor
    function castKongOrgan(tx, ty) {
        faceTarget(tx);
        startCast('ko_body');
        playSound('ko_voice');
        playSound('charge_small', { volume: 0.5 });
        spawnEffect('steam', player.x, player.y, { follow: true });
        after(33, () => {
            playSound('ko_go');
            playSound('barrage_start');
            armBarrage(tx, ty, { ticks: 95, every: 3, spread: 100, tip: 'arm_g4', radius: 75, colors: HAKI, fx: 'impact', fxScale: 0.9 });
        });
        finishAt(140);
    }

    // ---- Gear 4 Snakeman

    // [1] Jet Culverin: a lightning-fast punch that snakes around to strike the cursor
    function castJetCulverin(tx, ty) {
        faceTarget(tx);
        startCast('sn_charge');
        playSound('sn_voice');
        playSound('charge_small', { volume: 0.5 });
        const path = snakePath(tx, ty, 3, 110);
        after(31, () => {
            setPlayerAnim('sn_punch');
            playSound('sn_go');
            playSound('sn_travel', { volume: 0.6 });
            stretchArm(path, {
                tip: 'arm_snake', speed: 75, hold: 12,
                onStep: (x, y) => { if (Math.random() < 0.15) spawnEffect('swirl', x, y, { centered: true, scale: 0.8 }); },
                onHit: (x, y) => {
                    const v = Math.max(0.4, nearVolume(x, y));
                    playSound('sn_hit', { volume: v });
                    playSound('sn_snap', { volume: v });
                    spawnEffect('sn_ring', x, y, { centered: true, scale: 1.2 });
                    spawnEffect('swirl2', x, y, { centered: true, scale: 1.4 });
                    spawnEffect('burst', x, y, { centered: true, scale: 1.4, facing: player.direction });
                    createExplosion(x, y, { radius: 230, colors: HAKI });
                }
            });
        });
        finishAt(31 + armTicks(900, 75, 12));
    }

    // [2] Jet Python: a punch that loops around in a wide square before it strikes
    function castJetPython(tx, ty) {
        faceTarget(tx);
        startCast('sn_charge');
        playSound('jp_voice');
        playSound('charge_small', { volume: 0.5 });
        const path = zigzagPath(tx, ty, 2, 200);
        after(31, () => {
            setPlayerAnim('sn_punch');
            playSound('jp_go');
            stretchArm(path, {
                tip: 'arm_snake', speed: 70, hold: 14,
                onHit: (x, y) => {
                    const v = Math.max(0.4, nearVolume(x, y));
                    playSound('sn_hit', { volume: v });
                    playSound('sn_snap', { volume: v });
                    spawnEffect('sn_ring', x, y, { centered: true, scale: 1.6 });
                    spawnEffect('sn_ring', x + 30 * player.direction, y, { centered: true, scale: 1 });
                    spawnEffect('burst', x, y, { centered: true, scale: 1.6, facing: player.direction });
                    createExplosion(x, y, { radius: 260, colors: HAKI });
                }
            });
        });
        finishAt(31 + armTicks(1100, 70, 14));
    }

    // [3] Jet Culverin Gatling: a blur of snaking punches rakes the area around the cursor
    function castJetCulverinGatling(tx, ty) {
        faceTarget(tx);
        startCast('jcg_body');
        playSound('jcg_voice');
        playSound('charge_small', { volume: 0.5 });
        after(70, () => {
            playSound('jcg_loop', { volume: 0.7 });
            for (let t = 0; t < 100; t += 14) after(t, () => spawnEffect('jcg_arms', player.x + 40 * player.direction, player.y - 45, { facing: player.direction }));
            armBarrage(tx, ty, { ticks: 100, every: 2, spread: 110, tip: 'arm_snake', radius: 60, colors: HAKI, fx: 'jcg_ring', fxScale: 0.7, curve: 40, sound: 'sn_hit' });
        });
        finishAt(190);
    }

    // [4] Black Mamba: snake-quick punches whip in from every angle at the cursor
    function castBlackMamba(tx, ty) {
        faceTarget(tx);
        startCast('bm_body');
        playSound('bm_voice');
        playSound('charge_small', { volume: 0.5 });
        after(33, () => {
            playSound('bm_go');
            playSound('bm_loop', { volume: 0.7 });
            armBarrage(tx, ty, { ticks: 90, every: 3, spread: 130, tip: 'arm_snake', radius: 65, colors: HAKI, fx: 'spikes', fxScale: 0.7, curve: 90, sound: 'sn_hit' });
        });
        finishAt(140);
    }

    // [5] King Cobra: one colossal snaking punch that crashes into the cursor
    function castKingCobra(tx, ty) {
        faceTarget(tx);
        startCast('kc_body');
        playSound('kc_voice');
        playSound('charge_big', { volume: 0.6 });
        spawnEffect('charge_red', player.x, player.y - 35, { centered: true, life: 30 });
        const path = snakePath(tx, ty, 4, 160);
        after(39, () => {
            playSound('kc_go');
            playSound('snap_far');
            stretchArm(path, {
                tip: 'arm_snake', width: 9, tipScale: 1.8, speed: 50, hold: 30,
                onStep: (x, y) => { if (Math.random() < 0.2) spawnEffect('swirl', x, y, { centered: true }); },
                onHit: (x, y) => {
                    const v = Math.max(0.5, nearVolume(x, y));
                    playSound('kc_hit', { volume: v });
                    playSound('kc_boom', { volume: v });
                    after(20, () => playSound('kc_end', { volume: v }));
                    spawnEffect('spikes', x, y, { centered: true, scale: 2.5 });
                    spawnEffect('kc_streak', x, y, { centered: true, scale: 1.5, rotation: Math.atan2(y - player.y, x - player.x) });
                    spawnEffect('sn_ring', x, y, { centered: true, scale: 2.4 });
                    createExplosion(x, y, { radius: 440, colors: HAKI, smoke: 0.5 });
                    startShockwave(x, y, 560, 16);
                }
            });
        });
        finishAt(39 + armTicks(1200, 50, 30));
    }

    // ---- Transformations (T): Base → Gear 4 Boundman → Snakeman → Base
    function castLuffyTransform() {
        const next = (player.form + 1) % CHAR_FORMS.length;
        player.casting = true;
        player.vx = 0;
        if (next === 0) {
            // Back to base: a puff of steam and he's himself again
            playSound('g4_puff', { volume: 0.6 });
            spawnEffect('smoke', player.x, player.y - 35, { centered: true, scale: 1.4 });
            player.form = 0;
            setPlayerAnim('idle');
            after(20, endCast);
            return;
        }
        const anim = `tf_${next}`;
        player.anim = createAnim(anim);
        const total = Math.min(220, charData.anims[anim].frames.reduce((n, f) => n + f.t, 0));
        playSound('charge_big', { volume: 0.5 });
        spawnEffect('charge_red', player.x, player.y - 35, { centered: true, life: 30 });
        spawnEffect('ground_ring', player.x, player.y, { scale: 1.4 });
        if (next === 1) {
            playSound('tf_voice_1');
            after(28, () => spawnEffect('ground_ring', player.x, player.y, { scale: 1.6 }));
            after(90, () => { playSound('tf_puff_1'); spawnEffect('tf_1_line', player.x, player.y, { follow: true }); });
            after(117, () => spawnEffect('dust_burst', player.x, player.y + 5, { scale: 1 }));
            after(150, () => { playSound('tf_done_1'); spawnEffect('ring', player.x + 35 * player.direction, player.y - 80, { centered: true, scale: 1.2 }); });
        } else {
            after(45, () => playSound('tf_snake'));
            after(54, () => spawnEffect('tf_2_fx', player.x, player.y, { follow: true }));
            after(total - 20, () => playSound('tf_snake_done'));
        }
        after(total, () => {
            player.form = next;
            endCast();
            setPlayerAnim('idle');
        });
    }

    // ---------------- Ichigo ----------------
    // The anime Bankai Ichigo, with three moves (and their sprites and sounds) borrowed from the
    // Final Bankai Ichigo: 1000 Slice, Final Getsuga Tenshou and Bankai Rave.

    const GETSUGA = ['#ffffff', '#4dd0e1', '#263238'];
    const DARK = ['#212121', '#b71c1c', '#ffffff'];

    // His sword hand, out in front at chest height
    function ichigoBlade(reach = 40) {
        return [player.x + reach * player.direction, player.y - 45];
    }

    // A flash step: he dashes through (tx, ty) in a straight line, his sword cutting a groove of
    // half-width w behind him; onArrive when he's through
    function slashDash(tx, ty, reach, w, onArrive) {
        const blade = () => [player.x + 20 * player.direction, player.y - 40];
        let last = blade();
        const cut = () => {
            const [x, y] = blade();
            if (Math.hypot(x - last[0], y - last[1]) < 4) return;
            cutGroove(last[0], last[1], x, y, w);
            last = [x, y];
        };
        dashAt(tx, ty, reach, i => { if (i % 2 === 0) cut(); }, () => { cut(); onArrive(); });
    }

    // A wave of energy flies from (sx, sy) to the cursor, carving a groove of half-width w as it
    // goes; trail spawns an effect along the way; onHit(x, y) where it lands
    function getsugaWave(sx, sy, tx, ty, { anim, scale, speed, w, trail = null, trailScale = 1, onHit }) {
        launch(sx, sy, tx, ty, speed, [{ name: anim, scale, aim: 0 }], onHit);
        const d = Math.hypot(tx - sx, ty - sy) || 1;
        const ticks = Math.max(1, Math.floor(d / speed));
        let last = [sx, sy];
        for (let t = 2; t <= ticks; t += 2) {
            after(t, () => {
                const k = t * speed / d;
                const x = sx + (tx - sx) * k, y = sy + (ty - sy) * k;
                cutGroove(last[0], last[1], x, y, w);
                if (trail && t % 4 === 0) spawnEffect(trail, x, y, { centered: true, scale: trailScale, rotation: Math.random() * Math.PI * 2 });
                last = [x, y];
            });
        }
        after(ticks, () => cutGroove(last[0], last[1], tx, ty, w));
    }

    // [1] Getsuga Tenshou: one swing sends a crescent of energy flying at the cursor
    function castGetsuga(tx, ty) {
        faceTarget(tx);
        startCast('gt_body');
        playSound('gt_voice');
        // gt_body's swing comes on its third frame
        after(12, () => {
            const [x, y] = ichigoBlade(30);
            playSound('swing', { volume: 0.8 });
            spawnEffect('slash_wave', player.x, player.y, { facing: player.direction, scale: 0.8 });
            getsugaWave(x, y, tx, ty, {
                anim: 'gt_wave', scale: 0.9, speed: 13, w: 16,
                onHit: (hx, hy) => {
                    const v = Math.max(0.4, nearVolume(hx, hy));
                    playSound('boom', { volume: v });
                    spawnEffect('slash_wave', hx, hy + 40, { scale: 1.4, facing: player.direction });
                    createExplosion(hx, hy, { radius: 200, colors: GETSUGA, smoke: 0.4 });
                    startShockwave(hx, hy, 320, 10);
                }
            });
        });
        finishAt(40);
    }

    // [3] Air Bankai Slice: he spins in place over the cursor, slashing it to ribbons, then drops
    // out of it
    function castAirBankaiSlice(tx, ty) {
        faceTarget(tx);
        startCast('jump_up');
        playSound('as_voice');
        playSound('jump');
        const dir = player.direction;
        dashAt(tx - 60 * dir, ty - 70, 600, () => {}, () => {
            player.floatTicks = 100;
            setPlayerAnim('as_body');
            playSound('super', { volume: 0.5 });
            spawnEffect('as_swirl', tx, ty, { centered: true, scale: 2.2, life: 100, fade: 15 });
            for (let t = 0; t < 96; t += 4) {
                after(t, () => {
                    const a = Math.random() * Math.PI, len = 60 + Math.random() * 90;
                    const x = tx + (Math.random() - 0.5) * 120, y = ty + (Math.random() - 0.5) * 100;
                    cutGroove(x - Math.cos(a) * len, y - Math.sin(a) * len, x + Math.cos(a) * len, y + Math.sin(a) * len, 7);
                    spawnEffect('as_spark', x, y, { centered: true, scale: 1.5 });
                    if (t % 8 === 0) playSound(t % 16 ? 'swing' : 'hit', { volume: 0.5 * Math.max(0.3, nearVolume(x, y)), minGap: 0 });
                });
            }
            after(100, () => {
                setPlayerAnim('as_end');
                const v = Math.max(0.5, nearVolume(tx, ty));
                playSound('boom', { volume: v });
                createExplosion(tx, ty, { radius: 260, colors: GETSUGA, smoke: 0.5 });
                startShockwave(tx, ty, 420, 12);
            });
            finishAt(125);
        });
    }

    // [2] Rapid Bankai Combo: he flash-steps in and lays into the cursor with a long combo
    function castBankaiCombo(tx, ty) {
        faceTarget(tx);
        startCast('ra_body');
        playSound('bc_voice');
        playSound('super', { volume: 0.5 });
        dashAt(tx - 50 * player.direction, ty, 600, () => {}, () => {
            player.floatTicks = 175;
            setPlayerAnim('bc_body');
            const [cx, cy] = ichigoBlade(60);
            for (let t = 6; t < 160; t += 8) {
                after(t, () => {
                    const x = cx + (Math.random() - 0.3) * 90 * player.direction, y = cy + (Math.random() - 0.5) * 90;
                    const a = Math.random() * Math.PI, len = 40 + Math.random() * 50;
                    cutGroove(x - Math.cos(a) * len, y - Math.sin(a) * len, x + Math.cos(a) * len, y + Math.sin(a) * len, 8);
                    spawnEffect('bc_slash', x, y, { centered: true, scale: 0.9, rotation: a });
                    createExplosion(x, y, { radius: 55 + Math.random() * 30, colors: GETSUGA, smoke: 0.1 });
                    playSound(t % 16 ? 'swing' : 'hit', { volume: 0.5 * Math.max(0.3, nearVolume(x, y)), minGap: 0 });
                });
            }
            after(165, () => {
                const v = Math.max(0.5, nearVolume(cx, cy));
                playSound('hit2', { volume: v });
                playSound('boom', { volume: v });
                spawnEffect('flash', cx, cy, { centered: true, scale: 1.5 });
                createExplosion(cx, cy, { radius: 270, colors: GETSUGA, smoke: 0.5 });
                startShockwave(cx, cy, 420, 12);
            });
            finishAt(185);
        });
    }

    // [4] Final Bankai Slash: blue power flares around him, he flash-steps past the cursor, and
    // a moment later the page splits along one long cut
    function castFinalBankaiSlash(tx, ty) {
        faceTarget(tx);
        startCast('fb_body');
        playSound('fb_voice');
        playSound('super', { volume: 0.6 });
        const dir = player.direction;
        spawnEffect('fb_aura', player.x, player.y + 10, { scale: 1.3, behind: true });
        // fb_body flashes through its charge for 60 ticks before he goes
        after(60, () => {
            playSound('dash');
            playSound('slash', { volume: 0.8 });
            spawnEffect('smoke', player.x, player.y - 40, { centered: true, scale: 1.2 });
            dashAt(tx + 160 * dir, ty, 800, () => {}, () => {
                setPlayerAnim('fb_end');
                player.floatTicks = 70;
                // The cut: a line across the cursor, then it all comes apart along it
                after(18, () => {
                    playSound('swing2');
                    spawnEffect('fb_line', tx, ty, { centered: true, scale: 3, stretchX: 2, life: 25, fade: 10 });
                });
                after(30, () => {
                    const v = Math.max(0.6, nearVolume(tx, ty));
                    playSound('boom', { volume: v });
                    playSound('boom2', { volume: v });
                    cutGroove(tx - 520, ty, tx + 520, ty, 22);
                    for (let k = -4; k <= 4; k++) {
                        after(Math.abs(k) * 2, () => createExplosion(tx + k * 120, ty, { radius: 110, colors: GETSUGA, smoke: 0.15 }));
                    }
                    createExplosion(tx, ty, { radius: 260, colors: GETSUGA, smoke: 0.5 });
                    startShockwave(tx, ty, 600, 15);
                });
                finishAt(70);
            });
        });
    }

    // ---- From the Final Bankai Ichigo

    // [5] 1000 Slice: he flash-steps in and the air around the cursor is cut to pieces
    function castThousandSlice(tx, ty) {
        faceTarget(tx);
        startCast('ts_body');
        playSound('super', { volume: 0.6 });
        playSound('dash');
        dashAt(tx - 70 * player.direction, ty, 600, () => {}, () => {
            player.floatTicks = 110;
            spawnEffect('ts_swirl', tx, ty, { centered: true, scale: 2.4, life: 100, fade: 15 });
            for (let t = 0; t < 96; t += 3) {
                after(t, () => {
                    const a = Math.random() * Math.PI, len = 50 + Math.random() * 110;
                    const x = tx + (Math.random() - 0.5) * 220, y = ty + (Math.random() - 0.5) * 180;
                    cutGroove(x - Math.cos(a) * len, y - Math.sin(a) * len, x + Math.cos(a) * len, y + Math.sin(a) * len, 5);
                    spawnEffect('ts_spark', x, y, { centered: true, scale: 1.4 });
                    if (t % 6 === 0) playSound(t % 12 ? 'swing' : 'whoosh', { volume: 0.5 * Math.max(0.3, nearVolume(x, y)), minGap: 0 });
                });
            }
            after(100, () => {
                setPlayerAnim('ts_end');
                const v = Math.max(0.5, nearVolume(tx, ty));
                playSound('boom', { volume: v });
                playSound('hit', { volume: v });
                createExplosion(tx, ty, { radius: 280, colors: GETSUGA, smoke: 0.5 });
                startShockwave(tx, ty, 440, 13);
            });
            finishAt(120);
        });
    }

    // [6] Final Getsuga Tenshou: black power erupts from him in a pillar, he becomes Mugetsu,
    // raises his sword and brings down a wall of black flame that tears through everything ahead
    function castFinalGetsuga(tx, ty) {
        faceTarget(tx);
        startCast('fg_charge');
        playSound('fg_voice');
        after(15, () => setPlayerAnim('fg_hold'));
        spawnEffect('fg_dark', player.x, player.y - 60, { centered: true, scale: 1.4, behind: true });
        // The pillar, and he changes inside it
        after(45, () => {
            playSound('fg_pillar');
            playSound('boom', { volume: 0.8 });
            spawnEffect('fg_pillar', player.x, player.y + 30, { scale: 2.2 });
            createExplosion(player.x, player.y - 60, { radius: 150, colors: DARK, smoke: 0.4 });
            startShockwave(player.x, player.y - 60, 420, 12);
        });
        after(75, () => {
            setPlayerAnim('fg_form');
            playSound('fg_form');
            spawnEffect('fg_aura', player.x, player.y + 10, { scale: 1.6, behind: true, life: 130, fade: 20 });
            spawnEffect('fg_flame', player.x, player.y + 10, { scale: 1.4, behind: true, life: 130, fade: 20 });
        });
        after(135, () => { setPlayerAnim('fg_raise'); playSound('fg_shout'); });
        // fg_raise holds the sword up 49 ticks in; then the swing
        after(195, () => {
            player.anim = createAnim('fg_swing');
            playSound('fg_swing');
            playSound('fg_shout2');
            const dir = player.direction;
            const sx = player.x + 60 * dir, sy = player.y - 30;
            const d = Math.hypot(tx - sx, ty - sy) || 1;
            const ex = sx + (tx - sx) / d * Math.max(d, 500), ey = sy + (ty - sy) / d * Math.max(d, 500);
            const steps = 16;
            // The wall of black flame rolls out to the cursor and past it
            const wall = spawnEffect('fg_wall', sx, sy, { centered: true, scale: 2.4, facing: dir, life: steps * 3 + 20, fade: 15 });
            let last = [sx, sy];
            for (let k = 1; k <= steps; k++) {
                after(k * 3, () => {
                    const t = k / steps;
                    const x = sx + (ex - sx) * t, y = sy + (ey - sy) * t;
                    wall.x = x; wall.y = y;
                    cutGroove(last[0], last[1], x, y, 70);
                    if (k % 2 === 0) createExplosion(x, y, { radius: 150, colors: DARK, smoke: 0.2 });
                    if (k % 4 === 0) playSound('boom', { volume: 0.6 * Math.max(0.3, nearVolume(x, y)), minGap: 0 });
                    last = [x, y];
                });
            }
            after(steps * 3 + 2, () => {
                const v = Math.max(0.6, nearVolume(ex, ey));
                playSound('fg_pillar', { volume: v });
                playSound('boom', { volume: v });
                spawnEffect('fg_pillar', ex, ey + 60, { scale: 2.6 });
                createExplosion(ex, ey, { radius: 460, colors: DARK, smoke: 0.7 });
                startShockwave(ex, ey, 750, 18);
            });
        });
        after(280, () => setPlayerAnim('idle'));
        finishAt(290);
    }

    // [7] Bankai (Rave): he flash-steps back and forth through the cursor, cutting it each time,
    // then strikes a pose as it all goes up
    function castBankaiRave(tx, ty) {
        faceTarget(tx);
        startCast('rv_dash');
        playSound('rv_voice');
        playSound('super', { volume: 0.6 });
        const passes = 4;
        const pass = k => {
            if (k === passes) return finale();
            const side = player.x < tx ? 1 : -1;
            player.direction = side;
            player.anim = createAnim('rv_dash');
            playSound('dash', { volume: 0.7 });
            playSound('rv_slash', { volume: 0.6 });
            const a = (Math.random() - 0.5) * 0.8;
            slashDash(tx + side * 170, ty + Math.sin(a) * 120, 700, 10, () => {
                const v = Math.max(0.4, nearVolume(tx, ty));
                playSound(k % 2 ? 'rv_hit' : 'rv_hit2', { volume: v });
                spawnEffect('rv_cut', tx, ty, { centered: true, scale: 2, rotation: a, facing: side });
                createExplosion(tx, ty, { radius: 90 + k * 25, colors: GETSUGA, smoke: 0.15 });
                after(8, () => pass(k + 1));
            });
        };
        const finale = () => {
            player.floatTicks = 60;
            faceTarget(tx);
            setPlayerAnim('rv_pose');
            playSound('rv_end');
            playSound('rv_end2');
            spawnEffect('rv_sparkle', tx, ty, { centered: true, scale: 2.4 });
            after(20, () => {
                const v = Math.max(0.6, nearVolume(tx, ty));
                playSound('rv_fin', { volume: v });
                playSound('boom', { volume: v });
                cutGroove(tx - 260, ty - 200, tx + 260, ty + 200, 16);
                cutGroove(tx - 260, ty + 200, tx + 260, ty - 200, 16);
                createExplosion(tx, ty, { radius: 330, colors: GETSUGA, smoke: 0.5 });
                startShockwave(tx, ty, 520, 15);
            });
            finishAt(60);
        };
        after(8, () => pass(0));
    }

    // ---------------- Natsu ----------------

    // His fist, out in front at chest height
    function natsuFist(reach = 35) {
        return [player.x + reach * player.direction, player.y - 40];
    }

    // [1] Fire Dragon's Iron Fist: he lunges at the cursor, fist ablaze, and punches it in
    function castIronFist(tx, ty) {
        faceTarget(tx);
        startCast('if_body');
        playSound('if_voice');
        playSound('charge_small', { volume: 0.4 });
        // if_body's lunge frame comes 11 ticks in, when the original sets him moving
        after(11, () => {
            playSound('dash', { volume: 0.7 });
            playSound('fire_whoosh', { volume: 0.7 });
            const flame = spawnEffect('fist_fire', player.x, player.y, { follow: true, centered: true, offsetX: 30, offsetY: -40, scale: 0.6, life: 60 });
            dashAt(tx, ty, 450, i => {
                if (i % 2 === 0) spawnEffect('fire_puff', player.x - 15 * player.direction, player.y - 40, { centered: true, scale: 0.8 });
                disturbDebris(player.x, player.y - 40, 100, 6);
            }, () => {
                player.floatTicks = 25;
                flame.life = flame.age;
                const [x, y] = natsuFist(45);
                const v = Math.max(0.4, nearVolume(x, y));
                playSound('fire_hit', { volume: v });
                playSound('fire_boom', { volume: 0.7 * v });
                spawnEffect('fist_fire', x, y, { centered: true, scale: 1.6, facing: player.direction });
                spawnEffect('fire_cloud', x, y, { centered: true, scale: 2.4 });
                spawnEffect('impact', x, y, { centered: true, scale: 1.5, facing: player.direction });
                createExplosion(x, y, { radius: 200, colors: FIRE, smoke: 0.5 });
                startShockwave(x, y, 320, 10);
                finishAt(30);
            });
        });
    }

    // [2] Fire Dragon's Brilliant Flame: he leaps, gathers a ball of fire overhead and hurls it down
    function castBrilliantFlame(tx, ty) {
        faceTarget(tx);
        startCast('bf_body');
        playSound('bf_voice');
        playSound('jump', { volume: 0.6 });
        // The original is thrown from the air: up he goes, and he hangs there to throw
        if (player.isGrounded) player.vy = -11;
        after(12, () => {
            player.floatTicks = 22;
            playSound('fire_whoosh', { volume: 0.6 });
            spawnEffect('bf_ball', player.x, player.y - 75, { centered: true, scale: 1.2, life: 10 });
        });
        // bf_body's throw frame (620_0) comes 12 ticks in and holds for 10
        after(22, () => {
            const sx = player.x + 25 * player.direction, sy = player.y - 55;
            playSound('swing', { volume: 0.7 });
            launch(sx, sy, tx, ty, 8, [{ name: 'bf_ball', scale: 2, aim: 0 }], (x, y) => {
                const v = Math.max(0.4, nearVolume(x, y));
                playSound('fire_hit', { volume: v });
                playSound('fire_boom', { volume: v });
                spawnEffect('bf_blast', x, y + 40, { scale: 2.2 });
                spawnEffect('fire_cloud', x, y, { centered: true, scale: 3 });
                spawnEffect('fire_ring', x, y, { centered: true, scale: 1.6, rotation: Math.PI / 2 });
                createExplosion(x, y, { radius: 260, colors: FIRE, smoke: 0.6 });
                startShockwave(x, y, 420, 12);
            });
        });
        finishAt(45);
    }

    // [3] Fire Dragon's Claw: he flips up at the cursor, feet wreathed in a wheel of fire, and
    // kicks the fire down onto it, where it bursts back up out of the page
    function castClaw(tx, ty) {
        faceTarget(tx);
        startCast('cl_body');
        playSound('cl_voice');
        playSound('dash', { volume: 0.5 });
        // He leaves the ground 7 ticks in; the kick lands above and short of the cursor
        after(7, () => {
            const dir = player.direction;
            const wheel = spawnEffect('cl_ring', player.x, player.y, { follow: true, offsetX: 10, offsetY: -45, scale: 1.1, life: 80 });
            playSound('fire_whoosh', { volume: 0.7 });
            dashAt(tx - 70 * dir, ty - 110, 420, () => disturbDebris(player.x, player.y - 40, 100, 6), () => {
                player.floatTicks = 22;
                wheel.life = wheel.age + 8;
                playSound('swing', { volume: 0.8 });
                // The fire drops from his feet to the cursor
                const fx = player.x + 25 * dir, fy = player.y - 20;
                const drops = 5;
                for (let k = 1; k <= drops; k++) {
                    after(k * 2, () => {
                        const t = k / drops;
                        spawnEffect('fire_puff', fx + (tx - fx) * t, fy + (ty - fy) * t, { centered: true, scale: 1.4 });
                    });
                }
                after(drops * 2 + 1, () => {
                    const v = Math.max(0.4, nearVolume(tx, ty));
                    playSound('cl_hit', { volume: v });
                    playSound('fire_boom', { volume: 0.8 * v });
                    spawnEffect('cl_burst', tx, ty + 30, { scale: 2.6 });
                    spawnEffect('fire_cloud', tx, ty, { centered: true, scale: 2.4 });
                    createExplosion(tx, ty, { radius: 230, colors: FIRE, smoke: 0.5 });
                    startShockwave(tx, ty, 360, 11);
                });
                // Then he flips back off it
                after(4, () => {
                    setPlayerAnim('cl_flip');
                    player.floatTicks = 0;
                    player.vy = -6;
                    player.vx = -3.5 * dir;
                    playSound('swing2', { volume: 0.5 });
                });
                after(30, () => { player.vx = 0; });
                finishAt(32);
            });
        });
    }

    // [4] Crimson Lotus: Fire Dragon's Fist: he rushes the cursor and buries it under a storm of
    // flaming punches, then sends it all up with an uppercut
    const LOTUS_TICKS = 100; // length of the barrage
    function castLotusFist(tx, ty) {
        faceTarget(tx);
        startCast('lf_dash');
        playSound('su_voice');
        playSound('charge_small', { volume: 0.5 });
        after(5, () => {
            playSound('dash', { volume: 0.7 });
            dashAt(tx, ty, 500, i => {
                if (i % 2 === 0) spawnEffect('fire_puff', player.x - 15 * player.direction, player.y - 40, { centered: true, scale: 0.7 });
            }, () => {
                player.floatTicks = LOTUS_TICKS + 45;
                setPlayerAnim('lf_windup');
                playSound('lf_voice');
                const dir = player.direction;
                const cx = player.x + 100 * dir, cy = player.y - 45;
                after(12, () => setPlayerAnim('lf_barrage'));
                // Fists of fire fly out all over the space in front of him
                for (let t = 12; t < 12 + LOTUS_TICKS; t += 4) {
                    after(t, () => {
                        const x = cx + (Math.random() - 0.5) * 160, y = cy + (Math.random() - 0.5) * 140;
                        const v = Math.max(0.3, nearVolume(x, y));
                        spawnEffect('lf_fist', x, y, { centered: true, scale: 1.3, facing: dir });
                        createExplosion(x, y, { radius: 60 + Math.random() * 40, colors: FIRE, smoke: 0.1 });
                        if (t % 8 === 0) {
                            playSound(Math.random() < 0.5 ? 'swing' : 'swing3', { volume: 0.5 * v, minGap: 0 });
                            playSound('fire_hit', { volume: 0.35 * v, minGap: 0 });
                        }
                    });
                }
                // The uppercut
                after(12 + LOTUS_TICKS, () => {
                    setPlayerAnim('lf_finish');
                    const v = Math.max(0.5, nearVolume(cx, cy));
                    playSound('hit_big', { volume: v });
                    playSound('fire_boom', { volume: v });
                    spawnEffect('fire_ring', cx, cy, { centered: true, scale: 2.2 });
                    spawnEffect('bf_blast', cx, cy + 50, { scale: 2.4 });
                    createExplosion(cx, cy, { radius: 280, colors: FIRE, smoke: 0.5 });
                    startShockwave(cx, cy, 420, 12);
                });
                finishAt(12 + LOTUS_TICKS + 40);
            });
        });
    }

    // [5] Fire Dragon's Roar: a magic circle flares at his mouth and he breathes a torrent of fire
    // at the cursor that burns a trench all the way there
    const ROAR_GROOVE = 26; // half the width of the trench
    function castRoar(tx, ty) {
        faceTarget(tx);
        startCast('ro_body');
        playSound('ro_voice');
        playSound('charge_small', { volume: 0.5 });
        const dir = player.direction;
        const mouth = () => [player.x + 30 * dir, player.y - 55];
        // The circle comes up on ro_body's third frame, as in the original
        after(8, () => {
            const [mx, my] = mouth();
            spawnEffect('ro_circle', mx, my, { centered: true, scale: 0.45, life: 45, fade: 12 });
            spawnEffect('ro_flare', mx, my + 30, { facing: dir, scale: 1.2 });
        });
        after(20, () => {
            const [mx, my] = mouth();
            const v = Math.max(0.4, nearVolume(tx, ty));
            playSound('fire_whoosh');
            playSound('fire_hit', { volume: 0.6 });
            player.floatTicks = 30;
            const speed = 11;
            launch(mx, my, tx, ty, speed, [{ name: 'ro_ball', scale: 2.4, aim: 0 }], (x, y) => {
                playSound('fire_boom', { volume: v });
                playSound('fire_hit', { volume: v });
                spawnEffect('bf_blast', x, y + 45, { scale: 2.4 });
                spawnEffect('fire_cloud', x, y, { centered: true, scale: 3 });
                createExplosion(x, y, { radius: 280, colors: FIRE, smoke: 0.5 });
                startShockwave(x, y, 450, 13);
            });
            // The breath burns its trench behind the fireball, a piece every few ticks
            const d = Math.hypot(tx - mx, ty - my);
            const ticks = Math.max(1, Math.floor(d / speed));
            let last = [mx, my];
            for (let t = 3; t <= ticks; t += 3) {
                after(t, () => {
                    const k = t * speed / d;
                    const x = mx + (tx - mx) * k, y = my + (ty - my) * k;
                    cutGroove(last[0], last[1], x, y, ROAR_GROOVE);
                    spawnEffect('fire_cloud', x, y, { centered: true, scale: 1.4 });
                    last = [x, y];
                });
            }
            after(ticks, () => cutGroove(last[0], last[1], tx, ty, ROAR_GROOVE));
        });
        finishAt(50);
    }

    // The supers start the same way: he powers up, rushes the cursor and lays into it with a
    // combo. flame: the effect on his fist for the rush. onCombo(x, y) runs when the combo is
    // done, with the point he was hitting.
    const SUPER_COMBO = 92; // su_combo's length, up to his last punch
    function natsuRush(tx, ty, { burst, flame, ember }, onCombo) {
        faceTarget(tx);
        startCast('su_charge');
        playSound('su_start');
        playSound('charge_big', { volume: 0.6 });
        after(5, () => playSound('su_voice'));
        spawnEffect(burst, player.x, player.y, { scale: 1.2 });
        for (let t = 10; t < 45; t += 5) {
            after(t, () => spawnEffect(ember, player.x + (Math.random() - 0.5) * 50, player.y - Math.random() * 80, { centered: true, scale: 0.6 }));
        }
        after(45, () => {
            setPlayerAnim('su_dash');
            playSound('su_dash');
            const fist = spawnEffect(flame, player.x, player.y, { follow: true, centered: true, offsetX: 25, offsetY: -40, scale: 0.8, life: 60 });
            dashAt(tx, ty, 700, i => {
                spawnEffect(ember, player.x - 20 * player.direction, player.y - 40, { centered: true, scale: 0.5 });
                disturbDebris(player.x, player.y - 40, 120, 8);
            }, () => {
                fist.life = fist.age;
                player.floatTicks = SUPER_COMBO + 200;
                setPlayerAnim('su_combo');
                const dir = player.direction;
                const x = player.x + 45 * dir, y = player.y - 40;
                playSound('hit_big', { volume: Math.max(0.4, nearVolume(x, y)) });
                for (let t = 0; t < SUPER_COMBO; t += 7) {
                    after(t, () => {
                        const hx = x + (Math.random() - 0.3) * 50 * dir, hy = y + (Math.random() - 0.5) * 70;
                        spawnEffect(ember, hx, hy, { centered: true, scale: 0.8 });
                        spawnEffect('spark', hx, hy, { centered: true, scale: 0.6 });
                        createExplosion(hx, hy, { radius: 55 + Math.random() * 30, colors: FIRE, smoke: 0.1 });
                        playSound(['swing', 'swing2', 'swing3'][t % 3], { volume: 0.5 * Math.max(0.3, nearVolume(hx, hy)), minGap: 0 });
                    });
                }
                after(SUPER_COMBO, () => onCombo(x, y));
            });
        });
    }

    // [6] Crimson Lotus: Exploding Flame Blade: after the combo he throws his arms wide and two
    // twisting blades of fire spiral up out of the page, then it all goes up in a pillar of flame
    function castFlameBlade(tx, ty) {
        natsuRush(tx, ty, { burst: 'fb_burst', flame: 'fist_fire', ember: 'fb_fire' }, (x, y) => {
            setPlayerAnim('fb_pose');
            playSound('fb_voice');
            const v = Math.max(0.5, nearVolume(x, y));
            const twist = 70, climb = 9;
            for (let t = 0; t < 60; t += 2) {
                after(t, () => {
                    const s = Math.sin(t * 0.3 + 1.65) * 40;
                    for (const side of [-1, 1]) {
                        const sx = x + side * s, sy = y + 40 - t * climb;
                        spawnEffect(t % 4 ? 'fb_swirl' : 'fb_swirl2', sx, sy, { centered: true, scale: 0.9 });
                        if (t % 6 === 0) createExplosion(sx, sy, { radius: twist, colors: FIRE, smoke: 0.1 });
                    }
                    if (t % 10 === 0) playSound('fb_blade' + (1 + (t / 10) % 3), { volume: 0.6 * v, minGap: 0 });
                });
            }
            after(62, () => {
                playSound('fb_final', { volume: v });
                playSound('su_boom', { volume: v });
                playSound('fire_boom', { volume: v });
                spawnEffect('fb_pillar', x, y + 60, { scale: 1.5 });
                spawnEffect('bf_blast', x, y + 50, { scale: 3 });
                createExplosion(x, y, { radius: 380, colors: FIRE, smoke: 0.6 });
                startShockwave(x, y, 600, 15);
                // The pillar burns straight up through the page above
                cutGroove(x, y, x, y - 500, 60);
            });
            finishAt(100);
        });
    }

    // [7] Crimson Lotus: Phoenix Blade: after the combo he soars up in a blade of light, then
    // plunges back down on the spot as a meteor of fire
    function castPhoenixBlade(tx, ty) {
        natsuRush(tx, ty, { burst: 'ph_burst', flame: 'ph_flame', ember: 'ph_fire' }, (x, y) => {
            playSound('ph_voice');
            playSound('ph_rise');
            // Up and away
            const blade = spawnEffect('ph_blade', player.x, player.y + 40, { scale: 1.2, life: 40, fade: 10 });
            spawnEffect('ph_ring', player.x, player.y - 20, { centered: true, scale: 2 });
            spawnEffect('ph_burst', player.x, player.y, { scale: 1.6 });
            player.hidden = true;
            for (let k = 1; k <= 20; k++) after(k, () => { blade.y -= 30; });
            // ...and down onto the spot
            after(40, () => {
                playSound('ph_fly', { volume: 0.8 });
                const meteor = skySlam('bf_ball', x, y, {
                    scale: 3.2, fall: 18, hold: 4,
                    onLand: () => {
                        const v = Math.max(0.6, nearVolume(x, y));
                        playSound('ph_boom', { volume: v });
                        playSound('su_big', { volume: v });
                        playSound('crash', { volume: v });
                        spawnEffect('ph_pillar', x, y + 60, { scale: 1.8 });
                        spawnEffect('bf_blast', x, y + 60, { scale: 3.6 });
                        spawnEffect('fire_cloud', x, y, { centered: true, scale: 4 });
                        spawnEffect('ph_ring', x, y, { centered: true, scale: 4 });
                        createExplosion(x, y, { radius: 480, colors: FIRE, smoke: 0.6 });
                        startShockwave(x, y, 760, 18);
                        // He's standing in the middle of it when the fire clears
                        after(25, () => {
                            player.x = x;
                            player.y = y + 40;
                            player.vx = 0; player.vy = 0;
                            player.floatTicks = 0;
                            player.hidden = false;
                            setPlayerAnim('land');
                        });
                    }
                });
                meteor.rotation = Math.PI / 2; // the ball points right in the sheet; turn it to fall
                meteor.facing = 1;
                meteor.centered = true;
            });
            finishAt(40 + 18 + 40);
        });
    }

    // ---------------- Goku ----------------

    // Hands for ki attacks: in front of the chest
    function gokuHands() {
        return { x: player.x + 26 * player.direction, y: player.y - 48 };
    }

    // A Kamehameha beam from (x, y) to the target: it shoots out, carves a groove along its path
    // and explodes at the end
    function fireBeam(x, y, tx, ty, size) {
        const angle = Math.atan2(ty - y, tx - x);
        const dist = Math.max(40, Math.hypot(tx - x, ty - y));
        playSound('voice_kame_fire');
        playSound('kame_fire', { volume: 0.8 });
        spawnEffect('beam', x, y, { rotation: angle, stretchX: dist / 860, stretchTime: 10, scale: size, life: 55, fade: 15 });
        spawnEffect('beam_head', x, y, { rotation: angle, scale: size * 1.2, life: 55, fade: 15 });
        // The beam cuts a straight groove as it shoots out, a piece each tick behind its tip
        const ux = Math.cos(angle), uy = Math.sin(angle);
        let cutTo = Math.min(40, dist);
        for (let k = 1; k <= 10; k++) {
            after(k, () => {
                const from = cutTo;
                cutTo = dist * k / 10;
                if (cutTo - from < 4) return;
                cutGroove(x + ux * from, y + uy * from, x + ux * cutTo, y + uy * cutTo, KAME_GROOVE * size);
            });
        }
        after(10, () => {
            const v = Math.max(0.3, nearVolume(tx, ty));
            playSound('kame_boom', { volume: 0.9 * v });
            playSound('big_boom', { volume: 0.6 * v });
            spawnEffect('kame_boom', tx, ty, { centered: true, scale: 1.2 * size });
            createExplosion(tx, ty, { radius: 200 * size, colors: ['#e1f5fe', '#4fc3f7', '#ffffff'] });
        });
    }
    const KAME_GROOVE = 24; // half the width of the groove a size-1 beam cuts (the beam is ~80px)

    // [1] Kamehameha: Goku charges blue ki in his cupped hands, then fires a beam at the cursor.
    function castKamehameha(tx, ty) {
        faceTarget(tx);
        startCast('kame');
        playSound('charge', { volume: 0.5 });
        const h = gokuHands();
        spawnEffect('charge', h.x, h.y, { centered: true, scale: 0.8, life: 20 });
        // kame pose: charge on the 2nd frame (20 ticks), fire on the 3rd (70)
        after(20, () => {
            playSound('voice_kame_charge');
            playSound('kame_charge', { volume: 0.6 });
            const g = gokuHands();
            spawnEffect('kame_glow', g.x - 30 * player.direction, g.y, { centered: true, life: 50, fade: 10 });
        });
        after(70, () => {
            const g = gokuHands();
            fireBeam(g.x, g.y, tx, ty, 1);
        });
        after(120, endCast);
    }

    // [2] Instant Kamehameha: Goku vanishes, reappears beside the target and fires point-blank.
    function castInstantKamehameha(tx, ty) {
        faceTarget(tx);
        startCast('ikame');
        playSound('charge', { volume: 0.5 });
        after(20, () => {
            playSound('voice_ikame');
            playSound('kame_charge', { volume: 0.6 });
        });
        after(55, () => {
            playSound('vanish', { volume: 0.7 });
            spawnEffect('tp_out', player.x, player.y - 45, { centered: true, scale: 1.2 });
            player.hidden = true;
        });
        after(62, () => {
            // Reappear 220px short of the target, hands level with it, and hang there
            const side = tx >= player.x ? 1 : -1;
            player.x = tx - 220 * side;
            player.y = ty + 48;
            player.vx = 0; player.vy = 0;
            player.floatTicks = 60;
            player.direction = side;
            player.hidden = false;
            spawnEffect('tp_in', player.x, player.y - 45, { centered: true, scale: 1.2 });
            playSound('vanish', { volume: 0.5 });
        });
        after(75, () => {
            const g = gokuHands();
            fireBeam(g.x, g.y, tx, ty, 1.2);
        });
        after(125, endCast);
    }

    // [3] Ki Blast Volley: rapid alternating ki blasts that pepper the area around the cursor.
    function castKiVolley(tx, ty) {
        faceTarget(tx);
        startCast('volley');
        after(15, () => playSound('voice_volley'));
        // volley pose fires on every other frame from 20 ticks: one blast every 6 ticks
        for (let t = 20; t <= 74; t += 6) {
            after(t, () => {
                const g = gokuHands();
                spawnEffect('ki_flash', g.x, g.y - 8, { facing: player.direction });
                playSound('ki_shot', { volume: 0.5, rate: 0.9 + Math.random() * 0.2, minGap: 0 });
                const sx = (Math.random() - 0.5) * 90, sy = (Math.random() - 0.5) * 70;
                launch(g.x, g.y - 8, tx + sx, ty + sy, 14, [
                    { name: 'ki_ball', scale: 0.9 },
                ], (x, y) => {
                    spawnEffect('ki_boom', x, y, { centered: true, scale: 0.9 });
                    createExplosion(x, y, { radius: 60, colors: ['#ffe082', '#ffca28', '#ffffff'] });
                });
            });
        }
        after(90, endCast);
    }

    // [4] Spirit Bomb (Base, God): Goku raises his hands, a giant sphere of energy gathers above
    // him, and he hurls it at the cursor for the biggest blast he has.
    function castSpiritBomb(tx, ty) {
        faceTarget(tx);
        startCast('sb_body');
        playSound('voice_sb_a');
        playSound('charge', { volume: 0.5 });
        const cx = player.x, cy = player.y - 230;
        // sb_body raises the arms 15 ticks in and throws at 75
        after(15, () => {
            playSound('sb_gather', { volume: 0.6 });
            spawnEffect('sb_sphere', cx, cy, { centered: true, scale: 0.08, growTo: 0.9, growTime: 55, life: 60 });
            for (let i = 0; i < 6; i++) {
                const a = Math.random() * Math.PI * 2;
                after(i * 8, () => spawnEffect('charge', cx + Math.cos(a) * 160, cy + Math.sin(a) * 120, { centered: true, scale: 0.6, life: 15 }));
            }
        });
        after(75, () => {
            playSound('voice_sb_b');
            playSound('sb_throw', { volume: 0.7 });
            launch(cx, cy, tx, ty, 5, [
                { name: 'sb_sphere', scale: 0.9 },
            ], (x, y) => {
                const v = Math.max(0.4, nearVolume(x, y));
                playSound('big_boom', { volume: v });
                playSound('kame_boom', { volume: 0.8 * v });
                spawnEffect('sb_boom', x, y, { centered: true, scale: 1.3 });
                spawnEffect('smoke', x, y + 120, { scale: 2.5 });
                createExplosion(x, y, { radius: 330, colors: ['#e1f5fe', '#81d4fa', '#ffffff'] });
            });
        });
        after(110, endCast);
    }

    // [5] Dragon Fist (SSJ3, Blue Kaioken): Goku's punch unleashes a golden dragon that flies
    // head-first at the cursor and erupts on impact.
    function castDragonFist(tx, ty) {
        faceTarget(tx);
        startCast('df_body');
        playSound('voice_df');
        playSound('charge', { volume: 0.5 });
        after(20, () => spawnEffect('df_aura', player.x + 20 * player.direction, player.y - 40, { facing: player.direction, life: 40, fade: 10 }));
        // df_body throws the punch 35 ticks in
        after(35, () => {
            playSound('df_fire', { volume: 0.8 });
            const g = gokuHands();
            launch(g.x, g.y, tx, ty, 11, [
                { name: 'dragon', scale: 1.1, aim: 0, useAxis: true },
            ], (x, y) => {
                const v = Math.max(0.4, nearVolume(x, y));
                playSound('big_boom', { volume: v });
                spawnEffect('df_boom', x, y, { centered: true, scale: 1.1 });
                for (let i = 0; i < 4; i++) {
                    spawnEffect('df_spark', x + (Math.random() - 0.5) * 160, y + (Math.random() - 0.5) * 120, { centered: true });
                }
                createExplosion(x, y, { radius: 280, colors: ['#ffd54f', '#ffb300', '#fff8e1'] });
            });
        });
        after(100, endCast);
    }

    // Transform: power up to the next form (T). After the last form Goku drops back to base.
    // Each form's aura while powering up: [effect, scale]
    const FORM_AURA = {
        0: [['aura_0', 1]], 1: [['aura_1', 1]], 2: [['aura_2', 1], ['lightning', 1]], 3: [['aura_3', 1], ['lightning', 1]],
        4: [['god_fire_a', 0.9], ['god_fire_b', 0.9]], 5: [['blue_aura_a', 1], ['blue_aura_b', 1]],
        6: [['kk_aura_a', 1], ['kk_aura_b', 1], ['kk_flare', 0.9]], 7: [['ui_burst', 1], ['ui_aura', 1]], 8: [['ui_aura', 1], ['ui_burst', 1]]
    };
    const FORM_RING = { 1: 'tf_ring_1', 2: 'tf_ring_1', 3: 'tf_ring_1', 4: 'tf_ring_4', 5: 'tf_ring_5', 6: 'tf_ring_5' };
    const FORM_VOICE = { 1: 'voice_tf_1', 2: 'voice_tf_2', 3: 'voice_tf_3', 5: 'voice_tf_1', 6: 'voice_tf_1', 7: 'voice_tf_7', 8: 'voice_tf_7' };

    function castTransform() {
        if (CHAR_ID === 'luffy') return castLuffyTransform();
        const next = (player.form + 1) % CHAR_FORMS.length;
        player.casting = true;
        player.vx = 0;
        if (next === 0) {
            // Powering down is quick: a puff of smoke and he's back to base
            playSound('tf_burst', { volume: 0.6 });
            spawnEffect('smoke', player.x, player.y, { scale: 1.5 });
            spawnEffect('tf_flash', player.x, player.y - 45, { centered: true, scale: 0.5, life: 12, fade: 12 });
            player.form = 0;
            setPlayerAnim('idle');
            after(20, endCast);
            return;
        }
        const anim = `tf_${next}`;
        player.anim = createAnim(anim);
        const total = charData.anims[anim].frames.reduce((n, f) => n + f.t, 0);
        const half = Math.round(total * 0.55);
        playSound('charge', { volume: 0.5 });
        playSound('tf_powerup', { volume: 0.7 });
        if (FORM_VOICE[next]) playSound(FORM_VOICE[next]);
        for (const [name, scale] of FORM_AURA[player.form]) spawnEffect(name, player.x, player.y, { scale, follow: true, life: half, fade: 10, behind: true });
        if (FORM_RING[next]) spawnEffect(FORM_RING[next], player.x, player.y, { follow: true });
        for (let t = 12; t < total; t += 23) after(t, () => playSound('tf_pulse', { volume: 0.4, minGap: 0 }));
        for (let t = 6; t < total; t += 15) after(t, () => spawnEffect('smoke', player.x + (Math.random() - 0.5) * 60, player.y, { scale: 1 }));
        // The new form appears partway through: flash, burst and its own aura
        after(half, () => {
            playSound('tf_burst', { volume: 0.7 });
            playSound('tf_flash', { volume: 0.6 });
            spawnEffect('tf_flash', player.x, player.y - 45, { centered: true, scale: 0.7, life: 14, fade: 14 });
            for (const [name, scale] of FORM_AURA[next]) spawnEffect(name, player.x, player.y, { scale, follow: true, life: total - half + 25, fade: 20, behind: true });
            if (next >= 2) spawnEffect('lightning', player.x, player.y - 40, { follow: false, centered: true, life: 30, fade: 10 });
        });
        after(total, () => {
            player.form = next;
            endCast();
            setPlayerAnim('idle');
        });
    }

    // ==========================================
    // 11. DESTRUCTION
    // ==========================================
    // Punch a burning hole, tear paper shards out of it and shake letters loose around it.
    // smoke scales the grey clouds it leaves (a dash carving a trench would bury itself in them)
    // star: { dir, back, spikes } makes the hole a starburst splayed out toward dir (see addStarburst)
    function createExplosion(x, y, { radius = 60, colors = ['#4fc3f7', '#ffffff'], smoke = 1, star = null } = {}) {
        const holeR = Math.round(radius * 0.55);
        generated.tear(nearVolume(x, y));
        disturbDebris(x, y, radius * 1.4, 9);
        const blast = star ? addStarburst(x, y, holeR, star.dir, star.back, star.spikes) : addCrater(x, y, holeR);
        // What it tore out comes loose a tick later, so a big blast's work is spread over frames
        after(1, () => {
            spawnShards(x, y, holeR, blast.fresh);
            loosenLetters(blast);
            damageBlocks(blast.c);
            if (breakOffCards(x, y, blast.fresh)) scanPage(); // their ledges go with them
        });
        for (let i = 0; i < (8 + holeR / 10) * smoke; i++) {
            const a = Math.random() * Math.PI * 2;
            const d = holeR * (0.8 + Math.random() * 0.7);
            spawnPuff(x + Math.cos(a) * d, y + Math.sin(a) * d, true);
        }

        for (let i = 0; i < 45; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 8 + 3;
            particles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                radius: Math.random() * 4 + 2,
                color: colors[Math.floor(Math.random() * colors.length)],
                alpha: 1,
                decay: Math.random() * 0.03 + 0.01
            });
        }
    }

    // A straight cut through the page from (x1, y1) to (x2, y2), w either side of the line,
    // tearing out what it crosses
    function cutGroove(x1, y1, x2, y2, w) {
        generated.tear(nearVolume(x2, y2) * 0.6);
        const blast = addGroove(x1, y1, x2, y2, w);
        after(1, () => {
            spawnShards(blast.c.x, blast.c.y, w, blast.fresh);
            loosenLetters(blast);
            damageBlocks(blast.c);
            if (breakOffCards(blast.c.x, blast.c.y, blast.fresh)) scanPage();
        });
    }

    // ==========================================
    // 12. CORE ENGINE UPDATE & RENDER LOOP
    // ==========================================
    // Measured once per tick: reading the page's height makes the browser lay the page out, and
    // debris moving between reads would make it do that again for every piece
    let docBottomNow = null;
    function docBottom() {
        if (docBottomNow === null) docBottomNow = Math.max(html.scrollHeight, body.scrollHeight) - 4;
        return docBottomNow;
    }

    // Highest ledge crossed by a body spanning x1..x2 this tick (one-way: only when falling
    // onto it). Ledges are the page's own plus resting rubble; `self` is never its own ledge.
    function findLanding(x1, x2, prevY, nextY, self = null) {
        let best = null;
        for (let k = Math.floor((prevY - 0.5) / BAND); k <= Math.floor(nextY / BAND); k++) {
            for (const bands of [platformBands, rubbleBands]) {
                const band = bands.get(k);
                if (!band) continue;
                for (const p of band) {
                    if (x2 < p.x1 || x1 > p.x2 || p.y < prevY - 0.5 || p.y > nextY) continue;
                    if (best !== null && p.y >= best) continue;
                    if (p.o) {
                        if (p.o === self) continue;
                    } else if (inHole(Math.min(Math.max((x1 + x2) / 2, p.x1), p.x2), Math.max(p.y, pageTop) + 1)) {
                        // Checked just below the ledge's top, so a ledge on the page's edge falls too
                        continue;
                    }
                    best = p.y;
                }
            }
        }
        return best;
    }

    function updatePlayer() {
        const jumpHeld = keys['w'] || keys['arrowup'] || keys[' '];
        const wasGrounded = player.isGrounded;
        const airTicksBefore = player.airTicks;

        if (!player.casting) {
            player.vx = 0;
            if (keys['a'] || keys['arrowleft']) {
                player.vx = -player.speed;
                player.direction = -1;
            } else if (keys['d'] || keys['arrowright']) {
                player.vx = player.speed;
                player.direction = 1;
            }

            if (jumpHeld && player.isGrounded) {
                player.vy = player.jumpForce;
                player.isGrounded = false;
                playSound('jump', { volume: 0.6 });
            } else if (jumpHeld && player.airTicks > 12) {
                // Hold jump to fly: thrust beats gravity, capped climb speed
                player.vy = Math.max(player.vy - 1.0, -5);
                if (!player.flying) {
                    player.flying = true;
                    playSound('fly', { volume: 0.5 });
                }
            }
        }

        const prevY = player.y;
        if (player.floatTicks > 0) {
            player.floatTicks--;
            player.vy = 0;
        } else {
            player.vy = Math.min(player.vy + player.gravity, 16);
        }
        player.x += player.vx;
        player.y += player.vy;
        if (player.dropTicks > 0) player.dropTicks--;

        player.isGrounded = false;
        if (player.vy >= 0 && player.dropTicks === 0) {
            const landY = findLanding(player.x - 8, player.x + 8, prevY, player.y);
            if (landY !== null) {
                player.y = landY;
                player.vy = 0;
                player.isGrounded = true;
            }
        }
        const floor = docBottom();
        if (player.y >= floor) {
            player.y = floor;
            player.vy = 0;
            player.isGrounded = true;
        }
        player.airTicks = player.isGrounded ? 0 : player.airTicks + 1;
        if (player.isGrounded) player.flying = false;
        if (player.isGrounded && !wasGrounded && airTicksBefore > 8) playSound('land', { volume: 0.7 });

        // player.x is the feet axis, so keep half a body width from each edge
        const maxX = Math.max(html.scrollWidth, window.innerWidth) - 30;
        // Ceiling: the top of the sky, with room for his head (feet axis, ~90px tall)
        if (player.y < 100) {
            player.y = 100;
            player.vy = Math.max(player.vy, 0);
        }
        if (player.x < 30) player.x = 30;
        if (player.x > maxX) player.x = maxX;

        if (!player.casting) {
            if (!player.isGrounded) setPlayerAnim(player.vy < 0 ? 'jump_up' : 'jump_down');
            else if (player.vx !== 0) setPlayerAnim('run');
            else setPlayerAnim('idle');
        }
        stepAnim(player.anim);
        // Footsteps on the frames where a foot hits the ground (the original plays them on 3 and 6)
        if (player.anim.name === 'run' && player.anim.tick === 0 && (player.anim.index === 2 || player.anim.index === 5)) {
            playSound('step', { volume: 0.45, rate: 0.92 + Math.random() * 0.16, minGap: 0 });
        }

        // Camera: while the character moves, keep his feet between two lines on screen. Crossing a line
        // scrolls the page by exactly the overshoot, so he stays put and the page glides.
        if (player.vx !== 0 || player.vy !== 0) {
            const vh = window.innerHeight;
            const topLine = Math.min(170, vh * 0.45);
            const bottomLine = Math.max(vh - 50, topLine + 100);
            const feet = player.y - window.scrollY;
            if (feet < topLine) window.scrollTo(window.scrollX, player.y - topLine);
            else if (feet > bottomLine) window.scrollTo(window.scrollX, player.y - bottomLine);
        }
    }

    function updateDebris() {
        updateShockwaves();
        // Letters drop one at a time
        for (let i = letterQueue.length - 1; i >= 0; i--) {
            if (--letterQueue[i].delay <= 0) {
                dropLetter(letterQueue[i].span, letterQueue[i].from);
                letterQueue.splice(i, 1);
            }
        }

        const viewBottom = window.scrollY + window.innerHeight + 200;
        const lost = docBottom() + 400;

        for (let i = letters.length - 1; i >= 0; i--) {
            stepDebris(letters[i], 0.35);
            if (letters[i].y > lost) letters.splice(i, 1);
        }
        for (let i = shards.length - 1; i >= 0; i--) {
            stepDebris(shards[i], 0.3);
            if (shards[i].y > lost) shards.splice(i, 1);
        }
        for (let i = blocks.length - 1; i >= 0; i--) {
            const o = blocks[i];
            stepDebris(o, 0.3);
            if (o.y > lost) {
                o.el.remove();
                blocks.splice(i, 1);
            } else placeBlock(o);
        }

        // Craters near the screen keep burning, then smoulder
        const viewTop = viewBottom - window.innerHeight - 500; // scrollY - 300, without a layout
        for (const c of craters) {
            c.age++;
            if (c.y < viewTop || c.y > viewBottom + 100 || flames.length > 1800) continue;
            const burning = c.age < c.burn;
            if (burning && Math.random() < 0.12) generated.crackle(nearVolume(c.x, c.y));
            const size = c.seg ? c.len * 0.25 : c.R; // a groove burns along its length
            let n = burning ? size * 0.012 : size * 0.0015;
            while (n > 0) {
                if (Math.random() < n) spawnFlame(c);
                n -= 1;
            }
            if (burning && puffs.length < 300 && Math.random() < 0.02) {
                const a = -Math.PI / 2 + (Math.random() - 0.5) * 2;
                const [px, py] = c.seg ? rimPoint(c) : [c.x + Math.cos(a) * c.R, c.y + Math.sin(a) * c.R];
                spawnPuff(px, py, false);
            }
        }
        for (let i = puffs.length - 1; i >= 0; i--) {
            const pf = puffs[i];
            pf.x += pf.vx;
            pf.y += pf.vy;
            pf.r += 0.04;
            if (++pf.life > pf.max) puffs.splice(i, 1);
        }
        for (let i = flames.length - 1; i >= 0; i--) {
            const f = flames[i];
            f.x += f.vx;
            f.y += f.vy;
            f.life++;
            if (f.life > f.max) flames.splice(i, 1);
        }

        for (let i = particles.length - 1; i >= 0; i--) {
            const pt = particles[i];
            pt.x += pt.vx;
            pt.y += pt.vy;
            pt.alpha -= pt.decay;
            if (pt.alpha <= 0) particles.splice(i, 1);
        }
    }

    function drawEffects(behind) {
        for (const fx of effects) {
            if (fx.behind !== behind) continue;
            let alpha = 1;
            if (fx.life && fx.fade && fx.age > fx.life - fx.fade) {
                alpha = Math.max(0, (fx.life - fx.age) / fx.fade);
            }
            const scale = fx.growTo ? fx.scale + (fx.growTo - fx.scale) * Math.min(1, fx.age / fx.growTime) : fx.scale;
            const stretch = fx.stretchX * (fx.stretchTime ? Math.min(1, fx.age / fx.stretchTime) : 1);
            if (fx.follow) {
                fx.x = player.x + fx.offsetX * player.direction;
                fx.y = player.y + fx.offsetY;
                if (fx.offsetX) fx.facing = player.direction; // held in his hand: turns with him
            }
            drawAnim(fx.anim, fx.x, fx.y, fx.facing, scale, alpha, fx.centered, fx.rotation, stretch);
        }
    }

    function drawShard(s) {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.rot);
        ctx.beginPath();
        s.pts.forEach(([px, py], k) => k ? ctx.lineTo(px, py) : ctx.moveTo(px, py));
        ctx.closePath();
        ctx.fillStyle = s.color;
        ctx.fill();
        if (s.image) {
            // Draw the image as it sat on the page, relative to where this shard was torn from
            ctx.save();
            ctx.clip();
            const im = s.image;
            if (im.copy.bitmap) ctx.drawImage(im.copy.bitmap, im.x1 - s.ox, im.y1 - s.oy, im.x2 - im.x1, im.y2 - im.y1);
            ctx.restore();
        } else if (s.lines) {
            ctx.save();
            ctx.clip();
            ctx.fillStyle = 'rgba(40, 40, 40, 0.35)';
            for (let k = 0; k < s.lines; k++) ctx.fillRect(-30, -12 + k * 8, 60, 2);
            ctx.restore();
        }
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
    }

    function drawHud() {
        ctx.save();
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textBaseline = 'top';
        const list = jutsuList();
        if (selectedJutsu >= list.length) selectedJutsu = 0;
        if (CHAR_FORMS) {
            const label = `${CHAR_FORMS[player.form]}  ·  [T] transform`;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
            ctx.fillRect(12, 12 + list.length * 26, ctx.measureText(label).width + 16, 22);
            ctx.fillStyle = '#ffd54f';
            ctx.fillText(label, 20, 16 + list.length * 26);
        }
        list.forEach((j, i) => {
            const active = i === selectedJutsu;
            const label = `[${i + 1}] ${j.name}`;
            const w = ctx.measureText(label).width + 16;
            const y = 12 + i * 26;
            ctx.fillStyle = active ? 'rgba(255, 152, 0, 0.9)' : 'rgba(0, 0, 0, 0.55)';
            ctx.fillRect(12, y, w, 22);
            ctx.fillStyle = active ? '#000' : '#fff';
            ctx.fillText(label, 20, y + 4);
        });
        ctx.restore();
    }

    function drawCrosshair() {
        ctx.save();
        ctx.translate(mouse.x, mouse.y);
        ctx.strokeStyle = '#4fc3f7';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-15, 0); ctx.lineTo(-4, 0);
        ctx.moveTo(4, 0); ctx.lineTo(15, 0);
        ctx.moveTo(0, -15); ctx.lineTo(0, -4);
        ctx.moveTo(0, 4); ctx.lineTo(0, 15);
        ctx.stroke();
        ctx.restore();
    }

    let supportClock = 0;

    // One game tick. MUGEN timing assumes 60 ticks per second.
    function tick() {
        docBottomNow = null;
        viewX = window.scrollX;
        viewY = window.scrollY;
        // Scheduled jutsu steps
        for (let i = timers.length - 1; i >= 0; i--) {
            if (--timers[i].ticks <= 0) {
                const fn = timers[i].fn;
                timers.splice(i, 1);
                fn();
            }
        }

        if (rubbleDirty) rebuildRubble();
        if (++supportClock % 10 === 0) checkRubbleSupport();
        updatePlayer();

        updateArms();

        // Effects
        for (let i = effects.length - 1; i >= 0; i--) {
            const fx = effects[i];
            fx.age++;
            fx.rotation += fx.spin;
            stepAnim(fx.anim);
            const expired = fx.life ? fx.age >= fx.life : fx.anim.done;
            if (expired) effects.splice(i, 1);
        }

        // Projectiles
        const sx = window.scrollX, sy = window.scrollY;
        for (let i = projectiles.length - 1; i >= 0; i--) {
            const p = projectiles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.age++;
            p.layers.forEach(l => stepAnim(l.anim));

            const dist = Math.hypot(p.tx - p.x, p.ty - p.y);
            const speed = Math.hypot(p.vx, p.vy);
            const offscreen = p.x < sx - 300 || p.x > sx + canvas.width + 300 || p.y < sy - 300 || p.y > sy + canvas.height + 300;
            if (dist <= speed || offscreen) {
                projectiles.splice(i, 1);
                p.onHit(p.tx, p.ty);
            }
        }

        updateDebris();
    }

    function render() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const sx = window.scrollX, sy = window.scrollY;
        const vw = canvas.width, vh = canvas.height;

        drawCraters();

        // ---- World (page coordinates) ----
        ctx.save();
        ctx.translate(-sx, -sy);

        for (const pf of puffs) {
            if (pf.y + pf.r < sy || pf.y - pf.r > sy + vh) continue;
            const t = pf.life / pf.max;
            ctx.globalAlpha = Math.min(1, (1 - t) * 1.4) * 0.85;
            ctx.fillStyle = `rgb(${pf.shade}, ${pf.shade}, ${pf.shade})`;
            ctx.beginPath();
            ctx.arc(pf.x, pf.y, pf.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = `rgb(${pf.shade + 25}, ${pf.shade + 25}, ${pf.shade + 25})`;
            ctx.beginPath();
            ctx.arc(pf.x - pf.r * 0.15, pf.y - pf.r * 0.15, pf.r * 0.7, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        for (const f of flames) {
            const t = f.life / f.max;
            const s = Math.max(1, Math.round(f.size * (1 - t * 0.5)));
            ctx.fillStyle = flameColor(t);
            ctx.fillRect(Math.round(f.x - s / 2), Math.round(f.y - s / 2), s, s);
        }

        drawEffects(true);
        drawArms();
        if (!player.hidden) drawAnim(player.anim, player.x, player.y, player.direction);
        drawEffects(false);

        for (const p of projectiles) {
            const grow = Math.min(1, 0.4 + p.age / 60);
            const heading = Math.atan2(p.vy, p.vx);
            for (const l of p.layers) {
                // aim = the angle (degrees) the sprite already points at in the sheet
                const rotation = l.aim === undefined ? 0 : heading - l.aim * Math.PI / 180;
                drawAnim(l.anim, p.x, p.y, 1, l.scale * (l.grow ? grow : 1), 1, !l.useAxis, rotation);
            }
        }

        const onScreen = o => o.y > sy - 150 && o.y < sy + vh + 150;
        for (const s of shards) if (onScreen(s)) drawShard(s);

        for (const l of letters) {
            if (!onScreen(l)) continue;
            ctx.save();
            ctx.translate(l.x, l.y);
            ctx.rotate(l.rot);
            ctx.font = l.font;
            ctx.fillStyle = l.color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(l.ch, 0, 0);
            ctx.restore();
        }

        for (const pt of particles) {
            ctx.save();
            ctx.globalAlpha = Math.max(0, pt.alpha);
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, pt.radius, 0, Math.PI * 2);
            ctx.fillStyle = pt.color;
            ctx.fill();
            ctx.restore();
        }

        ctx.restore();

        // ---- Screen space ----
        drawHud();
        drawCrosshair();
    }

    // Run game ticks at a fixed 60 per second whatever the display's frame rate
    // (120/144 Hz screens, or slow frames during big jutsu), then draw once.
    const TICK_MS = 1000 / 60;
    let lastTime = performance.now();
    let pending = 0;

    function frame(now) {
        pending += Math.min(now - lastTime, 250); // don't fast-forward after a hidden tab
        lastTime = now;
        const start = performance.now();
        while (pending >= TICK_MS) {
            tick();
            pending -= TICK_MS;
            // After a heavy tick (a big blast's work) the rest catch up next frame, so work
            // spread over ticks isn't run back to back in one frame
            if (performance.now() - start > 25) break;
        }
        render();
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
})();
