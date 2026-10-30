import * as THREE from 'three';
import { gsap } from 'gsap';

/* ------------------------------------------------------------------ */
/*  Eşimi Tanıyorum — görsel katman                                   */
/*  Oyun mantığına dokunmaz: sadece ekran geçişi, skor, 3D ve mikro   */
/*  animasyonları yönetir.                                            */
/* ------------------------------------------------------------------ */

const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let reduceMotion = reduceQuery.matches;
reduceQuery.addEventListener?.('change', (event) => {
  reduceMotion = event.matches;
  if (reduceMotion) stopSceneLoop();
  else startSceneLoop();
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const rand = (min, max) => min + Math.random() * (max - min);
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/* ------------------------------------------------------------------ */
/*  Ekran geçişleri                                                   */
/* ------------------------------------------------------------------ */

const screenOrder = ['home', 'lobby', 'teamLobby', 'setup', 'play', 'roundEnd', 'final'];
const initialScreen = ($('.screen.active')?.id || 'screen-home').replace('screen-', '');
let currentScreen = initialScreen;

function animateScreen(name, first = false, previousScreen = null) {
  const screen = document.getElementById(`screen-${name}`);
  if (!screen) return;

  if (!reduceMotion) {
    const from = screenOrder.indexOf(name);
    const to = screenOrder.indexOf(previousScreen || currentScreen);
    const direction = from >= to ? 1 : -1;

    gsap.killTweensOf(screen);
    gsap.fromTo(
      screen,
      {
        opacity: 0,
        y: first ? 16 : 20 * direction,
        scale: 0.985,
      },
      {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: first ? 0.65 : 0.46,
        ease: 'power3.out',
        clearProps: 'transform',
      }
    );

    const pieces = $$(
      '.home-hero, .mode-pick, .setup-card, .screen-head, .team-lobby-head, .team-list, .lobby-hero, .players, .card, .question-card, .verdict, .code-box, .round-summary, .winner-card, .team-score-grid, .team-entry',
      screen
    );
    if (pieces.length) {
      gsap.fromTo(
        pieces,
        { opacity: 0, y: 11 },
        {
          opacity: 1,
          y: 0,
          duration: 0.42,
          stagger: 0.035,
          ease: 'power2.out',
          delay: 0.05,
          clearProps: 'transform',
        }
      );
    }
  }

  if (!celebrating) {
    const targetOpacity = name === 'home' ? 0.82 : name === 'final' ? 0.12 : 0;
    if (reduceMotion) {
      gsap.set(canvas, { opacity: targetOpacity });
    } else {
      gsap.to(canvas, {
        opacity: targetOpacity,
        duration: 0.7,
        ease: 'power2.out',
        overwrite: true,
      });
    }
  }
}

document.addEventListener('screenchange', (event) => {
  const name = event.detail?.name;
  if (!name) return;
  const previous = currentScreen;
  currentScreen = name;
  animateScreen(name, false, previous);
  scheduleScan();
  if (name === 'final') celebrate();
});

/* ------------------------------------------------------------------ */
/*  3D kalpler                                                        */
/* ------------------------------------------------------------------ */

const canvas = $('#scene-canvas');
let renderer = null;
let scene = null;
let camera = null;
let bgGroup = null;
let burstGroup = null;
let hearts = [];
let glowTexture = null;
let heartGeometry = null;
let innerHeartGeometry = null;
let sceneLoop = null;
let sceneRunning = false;
let celebrating = false;
let celebrationTimer = null;
let targetPointer = { x: 0, y: 0 };
let pointer = { x: 0, y: 0 };
let scrollOffset = 0;

const palette = [0xff5f8f, 0xff8f86, 0xffb07c, 0xffd166, 0x9b7bff, 0x63e2c0];

function supportsWebGL() {
  try {
    const probe = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext &&
        (probe.getContext('webgl2') || probe.getContext('webgl'))
    );
  } catch (_error) {
    return false;
  }
}

function makeGlowTexture() {
  const surface = document.createElement('canvas');
  surface.width = 128;
  surface.height = 128;
  const ctx = surface.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255, 235, 242, .85)');
  gradient.addColorStop(0.16, 'rgba(255, 160, 190, .55)');
  gradient.addColorStop(0.5, 'rgba(255, 95, 143, .16)');
  gradient.addColorStop(1, 'rgba(255, 95, 143, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(surface);
}

function makeHeartGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.5);
  shape.bezierCurveTo(0, 0.5, -0.4, 1.25, -1.25, 1.25);
  shape.bezierCurveTo(-2.3, 1.25, -2.3, -0.1, -2.3, -0.1);
  shape.bezierCurveTo(-2.3, -1.05, -1.2, -1.95, 0, -2.65);
  shape.bezierCurveTo(1.2, -1.95, 2.3, -1.05, 2.3, -0.1);
  shape.bezierCurveTo(2.3, -0.1, 2.3, 1.25, 1.25, 1.25);
  shape.bezierCurveTo(0.4, 1.25, 0, 0.5, 0, 0.5);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.62,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 5,
    bevelSize: 0.16,
    bevelThickness: 0.16,
    curveSegments: 14,
  });
  geometry.center();
  geometry.computeVertexNormals();
  return geometry;
}

function createHeart(color, scale, burst = false) {
  const group = new THREE.Group();

  if (!burst) {
    const outerMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffe2ec,
      metalness: 0.05,
      roughness: 0.08,
      transparent: true,
      opacity: 0.31,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const outer = new THREE.Mesh(heartGeometry, outerMaterial);
    group.add(outer);

    const innerMaterial = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.42,
      metalness: 0.18,
      roughness: 0.28,
    });
    const inner = new THREE.Mesh(innerHeartGeometry, innerMaterial);
    group.add(inner);

    if (glowTexture) {
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTexture,
          transparent: true,
          opacity: 0.12,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      glow.scale.setScalar(1.2);
      glow.position.z = -0.25;
      group.add(glow);
    }
  } else {
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.45,
      metalness: 0.18,
      roughness: 0.28,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(heartGeometry, material);
    mesh.scale.setScalar(scale);
    return mesh;
  }

  group.scale.setScalar(scale);
  return group;
}

function addLights() {
  scene.add(new THREE.HemisphereLight(0xffd9e8, 0x160b26, 1.15));

  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(4, 6, 7);
  scene.add(key);

  const roseLight = new THREE.PointLight(0xff5f8f, 32, 22);
  roseLight.position.set(-4, 2, 4);
  scene.add(roseLight);

  const mintLight = new THREE.PointLight(0x63e2c0, 15, 20);
  mintLight.position.set(4, -3, 3);
  scene.add(mintLight);

  const goldLight = new THREE.PointLight(0xffd166, 12, 18);
  goldLight.position.set(0, 4, 2);
  scene.add(goldLight);
}

function buildHearts() {
  if (!bgGroup) return;
  while (bgGroup.children.length) {
    const child = bgGroup.children.pop();
    child.traverse?.((node) => {
      if (node.material) {
        if (Array.isArray(node.material)) node.material.forEach((m) => m.dispose());
        else node.material.dispose();
      }
    });
  }
  hearts = [];

  const desktop = window.innerWidth >= 900;
  const lowPower =
    (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
    window.innerWidth < 380 ||
    window.innerHeight < 700;
  const count = desktop ? 12 : lowPower ? 5 : 7;
  const fov = THREE.MathUtils.degToRad(21);
  const aspect = window.innerWidth / window.innerHeight;

  for (let i = 0; i < count; i++) {
    const color = palette[i % palette.length];
    const scale = rand(0.11, desktop ? 0.25 : 0.19);
    const heart = createHeart(color, scale);
    const side = i % 2 === 0 ? -1 : 1;
    const baseZ = rand(-4.6, -1.1);
    const distance = 9 - baseZ;
    const halfH = distance * Math.tan(fov);
    const halfW = halfH * aspect;
    const baseX = side * rand(halfW * 0.78, halfW * 0.94);
    const baseY = rand(-halfH * 0.88, halfH * 0.88);

    heart.position.set(baseX, baseY, baseZ);
    heart.rotation.set(rand(-0.36, 0.36), rand(-0.36, 0.36), rand(-0.28, 0.28));
    heart.userData = {
      baseX,
      baseY,
      baseZ,
      phase: rand(0, Math.PI * 2),
      speed: rand(0.16, 0.38),
      driftX: rand(0.18, 0.55),
      driftY: rand(0.12, 0.42),
      rotX: heart.rotation.x,
      rotY: heart.rotation.y,
      rotZ: heart.rotation.z,
    };
    bgGroup.add(heart);
    hearts.push(heart);
  }
}

function initScene() {
  if (!canvas || !supportsWebGL()) {
    if (canvas) canvas.style.display = 'none';
    return;
  }

  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
  } catch (_error) {
    canvas.style.display = 'none';
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.setClearColor(0x000000, 0);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(
    42,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );
  camera.position.set(0, 0, 9);

  bgGroup = new THREE.Group();
  burstGroup = new THREE.Group();
  burstGroup.visible = false;
  scene.add(bgGroup, burstGroup);

  glowTexture = makeGlowTexture();
  heartGeometry = makeHeartGeometry();
  innerHeartGeometry = heartGeometry.clone().scale(0.74, 0.74, 0.84);

  addLights();
  buildHearts();

  if (!reduceMotion) startSceneLoop();
  else renderScene();

  bindSceneEvents();
}

function renderScene() {
  if (renderer && scene && camera) renderer.render(scene, camera);
}

function tickScene(now) {
  if (!sceneRunning) return;
  const t = now * 0.001;

  pointer.x += (targetPointer.x - pointer.x) * 0.045;
  pointer.y += (targetPointer.y - pointer.y) * 0.045;

  if (bgGroup) {
    bgGroup.rotation.y += (pointer.x * 0.16 - bgGroup.rotation.y) * 0.045;
    bgGroup.rotation.x += (-pointer.y * 0.1 - bgGroup.rotation.x) * 0.045;
    bgGroup.position.y = -scrollOffset * 1.15;
  }

  hearts.forEach((heart) => {
    const d = heart.userData;
    heart.position.x = d.baseX + Math.sin(t * d.speed + d.phase) * d.driftX;
    heart.position.y =
      d.baseY + Math.cos(t * d.speed * 0.82 + d.phase) * d.driftY;
    heart.position.z = d.baseZ + Math.sin(t * d.speed * 0.55 + d.phase) * 0.28;
    heart.rotation.x = d.rotX + Math.sin(t * d.speed * 0.7 + d.phase) * 0.14;
    heart.rotation.y = d.rotY + Math.sin(t * d.speed * 0.4 + d.phase) * 0.22;
    heart.rotation.z = d.rotZ + Math.cos(t * d.speed * 0.5 + d.phase) * 0.09;
  });

  renderScene();
  sceneLoop = requestAnimationFrame(tickScene);
}

function startSceneLoop() {
  if (!renderer || reduceMotion || document.hidden || sceneRunning) return;
  sceneRunning = true;
  sceneLoop = requestAnimationFrame(tickScene);
}

function stopSceneLoop() {
  sceneRunning = false;
  if (sceneLoop) cancelAnimationFrame(sceneLoop);
  sceneLoop = null;
}

function bindSceneEvents() {
  let resizeFrame = 0;
  window.addEventListener(
    'resize',
    () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        if (!renderer || !camera) return;
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(window.innerWidth, window.innerHeight);
        buildHearts();
        if (reduceMotion) renderScene();
      });
    },
    { passive: true }
  );

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopSceneLoop();
    else startSceneLoop();
  });

  window.addEventListener(
    'pointermove',
    (event) => {
      if (reduceMotion) return;
      targetPointer.x = clamp((event.clientX / window.innerWidth) * 2 - 1, -1, 1);
      targetPointer.y = clamp((event.clientY / window.innerHeight) * 2 - 1, -1, 1);
    },
    { passive: true }
  );

  window.addEventListener(
    'deviceorientation',
    (event) => {
      if (reduceMotion || event.gamma == null) return;
      targetPointer.x = clamp(event.gamma / 32, -1, 1);
      targetPointer.y = clamp((event.beta - 45) / 45, -1, 1);
    },
    { passive: true }
  );

  window.addEventListener(
    'scroll',
    () => {
      const max = Math.max(1, document.body.scrollHeight - window.innerHeight);
      scrollOffset = clamp(window.scrollY / max, 0, 1);
    },
    { passive: true }
  );

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    stopSceneLoop();
  });
}

function clearBurst() {
  if (!burstGroup) return;
  while (burstGroup.children.length) {
    const child = burstGroup.children.pop();
    child.traverse?.((node) => {
      if (node.material) node.material.dispose();
    });
  }
}

function celebrate() {
  if (!renderer || reduceMotion) return;
  if (celebrating) {
    clearBurst();
    clearTimeout(celebrationTimer);
  }
  celebrating = true;
  gsap.killTweensOf(canvas);
  gsap.set(canvas, { opacity: 1 });
  canvas.classList.add('is-celebrating');
  bgGroup.visible = false;
  burstGroup.visible = true;
  clearBurst();

  for (let i = 0; i < 30; i++) {
    const color = palette[i % palette.length];
    const heart = createHeart(color, rand(0.025, 0.065), true);
    heart.position.set(rand(-0.8, 0.8), rand(0.8, 1.6), rand(2.2, 3.4));
    burstGroup.add(heart);

    const angle = -Math.PI / 2 + rand(-0.95, 0.95);
    const speed = rand(1.4, 2.9);
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;

    const timeline = gsap.timeline();
    timeline
      .to(heart.position, {
        x: `+=${vx}`,
        y: `+=${vy}`,
        z: rand(2.2, 3.8),
        duration: rand(0.8, 1.2),
        ease: 'power2.out',
      })
      .to(
        heart.position,
        {
          x: `+=${vx * 0.35}`,
          y: `+=${vy * 0.1}`,
          z: rand(2.2, 3.4),
          duration: rand(1.0, 1.35),
          ease: 'power1.out',
        },
        '>-0.2'
      );
    gsap.to(heart.rotation, {
      x: rand(-4, 4),
      y: rand(-4, 4),
      z: rand(-4, 4),
      duration: rand(2.2, 3.2),
      ease: 'none',
    });
    gsap.to(heart.material, {
      opacity: 0,
      duration: 0.9,
      delay: rand(1.1, 1.5),
      ease: 'power2.in',
    });
  }

  celebrationTimer = setTimeout(() => {
    celebrating = false;
    clearBurst();
    if (burstGroup) burstGroup.visible = false;
    if (bgGroup) bgGroup.visible = true;
    canvas.classList.remove('is-celebrating');
    gsap.to(canvas, {
      opacity: currentScreen === 'home' ? 0.82 : currentScreen === 'final' ? 0.12 : 0,
      duration: 0.7,
    });
  }, 3200);
}

/* ------------------------------------------------------------------ */
/*  Skor sayacı                                                       */
/* ------------------------------------------------------------------ */

const scoreCache = new WeakMap();

function animateNumber(element, from, to) {
  if (reduceMotion || from === to) {
    element.textContent = String(to);
    return;
  }
  element.dataset.counting = '1';
  const proxy = { value: from };
  gsap.to(proxy, {
    value: to,
    duration: 0.32,
    ease: 'power2.out',
    onUpdate: () => {
      element.textContent = String(Math.round(proxy.value));
    },
    onComplete: () => {
      element.textContent = String(to);
      delete element.dataset.counting;
    },
  });

  const parent = element.closest('.score-side, .team-score, .team-score-card');
  if (parent) {
    gsap.fromTo(
      parent,
      { scale: 1 },
      {
        scale: 1.035,
        duration: 0.16,
        yoyo: true,
        repeat: 1,
        ease: 'power2.inOut',
      }
    );
  }
}

function scanScores() {
  $$('.score-value, .ts-score, .tsc-score').forEach((element) => {
    if (element.dataset.counting === '1') return;
    const raw = element.textContent.trim();
    if (!/^-?\d+$/.test(raw)) return;
    const value = Number(raw);
    const previous = scoreCache.get(element);
    scoreCache.set(element, value);
    if (previous === undefined) {
      if (value !== 0) animateNumber(element, 0, value);
    } else if (previous !== value) {
      animateNumber(element, previous, value);
    }
  });
}

/* ------------------------------------------------------------------ */
/*  Soru / sonuç / adam asmaca mikro animasyonları                    */
/* ------------------------------------------------------------------ */

let lastQuestion = '';
let lastVerdict = '';
let lastHangmanWrong = null;
let lastHangmanOpen = 0;

function scanPlay() {
  const active = $('.screen.active');
  if (!active || active.id !== 'screen-play') {
    lastQuestion = '';
    lastVerdict = '';
    lastHangmanWrong = null;
    lastHangmanOpen = 0;
    return;
  }

  const questionText = $('.question-text', active)?.textContent?.trim() || '';
  if (questionText && questionText !== lastQuestion) {
    lastQuestion = questionText;
    const card = $('.question-card', active);
    if (card && !reduceMotion) {
      gsap.fromTo(
        card,
        { opacity: 0, y: 14, scale: 0.99 },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: 0.45,
          ease: 'power3.out',
          clearProps: 'transform',
        }
      );
    }
  }

  const verdict = $('.verdict', active);
  if (verdict) {
    const key = verdict.textContent.trim().replace(/\s+/g, ' ').slice(0, 100);
    const emoji = $('.verdict-emoji', verdict)?.textContent || '';
    const good = ['🎯', '✨', '✅'].some((symbol) => emoji.includes(symbol));
    const bad = ['💔', '🧩', '⏰'].some((symbol) => emoji.includes(symbol));
    verdict.classList.toggle('is-correct', good);
    verdict.classList.toggle('is-wrong', bad);

    const verdictKey = `${questionText}::${key}`;
    if (key && verdictKey !== lastVerdict) {
      lastVerdict = verdictKey;
      if (!reduceMotion) {
        if (good) {
          gsap.fromTo(
            verdict,
            { scale: 0.96 },
            { scale: 1, duration: 0.55, ease: 'elastic.out(1, .45)' }
          );
        }
        if (bad) {
          gsap.fromTo(
            verdict,
            { x: -5 },
            { x: 0, duration: 0.45, ease: 'elastic.out(1, .35)' }
          );
        }
      }
    }
  } else {
    lastVerdict = '';
  }

  const board = $('.hm-board', active);
  if (board) {
    const wrong = $('.hm-wrong', active)?.textContent || '';
    if (wrong && wrong !== lastHangmanWrong) {
      if (lastHangmanWrong !== null && !reduceMotion) {
        gsap.fromTo(
          board,
          { x: -6 },
          { x: 0, duration: 0.5, ease: 'elastic.out(1, .35)' }
        );
        gsap.fromTo(
          $$('.hm-lives span', active),
          { scale: 1.22, opacity: 0.45 },
          {
            scale: 1,
            opacity: 1,
            duration: 0.42,
            stagger: 0.03,
            ease: 'back.out(2)',
          }
        );
      }
      lastHangmanWrong = wrong;
    }

    const open = $$('.hm-cell.open', active).length;
    if (open > lastHangmanOpen && !reduceMotion) {
      const fresh = $$('.hm-cell.open', active).slice(lastHangmanOpen);
      gsap.fromTo(
        fresh,
        { scale: 0.68, opacity: 0.35 },
        {
          scale: 1,
          opacity: 1,
          duration: 0.34,
          ease: 'back.out(2)',
        }
      );
    }
    lastHangmanOpen = open;
  } else {
    lastHangmanWrong = null;
    lastHangmanOpen = 0;
  }
}

/* ------------------------------------------------------------------ */
/*  Tarama ve mikro etkileşimler                                      */
/* ------------------------------------------------------------------ */

let scanScheduled = false;
function scheduleScan() {
  if (scanScheduled) return;
  scanScheduled = true;
  requestAnimationFrame(() => {
    scanScheduled = false;
    scanScores();
    scanPlay();
  });
}

const observer = new MutationObserver(scheduleScan);
observer.observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true,
});

document.addEventListener('click', (event) => {
  if (reduceMotion) return;
  const modeCard = event.target.closest('.home-mode');
  if (modeCard) {
    gsap.fromTo(
      modeCard,
      { scale: 0.965 },
      { scale: 1, duration: 0.4, ease: 'back.out(2)' }
    );
  }

  const key = event.target.closest('.hm-key');
  if (key) {
    gsap.fromTo(
      key,
      { scale: 0.84 },
      { scale: 1, duration: 0.34, ease: 'back.out(2)' }
    );
  }

  const chip = event.target.closest('.team-count');
  if (chip) {
    gsap.fromTo(
      chip,
      { scale: 0.94 },
      { scale: 1, duration: 0.3, ease: 'back.out(2)' }
    );
  }
});

/* ------------------------------------------------------------------ */
/*  Başlat                                                            */
/* ------------------------------------------------------------------ */

initScene();
requestAnimationFrame(() => {
  animateScreen(initialScreen, true);
  scanScores();
  scanPlay();
});

