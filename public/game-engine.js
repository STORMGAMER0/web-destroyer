(async function() {
    console.log("⚡ M.U.G.E.N Void Engine Initialized! Ranged Jutsu Loaded...");

    // ==========================================
    // 1. ENGINE, CANVAS & VOID SETUP
    // ==========================================
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.zIndex = '999999';
    canvas.style.pointerEvents = 'none';
    document.body.appendChild(canvas);

    const voidOverlay = document.createElement('div');
    voidOverlay.style.position = 'fixed';
    voidOverlay.style.top = '0';
    voidOverlay.style.left = '0';
    voidOverlay.style.width = '100vw';
    voidOverlay.style.height = '100vh';
    voidOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0)';
    voidOverlay.style.zIndex = '999998';
    voidOverlay.style.pointerEvents = 'none';
    document.body.appendChild(voidOverlay);

    document.documentElement.style.cursor = 'none';
    document.body.style.cursor = 'none';

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
    const ASSET_DIR = '/characters/naruto/';
    let charData = null;
    let sheets = [];

    try {
        const response = await fetch(ASSET_DIR + 'naruto.json');
        charData = await response.json();
        sheets = await Promise.all(charData.sheets.map(file => new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = ASSET_DIR + file;
        })));
        console.log("✅ Naruto assets successfully compiled!");
    } catch (err) {
        console.error("❌ Asset loading failed:", err);
        return;
    }

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
    function drawAnim(state, x, y, facing = 1, scale = 1, alpha = 1, centered = false) {
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
        ctx.scale(flipH ? -scale : scale, flipV ? -scale : scale);
        ctx.drawImage(sheets[spr.sheet], spr.x, spr.y, spr.w, spr.h, -ax, -ay, spr.w, spr.h);
        ctx.restore();
    }

    // ==========================================
    // 4. STATE VECTORS & INPUT
    // ==========================================
    const mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const particles = [];
    const projectiles = [];
    const effects = [];     // one-shot or timed animations drawn in the world
    const timers = [];      // scheduled jutsu steps, counted in ticks

    const player = {
        x: 100,
        y: window.innerHeight - 20, // feet (sprite axis) position
        vx: 0,
        vy: 0,
        speed: 6,
        gravity: 0.6,
        jumpForce: -14,
        isGrounded: false,
        direction: 1,
        hidden: false,       // true while Kurama stands in for Naruto
        casting: false,
        anim: createAnim('idle')
    };

    const JUTSU = [
        { key: '1', name: 'Rasenshuriken', cast: castRasenshuriken },
        { key: '2', name: 'Tailed Beast Bomb', cast: castTailedBeastBomb },
        { key: '3', name: 'Kurama Bijuudama', cast: castKuramaBijuudama },
        { key: '4', name: 'Twin Rasenshuriken', cast: castTwinRasenshuriken },
        { key: '5', name: 'Lava Rasenshuriken', cast: castLavaRasenshuriken }
    ];
    let selectedJutsu = 0;

    const keys = {};
    window.addEventListener('keydown', e => {
        keys[e.key.toLowerCase()] = true;
        const slot = JUTSU.findIndex(j => j.key === e.key);
        if (slot !== -1) selectedJutsu = slot;
    });
    window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

    window.addEventListener('mousemove', e => {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
    });

    window.addEventListener('mousedown', e => {
        if (e.button === 0 && !player.casting) {
            JUTSU[selectedJutsu].cast(e.clientX, e.clientY);
        }
    });

    // Clicks are attacks: stop them from following links or pressing page buttons
    window.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
    }, true);

    function setPlayerAnim(name) {
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
            behind: !!opts.behind,       // draw behind Naruto
            life: opts.life || null,     // ticks; null = until a non-looping anim ends
            fade: opts.fade || 0,        // ticks of fade-out at the end of life
            age: 0
        };
        effects.push(fx);
        return fx;
    }

    // ==========================================
    // 5. RANGED JUTSU
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

    // [1] Rasenshuriken: Naruto raises it overhead and throws; it explodes into a wind dome.
    function castRasenshuriken(tx, ty) {
        faceTarget(tx);
        startCast('rs_throw');
        spawnEffect('charge', player.x, player.y - 60, { life: 30 });

        // rs_throw frame 3 (after 5 + 25 + 3 ticks) is the release
        after(33, () => {
            const startX = player.x + 20 * player.direction;
            const startY = player.y - 55;
            launch(startX, startY, tx, ty, 9, [
                { name: 'rs_core', scale: 0.8 },
                { name: 'rs_spin', scale: 0.9 },
            ], (x, y) => {
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

        after(45, () => {
            const mouthX = baseX - 120 * facing + 220 * facing;
            const mouthY = baseY - 170;
            spawnEffect('charge', mouthX, mouthY, { scale: 1.6, life: 30 });
            launch(mouthX, mouthY, tx, ty, 7, [
                { name: 'tbb_glow', scale: 3, grow: true },
                { name: 'tbb_ball', scale: 0.35, grow: true },
            ], (x, y) => {
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

        after(40, () => {
            const mouthX = baseX + 220 * facing;
            const mouthY = baseY - 170;
            launch(mouthX, mouthY, tx, ty, 12, [
                { name: 'tbb_glow', scale: 2 },
                { name: 'tbb_ball', scale: 0.25 },
            ], (x, y) => {
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

        // tw_form reaches its held pose after 30 + 5 + 5 ticks
        after(40, () => {
            const startX = baseX + 60 * facing;
            const startY = baseY - 230;
            launch(startX, startY - 40, tx, ty, 8, [
                { name: 'rs_core', scale: 1.4 },
                { name: 'rs_spin', scale: 1.8 },
            ], (x, y) => {
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

        // Same throw as the Rasenshuriken: release on rs_throw frame 3
        after(33, () => {
            const startX = player.x + 20 * player.direction;
            const startY = player.y - 55;
            launch(startX, startY, tx, ty, 8, [
                { name: 'lv_crust', scale: 0.9 },
                { name: 'lv_core', scale: 0.9 },
                { name: 'lv_wind', scale: 0.8 },
            ], (x, y) => {
                spawnEffect('lv_ring', x, y, { centered: true, scale: 1.2 });
                spawnEffect('lv_dome', x, y, { scale: 1.1 });
                spawnEffect('tbb_explode', x, y, { centered: true, scale: 0.45, life: 30, fade: 20 });
                createExplosion(x, y, { radius: 200, colors: ['#ff5722', '#ffab00', '#ffeb3b'] });
            });
        });
        after(70, endCast);
    }

    // ==========================================
    // 6. DESTRUCTION & PARTICLES
    // ==========================================
    function createExplosion(x, y, { radius = 60, colors = ['#4fc3f7', '#ffffff'] } = {}) {
        const sparkCount = 45;
        for (let i = 0; i < sparkCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 8 + 3;
            particles.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                radius: Math.random() * 4 + 2,
                color: colors[Math.floor(Math.random() * colors.length)],
                alpha: 1,
                decay: Math.random() * 0.03 + 0.01
            });
        }

        // Sample the blast area in rings. The canvas and overlay have pointer-events: none,
        // so elementFromPoint sees straight through them to the page underneath.
        const viewportArea = window.innerWidth * window.innerHeight;
        const hit = new Set();
        for (const ring of [0, 0.5, 1]) {
            const steps = ring === 0 ? 1 : 8;
            for (let i = 0; i < steps; i++) {
                const a = (i / steps) * Math.PI * 2;
                const el = document.elementFromPoint(x + Math.cos(a) * radius * ring, y + Math.sin(a) * radius * ring);
                if (!el || el === document.body || el === document.documentElement) continue;
                // Skip page-sized wrappers so one blast doesn't wipe out the whole site
                const rect = el.getBoundingClientRect();
                if (rect.width * rect.height > viewportArea * 0.5) continue;
                hit.add(el);
            }
        }

        hit.forEach(hitElement => {
            const dx = Math.random() * 200 - 100;
            const dy = Math.random() * 200 - 100;
            hitElement.style.transition = 'transform 0.5s ease-out, opacity 0.4s ease';
            hitElement.style.transform = `scale(0) rotate(${Math.random() * 100 - 50}deg) translate(${dx}px, ${dy}px)`;
            hitElement.style.opacity = '0';
            setTimeout(() => { hitElement.style.visibility = 'hidden'; }, 450);
        });

        const blastRadius = Math.round(radius * 0.6);
        voidOverlay.style.backgroundColor = 'rgba(10, 10, 10, 0.96)';
        const currentClip = voidOverlay.style.clipPath || '';
        if (!currentClip.includes('polygon') && !currentClip.includes('path')) {
            voidOverlay.style.clipPath = `path('M 0 0 L ${window.innerWidth} 0 L ${window.innerWidth} ${window.innerHeight} L 0 ${window.innerHeight} Z M ${x} ${y} m -${blastRadius}, 0 a ${blastRadius},${blastRadius} 0 1,0 ${blastRadius * 2},0 a ${blastRadius},${blastRadius} 0 1,0 -${blastRadius * 2},0')`;
        } else {
            voidOverlay.style.clipPath += ` path('M ${x} ${y} m -${blastRadius}, 0 a ${blastRadius},${blastRadius} 0 1,0 ${blastRadius * 2},0 a ${blastRadius},${blastRadius} 0 1,0 -${blastRadius * 2},0')`;
        }
    }

    // ==========================================
    // 7. CORE ENGINE UPDATE & RENDER LOOP
    // ==========================================
    function updatePlayer() {
        if (!player.casting) {
            player.vx = 0;
            if (keys['a'] || keys['arrowleft']) {
                player.vx = -player.speed;
                player.direction = -1;
            } else if (keys['d'] || keys['arrowright']) {
                player.vx = player.speed;
                player.direction = 1;
            }

            if ((keys['w'] || keys['arrowup'] || keys[' ']) && player.isGrounded) {
                player.vy = player.jumpForce;
                player.isGrounded = false;
            }
        }

        player.vy += player.gravity;
        player.x += player.vx;
        player.y += player.vy;

        const floorBaseline = window.innerHeight - 20;
        if (player.y >= floorBaseline) {
            player.y = floorBaseline;
            player.vy = 0;
            player.isGrounded = true;
        }

        // player.x is the feet axis, so keep half a body width from each edge
        if (player.x < 30) player.x = 30;
        if (player.x > window.innerWidth - 30) player.x = window.innerWidth - 30;

        if (!player.casting) {
            if (!player.isGrounded) setPlayerAnim(player.vy < 0 ? 'jump_up' : 'jump_down');
            else if (player.vx !== 0) setPlayerAnim('run');
            else setPlayerAnim('idle');
        }
        stepAnim(player.anim);
    }

    function drawEffects(behind) {
        for (const fx of effects) {
            if (fx.behind !== behind) continue;
            let alpha = 1;
            if (fx.life && fx.fade && fx.age > fx.life - fx.fade) {
                alpha = Math.max(0, (fx.life - fx.age) / fx.fade);
            }
            drawAnim(fx.anim, fx.x, fx.y, fx.facing, fx.scale, alpha, fx.centered);
        }
    }

    function drawHud() {
        ctx.save();
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textBaseline = 'top';
        JUTSU.forEach((j, i) => {
            const active = i === selectedJutsu;
            const label = `[${j.key}] ${j.name}`;
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
        for (let i = projectiles.length - 1; i >= 0; i--) {
            const p = projectiles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.age++;
            p.layers.forEach(l => stepAnim(l.anim));

            const dist = Math.hypot(p.tx - p.x, p.ty - p.y);
            const speed = Math.hypot(p.vx, p.vy);
            if (dist <= speed || p.x < -200 || p.x > canvas.width + 200 || p.y < -200 || p.y > canvas.height + 200) {
                projectiles.splice(i, 1);
                p.onHit(p.tx, p.ty);
            }
        }

        // Particles
        for (let i = particles.length - 1; i >= 0; i--) {
            const pt = particles[i];
            pt.x += pt.vx;
            pt.y += pt.vy;
            pt.alpha -= pt.decay;
            if (pt.alpha <= 0) particles.splice(i, 1);
        }
    }

    function render() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        drawEffects(true);
        if (!player.hidden) drawAnim(player.anim, player.x, player.y, player.direction);
        drawEffects(false);

        for (const p of projectiles) {
            const grow = Math.min(1, 0.4 + p.age / 60);
            for (const l of p.layers) {
                drawAnim(l.anim, p.x, p.y, 1, l.scale * (l.grow ? grow : 1), 1, true);
            }
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
