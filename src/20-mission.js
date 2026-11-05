/* ==========================================================================
   SKYHOOK · 天穹电梯 — mission, camera, HUD, controls
   ========================================================================== */
(function () {
  'use strict';

  const APP = window.SKYHOOK_APP;
  const THREE = APP.THREE;
  const state = APP.state;
  const dom = APP.dom;
  const clamp = APP.clamp;
  const lerp = APP.lerp;
  const smoothstep = APP.smoothstep;
  const smootherstep = APP.smootherstep;
  const invSmootherstep = APP.invSmootherstep;
  const damp = APP.damp;
  const fmtTime = APP.fmtTime;
  const fmtInt = APP.fmtInt;
  const isSmall = APP.isSmall;
  const isTouch = APP.isTouch;
  const reducedMotion = APP.reducedMotion;

  const START_Y = APP.START_Y;
  const TOP = APP.TOP;
  const IGNITION = APP.IGNITION;
  const DURATION = APP.DURATION;
  const TOTAL_TIME = APP.TOTAL_TIME;

  const PHASES = [
    { t: 0.000, cn: '发射台', en: 'LAUNCH PAD', sub: '沙漠发射台 · 待命' },
    { t: 0.012, cn: '离地', en: 'LIFTOFF', sub: '托架释放 · 磁悬浮爬升' },
    { t: 0.170, cn: '云层', en: 'CLOUD DECK', sub: '穿过积云 · 气流扰动' },
    { t: 0.340, cn: '平流层', en: 'STRATOSPHERE', sub: '空气稀薄 · 天空转暗' },
    { t: 0.580, cn: '近空间', en: 'NEAR SPACE', sub: '星空显现 · 弧线地平线' },
    { t: 0.800, cn: '轨道', en: 'ORBIT', sub: '天穹站接近 · 准备减速' },
    { t: 0.965, cn: '对接', en: 'DOCKING', sub: '磁力捕获 · 轿厢锁定' }
  ];

  const VIEW_DEFAULTS = {
    chase: { yaw: 1.24, pitch: -0.11 },
    porthole: { yaw: 0.24, pitch: -0.46 },
    wide: { yaw: 1.02, pitch: -0.06 }
  };

  let renderer = null;
  let scene = null;
  let camera = null;
  let postFX = null;
  let engineAudio = null;
  let world = null;
  let clock = null;

  let lastPhase = -1;
  let lastUi = 0;
  let uiAccum = 0;
  let completeTimer = 0;
  let toastTimer = 0;
  let lookMode = false;
  let started = false;
  let pinching = false;
  let pinchStart = 0;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let frameCount = 0;
  let fpsTime = 0;
  let currentFps = 60;
  let lowFpsStreak = 0;
  let qualityDrops = 0;
  let degraded = false;

  const pointers = new Map();
  const milestones = new Set();

  const camPos = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  const desiredPos = new THREE.Vector3();
  const desiredTarget = new THREE.Vector3();
  const tmpV = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();

  const DOM_IDS = [
    'scene', 'ui', 'intro', 'complete', 'btnStart', 'btnLaunch', 'btnSkip',
    'btnReplay', 'btnAgain', 'btnLook', 'btnSound', 'stateLabel', 'altValue',
    'altUnit', 'altSub', 'speedValue', 'tensionValue', 'distanceValue',
    'tensionBar', 'altRead', 'altTrack', 'altMarker', 'phaseName', 'phaseEn',
    'pctValue', 'progressFill', 'toast', 'flash', 'loader', 'loaderStatus',
    'progressTrack'
  ];

  const viewButtons = [];

  /* ------------------------------ helpers --------------------------------- */
  function $(id) { return document.getElementById(id); }

  function setLoader(text) {
    if (dom.loaderStatus) dom.loaderStatus.textContent = text;
  }

  function padAlt(km) {
    if (km < 10) return km.toFixed(2);
    return km.toFixed(1);
  }

  function phaseFor(p) {
    let idx = 0;
    for (let i = 0; i < PHASES.length; i++) {
      if (p >= PHASES[i].t) idx = i;
    }
    return idx;
  }

  function phaseSub() {
    if (state.mode === 'complete') return '天穹站 · 磁力捕获锁定';
    if (state.mode === 'idle') return '沙漠发射台 · 待命';
    if (state.elapsed < IGNITION) return '发射台 · 点火序列';
    if (state.progress > 0.965) return '对接走廊 · 减速靠泊';
    return PHASES[Math.max(0, Math.min(PHASES.length - 1, state.phase))].sub;
  }

  function showToast(title, sub, duration) {
    if (!dom.toast) return;
    const b = dom.toast.querySelector('b');
    const s = dom.toast.querySelector('span');
    if (b) b.textContent = title;
    if (s) s.textContent = sub || '';
    dom.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => dom.toast.classList.remove('show'), duration || 2600);
  }

  function clearCompleteTimer() {
    if (completeTimer) {
      clearTimeout(completeTimer);
      completeTimer = 0;
    }
  }

  function baseForMode() {
    if (state.mode === 'complete' && !lookMode) return { yaw: 0.72, pitch: -0.10 };
    if (state.mode === 'complete' && lookMode) return VIEW_DEFAULTS.wide;
    return VIEW_DEFAULTS[state.camMode] || VIEW_DEFAULTS.chase;
  }

  function orbit(out, yaw, pitch, radius) {
    const cp = Math.cos(pitch);
    out.set(Math.sin(yaw) * cp * radius, Math.sin(pitch) * radius, Math.cos(yaw) * cp * radius);
    return out;
  }

  /* ------------------------------ boot ------------------------------------ */
  function cacheDom() {
    for (const id of DOM_IDS) dom[id] = document.getElementById(id);
    dom.canvas = dom.scene;
    dom.viewButtons = Array.from(document.querySelectorAll('.view-btn'));
    viewButtons.push(...dom.viewButtons);
    Object.assign(APP.dom, dom);
  }

  function setupRenderer() {
    const canvas = dom.canvas;
    const w = Math.max(1, innerWidth);
    const h = Math.max(1, innerHeight);
    const dprCap = isSmall() ? 1.5 : 1.8;

    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, dprCap));
    renderer.setSize(w, h, false);
    renderer.autoClear = true;
    renderer.setClearColor(0x03070a, 1);
    renderer.outputEncoding = THREE.LinearEncoding;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = false;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(54, w / h, 0.06, 30000);
    camera.position.set(56, 26, 64);
    camera.up.set(0, 1, 0);

    APP.renderer = renderer;
    APP.scene = scene;
    APP.camera = camera;
  }

  function setupWorld() {
    postFX = new APP.PostFX(renderer);
    engineAudio = new APP.EngineAudio();
    APP.postFX = postFX;
    APP.engineAudio = engineAudio;

    world = window.buildSkyhookWorld();
    APP.world = world;

    clock = new THREE.Clock();
    APP.clock = clock;

    state.time = 0;
    state.phase = 0;
    state.camMode = 'chase';
    state.yaw = VIEW_DEFAULTS.chase.yaw;
    state.pitch = VIEW_DEFAULTS.chase.pitch;
    state.zoom = 1;

    world.update(0.016, 0, 0, START_Y, 0);
    updateCamera(0, true);
    syncViewButtons();
  }

  function finishBoot() {
    state.ready = true;
    setLoader('系统就绪');
    document.body.classList.add('ready');
    renderHud(true);
    applyLocationDebug();
    requestAnimationFrame(loop);
  }

  function applyLocationDebug() {
    const m = /(?:[#?&])p=([0-9.]+)/.exec(location.hash + location.search);
    const view = /(?:[#?&])view=(chase|porthole|wide)/.exec(location.hash + location.search);
    if (view) setViewMode(view[1], false);
    if (/(?:[#?&])auto=1/.test(location.hash + location.search)) {
      setTimeout(() => startMission(false), 120);
      return;
    }
    if (!m) return;
    const p = clamp(parseFloat(m[1]), 0, 1);
    setTimeout(() => debugJump(p), 240);
  }

  function boot() {
    cacheDom();
    if (!window.WebGLRenderingContext) {
      setLoader('当前浏览器未启用 WebGL，无法呈现 3D 场景。');
      return;
    }
    setTimeout(() => {
      try {
        setupRenderer();
        setLoader('正在搭建发射场与复合缆索…');
        setTimeout(() => {
          try {
            setupWorld();
            setLoader('正在校准星空与追拍镜头…');
            setTimeout(finishBoot, 320);
          } catch (err) {
            APP.recordError(err && err.stack ? err.stack : String(err));
          }
        }, 60);
      } catch (err) {
        APP.recordError(err && err.stack ? err.stack : String(err));
      }
    }, 60);
  }

  /* ------------------------------ timeline -------------------------------- */
  function loop() {
    requestAnimationFrame(loop);
    if (!state.ready) return;

    const dt = Math.min(clock.getDelta(), 0.05);
    state.time += dt;

    if (state.mode === 'running' && !state.freeze) {
      state.elapsed = Math.min(TOTAL_TIME, state.elapsed + dt);
      const p = smootherstep(IGNITION, TOTAL_TIME, state.elapsed);
      state.progress = p;
      state.height = START_Y + (TOP - START_Y) * p;
      if (p >= 0.99999) finishMission();
    } else if (state.mode === 'idle') {
      state.elapsed = 0;
      state.progress = 0;
      state.height = START_Y;
    }

    updateMotion(dt);
    updatePhase();

    world.update(dt, state.elapsed, state.progress, state.height, state.time);
    updateCamera(dt, false);
    updateFlash(dt);
    updateAdaptive(dt);

    postFX.render(scene, camera, state.time);

    uiAccum += dt;
    if (uiAccum >= 0.075) {
      uiAccum = 0;
      renderHud(false);
    }
    engineAudio.update(state.progress, state.speed, state.mode);
  }

  function updateMotion() {
    const p = clamp(state.progress, 0, 1);
    if (state.mode === 'running' && state.elapsed >= IGNITION) {
      state.speed = 34 + Math.sin(Math.PI * p) * 1012;
    } else {
      state.speed = 0;
    }
    state.tension = 74.2 + p * 16.0 + Math.sin(state.time * 0.9) * 0.22;
  }

  function updatePhase() {
    const idx = state.mode === 'complete' ? 6 : phaseFor(state.progress);
    if (idx === state.phase && idx === lastPhase) return;
    state.phase = idx;

    if (idx > 0 && lastPhase >= 0 && state.mode === 'running') {
      engineAudio.phaseCue(idx);
    }

    if (state.mode === 'running' && !milestones.has(idx)) {
      if (idx === 2) {
        milestones.add(idx);
        showToast('穿越云层 / CLOUD DECK', '气动扰流 · 轿厢稳定', 2400);
      } else if (idx === 4) {
        milestones.add(idx);
        showToast('进入近空间 / NEAR SPACE', '星空显现 · 地球弧线', 2400);
      }
    }

    lastPhase = idx;
  }

  function finishMission() {
    if (state.mode === 'complete') return;
    state.mode = 'complete';
    state.elapsed = TOTAL_TIME;
    state.progress = 1;
    state.height = TOP;
    state.speed = 0;
    state.phase = 6;
    lastPhase = 6;
    lookMode = false;
    // the porthole is a flight view; the docking hero shot must not stay masked by it
    if (state.camMode === 'porthole') setViewMode('chase', true);
    document.body.classList.remove('running');
    engineAudio.complete();
    state.cloudFlash = Math.max(state.cloudFlash, 0.55);
    showToast('磁力捕获 / 对接锁定', 'TIANYONG ORBITAL RING · 400 KM', 2800);
    renderHud(true);

    clearCompleteTimer();
    completeTimer = setTimeout(() => {
      if (state.mode !== 'complete' || lookMode) return;
      if (dom.completeTime) dom.completeTime.textContent = fmtTime(Math.round(TOTAL_TIME));
      dom.complete.classList.add('show');
      state.completeShown = true;
    }, 2700);
  }

  function startMission(fromReplay) {
    if (!state.ready) return;
    if (state.mode === 'running' && !fromReplay) return;
    clearCompleteTimer();
    lookMode = false;
    started = true;
    milestones.clear();

    state.mode = 'running';
    state.freeze = false;
    state.elapsed = 0;
    state.progress = 0;
    state.height = START_Y;
    state.speed = 0;
    state.phase = 0;
    state.completeShown = false;
    lastPhase = 0;
    state.cloudFlash = 0;

    dom.complete.classList.remove('show');
    dom.intro.classList.add('hidden');
    document.body.classList.remove('intro-open');
    document.body.classList.add('running');

    if (fromReplay) {
      setViewMode('chase', true);
      state.yaw = VIEW_DEFAULTS.chase.yaw;
      state.pitch = VIEW_DEFAULTS.chase.pitch;
      state.zoom = 1;
      world.update(0.016, 0, 0, START_Y, state.time);
      updateCamera(0, true);
      showToast('重新点火 / RELAUNCH', '缆索复位 · 轿厢锁定', 2400);
    } else {
      state.yaw = VIEW_DEFAULTS[state.camMode].yaw;
      state.pitch = VIEW_DEFAULTS[state.camMode].pitch;
      state.zoom = 1;
      showToast('点火序列 / IGNITION', '缆索张力稳定 · 解除锁定', 2600);
    }

    world.triggerLaunch(state.time);
    if (state.soundOn) engineAudio.startFlight();
    updatePhase();
    renderHud(true);
  }

  function skipMission() {
    if (state.mode !== 'running') return;
    if (state.progress > 0.97) return;
    const p = 0.975;
    state.freeze = false;
    state.progress = p;
    state.height = START_Y + (TOP - START_Y) * p;
    state.elapsed = IGNITION + DURATION * invSmootherstep(p);
    state.cloudFlash = 0.7;
    milestones.add(2);
    milestones.add(4);
    lastPhase = -1;
    updatePhase();
    world.update(0.016, state.elapsed, state.progress, state.height, state.time);
    updateCamera(0, true);
    showToast('巡航跳过 / CRUISE SKIPPED', '直接前往对接走廊', 2200);
    renderHud(true);
  }

  function restartMission() {
    startMission(true);
  }

  function leaveCompleteOverlay() {
    if (state.mode !== 'complete') return;
    dom.complete.classList.remove('show');
    state.completeShown = false;
    lookMode = true;
    setViewMode('wide', false);
    state.lastInteract = state.time;
    showToast('自由环视 / FREE LOOK', '拖拽调整视角 · 1 / 2 / 3 切换', 2400);
  }

  /* ------------------------------ camera --------------------------------- */
  function updateCamera(dt, snap) {
    if (!world || !camera) return;

    const p = clamp(state.progress, 0, 1);
    let targetFov = 55;

    if (state.mode === 'idle') {
      const a = 0.72 + state.time * 0.016;
      desiredPos.set(Math.cos(a) * 78, 26 + Math.sin(state.time * 0.16) * 1.2, Math.sin(a) * 78);
      desiredTarget.set(0, 36 + Math.sin(state.time * 0.11) * 1.2, 0);
      targetFov = 54;
    } else if (state.mode === 'complete' && !lookMode) {
      const st = world.station.position;
      const yaw = 0.72 + Math.sin(state.time * 0.055) * 0.025;
      const radius = 155 * state.zoom;
      desiredTarget.set(st.x, st.y - 4, st.z);
      orbit(desiredPos, yaw, -0.04, radius).add(desiredTarget);
      targetFov = 54;
    } else if (state.camMode === 'porthole') {
      world.cabin.updateMatrixWorld(true);
      tmpV.set(0, 0.52, 1.84);
      world.cabin.localToWorld(tmpV);
      desiredPos.copy(tmpV);
      const cp = Math.cos(state.pitch);
      desiredTarget.set(
        desiredPos.x + Math.sin(state.yaw) * cp * 120,
        desiredPos.y + Math.sin(state.pitch) * 120,
        desiredPos.z + Math.cos(state.yaw) * cp * 120
      );
      targetFov = 68;
    } else if (state.camMode === 'wide') {
      const s = smoothstep(0.82, 0.995, p);
      const radius = lerp(36, 95, s) * state.zoom;
      const targetLift = lerp(2.4, 10, s);
      const lookLift = lerp(9, 31, s);
      tmpV2.set(world.cabin.position.x, world.cabin.position.y + targetLift, world.cabin.position.z);
      orbit(desiredPos, state.yaw, state.pitch, radius).add(tmpV2);
      desiredTarget.set(world.cabin.position.x, world.cabin.position.y + lookLift, world.cabin.position.z);
      targetFov = lerp(76, 82, s);
    } else {
      const s = smoothstep(0.80, 0.995, p);
      const approach = smoothstep(0.74, 0.94, p);
      const dock = smoothstep(0.90, 0.99, p);
      const radius = lerp(lerp(22, 72, s), 138, approach) * state.zoom;
      const stationY = world.station.position.y;
      const midY = (world.cabin.position.y + stationY) * 0.5;
      const focusY = lerp(
        world.cabin.position.y + lerp(4.6, 9, s),
        midY,
        approach
      );
      const finalFocusY = lerp(focusY, stationY - 10, dock);
      tmpV2.set(world.cabin.position.x, focusY, world.cabin.position.z);
      orbit(desiredPos, state.yaw, state.pitch + approach * 0.02, radius).add(tmpV2);
      if (dock > 0.001) {
        desiredPos.y += (stationY - 10 - focusY) * dock * 0.55;
        desiredPos.z -= dock * 26;
      }
      desiredTarget.set(world.cabin.position.x, finalFocusY, world.cabin.position.z);
      targetFov = lerp(56, 66, approach);
    }

    // slowly settle the view back behind the cabin after the user lets go
    if (!snap && state.mode !== 'idle' && !state.drag && state.time - state.lastInteract > 6) {
      const base = baseForMode();
      state.yaw = damp(state.yaw, base.yaw, 0.8, dt);
      state.pitch = damp(state.pitch, base.pitch, 0.8, dt);
      if (state.mode !== 'complete' || lookMode) state.zoom = damp(state.zoom, 1, 0.7, dt);
    }

    if (snap) {
      camPos.copy(desiredPos);
      camTarget.copy(desiredTarget);
    } else {
      let lambda = 3.4;
      if (state.mode === 'idle') lambda = 1.4;
      else if (state.camMode === 'porthole' && state.mode !== 'complete') lambda = 16;
      const k = 1 - Math.exp(-lambda * Math.max(dt, 1e-4));
      camPos.lerp(desiredPos, k);
      camTarget.lerp(desiredTarget, k);
    }

    camera.position.copy(camPos);
    camera.up.set(0, 1, 0);

    let shake = 0;
    if (!snap && state.mode === 'running' && !state.freeze) {
      if (state.elapsed < IGNITION) {
        shake = 0.055 * clamp(state.elapsed / IGNITION, 0, 1);
      } else {
        shake = 0.008 + 0.014 * Math.sin(Math.PI * p);
      }
      if (state.camMode === 'porthole') shake *= 0.45;
    }
    if (shake > 0) {
      camera.position.x += Math.sin(state.time * 47.1) * shake;
      camera.position.y += Math.sin(state.time * 61.7 + 1.3) * shake * 0.7;
      camera.position.z += Math.cos(state.time * 53.3) * shake * 0.5;
    }

    camera.lookAt(camTarget);
    if (!snap && state.mode === 'running') {
      const roll = state.camMode === 'porthole'
        ? Math.sin(state.time * 1.1) * 0.006
        : Math.sin(state.time * 0.7) * 0.002;
      camera.rotateZ(roll);
    }

    if (snap) {
      camera.fov = targetFov;
    } else {
      camera.fov = damp(camera.fov, targetFov, 3.0, dt);
    }
    camera.updateProjectionMatrix();
  }

  function setViewMode(mode, snap) {
    if (!VIEW_DEFAULTS[mode]) return;
    state.camMode = mode;
    const base = VIEW_DEFAULTS[mode];
    state.yaw = base.yaw;
    state.pitch = base.pitch;
    state.zoom = 1;
    state.lastInteract = state.time;
    // while the hero shot is up, a view choice means "let me look around now"
    if (!snap && state.mode === 'complete' && !lookMode) {
      lookMode = true;
      state.completeShown = false;
      clearCompleteTimer();
      dom.complete.classList.remove('show');
    }
    document.body.classList.toggle('cam-porthole', mode === 'porthole');
    syncViewButtons();
    if (snap && state.ready) updateCamera(0, true);
  }

  function syncViewButtons() {
    for (const btn of viewButtons) {
      const on = btn.dataset.mode === state.camMode;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  /* ------------------------------ HUD ------------------------------------ */
  function renderHud() {
    const p = clamp(state.progress, 0, 1);
    const km = p * 400;
    const phase = PHASES[Math.max(0, Math.min(PHASES.length - 1, state.phase < 0 ? 0 : state.phase))];

    if (dom.altValue) dom.altValue.textContent = padAlt(km);
    if (dom.altUnit) dom.altUnit.textContent = 'KM';
    if (dom.altSub) dom.altSub.textContent = phaseSub();
    if (dom.altRead) dom.altRead.textContent = km.toFixed(1) + ' KM';
    if (dom.speedValue) dom.speedValue.innerHTML = fmtInt(state.speed) + '<em>KM/H</em>';
    if (dom.tensionValue) dom.tensionValue.innerHTML = state.tension.toFixed(1) + '<em>%</em>';
    if (dom.distanceValue) dom.distanceValue.innerHTML = Math.max(0, 400 - km).toFixed(0) + '<em>KM</em>';
    if (dom.tensionBar) dom.tensionBar.style.width = clamp(state.tension, 0, 100).toFixed(1) + '%';
    if (dom.phaseName) dom.phaseName.textContent = phase.cn;
    if (dom.phaseEn) dom.phaseEn.textContent = phase.en;
    if (dom.pctValue) dom.pctValue.textContent = (p * 100).toFixed(1);
    if (dom.progressFill) dom.progressFill.style.width = (p * 100).toFixed(2) + '%';
    if (dom.altTrack) {
      dom.altTrack.style.setProperty('--fill', p.toFixed(4));
      dom.altTrack.style.setProperty('--fill-pct', (p * 100).toFixed(3) + '%');
    }

    if (dom.stateLabel) {
      if (state.mode === 'complete') dom.stateLabel.textContent = '已对接 · DOCKED';
      else if (state.mode === 'running') {
        dom.stateLabel.textContent = state.elapsed < IGNITION ? '点火 · IGNITION' : '上升中 · ASCENT';
      } else dom.stateLabel.textContent = '待命 · STANDBY';
    }

    if (dom.btnLaunch) {
      dom.btnLaunch.disabled = state.mode === 'running' || state.mode === 'complete';
      const span = dom.btnLaunch.querySelector('span');
      if (span) span.textContent = state.mode === 'running' ? '上升中' : state.mode === 'complete' ? '已抵达' : '启动电梯';
    }
    if (dom.btnSkip) dom.btnSkip.disabled = state.mode !== 'running' || p > 0.97;
    if (dom.btnReplay) dom.btnReplay.disabled = false;
    if (dom.btnSound) {
      dom.btnSound.classList.toggle('off', !state.soundOn);
      dom.btnSound.setAttribute('aria-pressed', state.soundOn ? 'true' : 'false');
    }
    if (dom.completeTime && state.mode === 'complete') {
      dom.completeTime.textContent = fmtTime(Math.round(TOTAL_TIME));
    }
    document.body.classList.toggle('running', state.mode === 'running');
    syncViewButtons();
  }

  /* ------------------------------ flash ---------------------------------- */
  function updateFlash(dt) {
    if (!dom.flash) return;
    const value = clamp(state.cloudFlash, 0, 0.92);
    dom.flash.style.opacity = value.toFixed(3);
    state.cloudFlash *= Math.exp(-dt * 3.0);
    if (state.cloudFlash < 0.001) state.cloudFlash = 0;
  }

  /* ------------------------------ input ---------------------------------- */
  function bindEvents() {
    dom.btnStart.addEventListener('click', () => startMission(false));
    dom.btnLaunch.addEventListener('click', () => startMission(false));
    dom.btnSkip.addEventListener('click', skipMission);
    dom.btnReplay.addEventListener('click', restartMission);
    dom.btnAgain.addEventListener('click', restartMission);
    dom.btnLook.addEventListener('click', leaveCompleteOverlay);
    dom.btnSound.addEventListener('click', toggleSound);

    for (const btn of viewButtons) {
      btn.addEventListener('click', () => setViewMode(btn.dataset.mode, false));
    }

    const canvas = dom.canvas;
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    addEventListener('resize', onResize, { passive: true });
    addEventListener('orientationchange', onResize, { passive: true });
    addEventListener('keydown', onKeyDown);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) clock.getDelta();
    });

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      showToast('渲染上下文中断', '正在等待浏览器恢复 WebGL', 5000);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      showToast('正在恢复场景', '请稍候…', 5000);
      setTimeout(() => location.reload(), 500);
    });

    APP.startMission = startMission;
    APP.setCameraMode = setViewMode;
    APP.updateCamera = updateCamera;
    APP.debugJump = debugJump;
    APP.finishMission = finishMission;
    window.SKYHOOK.diag = () => ({
      fps: Math.round(currentFps),
      mode: state.mode,
      progress: Number(state.progress.toFixed(4)),
      height: Number(state.height.toFixed(1)),
      altitudeKm: Number((state.progress * 400).toFixed(2)),
      camMode: state.camMode,
      fov: Number(camera.fov.toFixed(1)),
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      pixelRatio: renderer.getPixelRatio(),
      errors: APP.errors.slice()
    });
  }

  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (dom.canvas.setPointerCapture) {
      try { dom.canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      state.drag = true;
      state.lastInteract = state.time;
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
      dom.canvas.classList.add('dragging');
    } else if (pointers.size === 2) {
      state.drag = false;
      pinching = true;
      const pts = Array.from(pointers.values());
      pinchStart = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size >= 2) {
      const pts = Array.from(pointers.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (pinching && pinchStart > 0 && dist > 0) {
        state.zoom = clamp(state.zoom * (pinchStart / dist), 0.62, 1.7);
        state.lastInteract = state.time;
      }
      pinchStart = dist;
      return;
    }

    if (!state.drag) return;
    const dx = e.clientX - lastPointerX;
    const dy = e.clientY - lastPointerY;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    if (dx === 0 && dy === 0) return;
    const sens = isTouch ? 0.0072 : 0.0048;
    state.yaw -= dx * sens;
    state.pitch = clamp(state.pitch + dy * sens * 0.88, -1.15, 1.2);
    state.lastInteract = state.time;
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      state.drag = false;
      pinching = false;
      pinchStart = 0;
      dom.canvas.classList.remove('dragging');
    } else if (pointers.size === 1) {
      pinching = false;
      pinchStart = 0;
      const pt = Array.from(pointers.values())[0];
      state.drag = true;
      lastPointerX = pt.x;
      lastPointerY = pt.y;
    }
  }

  function onWheel(e) {
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    state.zoom = clamp(state.zoom * Math.exp(delta * 0.00085), 0.62, 1.7);
    state.lastInteract = state.time;
  }

  function onKeyDown(e) {
    if (e.repeat) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (state.mode === 'idle') startMission(false);
      else if (state.mode === 'complete') restartMission();
      // during flight Space does nothing on purpose: the hint promises "启动", not "跳过"
      return;
    }
    if (e.key === '1') setViewMode('chase', false);
    else if (e.key === '2') setViewMode('porthole', false);
    else if (e.key === '3') setViewMode('wide', false);
    else if (e.key === 'm' || e.key === 'M') toggleSound();
    else if (e.key === 'r' || e.key === 'R') restartMission();
    else if (e.key === 'ArrowLeft') { state.yaw += 0.06; state.lastInteract = state.time; }
    else if (e.key === 'ArrowRight') { state.yaw -= 0.06; state.lastInteract = state.time; }
    else if (e.key === 'ArrowUp') { state.pitch = clamp(state.pitch + 0.05, -1.15, 1.2); state.lastInteract = state.time; }
    else if (e.key === 'ArrowDown') { state.pitch = clamp(state.pitch - 0.05, -1.15, 1.2); state.lastInteract = state.time; }
  }

  function toggleSound() {
    if (!engineAudio) return;
    state.soundOn = !state.soundOn;
    engineAudio.init();
    engineAudio.setMuted(!state.soundOn);
    dom.btnSound.classList.toggle('off', !state.soundOn);
    dom.btnSound.setAttribute('aria-pressed', state.soundOn ? 'true' : 'false');
    showToast(state.soundOn ? '音效开启 / SOUND ON' : '音效静音 / MUTED', state.soundOn ? '环境声与引擎声' : '按 M 恢复声音', 1800);
  }

  function onResize() {
    if (!renderer || !camera) return;
    const w = Math.max(1, innerWidth);
    const h = Math.max(1, innerHeight);
    const dprCap = isSmall() ? 1.5 : 1.8;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, dprCap));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (postFX) postFX.resize();
  }

  function updateAdaptive(dt) {
    frameCount++;
    fpsTime += dt;
    if (fpsTime < 1) return;
    currentFps = frameCount / fpsTime;
    frameCount = 0;
    fpsTime = 0;
    if (state.time > 6 && !degraded) {
      if (currentFps < 38) lowFpsStreak++;
      else lowFpsStreak = 0;
      if (lowFpsStreak >= 2 && qualityDrops < 1 && renderer.getPixelRatio() > 1.01) {
        qualityDrops++;
        degraded = true;
        renderer.setPixelRatio(1);
        renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight), false);
        postFX.resize();
      }
    }
  }

  /* ------------------------------ debug ---------------------------------- */
  function debugJump(p) {
    if (!state.ready || !world) return;
    p = clamp(p, 0, 1);
    clearCompleteTimer();
    lookMode = false;
    started = true;
    milestones.clear();
    state.freeze = true;
    state.progress = p;
    state.height = START_Y + (TOP - START_Y) * p;
    state.elapsed = p >= 1 ? TOTAL_TIME : IGNITION + DURATION * invSmootherstep(p);
    state.mode = p >= 1 ? 'complete' : 'running';
    state.phase = p >= 1 ? 6 : phaseFor(p);
    lastPhase = -1;
    state.completeShown = false;
    state.cloudFlash = 0;

    dom.intro.classList.add('hidden');
    document.body.classList.remove('intro-open');
    dom.complete.classList.remove('show');
    document.body.classList.add('running');
    if (p >= 1) document.body.classList.remove('running');

    if (state.camMode === 'porthole' && p >= 1) setViewMode('chase', true);
    const base = VIEW_DEFAULTS[state.camMode] || VIEW_DEFAULTS.chase;
    state.yaw = base.yaw;
    state.pitch = base.pitch;
    state.zoom = 1;
    state.lastInteract = state.time;

    world.update(0.016, state.elapsed, state.progress, state.height, state.time);
    updateCamera(0, true);
    updatePhase();
    renderHud(true);

    if (p >= 1 && /(?:[#?&])card=1/.test(location.hash + location.search)) {
      if (dom.completeTime) dom.completeTime.textContent = fmtTime(Math.round(TOTAL_TIME));
      dom.complete.classList.add('show');
      state.completeShown = true;
    }
  }

  /* ------------------------------ go ------------------------------------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      boot();
      setTimeout(() => bindEvents(), 150);
    });
  } else {
    boot();
    setTimeout(() => bindEvents(), 150);
  }
})();
