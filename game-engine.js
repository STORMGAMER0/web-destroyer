(async function() {
    console.log("⚡ M.U.G.E.N Void Engine Initialized! Rasenshuriken Loaded...");

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
    let spriteData = null;
    const spriteSheet = new Image();

    try {
        const response = await fetch('/naruto_data.json');
        spriteData = await response.json();
        
        spriteSheet.src = '/naruto_spritesheet.png';
        await new Promise((resolve) => spriteSheet.onload = resolve);
        console.log("✅ Naruto assets successfully compiled!");
    } catch (err) {
        console.error("❌ Asset loading failed:", err);
        return;
    }

    // ==========================================
    // 3. STATE VECTORS & MOUSE SYSTEM
    // ==========================================
    const mouse = { x: 0, y: 0, clicked: false };
    const particles = [];
    const projectiles = [];

    const player = {
        x: 100,
        y: window.innerHeight - 150,
        vx: 0,
        vy: 0,
        speed: 6,
        gravity: 0.6,
        jumpForce: -14,
        isGrounded: false,
        direction: 1,
        state: 'idle',
        currentFrameIndex: 0,
        frameTimer: 0,
        frameSpeed: 5
    };

    const keys = {};
    window.addEventListener('keydown', e => keys[e.key.toLowerCase()] = true);
    window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

    window.addEventListener('mousemove', e => {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
    });

    window.addEventListener('mousedown', e => {
        if (e.button === 0) { 
            fireRasenshuriken(e.clientX, e.clientY);
        }
    });

    // ==========================================
    // 4. ANIMATION REGISTRATION
    // ==========================================
    const allFrameNames = Object.keys(spriteData.frames);
    
    function filterMugenGroup(groupNumber) {
        const pattern = new RegExp(`\\s${groupNumber}_\\d+\\.png$`);
        let matched = allFrameNames.filter(name => pattern.test(name));
        return matched.sort((a, b) => {
            const numA = parseInt(a.match(/_(\d+)\.png$/)?.[1] || 0);
            const numB = parseInt(b.match(/_(\d+)\.png$/)?.[1] || 0);
            return numA - numB;
        });
    }

    const animations = {
        idle: filterMugenGroup(0),     
        walk: filterMugenGroup(20),    
        attack: filterMugenGroup(200), 
        special: filterMugenGroup(350) 
    };

    if (animations.special.length === 0) {
        animations.special = filterMugenGroup(360).length > 0 ? filterMugenGroup(360) : allFrameNames.slice(70, 90);
    }

    // ==========================================
    // 5. PROJECTILE & PARTICLE ALGORITHMS
    // ==========================================
    function fireRasenshuriken(targetX, targetY) {
        player.state = 'special';
        player.currentFrameIndex = 0;
        player.vx = 0;
        player.direction = targetX > player.x ? 1 : -1;

        const startX = player.x + (player.direction === 1 ? 60 : 10);
        const startY = player.y + 30;
        
        const angle = Math.atan2(targetY - startY, targetX - startX);
        const projectileSpeed = 12;

        projectiles.push({
            x: startX,
            y: startY,
            tx: targetX,
            ty: targetY,
            vx: Math.cos(angle) * projectileSpeed,
            vy: Math.sin(angle) * projectileSpeed,
            rotation: 0,
            radius: 18,
            active: true
        });
    }

    function createExplosion(x, y) {
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
                color: Math.random() > 0.3 ? '#4fc3f7' : '#ffffff', 
                alpha: 1,
                decay: Math.random() * 0.03 + 0.01
            });
        }

        canvas.style.pointerEvents = 'auto';
        const blastRadius = 60;
        const scanOffsets = [
            {dx: 0, dy: 0}, {dx: -40, dy: 0}, {dx: 40, dy: 0},
            {dx: 0, dy: -40}, {dx: 0, dy: 40}, {dx: -30, dy: -30}, {dx: 30, dy: 30}
        ];

        scanOffsets.forEach(offset => {
            const hitElement = document.elementFromPoint(x + offset.dx, y + offset.dy);
            
            if (hitElement && hitElement !== canvas && hitElement !== voidOverlay && hitElement !== document.body && hitElement !== document.documentElement) {
                hitElement.style.transition = 'transform 0.5s ease-out, opacity 0.4s ease';
                hitElement.style.transform = `scale(0) rotate(${Math.random() * 100 - 50}deg) translate(${offset.dx * 2}px, ${offset.dy * 2}px)`;
                hitElement.style.opacity = '0';
                setTimeout(() => { hitElement.style.display = 'none'; }, 450);
            }
        });

        canvas.style.pointerEvents = 'none';

        voidOverlay.style.backgroundColor = 'rgba(10, 10, 10, 0.96)';
        const currentClip = voidOverlay.style.clipPath || '';
        
        if (!currentClip.includes('polygon') && !currentClip.includes('path')) {
            voidOverlay.style.clipPath = `path('M 0 0 L ${window.innerWidth} 0 L ${window.innerWidth} ${window.innerHeight} L 0 ${window.innerHeight} Z M ${x} ${y} m -${blastRadius}, 0 a ${blastRadius},${blastRadius} 0 1,0 ${blastRadius * 2},0 a ${blastRadius},${blastRadius} 0 1,0 -${blastRadius * 2},0')`;
        } else {
            voidOverlay.style.clipPath += ` path('M ${x} ${y} m -${blastRadius}, 0 a ${blastRadius},${blastRadius} 0 1,0 ${blastRadius * 2},0 a ${blastRadius},${blastRadius} 0 1,0 -${blastRadius * 2},0')`;
        }
    }

    // ==========================================
    // 6. ENGINE RENDERING & UPDATES CORE LOOP
    // ==========================================
    function update() {
        if (player.state !== 'attack' && player.state !== 'special') {
            player.state = 'idle';
            if (keys['a'] || keys['arrowleft']) {
                player.vx = -player.speed;
                player.direction = -1;
                player.state = 'walk';
            } else if (keys['d'] || keys['arrowright']) {
                player.vx = player.speed;
                player.direction = 1;
                player.state = 'walk';
            } else {
                player.vx = 0;
            }

            if ((keys['w'] || keys['arrowup'] || keys[' ']) && player.isGrounded) {
                player.vy = player.jumpForce;
                player.isGrounded = false;
            }
        }

        player.vy += player.gravity;
        player.x += player.vx;
        player.y += player.vy;

        const floorY = window.innerHeight - 130; 
        if (player.y >= floorY) {
            player.y = floorY;
            player.vy = 0;
            player.isGrounded = true;
        }

        if (player.x < 0) player.x = 0;
        if (player.x > window.innerWidth - 80) player.x = window.innerWidth - 80;

        const currentAnim = animations[player.state] || animations.idle;
        player.frameTimer++;
        if (player.frameTimer >= player.frameSpeed) {
            player.frameTimer = 0;
            player.currentFrameIndex++;
            if (player.currentFrameIndex >= currentAnim.length) {
                player.currentFrameIndex = 0;
                if (player.state === 'special' || player.state === 'attack') {
                    player.state = 'idle'; 
                }
            }
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        for (let i = projectiles.length - 1; i >= 0; i--) {
            const p = projectiles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.rotation += 0.4; 

            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation);
            
            ctx.beginPath();
            ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(79, 195, 247, 0.4)';
            ctx.fill();
            
            ctx.beginPath();
            ctx.arc(0, 0, p.radius * 0.5, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.restore();

            const dist = Math.hypot(p.tx - p.x, p.ty - p.y);
            if (dist < 15 || p.x < 0 || p.x > canvas.width || p.y < 0 || p.y > canvas.height) {
                createExplosion(p.x, p.y);
                projectiles.splice(i, 1);
            }
        }

        for (let i = particles.length - 1; i >= 0; i--) {
            const pt = particles[i];
            pt.x += pt.vx;
            pt.y += pt.vy;
            pt.alpha -= pt.decay;

            ctx.save();
            ctx.globalAlpha = pt.alpha;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, pt.radius, 0, Math.PI * 2);
            ctx.fillStyle = pt.color;
            ctx.fill();
            ctx.restore();

            if (pt.alpha <= 0) particles.splice(i, 1);
        }

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

        const frameName = currentAnim[player.currentFrameIndex] || (animations.idle ? animations.idle[0] : null);
        if (frameName && spriteData.frames[frameName]) {
            const frameInfo = spriteData.frames[frameName];
            const frameData = frameInfo.frame;

            ctx.save();
            ctx.translate(player.x, player.y);
            if (player.direction === -1) {
                ctx.translate(frameData.w, 0);
                ctx.scale(-1, 1);
            }

            if (frameInfo.rotated) {
                ctx.rotate(-90 * Math.PI / 180);
                ctx.translate(-frameData.h, 0);
                ctx.drawImage(spriteSheet, frameData.x, frameData.y, frameData.h, frameData.w, 0, 0, frameData.h, frameData.w);
            } else {
                ctx.drawImage(spriteSheet, frameData.x, frameData.y, frameData.w, frameData.h, 0, 0, frameData.w, frameData.h);
            }
            ctx.restore();
        }

        requestAnimationFrame(update);
    }

    update();
})();