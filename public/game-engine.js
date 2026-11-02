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
    const CHARACTERS = ['naruto', 'sasuke', 'goku'];
    // Characters with transformations: form names in the order the transform key cycles them
    const FORMS = {
        goku: ['Base', 'Super Saiyan', 'Super Saiyan 2', 'Super Saiyan 3', 'Super Saiyan God',
               'Super Saiyan Blue', 'Blue Kaioken', 'Ultra Instinct Sign', 'Mastered Ultra Instinct']
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

    // Quieter the further a sound is from the middle of the screen (page coordinates)
    function nearVolume(x, y) {
        const cx = window.scrollX + window.innerWidth / 2, cy = window.scrollY + window.innerHeight / 2;
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
        if (anim.blend === 'add') ctx.globalCompositeOperation = 'lighter';
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

    function radiusAt(c, angle) {
        let r = 1;
        for (const w of c.waves) r += w.a * Math.sin(w.k * angle + w.p);
        return c.R * r;
    }

    // Signed distance-ish to the crater union: < 0 inside a hole. Also returns the nearest blob.
    function craterField(x, y, list = craters) {
        let best = Infinity, owner = null;
        for (const c of list) {
            const dx = x - c.x, dy = y - c.y;
            if (Math.abs(dx) > c.R * 1.5 + c.soot || Math.abs(dy) > c.R * 1.5 + c.soot) continue;
            const f = Math.sqrt(dx * dx + dy * dy) - radiusAt(c, Math.atan2(dy, dx));
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
                const { f: raw, owner: c } = craterField(px, Math.max(py, sky), near);
                if (!c) continue;
                const f = raw + (hash(gx, gy) - 0.5) * DMG * 1.6; // ragged pixel edge
                const p = (my * w + mx) * 4;
                if (f < 0) {
                    put(holes, p, 0, 0, 0, 255);
                    if (inSky) continue;
                    // Torn paper lip hanging into the bottom of the hole
                    const lip = c.R * (0.07 + hash(gx, 7) * 0.09);
                    if (py - c.y > c.R * 0.25 && f > -lip) {
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
        // The page this blast actually removes: inside the new blob, not sky, not already a hole.
        // Debris comes only from here, so hitting the same spot again tears nothing new.
        const before = craters.slice();
        const fresh = [];
        const reach0 = R * 1.5;
        for (let py = y - reach0; py <= y + reach0; py += FRESH_STEP) {
            if (py < pageTop) continue;
            for (let px = x - reach0; px <= x + reach0; px += FRESH_STEP) {
                if (craterField(px, py, [c]).f < 0 && craterField(px, py, before).f >= 0) fresh.push([px, py]);
            }
        }
        craters.push(c);
        disturbDebris(x, y, R * 1.6 + 40, 0);
        ensureMapSize();
        const reach = R * 1.5 + c.soot + DMG * 2;
        paintDamage(x - reach, y - reach, x + reach, y + reach);
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
        return { el: img, x1: ir.left + window.scrollX, y1: ir.top + window.scrollY, x2: ir.right + window.scrollX, y2: ir.bottom + window.scrollY };
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

    // Wrap individual characters in hidden-able spans and queue them to fall. Letters the blast
    // destroyed (inside the new hole, not in an older one) all fly out; a few right at the new
    // rim shake loose. Letters already under a hole were destroyed before and stay gone.
    function loosenLetters({ c, before }) {
        const cx = c.x, cy = c.y, rim = c.R * 0.3, rOut = c.R * 1.5 + rim;
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
        const picked = [];
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
                    if (share > 0.9) el.style.visibility = 'hidden'; // blown away entirely
                    else picked.push({ el, r });
                    break;
                }
            }
        }
        for (const { el, r } of picked) detachCard(el, r, cx, cy);
        return picked.length > 0;
    }

    // Cut the holes the card already has out of it, so the bite travels with it. Returns the
    // mask canvas (opaque = card still there), kept so later blasts can bite into it.
    function maskOutHoles(el, r) {
        const x0 = (r.left + window.scrollX) / DMG, y0 = (r.top + window.scrollY) / DMG;
        const mw = Math.max(1, Math.ceil(r.width / DMG)), mh = Math.max(1, Math.ceil(r.height / DMG));
        const m = document.createElement('canvas');
        m.width = mw; m.height = mh;
        const g = m.getContext('2d');
        g.fillStyle = '#000';
        g.fillRect(0, 0, mw, mh);
        g.globalCompositeOperation = 'destination-out';
        g.drawImage(holeMap, x0, y0, r.width / DMG, r.height / DMG, 0, 0, mw, mh);
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

    // The colour a card's torn pieces get: its own background, else its image's average colour
    function cardColor(el) {
        const bg = getComputedStyle(el).backgroundColor;
        if (isOpaque(bg)) return bg;
        const img = el.tagName === 'IMG' ? el : el.querySelector('img');
        if (img && img.complete && img.naturalWidth) {
            try {
                const t = document.createElement('canvas');
                t.width = t.height = 1;
                const tg = t.getContext('2d');
                tg.drawImage(img, 0, 0, 1, 1);
                const [r, g, b, a] = tg.getImageData(0, 0, 1, 1).data;
                if (a > 40) return `rgb(${r}, ${g}, ${b})`;
            } catch (e) { /* another site's image: can't be read */ }
        }
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
            const size = Math.min(Math.sqrt(total / count) * 1.3, 8 + c.R * 0.4);
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

    function detachCard(el, r, cx, cy) {
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
        const mask = maskOutHoles(copy, r);
        debrisLayer.appendChild(copy);
        el.setAttribute(LOOSE, '');
        el.style.setProperty('visibility', 'hidden', 'important');

        const x = left + r.width / 2, y = top + r.height / 2;
        const a = Math.atan2(y - cy, x - cx);
        const heavy = 1 + (r.width * r.height) / 6000;
        const hw = r.width / 2, hh = r.height / 2;
        blocks.push({
            el: copy, base: base === 'none' ? '' : ' ' + base,
            x, y, ox: x, oy: y, heavy, w: r.width, h: r.height, mask,
            color: cardColor(el), image: el.tagName === 'IMG' ? imageSource(el) : null,
            pts: [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]],
            vx: Math.cos(a) * (2 + Math.random() * 3) / Math.sqrt(heavy),
            vy: Math.sin(a) * 2 - 3 - Math.random() * 2,
            rot: 0, vr: (Math.random() - 0.5) * 0.12 / Math.sqrt(heavy),
            resting: false, shown: ''
        });
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
        const a = Math.random() * Math.PI * 2;
        const d = radiusAt(c, a) * (0.97 + Math.random() * 0.1);
        const x = c.x + Math.cos(a) * d;
        const y = c.y + Math.sin(a) * d;
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
            { name: 'Lava Rasenshuriken', cast: castLavaRasenshuriken }
        ],
        sasuke: [
            { name: 'Great Fireball', cast: castGreatFireball },
            { name: 'Susanoo Arrow', cast: castSusanooArrow },
            { name: 'Chibaku Tensei', cast: castChibakuTensei },
            { name: "Indra's Arrow", cast: castIndrasArrow },
            { name: 'Chidori Senbon', cast: castChidoriSenbon },
            { name: 'Shinra Tensei', cast: castShinraTensei }
        ]
    };
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

    const GAME_KEYS = new Set([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
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

    // [6] Shinra Tensei: a shockwave bursts out from Sasuke himself, tearing a crater around him
    // and hurling every piece of rubble nearby away. Not aimed: the cursor only sets his facing.
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
            disturbDebris(cx, cy, 700, 22);
            createExplosion(cx, cy, { radius: 300, colors: ['#eceff1', '#b0bec5', '#ffffff'] });
        });
        after(60, endCast);
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
        after(10, () => {
            const v = Math.max(0.3, nearVolume(tx, ty));
            playSound('kame_boom', { volume: 0.9 * v });
            playSound('big_boom', { volume: 0.6 * v });
            spawnEffect('kame_boom', tx, ty, { centered: true, scale: 1.2 * size });
            createExplosion(tx, ty, { radius: 200 * size, colors: ['#e1f5fe', '#4fc3f7', '#ffffff'] });
            // The beam's path is scorched too, but more lightly
            for (let d = 140; d < dist - 120; d += 150) {
                const px = x + Math.cos(angle) * d, py = y + Math.sin(angle) * d;
                after(Math.round(d / 120), () => createExplosion(px, py, { radius: 70 * size, colors: ['#b3e5fc', '#ffffff'] }));
            }
        });
    }

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
    function createExplosion(x, y, { radius = 60, colors = ['#4fc3f7', '#ffffff'] } = {}) {
        const holeR = Math.round(radius * 0.55);
        generated.tear(nearVolume(x, y));
        disturbDebris(x, y, radius * 1.4, 9);
        const blast = addCrater(x, y, holeR);
        spawnShards(x, y, holeR, blast.fresh);
        loosenLetters(blast);
        damageBlocks(blast.c);
        if (breakOffCards(x, y, blast.fresh)) scanPage(); // their ledges go with them
        for (let i = 0; i < 8 + holeR / 10; i++) {
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

    // ==========================================
    // 12. CORE ENGINE UPDATE & RENDER LOOP
    // ==========================================
    function docBottom() {
        return Math.max(html.scrollHeight, body.scrollHeight) - 4;
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
        const viewTop = window.scrollY - 300;
        for (const c of craters) {
            c.age++;
            if (c.y < viewTop || c.y > viewBottom + 100 || flames.length > 1800) continue;
            const burning = c.age < c.burn;
            if (burning && Math.random() < 0.12) generated.crackle(nearVolume(c.x, c.y));
            let n = burning ? c.R * 0.012 : c.R * 0.0015;
            while (n > 0) {
                if (Math.random() < n) spawnFlame(c);
                n -= 1;
            }
            if (burning && puffs.length < 300 && Math.random() < 0.02) {
                const a = -Math.PI / 2 + (Math.random() - 0.5) * 2;
                spawnPuff(c.x + Math.cos(a) * c.R, c.y + Math.sin(a) * c.R, false);
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
            if (fx.follow) { fx.x = player.x; fx.y = player.y; }
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
            ctx.drawImage(im.el, im.x1 - s.ox, im.y1 - s.oy, im.x2 - im.x1, im.y2 - im.y1);
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

        // Effects
        for (let i = effects.length - 1; i >= 0; i--) {
            const fx = effects[i];
            fx.age++;
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
        while (pending >= TICK_MS) {
            tick();
            pending -= TICK_MS;
        }
        render();
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
})();
