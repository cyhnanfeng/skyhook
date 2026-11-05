/* ==========================================================================
   SKYHOOK · 天穹电梯 — core, post FX, procedural audio
   Single-file / offline / no external assets
   ========================================================================== */
(function () {
  'use strict';

  const TOP = 930;
  const BASE_Y = 2.6;
  const START_Y = 10;
  const DURATION = 72;          // seconds of actual ascent
  const IGNITION = 2.6;         // hold-down / ignition seconds
  const TOTAL_TIME = DURATION + IGNITION;
  const MAX_ALT_M = 400000;

  const state = {
    ready: false,
    mode: 'idle',               // idle | running | complete
    time: 0,
    elapsed: 0,
    progress: 0,
    height: START_Y,
    speed: 0,
    tension: 74,
    phase: -1,
    camMode: 'chase',
    yaw: 0,
    pitch: 0,
    zoom: 1,
    drag: false,
    lastInteract: -99,
    soundOn: true,
    freeze: false,
    completeShown: false,
    cloudFlash: 0,
    stationFlash: false
  };

  const dom = {};
  const isTouch = matchMedia('(hover: none)').matches;
  const isSmall = () => innerWidth <= 860;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let renderer = null;
  let scene = null;
  let camera = null;
  let postFX = null;
  let engineAudio = null;
  let world = null;
  let clock = null;
  let booted = false;
  const errors = [];
  const clockStart = performance.now();

  /* ----------------------------- math / utils ----------------------------- */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a || 1e-6), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const smootherstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a || 1e-6), 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
  };
  const invSmootherstep = (x) => {
    // numeric inverse is plenty for skip / debug
    let lo = 0, hi = 1;
    const target = clamp(x, 0, 1);
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) * 0.5;
      const v = mid * mid * mid * (mid * (mid * 6 - 15) + 10);
      if (v < target) lo = mid; else hi = mid;
    }
    return (lo + hi) * 0.5;
  };
  const damp = (current, target, lambda, dt) =>
    lerp(current, target, 1 - Math.exp(-lambda * Math.max(dt, 1e-4)));
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
  const fmtTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${pad2(m)}:${pad2(sec)}`;
  };

  function col(hex) {
    return new THREE.Color(hex).convertSRGBToLinear();
  }

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash2(x, y) {
    const h = Math.sin(x * 127.1 + y * 311.7 + 47.13) * 43758.5453123;
    return h - Math.floor(h);
  }
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi);
    const b = hash2(xi + 1, yi);
    const c = hash2(xi, yi + 1);
    const d = hash2(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
  function fbm2(x, y, oct = 4, lac = 2.02, gain = 0.5) {
    let f = 0, amp = 0.5, sum = 0;
    for (let i = 0; i < oct; i++) {
      f += vnoise(x, y) * amp;
      sum += amp;
      x = x * lac + 13.7;
      y = y * lac - 9.3;
      amp *= gain;
    }
    return f / sum;
  }

  function measure() {
    return {
      w: Math.max(1, innerWidth),
      h: Math.max(1, innerHeight)
    };
  }

  /* ----------------------------- error capture ---------------------------- */
  function recordError(message) {
    errors.push(String(message));
    if (errors.length > 30) errors.shift();
    const el = document.getElementById('loaderStatus');
    if (el) el.textContent = '场景初始化遇到问题：' + message;
    console.error('[SKYHOOK]', message);
  }
  addEventListener('error', (e) => recordError(e.message || e.error || 'script error'));
  addEventListener('unhandledrejection', (e) => recordError(e.reason || 'promise rejection'));

  /* =============================== POST FX ================================= */
  class PostFX {
    constructor(r) {
      this.renderer = r;
      this.width = 1;
      this.height = 1;
      this.sceneRT = null;
      this.brightRT = null;
      this.levels = [];
      this.quadScene = new THREE.Scene();
      this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
      this.quad.frustumCulled = false;
      this.quadScene.add(this.quad);

      this.brightMat = new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: null },
          uThreshold: { value: 0.68 },
          uKnee: { value: 0.28 }
        },
        vertexShader: FULL_VS,
        fragmentShader: `
          precision highp float;
          varying vec2 vUv;
          uniform sampler2D tDiffuse;
          uniform float uThreshold;
          uniform float uKnee;
          void main(){
            vec3 c = texture2D(tDiffuse, vUv).rgb;
            float br = max(c.r, max(c.g, c.b));
            float knee = max(uKnee, 0.0001);
            float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
            soft = soft * soft / (4.0 * knee + 0.0001);
            float contrib = max(soft, br - uThreshold) / max(br, 0.0001);
            gl_FragColor = vec4(c * contrib, 1.0);
          }
        `,
        depthTest: false,
        depthWrite: false
      });

      this.blurMat = new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: null },
          uTexel: { value: new THREE.Vector2(1 / 512, 1 / 512) }
        },
        vertexShader: FULL_VS,
        fragmentShader: `
          precision highp float;
          varying vec2 vUv;
          uniform sampler2D tDiffuse;
          uniform vec2 uTexel;
          void main(){
            vec3 c = texture2D(tDiffuse, vUv).rgb * 0.227027;
            c += texture2D(tDiffuse, vUv + uTexel * 1.384615).rgb * 0.316216;
            c += texture2D(tDiffuse, vUv - uTexel * 1.384615).rgb * 0.316216;
            c += texture2D(tDiffuse, vUv + uTexel * 3.230769).rgb * 0.070270;
            c += texture2D(tDiffuse, vUv - uTexel * 3.230769).rgb * 0.070270;
            gl_FragColor = vec4(c, 1.0);
          }
        `,
        depthTest: false,
        depthWrite: false
      });

      this.finalMat = new THREE.ShaderMaterial({
        uniforms: {
          tScene: { value: null },
          tB0: { value: null },
          tB1: { value: null },
          tB2: { value: null },
          tB3: { value: null },
          uBloom: { value: 0.80 },
          uExposure: { value: 1.12 },
          uTime: { value: 0 },
          uResolution: { value: new THREE.Vector2(1, 1) }
        },
        vertexShader: FULL_VS,
        fragmentShader: `
          precision highp float;
          varying vec2 vUv;
          uniform sampler2D tScene;
          uniform sampler2D tB0;
          uniform sampler2D tB1;
          uniform sampler2D tB2;
          uniform sampler2D tB3;
          uniform float uBloom;
          uniform float uExposure;
          uniform float uTime;
          uniform vec2 uResolution;

          vec3 aces(vec3 x){
            return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
          }
          float hash(vec2 p){
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
          }

          void main(){
            vec2 uv = vUv;
            vec2 d = uv - 0.5;
            float r2 = dot(d, d);

            // very subtle chromatic split toward the edges
            vec2 ca = d * (0.0011 + r2 * 0.0022);
            vec3 base;
            base.r = texture2D(tScene, uv + ca).r;
            base.g = texture2D(tScene, uv).g;
            base.b = texture2D(tScene, uv - ca).b;

            vec3 bloom =
              texture2D(tB0, uv).rgb * 0.56 +
              texture2D(tB1, uv).rgb * 0.34 +
              texture2D(tB2, uv).rgb * 0.24 +
              texture2D(tB3, uv).rgb * 0.16;

            vec3 c = base + bloom * uBloom;
            c *= uExposure;
            c = aces(c);
            c = pow(c, vec3(0.454545));

            float luma = dot(c, vec3(0.299, 0.587, 0.114));
            c = mix(c, c * vec3(0.90, 0.99, 1.08), smoothstep(0.52, 0.0, luma) * 0.34);
            c = mix(c, c * vec3(1.06, 1.0, 0.94), smoothstep(0.52, 1.0, luma) * 0.32);
            c = mix(vec3(luma), c, 1.08);

            float vig = smoothstep(1.02, 0.28, length(d) * 1.28);
            c *= mix(0.60, 1.0, vig);

            float grain = hash(uv * uResolution + vec2(uTime * 41.0, uTime * 27.0)) - 0.5;
            c += grain * 0.024;
            c += (hash(uv * uResolution * 1.7 - uTime) - 0.5) * 0.008;

            gl_FragColor = vec4(max(c, 0.0), 1.0);
          }
        `,
        depthTest: false,
        depthWrite: false
      });

      this.resize();
    }

    createRT(w, h, msaa, half, depth) {
      const options = {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: half ? THREE.HalfFloatType : THREE.UnsignedByteType,
        depthBuffer: !!depth,
        stencilBuffer: false
      };
      if (msaa) {
        try {
          const rt = new THREE.WebGLMultisampleRenderTarget(w, h, options);
          rt.samples = 4;
          return rt;
        } catch (e) { /* fall through */ }
      }
      return new THREE.WebGLRenderTarget(w, h, options);
    }

    disposeTargets() {
      if (this.sceneRT) this.sceneRT.dispose();
      if (this.brightRT) this.brightRT.dispose();
      this.levels.forEach((l) => { l.a.dispose(); l.b.dispose(); });
      this.sceneRT = null;
      this.brightRT = null;
      this.levels = [];
    }

    resize() {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      const w = Math.max(2, Math.floor(size.x));
      const h = Math.max(2, Math.floor(size.y));
      if (w === this.width && h === this.height) return;
      this.width = w;
      this.height = h;
      this.disposeTargets();

      const half = this.renderer.capabilities.isWebGL2 ||
        !!this.renderer.extensions.get('OES_texture_half_float_linear');
      const gl2 = this.renderer.capabilities.isWebGL2;
      this.sceneRT = this.createRT(w, h, gl2, half, true);
      this.brightRT = this.createRT(Math.max(2, w >> 1), Math.max(2, h >> 1), false, half, false);

      let bw = Math.max(2, w >> 1);
      let bh = Math.max(2, h >> 1);
      const levelCount = isSmall() ? 3 : 4;
      for (let i = 0; i < levelCount; i++) {
        this.levels.push({
          a: this.createRT(bw, bh, false, half, false),
          b: this.createRT(bw, bh, false, half, false),
          w: bw,
          h: bh
        });
        bw = Math.max(2, Math.floor(bw * 0.5));
        bh = Math.max(2, Math.floor(bh * 0.5));
      }
      this.finalMat.uniforms.uResolution.value.set(w, h);
      this.finalMat.uniforms.uBloom.value = isSmall() ? 0.72 : 0.82;
    }

    pass(material, target) {
      this.quad.material = material;
      this.renderer.setRenderTarget(target || null);
      this.renderer.render(this.quadScene, this.quadCam);
    }

    render(scene, camera, time) {
      this.resize();
      const r = this.renderer;

      r.setRenderTarget(this.sceneRT);
      r.clear();
      r.render(scene, camera);

      this.brightMat.uniforms.tDiffuse.value = this.sceneRT.texture;
      this.pass(this.brightMat, this.brightRT);

      let input = this.brightRT.texture;
      for (let i = 0; i < this.levels.length; i++) {
        const lv = this.levels[i];
        this.blurMat.uniforms.tDiffuse.value = input;
        this.blurMat.uniforms.uTexel.value.set(1 / lv.w, 0);
        this.pass(this.blurMat, lv.a);

        this.blurMat.uniforms.tDiffuse.value = lv.a.texture;
        this.blurMat.uniforms.uTexel.value.set(0, 1 / lv.h);
        this.pass(this.blurMat, lv.b);
        input = lv.b.texture;
      }

      const u = this.finalMat.uniforms;
      u.tScene.value = this.sceneRT.texture;
      u.tB0.value = this.levels[0] ? this.levels[0].b.texture : null;
      u.tB1.value = this.levels[1] ? this.levels[1].b.texture : (this.levels[0] ? this.levels[0].b.texture : null);
      u.tB2.value = this.levels[2] ? this.levels[2].b.texture : u.tB1.value;
      u.tB3.value = this.levels[3] ? this.levels[3].b.texture : u.tB2.value;
      u.uTime.value = time;
      this.pass(this.finalMat, null);
      r.setRenderTarget(null);
    }
  }

  const FULL_VS = `
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `;

  /* ============================== AUDIO =================================== */
  class EngineAudio {
    constructor() {
      this.ctx = null;
      this.ready = false;
      this.muted = false;
      this.nodes = {};
      this.lastUpdate = -1;
      this.flight = 0;
    }

    init() {
      if (this.ready) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return true;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try {
        const ctx = this.ctx = new AC();
        const master = this.master = ctx.createGain();
        master.gain.value = 0;
        const comp = this.comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.knee.value = 22;
        comp.ratio.value = 3.2;
        comp.attack.value = 0.02;
        comp.release.value = 0.3;
        master.connect(comp);
        comp.connect(ctx.destination);

        const reverb = this.reverb = ctx.createConvolver();
        reverb.buffer = this._impulse(3.2, 2.7);
        const wet = this.wet = ctx.createGain();
        wet.gain.value = 0.45;
        reverb.connect(wet);
        wet.connect(master);
        this.reverbSend = ctx.createGain();
        this.reverbSend.gain.value = 0.34;
        this.reverbSend.connect(reverb);

        this.noiseBuf = this._noise(5.0);
        this._buildPad();
        this._buildWind();
        this.ready = true;
        master.gain.setTargetAtTime(this.muted ? 0 : 0.78, ctx.currentTime, 0.8);
        return true;
      } catch (err) {
        recordError('audio unavailable: ' + err.message);
        return false;
      }
    }

    _noise(seconds) {
      const ctx = this.ctx;
      const len = Math.floor(ctx.sampleRate * seconds);
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let last = 0;
        for (let i = 0; i < len; i++) {
          const white = Math.random() * 2 - 1;
          last = last * 0.86 + white * 0.14;
          d[i] = last * 2.4;
        }
      }
      return buf;
    }

    _impulse(seconds, decay) {
      const ctx = this.ctx;
      const len = Math.floor(ctx.sampleRate * seconds);
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          const t = i / len;
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (1 - t * 0.3);
        }
      }
      return buf;
    }

    _buildPad() {
      const ctx = this.ctx;
      const padGain = this.padGain = ctx.createGain();
      padGain.gain.value = 0.0;
      const filter = this.padFilter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 360;
      filter.Q.value = 0.4;
      padGain.connect(filter);
      filter.connect(this.master);
      const send = ctx.createGain();
      send.gain.value = 0.28;
      filter.connect(send);
      send.connect(this.reverbSend);

      const freqs = [55, 82.4069, 110, 164.8138, 220];
      const types = ['sine', 'triangle', 'sine', 'triangle', 'sine'];
      const gains = [0.11, 0.055, 0.07, 0.032, 0.018];
      this.padOscs = [];
      freqs.forEach((f, i) => {
        const osc = ctx.createOscillator();
        osc.type = types[i];
        osc.frequency.value = f;
        osc.detune.value = (i % 2 ? 1 : -1) * (2 + i * 1.7);
        const g = ctx.createGain();
        g.gain.value = gains[i];
        osc.connect(g);
        g.connect(padGain);
        osc.start();
        this.padOscs.push(osc);
      });

      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.045;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 130;
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      lfo.start();

      const lfo2 = ctx.createOscillator();
      lfo2.frequency.value = 0.021;
      const lfo2Gain = ctx.createGain();
      lfo2Gain.gain.value = 0.018;
      lfo2.connect(lfo2Gain);
      lfo2Gain.connect(padGain.gain);
      lfo2.start();
    }

    _buildWind() {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const bp = this.windFilter = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 420;
      bp.Q.value = 0.55;
      const g = this.windGain = ctx.createGain();
      g.gain.value = 0.0;
      src.connect(bp);
      bp.connect(g);
      g.connect(this.master);
      const send = ctx.createGain();
      send.gain.value = 0.16;
      g.connect(send);
      send.connect(this.reverbSend);
      src.start();

      // deep cabin hum
      const hum = ctx.createOscillator();
      hum.type = 'sawtooth';
      hum.frequency.value = 47;
      const humFilter = ctx.createBiquadFilter();
      humFilter.type = 'lowpass';
      humFilter.frequency.value = 150;
      const humGain = this.humGain = ctx.createGain();
      humGain.gain.value = 0.0;
      hum.connect(humFilter);
      humFilter.connect(humGain);
      humGain.connect(this.master);
      hum.start();

      const hum2 = ctx.createOscillator();
      hum2.type = 'sine';
      hum2.frequency.value = 94;
      const hum2Gain = this.hum2Gain = ctx.createGain();
      hum2Gain.gain.value = 0.0;
      hum2.connect(hum2Gain);
      hum2Gain.connect(this.master);
      hum2.start();
    }

    _tone(freq, duration, type, level, delay = 0) {
      if (!this.ready) return;
      const ctx = this.ctx;
      const t0 = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.connect(g);
      g.connect(this.master);
      const send = ctx.createGain();
      send.gain.value = 0.55;
      g.connect(send);
      send.connect(this.reverbSend);
      osc.start(t0);
      osc.stop(t0 + duration + 0.05);
    }

    _boom() {
      if (!this.ready) return;
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(320, ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 2.8);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.42, ctx.currentTime + 0.12);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 3.4);
      src.connect(filter);
      filter.connect(g);
      g.connect(this.master);
      src.start();
      src.stop(ctx.currentTime + 3.6);
    }

    startFlight() {
      if (!this.init()) return;
      this.flight = 1;
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.78, this.ctx.currentTime, 0.6);
      this.padGain.gain.setTargetAtTime(0.75, this.ctx.currentTime, 1.2);
      this._boom();
      this._tone(110, 2.4, 'sine', 0.10, 0.02);
      this._tone(164.8, 2.8, 'sine', 0.06, 0.08);
      this._tone(329.6, 2.0, 'triangle', 0.025, 0.3);
    }

    update(progress, speed, mode) {
      if (!this.ready) return;
      const now = this.ctx.currentTime;
      if (now - this.lastUpdate < 0.08) return;
      this.lastUpdate = now;
      const moving = mode === 'running';
      // speed arrives in km/h up to ~1050: keep the noise bed audible but never dominant
      const wind = moving ? 0.030 + Math.min(speed, 1100) * 0.00012 : 0.006;
      this.windGain.gain.setTargetAtTime(wind, now, 0.35);
      this.windFilter.frequency.setTargetAtTime(240 + Math.min(speed, 1100) * 6 + progress * 700, now, 0.5);
      this.padFilter.frequency.setTargetAtTime(260 + progress * 900 + (moving ? 160 : 0), now, 0.8);
      this.humGain.gain.setTargetAtTime(moving ? 0.020 + Math.min(speed, 1100) * 0.00004 : 0.006, now, 0.5);
      this.hum2Gain.gain.setTargetAtTime(moving ? 0.010 : 0.003, now, 0.6);
    }

    phaseCue(index) {
      if (!this.ready) return;
      const sets = [
        [261.63, 392.0, 523.25],
        [220.0, 329.63, 440.0],
        [196.0, 293.66, 392.0],
        [174.61, 261.63, 349.23],
        [146.83, 220.0, 293.66],
        [130.81, 196.0, 329.63],
        [110.0, 164.81, 261.63]
      ];
      const notes = sets[Math.max(0, Math.min(sets.length - 1, index))];
      notes.forEach((f, i) => this._tone(f, 3.6, i === 0 ? 'sine' : 'triangle', 0.036 - i * 0.006, i * 0.13));
    }

    complete() {
      if (!this.ready) return;
      const notes = [130.81, 196.0, 261.63, 329.63, 392.0, 523.25];
      notes.forEach((f, i) => this._tone(f, 5.5, i % 2 ? 'triangle' : 'sine', 0.045 - i * 0.004, i * 0.18));
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.72, this.ctx.currentTime, 2.0);
    }

    setMuted(muted) {
      this.muted = muted;
      if (!this.ready) return;
      this.master.gain.setTargetAtTime(muted ? 0 : 0.78, this.ctx.currentTime, 0.25);
    }

    toggle() {
      this.setMuted(!this.muted);
      if (!this.muted) this.init();
      return this.muted;
    }
  }

  /* ----------------------------- exposure -------------------------------- */
  const APP = {
    THREE,
    state,
    dom,
    errors,
    TOP,
    BASE_Y,
    START_Y,
    DURATION,
    IGNITION,
    TOTAL_TIME,
    MAX_ALT_M,
    isTouch,
    isSmall,
    reducedMotion,
    clamp,
    lerp,
    smoothstep,
    smootherstep,
    invSmootherstep,
    damp,
    pad2,
    fmtInt,
    fmtTime,
    col,
    mulberry32,
    hash2,
    vnoise,
    fbm2,
    PostFX,
    EngineAudio,
    recordError,
    renderer: null,
    scene: null,
    camera: null,
    postFX: null,
    engineAudio: null,
    world: null,
    clock: null,
    setCameraMode: null,
    startMission: null,
    updateCamera: null,
    debugJump: null
  };
  window.SKYHOOK_APP = APP;

  window.SKYHOOK = {
    state,
    errors,
    get ready() { return state.ready; },
    jump(p) {
      if (APP.debugJump) APP.debugJump(p);
    },
    release() { state.freeze = false; },
    setCamera(mode) { if (APP.setCameraMode) APP.setCameraMode(mode, true); },
    start() { if (APP.startMission) APP.startMission(); }
  };
})();
