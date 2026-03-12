const { Engine, Render, Runner, World, Bodies, Body, Events, Composite, Vector, Detector } = Matter;

// Configuration
const GAME_W = 380;           // Canvas width
const GAME_H = 680;           // Canvas height

// Layout (all Y values are canvas-space, top = 0)
const UI_HEIGHT = 50;     // Top UI bar (score / next)
const GAMEOVER_Y = 180;     // Game over line (invisible, = UI_HEIGHT)
const WARNING_LINE_Y = 193;    // Static gray line, always visible (10px below gameover)
const WARNING_TRIGGER_Y = 205;  // Triggers warning flag (15px below gray line)
const FIELD_TOP = WARNING_LINE_Y;     // Same as WARNING_LINE_Y
const FIELD_BOTTOM = 600;    // Bottom wall inner face
const FIELD_LEFT = 40;     // Left wall inner face
const FIELD_RIGHT = 340;    // Right wall inner face  (350px wide field)
const DROP_Y = 140;     // Preview ball Y (above gameover line, inside UI area)
const WALL_THICKNESS = 500;   // Much thicker physical walls to prevent tunneling
const VISUAL_WALL_THICKNESS = 30; // Original thickness for layout logic if needed

// Sizes: 25, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130 (Diameters)
// Radii: 12.5, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65
const BALL_RADII = [15, 20, 25, 30, 35, 50, 45, 50, 56, 63, 71, 80, 90];

// Placeholder Colors
const BALL_COLORS = [
    '#FF3333', '#FF9933', '#FFFF33', '#33FF33', '#33FFFF',
    '#3333FF', '#9933FF', '#FF33FF', '#FFFFFF', '#000000',
    '#FF5733', '#33FF57'
];

// --- IMAGE REPLACEMENT CONFIGURATION ---
// To use images:
// 1. Put images named 001.PNG... 012.PNG in the 'assets' folder.
// 2. Set USE_IMAGES = true;
const USE_IMAGES = true;
// ---------------------------------------

let engine;
let render;
let runner;
let score = 0;
let isGameOver = false;
let isPlaying = false;
let isWarningActive = false;
let isPaused = false;
let gameOverCounter = 0;
const GAMEOVER_THRESHOLD = 30; // 0.5 seconds at 60fps
const delta = 1000 / 60; // Target 60fps physics step
let isLowPerformanceMode = false;
let slowFrameSequence = 0;
let lastTime = 0;
let accumulator = 0;

// CM & ED globals
let lastCMScore = 0;
let maxLevelReached = 0;
let isEduEnabled = true; // 教育內容開關 (唐突衛教)
const CM_DATA = [
    { img: 'cm_01', link: 'https://youtube.com/shorts/1Zzu1lTNThw?si=zJ97SKU9Z0sM6l0o' }, //大腸桿菌之戰
    { img: 'cm_02', link: 'https://youtube.com/shorts/jKMBcdd-oac?si=-jFzEUbNKcEFHv_2' }, //水痘與帶狀疱疹(玫瑰花瓣上的露珠)
    { img: 'cm_03', link: 'https://youtube.com/shorts/XI5j6NeBA9g?si=B94VK5XYSzy2T42' }, //成人篩檢肝腎功能尿酸
    { img: 'cm_04', link: 'https://www.youtube.com/watch?v=PdWnGcRcjWo' }, //左流右新健康安心
    { img: 'cm_05', link: 'https://www.youtube.com/watch?v=W6auYLrj7KI' }, //實寫注意!深入了解大腸癌
    { img: 'cm_06', link: 'https://www.youtube.com/watch?v=svqq5stpB_Q' }, //頭家，來一份快樂套餐!
    { img: 'cm_07', link: 'https://www.youtube.com/watch?v=C1w9VIBF3x4' }, //憂鬱絕對不是不知足!
    { img: 'cm_08', link: 'https://www.youtube.com/watch?v=lrefLk3I69Q' }, //肌少症從0開始的預防保健
    { img: 'cm_09', link: 'https://www.youtube.com/watch?v=gd_T7zTUCec' }, //原來我也有乳糖不耐症?!
    { img: 'cm_10', link: 'https://www.youtube.com/watch?v=KIvaI2PQ-Hs' }, //如果早知道偶像也會脂肪肝
    { img: 'cm_11', link: 'https://www.youtube.com/watch?v=ByjnjtJOrJI' }, //結石也是病痛起來要人命
    { img: 'cm_12', link: 'https://www.youtube.com/watch?v=VDctL-3fPpA' }, //寶寶的十萬個為什麼
];

// Upcoming queue
let upcomingLevels = [];

// --- OBJECT POOLING ---
const BODY_POOL = {}; // { level: [bodies...] }
const MAX_POOL_SIZE_PER_LEVEL = 10;

function getBodyFromPool(level, x, y, radius) {
    if (!BODY_POOL[level]) BODY_POOL[level] = [];

    // Find an inactive body
    let body = BODY_POOL[level].find(b => !b.isActive);

    if (body) {
        body.isActive = true;
        body.isRemoved = false;
        body.isPopping = false;
        body.popScale = 1.0;
        body.id = Matter.Common.nextId(); // Refresh ID for collision tracking
        Body.setPosition(body, { x, y });

        // Add tiny random rotation so it doesn't stay perfectly balanced (crucial for capsules)
        const startAngle = (Math.random() - 0.5) * 0.2;
        Body.setAngle(body, startAngle);

        Body.setVelocity(body, { x: 0, y: 0 });
        Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.05);
        return body;
    }

    // Create new if none available or pool not full
    const commonOpts = {
        restitution: 0.7, // Increased for a livelier feel
        friction: 0.05,
        frictionAir: 0.01, // Lighter air resistance
        slop: 0.05,       // Reduced micro-calculations for stable stacking
        render: { visible: false }
    };

    if (level === 5) {
        body = createCapsule(x, y, radius);
    } else {
        body = Bodies.circle(x, y, radius, commonOpts);
    }

    body.level = level;
    body.isActive = true;
    body.assetImg = ASSET_IMAGES[String(level + 1).padStart(3, '0')];

    // Non-zero start angle/spin for natural tumbling
    Body.setAngle(body, (Math.random() - 0.5) * 0.2);
    Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.05);

    if (BODY_POOL[level].length < MAX_POOL_SIZE_PER_LEVEL) {
        BODY_POOL[level].push(body);
    }
    return body;
}

function releaseToPool(body) {
    if (body.level === undefined) return;
    body.isActive = false;
    body.isRemoved = true;
    World.remove(engine.world, body);
}
// -----------------------

// The ball currently hovering at top, waiting to be dropped
let previewBall = null;
let spawnTimer = 0;
const SPAWN_COOLDOWN = 18; // Reduced for better responsiveness (~0.3s)
let dropX = (FIELD_LEFT + FIELD_RIGHT) / 2; // horizontal center of play field

// Elements
const scoreEl = document.getElementById('score'); // Live Score
const finalScoreEl = document.getElementById('final-score');
const gameHeader = document.getElementById('game-header');
const gameFooter = document.getElementById('game-footer');
const retryBtn = document.getElementById('retry-btn');
const retryBtnTop = document.getElementById('retry-btn-top');
const shareBtn = document.getElementById('share-btn');
const screenshotBtn = document.getElementById('screenshot-btn');
const mainWrapper = document.getElementById('main-wrapper');
const uiLayer = document.getElementById('ui-layer'); // In-Game UI
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings');
const bgmSlider = document.getElementById('bgm-volume');
const sfxSlider = document.getElementById('sfx-volume');
const loadingScreen = document.getElementById('loading-screen');
const loadingProgress = document.getElementById('loading-progress');

// Audio
const bgm = new Audio('assets/bgm.mp3');
bgm.loop = true;
const clickSound = new Audio('assets/click.mp3');
const mergeSound = new Audio('assets/merge.mp3');

// Asset Lists
const IMAGES_TO_LOAD = [
    'assets/001.PNG', 'assets/002.PNG', 'assets/003.PNG', 'assets/004.PNG',
    'assets/005.PNG', 'assets/006.PNG', 'assets/007.PNG', 'assets/008.PNG',
    'assets/009.PNG', 'assets/010.PNG', 'assets/011.PNG', 'assets/012.PNG',
    'assets/013.PNG', 'assets/bk.png',
    'assets/cm_01.png', 'assets/cm_02.png', 'assets/cm_03.png', 'assets/cm_04.png', 'assets/cm_05.png',
    'assets/cm_06.png', 'assets/cm_07.png', 'assets/cm_08.png', 'assets/cm_09.png', 'assets/cm_10.png',
    'assets/cm_11.png', 'assets/cm_12.png',
    'assets/ed_01.jpg', 'assets/ed_02.jpg', 'assets/ed_03.jpg', 'assets/ed_04.jpg'
];
const ASSET_IMAGES = {}; // Cache for preloaded images

// Audio Context (for mobile volume control)
let audioCtx = null;
let bgmGainNode = null;
let sfxGainNode = null;
let bgmSourceNode = null;

// Audio Init Volume
let bgmVolume = 0.5;
let sfxVolume = 1.0;

function initAudioContext() {
    if (audioCtx) {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return;
    }

    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        // Setup SFX Master Gain
        sfxGainNode = audioCtx.createGain();
        sfxGainNode.gain.value = sfxVolume;
        sfxGainNode.connect(audioCtx.destination);

        // Setup BGM Master Gain & Source
        bgmGainNode = audioCtx.createGain();
        bgmGainNode.gain.value = bgmVolume;
        bgmSourceNode = audioCtx.createMediaElementSource(bgm);
        bgmSourceNode.connect(bgmGainNode);
        bgmGainNode.connect(audioCtx.destination);

        if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) {
        console.error('Web Audio API not supported:', e);
    }
}


async function preloadAssets() {
    let loadedCount = 0;
    const totalAssets = IMAGES_TO_LOAD.length; // Intentionally only tracking images for visual loading bar
    // Audio preloading is less visual, but we can try to fetch them too.

    const updateProgress = () => {
        loadedCount++;
        const percent = Math.floor((loadedCount / totalAssets) * 100);
        if (loadingProgress) loadingProgress.textContent = percent + '%';
        if (loadedCount >= totalAssets) {
            setTimeout(() => {
                loadingScreen.style.display = 'none';
                init();
            }, 500); // Small delay for smoothness
        }
    };

    IMAGES_TO_LOAD.forEach(src => {
        const img = new Image();
        img.onload = () => {
            // Extract simple filename key (e.g., '001')
            const key = src.split('/').pop().split('.')[0];
            ASSET_IMAGES[key] = img;
            updateProgress();
        };
        img.onerror = (e) => {
            console.error('Failed to load image:', src, e);
            updateProgress(); // Continue anyway to avoid hanging
        };
        img.src = src;
    });
}

function makeWalls() {
    const opts = { isStatic: true, restitution: 0.7, friction: 0.1, render: { fillStyle: 'transparent' } };
    const cx = (FIELD_LEFT + FIELD_RIGHT) / 2; // horizontal center of field
    return [
        // Bottom (thick for high pressure)
        Bodies.rectangle(cx, FIELD_BOTTOM + WALL_THICKNESS / 2, 2000, WALL_THICKNESS, opts),
        // Left
        Bodies.rectangle(FIELD_LEFT - WALL_THICKNESS / 2, GAME_H / 2, WALL_THICKNESS, GAME_H * 4, opts),
        // Right
        Bodies.rectangle(FIELD_RIGHT + WALL_THICKNESS / 2, GAME_H / 2, WALL_THICKNESS, GAME_H * 4, opts),
    ];
}

function createCapsule(x, y, radius, renderConfig) {
    const r = radius * 0.4; // Horizontal radius (0.4x width)
    const offset = radius - r; // Vertical offset for centers of outer circles

    // Create 3 overlapping circles to form a vertical capsule
    const c1 = Bodies.circle(x, y - offset, r);
    const c2 = Bodies.circle(x, y, r);
    const c3 = Bodies.circle(x, y + offset, r);

    return Body.create({
        parts: [c1, c2, c3],
        restitution: 0.85, // Balanced bounce
        friction: 0.05,
        frictionAir: 0.01,
        slop: 0.05,
        render: { visible: false }
    });
}

function init() {
    // Create Engine
    engine = Engine.create({
        enableSleeping: true,
        positionIterations: 10,
        velocityIterations: 8
    });
    engine.world.gravity.y = 1.5; // Restore original gravity

    // Create Renderer with Adaptive DPR
    const dpr = Math.min(window.devicePixelRatio, 2);
    render = Render.create({
        element: document.getElementById('game-container'),
        engine: engine,
        options: {
            width: GAME_W,
            height: GAME_H,
            wireframes: false,
            background: 'transparent',
            pixelRatio: dpr
        }
    });

    // Explicitly set canvas style for CSS scaling
    render.canvas.style.width = GAME_W + 'px';
    render.canvas.style.height = GAME_H + 'px';
    render.canvas.style.touchAction = 'none'; // CRITICAL: Stop mobile gesture latency

    // Create Walls
    World.add(engine.world, makeWalls());

    // Restore Game State if available
    loadGameState();

    // --- High Performance Physics Loop (Accumulator + Circuit Breaker) ---
    function gameLoop(time) {
        if (!lastTime) lastTime = time;
        let frameTime = time - lastTime;
        lastTime = time;

        // 1. Performance Monitor & Adaptive DPR
        if (isPlaying && !isGameOver && !isPaused) {
            if (frameTime > 32) { // Target < 30fps
                slowFrameSequence++;
                if (slowFrameSequence > 60 && !isLowPerformanceMode) {
                    enableLowPerformanceMode();
                }
            } else {
                slowFrameSequence = Math.max(0, slowFrameSequence - 1);
            }
        }

        // Caps to prevent Death Spiral (max 250ms)
        if (frameTime > 250) frameTime = 250;
        accumulator += frameTime;

        // Physics & Game Logic (Skip if paused)
        if (!isPaused && !isGameOver) {
            let updatesThisFrame = 0;
            const maxUpdates = isLowPerformanceMode ? 1 : 2; // Reduce updates if struggling

            while (accumulator >= delta) {
                if (updatesThisFrame < maxUpdates) {
                    Engine.update(engine, delta);
                    updatesThisFrame++;
                }
                accumulator -= delta;
            }
        }

        // Render (Keep rendering even if paused so UI is visible)
        Render.world(render);

        requestAnimationFrame(gameLoop);
    }

    function enableLowPerformanceMode() {
        if (isLowPerformanceMode) return;
        isLowPerformanceMode = true;

        // Use 1.5 as a balance between perfromance and clarity (sharper than 1.0)
        const dpr = isLowPerformanceMode ? 1.5 : Math.min(window.devicePixelRatio, 2);

        Render.setPixelRatio(render, dpr);
        render.canvas.style.width = GAME_W + 'px';
        render.canvas.style.height = GAME_H + 'px';

        // Force smoothing to prevent jaggies
        const ctx = render.context;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        console.log("Performance Optimized: Pixel Ratio adjusted to 1.5 for stability.");
    }

    // Start custom loop
    requestAnimationFrame(gameLoop);

    // Pre-allocate Pool to prevent "First Drop Lag"
    for (let lvl = 0; lvl <= 3; lvl++) {
        for (let i = 0; i < 4; i++) {
            const tempBody = getBodyFromPool(lvl, -1000, -1000, BALL_RADII[lvl]);
            tempBody.isActive = false; // Ensure it's marked inactive
            World.remove(engine.world, tempBody);
        }
    }

    // Initial message
    showStartMessage();

    // Ensure Init State: Header/Footer hidden, UI shown (but msg covers it)
    gameHeader.classList.add('hidden');
    gameFooter.classList.add('hidden');
    uiLayer.classList.remove('hidden');

    // Custom Rendering
    Events.on(render, 'afterRender', () => {
        const ctx = render.context;

        // 1. Play field border (always)
        ctx.beginPath();
        ctx.rect(FIELD_LEFT, FIELD_TOP, FIELD_RIGHT - FIELD_LEFT, FIELD_BOTTOM - FIELD_TOP);
        ctx.strokeStyle = 'transparent';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 3. Drop guide line (vertical dashed, from preview ball to bottom)
        if (previewBall && isPlaying) {
            ctx.beginPath();
            ctx.moveTo(previewBall.x, previewBall.y + previewBall.radius + 2);
            ctx.lineTo(previewBall.x, FIELD_BOTTOM);
            ctx.setLineDash([6, 8]);
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // 5. Drawing All Physical Balls (Images)
        const bodies = Composite.allBodies(engine.world);
        for (let i = 0; i < bodies.length; i++) {
            const body = bodies[i];
            if (body.level === undefined || body.isStatic || body.isRemoved) continue;

            if (USE_IMAGES) {
                // Optimization: Cache image reference on body if not present
                if (!body.assetImg) {
                    const imageIndex = String(body.level + 1).padStart(3, '0');
                    body.assetImg = ASSET_IMAGES[imageIndex];
                }

                if (body.assetImg) {
                    const r = BALL_RADII[body.level];
                    let size = r * 2;

                    // Render Pressure Optimization: 
                    // 1. Skip pop animations if sleeping or low performance
                    if (body.popScale === undefined) body.popScale = 1.0;
                    if (!body.isSleeping && !isLowPerformanceMode) {
                        if (body.isPopping) {
                            body.popScale += 0.05;
                            if (body.popScale >= 1.25) body.isPopping = false;
                        } else if (body.popScale > 1.0) {
                            body.popScale -= 0.05;
                        }
                    } else if (body.popScale !== 1.0) {
                        body.popScale = 1.0; // Reset for sleeping bodies to save logic
                    }

                    // 2. Skip draw partially? (No, but can simplify transformations)
                    ctx.save();
                    ctx.translate(body.position.x, body.position.y);
                    ctx.rotate(body.angle);

                    const drawR = r * body.popScale;
                    const drawS = size * body.popScale;
                    ctx.drawImage(body.assetImg, -drawR, -drawR, drawS, drawS);
                    ctx.restore();
                }
            } else {
                // Fallback for no images
                ctx.beginPath();
                ctx.arc(body.position.x, body.position.y, body.circleRadius || BALL_RADII[body.level], 0, 2 * Math.PI);
                ctx.fillStyle = BALL_COLORS[body.level];
                ctx.fill();
            }
        }

        // 6. Preview Ball (Current held ball)
        if (previewBall && isPlaying) {
            if (USE_IMAGES) {
                const imageIndex = String(previewBall.level + 1).padStart(3, '0');
                if (ASSET_IMAGES[imageIndex]) {
                    const img = ASSET_IMAGES[imageIndex];
                    const size = previewBall.radius * 2;
                    ctx.save();
                    ctx.translate(previewBall.x, previewBall.y);
                    ctx.drawImage(img, -previewBall.radius, -previewBall.radius, size, size);
                    ctx.restore();
                } else {
                    ctx.beginPath();
                    ctx.arc(previewBall.x, previewBall.y, previewBall.radius, 0, 2 * Math.PI);
                    ctx.fillStyle = previewBall.color;
                    ctx.fill();
                }
            } else {
                ctx.beginPath();
                ctx.arc(previewBall.x, previewBall.y, previewBall.radius, 0, 2 * Math.PI);
                ctx.fillStyle = previewBall.color;
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }

        // 6. Background Image 'bk.png' at (0, 190) - Should cover most things
        if (ASSET_IMAGES['bk']) {
            ctx.drawImage(ASSET_IMAGES['bk'], 0, 190);
        }

        // 7. Warning dashed line (Only visible when active, on top of BK)
        if (isWarningActive && !isGameOver) {
            ctx.beginPath();
            ctx.moveTo(FIELD_LEFT, WARNING_LINE_Y);
            ctx.lineTo(FIELD_RIGHT, WARNING_LINE_Y);
            ctx.setLineDash([12, 10]); // Thick dashed line
            ctx.strokeStyle = '#FF3333';
            ctx.lineWidth = 4; // Thicker
            ctx.stroke();
            ctx.setLineDash([]);
        }
    });

    // Physics Loop Updates
    Events.on(engine, 'beforeUpdate', () => {
        if (isGameOver || isPaused) return; // Added isPaused check here too

        let warningTriggered = false;
        let gameOverTriggered = false;
        const bodies = Composite.allBodies(engine.world);

        for (let i = 0; i < bodies.length; i++) {
            const body = bodies[i];
            if (body.isStatic || body.isRemoved) continue;

            // Use actual physics bounds for accurate edge detection
            const topEdge = body.bounds.min.y;

            // Warning Check: top edge above WARNING_TRIGGER_Y
            if (topEdge < WARNING_TRIGGER_Y) {
                if (body.id !== lastShotBodyId) {
                    warningTriggered = true;
                } else if (body.speed < 2) {
                    warningTriggered = true;
                }
            }

            // Game Over Check: top edge above GAMEOVER_Y and nearly stopped
            if (topEdge < GAMEOVER_Y) {
                if (body.speed < 0.5 && body.id !== lastShotBodyId) {
                    gameOverTriggered = true;
                }
            }

            // Cleanup flag
            if (body.isRemoved) {
                // Already handled by World.remove, but keep logic clean
            }
        }

        isWarningActive = warningTriggered;

        // Game Over logic with delay
        if (gameOverTriggered) {
            gameOverCounter++;
            if (gameOverCounter >= GAMEOVER_THRESHOLD) {
                endGame();
            }
        } else {
            gameOverCounter = 0;
        }

        // --- NEW: Frame-based Spawn Management ---
        if (!previewBall && isPlaying && !isGameOver) {
            spawnTimer++;
            if (spawnTimer >= SPAWN_COOLDOWN) {
                spawnPreview();
                spawnTimer = 0;
            }
        }
    });

    // Collision & Merge Logic
    Events.on(engine, 'collisionStart', (event) => {
        const pairs = event.pairs;
        for (let i = 0; i < pairs.length; i++) {
            const pair = pairs[i];
            const bodyA = pair.bodyA.parent; // Use parent for composite body support
            const bodyB = pair.bodyB.parent;

            if (bodyA.level !== undefined && bodyB.level !== undefined && !bodyA.isRemoved && !bodyB.isRemoved) {
                if (bodyA.level === bodyB.level && bodyA.level < 12) { // 13 levels (0-12)
                    mergeBalls(bodyA, bodyB);
                }
            }
        }
    });

    // Track mouse/touch X for drop position preview
    const container = document.getElementById('game-container');

    function getGameX(e) {
        const rect = render.canvas.getBoundingClientRect();
        const scaleX = GAME_W / rect.width;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        // Clamp to play field X range (accounting for ball radius later in shoot)
        return Math.max(FIELD_LEFT, Math.min(FIELD_RIGHT, (clientX - rect.left) * scaleX));
    }

    // Unified Input Event Pointerdown
    container.addEventListener('pointerdown', handleInput, { passive: false });

    // Update drop X (Preview follows pointer)
    container.addEventListener('pointermove', (e) => {
        if (!isPlaying || isGameOver || !previewBall) return;
        if (e.cancelable) e.preventDefault();
        dropX = getGameX(e);
        previewBall.x = dropX;
    }, { passive: false });

    spawnPreview();
}

let lastShotBodyId = null;

function handleInput(e) {
    // Unify input filtering
    if (e.target.tagName === 'BUTTON' || e.target.parentElement.tagName === 'BUTTON') return;
    if (e.cancelable) e.preventDefault();
    if (isGameOver || isPaused) return; // Added isPaused check here

    initAudioContext();

    if (!isPlaying) {
        isPlaying = true;
        const msg = document.getElementById('start-message');
        if (msg) msg.style.display = 'none';
        updateNextPreviewUI();
        if (bgm.paused && bgmVolume > 0) {
            bgm.play().catch(e => console.log("BGM interaction waiting"));
        }
    }

    // Modal blocking - checks by class (faster than ID lookup every frame)
    if (!document.getElementById('cm-window').classList.contains('hidden') ||
        !document.getElementById('settings-modal').classList.contains('hidden')) {
        return;
    }

    // Direct X update from event for zero-latency response
    if (render && render.canvas) {
        const rect = render.canvas.getBoundingClientRect();
        const scaleX = GAME_W / rect.width;
        dropX = Math.max(FIELD_LEFT, Math.min(FIELD_RIGHT, (e.clientX - rect.left) * scaleX));
        if (previewBall) previewBall.x = dropX;
    }

    shoot();
}

function showStartMessage() {
    const existingMsg = document.getElementById('start-message');
    if (existingMsg) existingMsg.remove();

    const msg = document.createElement('div');
    msg.id = 'start-message';
    msg.innerHTML = "<h1>Tap Anywhere<br>to Start</h1>";
    msg.style.position = 'absolute';
    msg.style.top = '50%';
    msg.style.left = '50%';
    msg.style.transform = 'translate(-50%, -50%)';
    msg.style.textAlign = 'center';
    msg.style.width = '100%';
    msg.style.color = 'white';
    msg.style.fontSize = '30px';
    msg.style.pointerEvents = 'none';
    msg.style.textShadow = '0 0 10px black';
    msg.style.zIndex = '5';
    document.getElementById('game-container').appendChild(msg);
}

function spawnPreview() {
    if (upcomingLevels.length < 1) {
        upcomingLevels.push(Math.floor(Math.random() * 4));
    }

    const level = upcomingLevels.shift();
    upcomingLevels.push(Math.floor(Math.random() * 4));

    const radius = BALL_RADII[level];
    const color = BALL_COLORS[level];

    previewBall = {
        level: level,
        radius: radius,
        color: color,
        x: dropX,   // stay at last known drop X
        y: DROP_Y
    };

    updateNextPreviewUI();
}

function updateNextPreviewUI() {
    const slot1 = document.getElementById('next-ball-1');
    if (!slot1) return;
    let lvl = upcomingLevels[0];
    if (!isPlaying && previewBall) {
        lvl = previewBall.level;
    }

    if (USE_IMAGES) {
        slot1.style.backgroundImage = `url('assets/${String(lvl + 1).padStart(3, '0')}.PNG')`;
        slot1.style.backgroundColor = 'transparent';
    } else {
        slot1.style.backgroundImage = 'none';
        slot1.style.backgroundColor = BALL_COLORS[lvl];
    }
}

function shoot() {
    if (!previewBall || isGameOver) return;

    const renderConfig = USE_IMAGES ? {
        sprite: {
            texture: `assets/${String(previewBall.level + 1).padStart(3, '0')}.PNG`,
            xScale: (previewBall.radius * 2) / 250,
            yScale: (previewBall.radius * 2) / 250
        }
    } : {
        fillStyle: previewBall.color
    };

    // Clamp spawn X inside play field
    const spawnX = Math.max(FIELD_LEFT + previewBall.radius, Math.min(FIELD_RIGHT - previewBall.radius, previewBall.x));

    // Use Object Pool instead of New Bodies
    const body = getBodyFromPool(previewBall.level, spawnX, DROP_Y, previewBall.radius);

    lastShotBodyId = body.id;

    // Drop straight down with much gentler force
    Body.setVelocity(body, { x: 0, y: 2 }); // Slightly faster than 1.5 to reduce overlap time

    playSound(clickSound);
    World.add(engine.world, body);

    previewBall = null;
    spawnTimer = 0; // Reset frame timer
}

function mergeBalls(bodyA, bodyB) {
    if (bodyA.isRemoved || bodyB.isRemoved) return;

    const midX = (bodyA.position.x + bodyB.position.x) / 2;
    const midY = (bodyA.position.y + bodyB.position.y) / 2;
    const newLevel = bodyA.level + 1;

    // Release to Pool instead of Just Removing
    releaseToPool(bodyA);
    releaseToPool(bodyB);

    score += (newLevel + 1) * 10;
    scoreEl.textContent = score;

    if (newLevel > maxLevelReached) maxLevelReached = newLevel;

    // Trigger CM every 3000 points
    if (isEduEnabled && score >= lastCMScore + 3000) {
        lastCMScore = Math.floor(score / 3000) * 3000;
        showCMWindow();
    }

    const radius = BALL_RADII[newLevel];

    const renderConfig = USE_IMAGES ? {
        sprite: {
            texture: `assets/${String(newLevel + 1).padStart(3, '0')}.PNG`,
            xScale: (radius * 2) / 250, // Source: 250px
            yScale: (radius * 2) / 250
        }
    } : {
        fillStyle: BALL_COLORS[newLevel]
    };

    // Use Object Pool for Merged Fruit
    const newBody = getBodyFromPool(newLevel, midX, midY, radius);

    newBody.level = newLevel;

    // Set a random velocity to give it a "kick" and wake up neighbors
    Body.setVelocity(newBody, { x: (Math.random() - 0.5) * 1.5, y: (Math.random() - 0.5) * 1.5 });

    newBody.isPopping = true;
    newBody.popScale = 1.0;

    World.add(engine.world, newBody);

    // Wake up nearby bodies to prevent floating balls
    const bodies = Composite.allBodies(engine.world);
    const wakeRange = radius * 4;
    for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        if (b.isStatic || b === newBody) continue;
        const dist = Vector.magnitude(Vector.sub(b.position, newBody.position));
        if (dist < wakeRange) {
            Matter.Sleeping.set(b, false);
        } else {
            // Optimization: If far enough and moving very slow, try to force sleep
            if (b.speed < 0.1 && b.angularSpeed < 0.1) {
                Matter.Sleeping.set(b, true);
            }
        }
    }
}

function endGame() {
    if (isGameOver) return;
    isGameOver = true;
    finalScoreEl.textContent = score;
    // Show Header and Footer, Hide In-Game UI
    gameHeader.classList.remove('hidden');
    gameFooter.classList.remove('hidden');
    uiLayer.classList.add('hidden');

    showEDWindow();
}

function showCMWindow() {
    const cmWindow = document.getElementById('cm-window');
    const cmBox = document.getElementById('cm-box');
    const cmLink = document.getElementById('cm-link');

    // Pick random CM
    const data = CM_DATA[Math.floor(Math.random() * CM_DATA.length)];

    if (ASSET_IMAGES[data.img]) {
        cmBox.style.backgroundImage = `url('${ASSET_IMAGES[data.img].src}')`;
    }
    cmLink.href = data.link;

    cmWindow.classList.remove('hidden');

    // Pause Engine to prevent background game over
    isPaused = true;
}

function showEDWindow() {
    const edWindow = document.getElementById('ed-window');
    const edBox = document.getElementById('ed-box');

    let edImg = 'ed_01';
    if (maxLevelReached <= 7) edImg = 'ed_01'; // Level 8 or below (0-indexed)
    else if (maxLevelReached <= 9) edImg = 'ed_02'; // Level 9 or 10
    else if (maxLevelReached === 10) edImg = 'ed_03'; // Level 11
    else edImg = 'ed_04'; // Level 12 or above (13th level)

    if (ASSET_IMAGES[edImg]) {
        edBox.style.backgroundImage = `url('${ASSET_IMAGES[edImg].src}')`;
    }

    edWindow.classList.remove('hidden');
}

// --- Game State Persistence ---
function saveGameState() {
    if (!isPlaying || isGameOver) return;

    const bodies = Composite.allBodies(engine.world)
        .filter(b => b.level !== undefined && !b.isStatic && !b.isRemoved)
        .map(b => ({
            x: b.position.x,
            y: b.position.y,
            lv: b.level,
            a: b.angle
        }));

    const state = {
        score,
        bodies,
        time: Date.now()
    };

    localStorage.setItem('R1HBD_save', JSON.stringify(state));
    console.log("Game Saved");
}

function loadGameState() {
    const data = localStorage.getItem('R1HBD_save');
    if (!data) return;

    try {
        const state = JSON.parse(data);

        // Only restore if save is less than 1 hour old (optional safety)
        if (Date.now() - state.time > 3600000) {
            localStorage.removeItem('R1HBD_save');
            return;
        }

        score = state.score;
        scoreEl.textContent = score;

        state.bodies.forEach(b => {
            const body = getBodyFromPool(b.lv, b.x, b.y, BALL_RADII[b.lv]);
            Body.setAngle(body, b.a);
            World.add(engine.world, body);
        });

        console.log("Game Restored");
        isPlaying = true;
        const msg = document.getElementById('start-message');
        if (msg) msg.style.display = 'none';
        updateNextPreviewUI();
    } catch (e) {
        console.error("Failed to restore game", e);
        localStorage.removeItem('R1HBD_save');
    }
}

function resetGame() {
    localStorage.removeItem('R1HBD_save'); // Clear save on reset
    World.clear(engine.world);
    Engine.clear(engine);

    World.add(engine.world, makeWalls());

    score = 0;
    scoreEl.textContent = '0';
    isGameOver = false;
    isWarningActive = false;
    gameOverCounter = 0;
    lastCMScore = 0;
    maxLevelReached = 0;
    upcomingLevels = [];
    previewBall = null;
    spawnTimer = 0;
    dropX = (FIELD_LEFT + FIELD_RIGHT) / 2; // center of play field
    gameHeader.classList.add('hidden');
    gameFooter.classList.add('hidden');
    uiLayer.classList.remove('hidden');

    document.getElementById('cm-window').classList.add('hidden');
    document.getElementById('ed-window').classList.add('hidden');

    isPaused = false;
    isPlaying = false;
    showStartMessage();
    spawnPreview();
}

// Helper to play SFX (clone node and connect to master gain)
function playSound(audio) {
    if (sfxVolume <= 0) return;

    const clone = audio.cloneNode();

    // Connect to Web Audio master sfx gain if supported
    if (audioCtx && sfxGainNode) {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        try {
            const source = audioCtx.createMediaElementSource(clone);
            source.connect(sfxGainNode);
        } catch (e) {
            // Browser limit or already connected?
            clone.volume = sfxVolume;
        }
    } else {
        clone.volume = sfxVolume;
    }

    clone.play().catch(e => console.warn('Audio play failed', e));
}


// Global UI Handlers
if (retryBtnTop) retryBtnTop.addEventListener('click', resetGame);
if (retryBtn) retryBtn.addEventListener('click', resetGame);

// Settings UI Handlers
if (settingsBtn) {
    settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsModal.classList.remove('hidden');
        settingsModal.style.display = 'flex';
        isPaused = true; // Pause on open
    });
}

if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
        settingsModal.style.display = 'none';
        isPaused = false; // Resume on close

        // Ensure BGM starts if it wasn't playing (user interaction)
        if (bgm.paused && bgm.volume > 0) {
            bgm.play().catch(e => console.warn("BGM autoplay prevented", e));
        }
    });
}

// CM/ED Modal Handlers
const closeCmBtn = document.getElementById('close-cm');
const closeEdBtn = document.getElementById('close-ed');

if (closeCmBtn) {
    closeCmBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('cm-window').classList.add('hidden');
        isPaused = false; // Resume Engine
    });
}
if (closeEdBtn) {
    closeEdBtn.addEventListener('click', () => {
        document.getElementById('ed-window').classList.add('hidden');
    });
}

bgmSlider.addEventListener('input', (e) => {
    bgmVolume = e.target.value / 100;

    // BGM volume adjustment (Web Audio Gain)
    if (bgmGainNode) {
        bgmGainNode.gain.setTargetAtTime(bgmVolume, audioCtx.currentTime, 0.01);
    } else {
        bgm.volume = bgmVolume; // Fallback
    }

    if (bgmVolume > 0 && bgm.paused) {
        bgm.play().catch(e => console.warn("BGM play failed", e));
    }
});

sfxSlider.addEventListener('input', (e) => {
    sfxVolume = e.target.value / 100;

    // SFX volume adjustment (Web Audio Gain)
    if (sfxGainNode) {
        sfxGainNode.gain.setTargetAtTime(sfxVolume, audioCtx.currentTime, 0.01);
    } else {
        // Fallback
        clickSound.volume = sfxVolume;
        mergeSound.volume = sfxVolume;
    }
});


const eduToggle = document.getElementById('edu-toggle');
if (eduToggle) {
    eduToggle.addEventListener('change', (e) => {
        isEduEnabled = e.target.checked;
    });
}

// Handle tab switching / app backgrounding
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        bgm.pause();
        saveGameState(); // Auto-save when leaving
    } else {
        // --- 物理時間重置 ---
        lastTime = performance.now();
        accumulator = 0;

        // Audio Recovery: Resume Context and BGM
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        // Resume BGM if it should be playing (game started and not muted)
        if (isPlaying && bgmVolume > 0) {
            bgm.play().catch(e => console.warn("BGM resume failed", e));
        }
    }
});


if (screenshotBtn) {
    screenshotBtn.addEventListener('click', async () => {
        const gameCanvas = document.querySelector('#game-container canvas');
        if (!gameCanvas) return;

        const captureCanvas = document.createElement('canvas');
        captureCanvas.width = gameCanvas.width;
        captureCanvas.height = gameCanvas.height + 50; // Extra room for header & footer
        const ctx = captureCanvas.getContext('2d');

        // 1. Fill Background (Match body color)
        ctx.fillStyle = '#88b1cc';
        ctx.fillRect(0, 0, captureCanvas.width, captureCanvas.height);

        // 2. Remove manual BK Draw - it's already inside gameCanvas at (0, 190)
        // Which translates to (0, 120 + 190) in captureCanvas

        // 3. Draw Header "Game Over" (CSS Style)
        const centerX = captureCanvas.width / 2;
        ctx.textAlign = 'center';

        // Title text
        ctx.fillStyle = '#ff4444';
        ctx.font = 'bold 42px Arial';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'white';
        ctx.strokeText('Game Over', centerX, 50);
        ctx.fillText('Game Over', centerX, 50);

        // Score text
        ctx.fillStyle = 'white';
        ctx.font = 'bold 28px Arial';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 3;
        ctx.fillText('Score: ' + score, centerX, 95);
        ctx.shadowBlur = 0; // Reset shadow

        // 4. Draw Game Area (Shifted up to tighten gap)
        const gameY = 10;
        ctx.drawImage(gameCanvas, 0, gameY);

        // 5. Draw Footer Copyright
        ctx.fillStyle = 'white';
        ctx.font = '14px Arial';
        ctx.fillText('Nika © nikaworx.com', centerX, captureCanvas.height - 15);

        try {
            const dataURL = captureCanvas.toDataURL('image/png');

            // Check if mobile and navigator.share supports files
            if (navigator.share && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
                const blob = await (await fetch(dataURL)).blob();
                const file = new File([blob], `R1HBD_Score_${score}.png`, { type: 'image/png' });

                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        files: [file],
                        title: 'R1HBD2026 Score',
                        text: `Check out my score: ${score}!`
                    });
                    return; // Shared, exit
                }
            }

            // Fallback for Desktop: Normal download
            const link = document.createElement('a');
            link.download = `R1HBD2026_Score_${score}.png`;
            link.href = dataURL;
            link.click();

        } catch (err) {
            console.error('Screenshot error:', err);
            if (window.location.protocol === 'file:') {
                alert('【本地端安全限制】\n由於瀏覽器安全限制，直接點擊實體檔案開啟無法執行截圖功能。\n請使用 VS Code 的 Live Server 擴充功能開啟，或等上傳至伺服器(如 GitHub Pages)後再行測試！');
            } else {
                alert('截圖失敗。請嘗試在手機瀏覽器中進行測試。');
            }
        }
    });
}

if (shareBtn) {
    shareBtn.addEventListener('click', () => {
        const url = "https://nikaworx.com/R1HBD2026/";
        const msg = `我得到 ${score} 分！`;

        if (navigator.share) {
            navigator.share({
                title: '天天五蔬果 健康屬於我',
                text: msg,
                url: url
            }).catch(err => console.error("Share failed", err));
        } else {
            navigator.clipboard.writeText(`${msg} ${url}`);
            alert('Copied to clipboard!');
        }
    });
}

// Start
// init(); // Removed, called by preloadAssets
preloadAssets();
