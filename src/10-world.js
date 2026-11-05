/* ==========================================================================
   SKYHOOK · world — desert, composite tether, glass cabin, orbital ring
   All geometry, textures and materials are generated at runtime.
   ========================================================================== */
(function () {
  'use strict';

  const APP = window.SKYHOOK_APP;
  const THREE = APP.THREE;
  const state = APP.state;
  const col = APP.col;
  const clamp = APP.clamp;
  const lerp = APP.lerp;
  const smoothstep = APP.smoothstep;
  const mulberry32 = APP.mulberry32;
  const fbm2 = APP.fbm2;
  const isSmall = APP.isSmall;

  const R = 24000;              // implied planetary radius for the desert curvature
  const CLOUD_LOW = 180;
  const TETHER_TOP = APP.TOP;

  let rng = mulberry32(20261030);
  const rand = () => rng();

  /* ---------------------------- texture helpers --------------------------- */
  function canvas2d(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    return { c, ctx: c.getContext('2d') };
  }

  function toTexture(canvas, srgb) {
    const t = new THREE.CanvasTexture(canvas);
    t.encoding = srgb === false ? THREE.LinearEncoding : THREE.sRGBEncoding;
    t.needsUpdate = true;
    return t;
  }

  function radialTexture(size, inner, outer, stops) {
    const { c, ctx } = canvas2d(size);
    const g = ctx.createRadialGradient(size / 2, size / 2, inner, size / 2, size / 2, outer);
    (stops || [[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,.45)'], [1, 'rgba(255,255,255,0)']])
      .forEach(([p, color]) => g.addColorStop(p, color));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = toTexture(c);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  }

  function cloudTexture(seed) {
    const r = mulberry32(seed);
    const size = 256;
    const { c, ctx } = canvas2d(size);
    ctx.clearRect(0, 0, size, size);

    // a soft, layered cumulus puff
    for (let i = 0; i < 34; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.pow(r(), 0.62) * 74;
      const x = size / 2 + Math.cos(a) * d;
      const y = size / 2 + Math.sin(a) * d * 0.55 + 8;
      const rad = 18 + r() * 54;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      const alpha = 0.045 + r() * 0.10;
      g.addColorStop(0, `rgba(255,255,255,${alpha})`);
      g.addColorStop(0.55, `rgba(248,252,255,${alpha * 0.55})`);
      g.addColorStop(1, 'rgba(220,240,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }

    // crisp upper highlight / soft underbelly
    const hl = ctx.createLinearGradient(0, 24, 0, size * 0.7);
    hl.addColorStop(0, 'rgba(255,252,246,.23)');
    hl.addColorStop(0.45, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl;
    ctx.fillRect(0, 0, size, size);

    ctx.globalCompositeOperation = 'destination-in';
    const mask = ctx.createRadialGradient(size / 2, size / 2, size * 0.16, size / 2, size / 2, size * 0.49);
    mask.addColorStop(0, 'rgba(0,0,0,1)');
    mask.addColorStop(0.72, 'rgba(0,0,0,.95)');
    mask.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = mask;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'source-over';

    // fbm speckle for a less synthetic edge
    const img = ctx.getImageData(0, 0, size, size);
    for (let y = 0; y < size; y += 2) {
      for (let x = 0; x < size; x += 2) {
        const i = (y * size + x) * 4 + 3;
        const n = 0.82 + fbm2(x * 0.05, y * 0.05, 3) * 0.36;
        img.data[i] = Math.min(255, img.data[i] * n);
      }
    }
    ctx.putImageData(img, 0, 0);

    const tex = toTexture(c);
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    return tex;
  }

  function starTexture() {
    const size = 64;
    const { c, ctx } = canvas2d(size);
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 31);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.16, 'rgba(255,255,255,.98)');
    g.addColorStop(0.35, 'rgba(190,225,255,.42)');
    g.addColorStop(1, 'rgba(150,200,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = toTexture(c);
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }

  function padTexture() {
    const size = 1024;
    const { c, ctx } = canvas2d(size);
    ctx.clearRect(0, 0, size, size);
    const cx = size / 2, cy = size / 2;
    ctx.strokeStyle = 'rgba(235,214,178,.52)';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(cx, cy, 440, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, 402, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 232, 0, Math.PI * 2); ctx.stroke();

    ctx.save();
    ctx.translate(cx, cy);
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const long = i % 4 === 0;
      ctx.strokeStyle = long ? 'rgba(255,224,180,.7)' : 'rgba(225,210,185,.3)';
      ctx.lineWidth = long ? 4 : 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (long ? 394 : 408), Math.sin(a) * (long ? 394 : 408));
      ctx.lineTo(Math.cos(a) * 438, Math.sin(a) * 438);
      ctx.stroke();
    }
    ctx.restore();

    // hazard arcs
    for (let i = 0; i < 6; i++) {
      ctx.strokeStyle = i % 2 ? 'rgba(255,170,80,.9)' : 'rgba(22,28,30,.85)';
      ctx.lineWidth = 22;
      const a0 = (i / 6) * Math.PI * 2 + 0.06;
      const a1 = ((i + 1) / 6) * Math.PI * 2 - 0.06;
      ctx.beginPath();
      ctx.arc(cx, cy, 330, a0, a1);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(240,236,222,.92)';
    ctx.textAlign = 'center';
    ctx.font = '600 52px "Arial Narrow", Arial, sans-serif';
    ctx.fillText('SH-01', cx, cy - 40);
    ctx.font = '400 22px Arial, sans-serif';
    ctx.letterSpacing = '7px';
    ctx.fillStyle = 'rgba(240,236,222,.62)';
    ctx.fillText('TIANYONG  /  SKYHOOK', cx, cy + 6);
    ctx.font = '300 17px Arial, sans-serif';
    ctx.fillStyle = 'rgba(240,236,222,.42)';
    ctx.fillText('ORBITAL LIFT COMPLEX', cx, cy + 38);
    ctx.fillText('LAT 24° 41\' N   LON 118° 09\' E', cx, cy + 66);

    ctx.strokeStyle = 'rgba(240,236,222,.28)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy - 160); ctx.lineTo(cx, cy - 84); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy + 84); ctx.lineTo(cx, cy + 160); ctx.stroke();

    // subtle wear
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(20,16,12,${0.02 + Math.random() * 0.05})`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 6, 1 + Math.random() * 3);
    }

    const tex = toTexture(c);
    tex.anisotropy = 4;
    return tex;
  }

  function earthTexture() {
    const W = isSmall() ? 512 : 1024;
    const H = W / 2;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(W, H);
    const data = img.data;

    const deep = [6, 22, 48];
    const ocean = [10, 52, 92];
    const shelf = [36, 126, 150];
    const lowland = [55, 92, 58];
    const highland = [132, 112, 76];
    const sand = [176, 148, 103];
    const ice = [226, 235, 238];

    for (let y = 0; y < H; y++) {
      const v = y / (H - 1);
      const lat = (v - 0.5) * Math.PI;
      const absLat = Math.abs(lat);
      for (let x = 0; x < W; x++) {
        const warp = fbm2(x * 0.013 + 11.3, y * 0.017 - 4.1, 3) - 0.5;
        let n = fbm2(x * 0.0058 + 3.4 + warp * 0.8, y * 0.0076 - 1.9 + warp * 0.55, 5);
        n = n * 0.78 + fbm2(x * 0.022 + 8.2, y * 0.026 + 2.7, 3) * 0.22;
        const shelfN = smoothstep(0.475, 0.535, n);
        const landN = smoothstep(0.535, 0.585, n);
        const i = (y * W + x) * 4;
        let r, g, b;

        if (landN > 0.001) {
          const alt = smoothstep(0.56, 0.72, n);
          const dry = clamp((fbm2(x * 0.011 - 8.7, y * 0.015 + 5.1, 3) - 0.42) * 2.1, 0, 1);
          r = lerp(lowland[0], highland[0], alt);
          g = lerp(lowland[1], highland[1], alt);
          b = lerp(lowland[2], highland[2], alt);
          r = lerp(r, sand[0], dry * 0.72);
          g = lerp(g, sand[1], dry * 0.72);
          b = lerp(b, sand[2], dry * 0.72);
          if (absLat > 0.92) {
            const polar = smoothstep(0.92, 1.22, absLat);
            r = lerp(r, ice[0], polar);
            g = lerp(g, ice[1], polar);
            b = lerp(b, ice[2], polar);
          }
        } else {
          const shallow = smoothstep(0.08, 0.46, shelfN);
          r = lerp(ocean[0], shelf[0], shallow);
          g = lerp(ocean[1], shelf[1], shallow);
          b = lerp(ocean[2], shelf[2], shallow);
          const dark = smoothstep(0.0, -0.45, lat) * 0.16;
          r = lerp(r, deep[0], dark);
          g = lerp(g, deep[1], dark);
          b = lerp(b, deep[2], dark);
        }

        data[i] = r; data[i + 1] = g; data[i + 2] = b;
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // thin sunlit haze over the ocean for a little depth
    const haze = ctx.createLinearGradient(0, 0, 0, H);
    haze.addColorStop(0, 'rgba(190,225,240,.07)');
    haze.addColorStop(0.34, 'rgba(160,220,255,.02)');
    haze.addColorStop(0.62, 'rgba(255,212,170,.035)');
    haze.addColorStop(1, 'rgba(255,255,255,.07)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, W, H);

    const tex = toTexture(c);
    tex.anisotropy = 8;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    return tex;
  }

  function earthCloudTexture() {
    const W = isSmall() ? 512 : 1024;
    const H = W / 2;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(W, H);
    const data = img.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = y / (H - 1);
        const band = Math.sin(v * Math.PI * 6.0 + fbm2(x * 0.004, y * 0.012, 3) * 3.2) * 0.08;
        let n = fbm2(x * 0.009 + 6.2 + band, y * 0.015 - 2.3, 5);
        n = n * 0.72 + fbm2(x * 0.031 + 1.7, y * 0.038 + 8.1, 3) * 0.28;
        const alpha = smoothstep(0.53, 0.74, n) * 0.82;
        const i = (y * W + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 255;
        data[i + 3] = alpha * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = toTexture(c);
    tex.anisotropy = 4;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    return tex;
  }

  function bandTexture() {
    const { c, ctx } = canvas2d(256);
    ctx.fillStyle = '#182b33';
    ctx.fillRect(0, 0, 256, 256);
    const g = ctx.createLinearGradient(0, 0, 256, 0);
    g.addColorStop(0, 'rgba(0,0,0,.6)');
    g.addColorStop(0.18, 'rgba(110,150,164,.10)');
    g.addColorStop(0.45, 'rgba(170,220,235,.14)');
    g.addColorStop(0.72, 'rgba(110,150,164,.08)');
    g.addColorStop(1, 'rgba(0,0,0,.62)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    // longitudinal graphite strands
    for (let x = 0; x < 256; x += 4) {
      ctx.fillStyle = x % 8 === 0 ? 'rgba(120,160,175,.10)' : 'rgba(0,0,0,.12)';
      ctx.fillRect(x, 0, 1, 256);
    }
    // fine composite weave + tension ribs
    ctx.strokeStyle = 'rgba(150,210,225,.18)';
    ctx.lineWidth = 1;
    for (let y = 6; y < 256; y += 16) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(256, y + 3);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(0,0,0,.35)';
    for (let y = 12; y < 256; y += 16) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(256, y + 3);
      ctx.stroke();
    }
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = `rgba(190,240,250,${0.03 + Math.random() * 0.09})`;
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1);
    }
    const tex = toTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 22);
    tex.anisotropy = 4;
    return tex;
  }

  /* ---------------------------- environment map --------------------------- */
  function makeEnvironment(renderer) {
    const size = 128;
    const faces = [];
    const sky = ['#173447', '#2d536d', '#533c38', '#2c211c'];
    for (let face = 0; face < 6; face++) {
      const { c, ctx } = canvas2d(size);
      let top, bottom;
      if (face === 2) { top = '#76a8c4'; bottom = '#c9d7d5'; }
      else if (face === 3) { top = '#50382c'; bottom = '#241812'; }
      else { top = sky[face % 3]; bottom = face < 2 ? '#8d6146' : '#3b2b23'; }
      const g = ctx.createLinearGradient(0, 0, 0, size);
      g.addColorStop(0, top);
      g.addColorStop(0.55, face === 2 ? '#9ebdc8' : '#7a604c');
      g.addColorStop(1, bottom);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);

      if (face === 0 || face === 4) {
        const sx = face === 0 ? size * 0.72 : size * 0.2;
        const sg = ctx.createRadialGradient(sx, size * 0.48, 0, sx, size * 0.48, size * 0.38);
        sg.addColorStop(0, 'rgba(255,223,176,.95)');
        sg.addColorStop(0.18, 'rgba(255,183,112,.55)');
        sg.addColorStop(1, 'rgba(255,170,100,0)');
        ctx.fillStyle = sg;
        ctx.fillRect(0, 0, size, size);
      }
      faces.push(c);
    }
    const tex = new THREE.CubeTexture(faces);
    tex.needsUpdate = true;
    tex.encoding = THREE.sRGBEncoding;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    if (renderer) tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    return tex;
  }

  /* ================================ build ================================= */
  function buildWorld() {
    const scene = APP.scene;
    const camera = APP.camera;
    const renderer = APP.renderer;
    rng = mulberry32(20261030);
    scene.environment = makeEnvironment(renderer);
    scene.fog = new THREE.FogExp2(0x8f6f58, 0.00052);

    const root = new THREE.Group();
    root.name = 'SKYHOOK_WORLD';
    scene.add(root);

    /* ----------------------------- lights --------------------------------- */
    const hemi = new THREE.HemisphereLight(0x9dc4dd, 0x5a3d2b, 0.58);
    scene.add(hemi);

    const sunDir = new THREE.Vector3(-0.52, 0.15, -0.84).normalize();
    const sunLight = new THREE.DirectionalLight(0xffc18a, 1.35);
    sunLight.position.copy(sunDir).multiplyScalar(900);
    scene.add(sunLight);

    const rim = new THREE.DirectionalLight(0x5fb6d8, 0.28);
    rim.position.set(520, 220, 420);
    scene.add(rim);

    /* ----------------------------- sky dome -------------------------------- */
    const skyGroup = new THREE.Group();
    skyGroup.name = 'SKY';
    scene.add(skyGroup);

    const skyUniforms = {
      uHigh: { value: 0 },
      uTime: { value: 0 },
      uZenith: { value: col(0x173c58) },
      uHorizon: { value: col(0xd99567) },
      uGround: { value: col(0x2f2018) },
      uSunDir: { value: sunDir.clone() },
      uSunColor: { value: col(0xffbd7d) },
      uSunI: { value: 1.0 }
    };

    const skyMat = new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `
        varying vec3 vDir;
        void main(){
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec3 vDir;
        uniform float uHigh;
        uniform float uTime;
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform vec3 uGround;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uSunI;

        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

        void main(){
          vec3 dir = normalize(vDir);
          float h = dir.y;
          float up = max(h, 0.0);

          vec3 zenith = uZenith;
          vec3 horizon = uHorizon;
          vec3 ground = uGround;

          vec3 sky = mix(horizon, zenith, pow(up, 0.52));
          sky = mix(sky, ground, smoothstep(0.02, -0.30, h));

          // atmospheric rim just above the horizon
          float rim = exp(-abs(h) * (7.0 + uHigh * 2.0));
          sky += vec3(0.10, 0.22, 0.30) * rim * (0.55 + 0.35 * uHigh);

          // warm sunset scattering on the sun side (fades out once the air is gone)
          float sd = max(dot(dir, normalize(uSunDir)), 0.0);
          float low = exp(-max(h, 0.0) * 4.5);
          float scatter = (0.22 + low * 0.55) * (1.0 - uHigh * 0.72);
          sky += uSunColor * pow(sd, 18.0) * scatter * uSunI;
          sky += uSunColor * pow(sd, 280.0) * 0.42 * uSunI * (1.0 - uHigh * 0.55);

          // high-altitude: faint airglow and a colder, deeper sky
          float band = exp(-abs(h - 0.015) * 55.0);
          sky += vec3(0.035, 0.09, 0.11) * band * uHigh;

          // dither to defeat 8-bit banding
          float d = (hash(gl_FragCoord.xy + uTime * 0.3) - 0.5) * 0.012;
          gl_FragColor = vec4(max(sky + d, 0.0), 1.0);
        }
      `
    });

    const sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 32), skyMat);
    sky.renderOrder = -50;
    skyGroup.add(sky);

    const sunGlowTex = radialTexture(256, 0, 128, [
      [0, 'rgba(255,245,220,1)'], [0.08, 'rgba(255,224,172,.98)'],
      [0.22, 'rgba(255,177,104,.42)'], [0.55, 'rgba(255,150,85,.10)'], [1, 'rgba(255,130,70,0)']
    ]);
    const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sunGlowTex, color: 0xffffff, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, fog: false
    }));
    sunSprite.scale.setScalar(760);
    sunSprite.position.copy(sunDir).multiplyScalar(7600);
    skyGroup.add(sunSprite);

    const sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sunGlowTex, color: 0xffb47a, transparent: true, opacity: 0.24,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, fog: false
    }));
    sunHalo.scale.setScalar(2800);
    sunHalo.position.copy(sunDir).multiplyScalar(7700);
    skyGroup.add(sunHalo);

    /* ------------------------------ stars --------------------------------- */
    const starTex = starTexture();
    const starGroup = new THREE.Group();
    scene.add(starGroup);

    function makePoints(count, radius, size, opacity, colorA, colorB, band) {
      const pos = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      const cA = col(colorA);
      const cB = col(colorB);
      const v = new THREE.Vector3();
      const bandN = new THREE.Vector3(0.25, 0.86, -0.44).normalize();
      for (let i = 0; i < count; i++) {
        if (band && Math.random() < 0.78) {
          const a = Math.random() * Math.PI * 2;
          const spread = (Math.random() + Math.random() + Math.random() - 1.5) * 0.28;
          const x = Math.cos(a), z = Math.sin(a);
          v.set(x, spread, z).normalize();
          v.applyAxisAngle(new THREE.Vector3(1, 0, 0), 0.42);
        } else {
          const u = Math.random() * 2 - 1;
          const a = Math.random() * Math.PI * 2;
          const s = Math.sqrt(1 - u * u);
          v.set(Math.cos(a) * s, u, Math.sin(a) * s);
          if (v.y < -0.15 && !band) v.y = -v.y;
        }
        v.multiplyScalar(radius * (0.82 + Math.random() * 0.26));
        pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
        const t = Math.random();
        const c = cA.clone().lerp(cB, t);
        const b = 0.55 + Math.random() * 0.45;
        colors[i * 3] = c.r * b; colors[i * 3 + 1] = c.g * b; colors[i * 3 + 2] = c.b * b;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const mat = new THREE.PointsMaterial({
        size, map: starTex, transparent: true, opacity,
        vertexColors: true, depthWrite: false, depthTest: true,
        blending: THREE.AdditiveBlending, sizeAttenuation: false, fog: false
      });
      const p = new THREE.Points(geo, mat);
      p.frustumCulled = false;
      starGroup.add(p);
      return p;
    }

    const starsFar = makePoints(isSmall() ? 1700 : 3000, 5600, 1.7, 0.0, 0xdfefff, 0xffe4c4, false);
    const starsBright = makePoints(isSmall() ? 130 : 260, 5200, 3.1, 0.0, 0xffffff, 0xbcd8ff, false);
    const milky = makePoints(isSmall() ? 1300 : 2600, 5400, 1.3, 0.0, 0x93b7e8, 0xffd7b0, true);

    /* ---------------------------- cloud deck ------------------------------- */
    const cloudTextures = [cloudTexture(11), cloudTexture(29), cloudTexture(73), cloudTexture(101)];
    const clouds = new THREE.Group();
    clouds.name = 'CLOUDS';
    root.add(clouds);
    const cloudItems = [];
    const cloudMatColor = col(0xfff3e6);

    function addCloud(x, y, z, scale, opacity, variant, horizon) {
      const mat = new THREE.SpriteMaterial({
        map: cloudTextures[variant],
        color: cloudMatColor.clone().multiplyScalar(0.82 + Math.random() * 0.3),
        transparent: true,
        opacity,
        depthWrite: false,
        depthTest: true,
        fog: true,
        rotation: Math.random() * Math.PI * 2
      });
      const s = new THREE.Sprite(mat);
      s.position.set(x, y, z);
      s.scale.set(scale * (0.8 + Math.random() * 0.7), scale * (0.42 + Math.random() * 0.64), 1);
      s.renderOrder = horizon ? 4 : 6;
      clouds.add(s);
      cloudItems.push({ sprite: s, baseOpacity: opacity, baseX: x, drift: (Math.random() - 0.5) * 1.8, phase: Math.random() * 6.28 });
      return s;
    }

    const cloudCount = isSmall() ? 110 : 175;
    for (let i = 0; i < cloudCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const dist = 34 + Math.pow(Math.random(), 0.6) * 430;
      const y = 125 + Math.random() * 100;
      const scale = 55 + Math.random() * 190;
      addCloud(Math.cos(a) * dist, y, Math.sin(a) * dist, scale, 0.55 + Math.random() * 0.35, i % 4, dist > 300);
    }
    for (let i = 0; i < (isSmall() ? 28 : 54); i++) {
      const a = Math.random() * Math.PI * 2;
      const dist = 90 + Math.random() * 620;
      addCloud(Math.cos(a) * dist, 255 + Math.random() * 90, Math.sin(a) * dist, 130 + Math.random() * 280,
        0.18 + Math.random() * 0.22, (i + 2) % 4, true);
    }
    for (let i = 0; i < (isSmall() ? 16 : 28); i++) {
      const a = Math.random() * Math.PI * 2;
      const dist = 30 + Math.random() * 160;
      addCloud(Math.cos(a) * dist, 72 + Math.random() * 55, Math.sin(a) * dist, 32 + Math.random() * 80,
        0.16 + Math.random() * 0.18, (i + 1) % 4, false);
    }

    /* ----------------------------- terrain --------------------------------- */
    const terrainGeo = new THREE.PlaneGeometry(18000, 18000, isSmall() ? 140 : 196, isSmall() ? 140 : 196);
    terrainGeo.rotateX(-Math.PI / 2);

    function terrainHeight(x, z) {
      const r = Math.sqrt(x * x + z * z);
      const flat = smoothstep(38, 145, r);
      const n = fbm2(x * 0.00115 + 4.2, z * 0.00115 - 2.7, 5) - 0.5;
      const ridges = Math.sin(x * 0.0063 + n * 4.3) * Math.sin(z * 0.0048 - n * 2.1);
      const ripples = Math.sin((x + z) * 0.024 + n * 5.0) * 0.85;
      let h = (n * 86 + ridges * 14 + ripples * 2.2) * flat;
      h += 7.5 * flat * smoothstep(120, 700, r);
      h -= (r * r) / (2 * R);
      return h;
    }

    const pos = terrainGeo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cLow = col(0x5b3a28);
    const cMid = col(0x9a6341);
    const cHigh = col(0xd29a68);
    const cCool = col(0x6f5b52);
    const tmpColor = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = terrainHeight(x, z);
      pos.setY(i, y);
      const n = fbm2(x * 0.009, z * 0.009, 3);
      const hN = clamp((y + 25) / 120, 0, 1);
      tmpColor.copy(cLow).lerp(cMid, hN * 0.85 + n * 0.15);
      tmpColor.lerp(cHigh, Math.pow(hN, 2.5) * 0.55);
      if (n > 0.62) tmpColor.lerp(cCool, (n - 0.62) * 0.8);
      const grain = 0.9 + Math.random() * 0.18;
      colors[i * 3] = tmpColor.r * grain;
      colors[i * 3 + 1] = tmpColor.g * grain;
      colors[i * 3 + 2] = tmpColor.b * grain;
    }
    terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    terrainGeo.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.97, metalness: 0.0,
      dithering: true, fog: true
    });
    const terrain = new THREE.Mesh(terrainGeo, terrainMat);
    terrain.receiveShadow = false;
    terrain.renderOrder = 0;
    root.add(terrain);

    // scattered rocks / boulders
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: col(0x5a3a2a), roughness: 0.95, metalness: 0.02, flatShading: true });
    const rockCount = isSmall() ? 90 : 170;
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < rockCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 52 + Math.pow(Math.random(), 0.7) * 780;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const s = 1.2 + Math.pow(Math.random(), 2.4) * 13;
      dummy.position.set(x, terrainHeight(x, z) + s * 0.32, z);
      dummy.rotation.set(Math.random() * 2, Math.random() * 6, Math.random() * 2);
      dummy.scale.set(s * (0.7 + Math.random() * 0.6), s * (0.45 + Math.random() * 0.5), s * (0.7 + Math.random() * 0.6));
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
    }
    rocks.instanceMatrix.needsUpdate = true;
    root.add(rocks);

    // distant mesas
    const mesaMat = new THREE.MeshStandardMaterial({ color: col(0x6d4431), roughness: 0.93, metalness: 0.02, flatShading: true });
    const mesaMatDark = new THREE.MeshStandardMaterial({ color: col(0x4a2f24), roughness: 0.96, metalness: 0.01, flatShading: true });
    const mesas = [];
    for (let i = 0; i < (isSmall() ? 9 : 16); i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 620 + Math.random() * 1900;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const h = 32 + Math.pow(Math.random(), 1.7) * 150;
      const top = 26 + Math.random() * 90;
      const bottom = top * (1.2 + Math.random() * 0.55);
      const mesa = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, h, 6 + Math.floor(Math.random() * 3), 1, false), Math.random() > 0.5 ? mesaMat : mesaMatDark);
      mesa.position.set(x, terrainHeight(x, z) + h * 0.5 - 7, z);
      mesa.rotation.y = Math.random() * Math.PI;
      root.add(mesa);
      mesas.push(mesa);
    }

    /* ------------------------------- earth --------------------------------- */
    const EARTH_R = 12000;
    const earthGroup = new THREE.Group();
    earthGroup.name = 'EARTH';
    earthGroup.position.set(0, -12050, 0);
    earthGroup.rotation.set(0, 0.35, 0);
    root.add(earthGroup);

    const earthMat = new THREE.ShaderMaterial({
      uniforms: {
        uOpacity: { value: 0 },
        uTime: { value: 0 },
        uSunDir: { value: sunDir.clone() }
      },
      transparent: true,
      depthWrite: true,
      fog: false,
      vertexShader: `
        varying vec3 vDir;
        varying vec3 vN;
        varying vec3 vW;
        void main(){
          vDir = normalize(position);
          vN = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vW = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec3 vDir;
        varying vec3 vN;
        varying vec3 vW;
        uniform float uOpacity;
        uniform float uTime;
        uniform vec3 uSunDir;

        float hash(vec3 p){
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float noise(vec3 x){
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
            mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
            f.z);
        }
        float fbm(vec3 p){
          float v = 0.0;
          float a = 0.52;
          for (int i = 0; i < 5; i++){
            v += a * noise(p);
            p = p * 2.03 + vec3(11.7, 3.1, 8.3);
            a *= 0.5;
          }
          return v;
        }

        void main(){
          vec3 p = normalize(vDir);
          // tilt the sampling frame so the visible cap shows mid-latitudes, not the pole
          float ca = 0.5817, sa = 0.8134;   // ~0.95 rad around X
          float cb = 0.8253, sb = 0.5646;   // ~0.60 rad around Y
          vec3 r1 = vec3(p.x, p.y * ca - p.z * sa, p.y * sa + p.z * ca);
          vec3 q = normalize(vec3(r1.x * cb + r1.z * sb, r1.y, -r1.x * sb + r1.z * cb));
          float cont = fbm(q * 26.0 + vec3(3.2, 8.1, -2.7));
          float mid = fbm(q * 70.0 + vec3(1.7, -3.4, 5.2));
          float detail = fbm(q * 180.0 + vec3(-4.1, 2.4, 6.3));
          float hn = cont * 0.55 + mid * 0.30 + detail * 0.15;
          // push more of the visible cap above sea level so the porthole view reads as a planet, not an ocean
          float bias = 0.020 * smoothstep(-0.2, 0.55, dot(normalize(q), normalize(vec3(0.32, 0.86, 0.40))));
          float land = smoothstep(0.492, 0.528, hn + bias);
          float desert = smoothstep(0.42, 0.72, fbm(q * 34.0 + vec3(5.7, -1.9, 4.2)));

          vec3 deep = vec3(0.002, 0.016, 0.058);
          vec3 shallow = vec3(0.010, 0.085, 0.170);
          vec3 ocean = mix(deep, shallow, smoothstep(0.26, 0.66, mid));
          vec3 green = vec3(0.062, 0.132, 0.055);
          vec3 tan = vec3(0.230, 0.176, 0.095);
          vec3 sand = vec3(0.330, 0.262, 0.148);
          vec3 landCol = mix(green, tan, smoothstep(0.28, 0.68, cont));
          landCol = mix(landCol, sand, desert * 0.72);
          landCol = mix(landCol, vec3(0.150, 0.128, 0.098), smoothstep(0.52, 0.78, detail) * 0.6);
          // crisp coastline: a brighter shelf right at the water line
          float shelf = smoothstep(0.446, 0.472, hn) * (1.0 - land);
          vec3 surf = mix(ocean, vec3(0.030, 0.180, 0.250), shelf * 0.38);
          surf = mix(surf, landCol, land);

          // polar ice (keep it off the nadir cap, otherwise the whole view turns white)
          float ice = smoothstep(0.86, 0.97, abs(q.y));
          ice += smoothstep(0.80, 0.93, abs(q.y)) * smoothstep(0.62, 0.86, fbm(q * 6.0)) * 0.45;
          surf = mix(surf, vec3(0.84, 0.90, 0.93), clamp(ice, 0.0, 1.0) * 0.85);

          // Cloud bands (slightly warped by the underlying height)
          vec3 cp = q * 9.5 + vec3(uTime * 0.0045, 0.0, 0.0);
          cp.xz += vec2(cont, detail) * 0.26;
          float cloud = smoothstep(0.735, 0.860, fbm(cp));
          cloud *= 0.65 + 0.35 * smoothstep(0.05, 0.5, fbm(q * 3.1 + 7.1));
          surf = mix(surf, vec3(0.90, 0.94, 0.97), cloud * 0.13);

          // Day/night terminator, with just enough fill to read the night side
          vec3 n = normalize(vN);
          float ndl = dot(n, normalize(uSunDir));
          float day = smoothstep(-0.36, 0.30, ndl);
          surf *= mix(0.14, 1.06, day);
          surf += vec3(0.10, 0.045, 0.014) * pow(1.0 - abs(ndl), 5.0) * 0.5;

          // a soft blue atmospheric rim
          vec3 view = normalize(cameraPosition - vW);
          float rim = pow(1.0 - abs(dot(n, view)), 3.2);
          surf += vec3(0.07, 0.24, 0.52) * rim * 0.34;

          gl_FragColor = vec4(surf, uOpacity);
        }
      `
    });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R, 96, 64), earthMat);
    earthGroup.add(earth);

    const atmoUniforms = { uOpacity: { value: 0 } };
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_R + 420, 64, 44),
      new THREE.ShaderMaterial({
        uniforms: atmoUniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        vertexShader: `
          varying vec3 vNormal;
          varying vec3 vView;
          void main(){
            vNormal = normalize(normalMatrix * normal);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vView = mv.xyz;
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: `
          precision highp float;
          uniform float uOpacity;
          varying vec3 vNormal;
          varying vec3 vView;
          void main(){
            vec3 n = normalize(vNormal);
            vec3 v = normalize(-vView);
            float rim = pow(1.0 - abs(dot(n, v)), 2.6);
            vec3 glow = mix(vec3(0.08, 0.30, 0.72), vec3(0.42, 0.78, 1.0), rim);
            gl_FragColor = vec4(glow, rim * 0.62 * uOpacity);
          }
        `
      })
    );
    // the planet shader carries its own limb glow; a second shell would veil the surface
    atmosphere.visible = false;

    /* --------------------------- launch complex ---------------------------- */
    const pad = new THREE.Group();
    pad.name = 'LAUNCH_COMPLEX';
    root.add(pad);

    const concrete = new THREE.MeshStandardMaterial({ color: col(0x6f6a61), roughness: 0.9, metalness: 0.05, dithering: true });
    const concreteDark = new THREE.MeshStandardMaterial({ color: col(0x3c3d3a), roughness: 0.86, metalness: 0.1 });
    const steel = new THREE.MeshStandardMaterial({ color: col(0x2b363c), roughness: 0.36, metalness: 0.82 });
    const steelDark = new THREE.MeshStandardMaterial({ color: col(0x151d22), roughness: 0.48, metalness: 0.72 });
    const orange = new THREE.MeshStandardMaterial({ color: col(0xc97839), emissive: col(0x3a1405), roughness: 0.55, metalness: 0.3 });
    const emissiveCyan = new THREE.MeshStandardMaterial({ color: col(0x1a3d49), emissive: col(0x2baac8), emissiveIntensity: 1.8, roughness: 0.4, metalness: 0.3 });
    const emissiveAmber = new THREE.MeshStandardMaterial({ color: col(0x51351b), emissive: col(0xff9a3c), emissiveIntensity: 2.2, roughness: 0.4 });
    const emissiveRed = new THREE.MeshStandardMaterial({ color: col(0x3a1110), emissive: col(0xff3b2d), emissiveIntensity: 2.2, roughness: 0.5 });

    // apron + main pad
    const apron = new THREE.Mesh(new THREE.CylinderGeometry(47, 51, 2.2, 64), concrete);
    apron.position.y = 0.7;
    pad.add(apron);

    const padBody = new THREE.Mesh(new THREE.CylinderGeometry(28.5, 31, 2.8, 64), concreteDark);
    padBody.position.y = 2.25;
    pad.add(padBody);

    const padTop = new THREE.Mesh(new THREE.CylinderGeometry(28.2, 28.8, 0.5, 64), concrete);
    padTop.position.y = 3.85;
    pad.add(padTop);

    const marking = new THREE.Mesh(
      new THREE.PlaneGeometry(58, 58),
      new THREE.MeshBasicMaterial({ map: padTexture(), transparent: true, depthWrite: false, opacity: 0.92, side: THREE.DoubleSide })
    );
    marking.rotation.x = -Math.PI / 2;
    marking.position.y = 4.12;
    pad.add(marking);

    // radial service lines
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.06, 15), steelDark);
      line.position.set(Math.cos(a) * 20.5, 4.06, Math.sin(a) * 20.5);
      line.rotation.y = -a + Math.PI / 2;
      pad.add(line);
    }

    // tether anchor / cradle
    const anchor = new THREE.Group();
    anchor.position.y = 4.1;
    pad.add(anchor);
    const anchorBase = new THREE.Mesh(new THREE.CylinderGeometry(7.4, 9.2, 2.6, 12), concreteDark);
    anchorBase.position.y = 1.3;
    anchor.add(anchorBase);
    const anchorRing = new THREE.Mesh(new THREE.TorusGeometry(5.1, 0.32, 8, 32), steel);
    anchorRing.rotation.x = Math.PI / 2;
    anchorRing.position.y = 2.6;
    anchor.add(anchorRing);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const buttress = new THREE.Mesh(new THREE.BoxGeometry(1.25, 10.5, 2.1), steel);
      buttress.position.set(Math.cos(a) * 7.1, 5.1, Math.sin(a) * 7.1);
      buttress.rotation.y = -a;
      buttress.rotation.z = -0.20;
      anchor.add(buttress);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.1, 2.6), concrete);
      foot.position.set(Math.cos(a) * 7.1, 0.6, Math.sin(a) * 7.1);
      anchor.add(foot);
    }
    const cradle = new THREE.Mesh(new THREE.CylinderGeometry(4.15, 4.7, 2.0, 16), steelDark);
    cradle.position.y = 2.8;
    anchor.add(cradle);
    const cradleRing = new THREE.Mesh(new THREE.TorusGeometry(4.3, 0.12, 6, 32), emissiveCyan);
    cradleRing.rotation.x = Math.PI / 2;
    cradleRing.position.y = 3.6;
    anchor.add(cradleRing);

    // 4 floodlight masts + fake volumetric cones
    const floodSprites = [];
    const floodLights = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const x = Math.cos(a) * 54;
      const z = Math.sin(a) * 54;
      const mast = new THREE.Group();
      mast.position.set(x, 4, z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.58, 33, 8), steel);
      pole.position.y = 16.5;
      mast.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.2, 1.6), steelDark);
      head.position.y = 33.2;
      head.lookAt(0, 24, 0);
      mast.add(head);
      const lens = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.9, 0.25), emissiveAmber);
      lens.position.set(0, 33.2, 0);
      lens.lookAt(0, 24, 0);
      lens.translateZ(0.72);
      mast.add(lens);
      pad.add(mast);

      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: sunGlowTex, color: 0xffb15c, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true
      }));
      glow.scale.setScalar(17);
      glow.position.set(x * 0.92, 36, z * 0.92);
      pad.add(glow);
      floodSprites.push(glow);

      const pl = new THREE.PointLight(0xffa95c, 1.25, 125, 2);
      pl.position.set(x * 0.82, 29, z * 0.82);
      pad.add(pl);
      floodLights.push(pl);
    }

    // perimeter beacons
    const beaconGeo = new THREE.BoxGeometry(0.55, 0.55, 0.55);
    const beacons = new THREE.InstancedMesh(beaconGeo, emissiveAmber, 64);
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      dummy.position.set(Math.cos(a) * 44.5, 4.7, Math.sin(a) * 44.5);
      dummy.rotation.set(0, -a, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      beacons.setMatrixAt(i, dummy.matrix);
    }
    beacons.instanceMatrix.needsUpdate = true;
    pad.add(beacons);

    // service gantry to the side
    const gantry = new THREE.Group();
    gantry.position.set(-31, 4, -15);
    pad.add(gantry);
    const gantryMat = steel;
    for (let i = 0; i < 6; i++) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.55, 30, 0.55), gantryMat);
      leg.position.set((i % 2 ? 3.4 : -3.4), 15, i < 2 ? -7 : 7);
      gantry.add(leg);
    }
    for (let y = 3; y < 31; y += 3.6) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.28, 0.28), gantryMat);
      beam.position.set(0, y, -7);
      gantry.add(beam);
      const beam2 = beam.clone();
      beam2.position.z = 7;
      gantry.add(beam2);
      const cross = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 14.3), gantryMat);
      cross.position.set(3.4, y, 0);
      gantry.add(cross);
      const cross2 = cross.clone();
      cross2.position.x = -3.4;
      gantry.add(cross2);
    }
    const gantryArm = new THREE.Mesh(new THREE.BoxGeometry(15, 0.9, 1.6), steel);
    gantryArm.position.set(10, 30, 7);
    gantryArm.rotation.z = -0.08;
    gantry.add(gantryArm);
    const gantryLight = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), emissiveRed);
    gantryLight.position.set(17, 30.4, 7);
    gantry.add(gantryLight);

    // small service buildings
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.7;
      const d = 78 + Math.random() * 26;
      const b = new THREE.Mesh(new THREE.BoxGeometry(10 + Math.random() * 12, 4 + Math.random() * 4, 8 + Math.random() * 7), concrete);
      b.position.set(Math.cos(a) * d, 2.4, Math.sin(a) * d);
      b.rotation.y = -a;
      pad.add(b);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.3, 8.1), orange);
      stripe.position.set(Math.cos(a) * (d + 1), 5.2, Math.sin(a) * d);
      stripe.rotation.y = -a;
      pad.add(stripe);
    }

    // launch dust / smoke
    const smokeCount = isSmall() ? 150 : 260;
    const smokeGeo = new THREE.BufferGeometry();
    const smokePos = new Float32Array(smokeCount * 3);
    const smokeCol = new Float32Array(smokeCount * 3);
    const smokeVel = [];
    const smokeLife = [];
    for (let i = 0; i < smokeCount; i++) {
      smokePos[i * 3] = (Math.random() - 0.5) * 12;
      smokePos[i * 3 + 1] = 4;
      smokePos[i * 3 + 2] = (Math.random() - 0.5) * 12;
      const c = 0.55 + Math.random() * 0.35;
      smokeCol[i * 3] = c; smokeCol[i * 3 + 1] = c * 0.91; smokeCol[i * 3 + 2] = c * 0.8;
      const a = Math.random() * Math.PI * 2;
      const spd = 4 + Math.random() * 17;
      smokeVel.push(new THREE.Vector3(Math.cos(a) * spd, 2 + Math.random() * 17, Math.sin(a) * spd));
      smokeLife.push(6 + Math.random() * 9);
    }
    smokeGeo.setAttribute('position', new THREE.BufferAttribute(smokePos, 3));
    smokeGeo.setAttribute('color', new THREE.BufferAttribute(smokeCol, 3));
    const smokeMat = new THREE.PointsMaterial({
      map: cloudTextures[1], size: 15, transparent: true, opacity: 0,
      vertexColors: true, depthWrite: false, blending: THREE.NormalBlending, sizeAttenuation: true, fog: true
    });
    const smoke = new THREE.Points(smokeGeo, smokeMat);
    smoke.frustumCulled = false;
    root.add(smoke);
    let smokeStart = -100;
    let smokeActive = false;

    // floating dust
    const dustCount = isSmall() ? 70 : 140;
    const dustGeo = new THREE.BufferGeometry();
    const dustPos = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 10 + Math.random() * 100;
      dustPos[i * 3] = Math.cos(a) * d;
      dustPos[i * 3 + 1] = 5 + Math.random() * 45;
      dustPos[i * 3 + 2] = Math.sin(a) * d;
    }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
      color: 0xffd0a0, size: 0.5, transparent: true, opacity: 0.5,
      map: starTex, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
    }));
    root.add(dust);

    /* ------------------------------- tether -------------------------------- */
    const tether = new THREE.Group();
    tether.name = 'COMPOSITE_TETHER';
    root.add(tether);

    // broad structural tension band
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(3.55, TETHER_TOP - 6, 0.36),
      new THREE.MeshStandardMaterial({
        map: bandTexture(),
        color: 0xffffff,
        roughness: 0.46,
        metalness: 0.58,
        emissive: col(0x071a22),
        emissiveIntensity: 0.7,
        envMapIntensity: 1.25
      })
    );
    band.position.y = 6 + (TETHER_TOP - 6) / 2;
    tether.add(band);

    // glowing edges of the band
    for (const sx of [-1, 1]) {
      const edge = new THREE.Mesh(
        new THREE.BoxGeometry(0.075, TETHER_TOP - 12, 0.44),
        new THREE.MeshBasicMaterial({ color: 0x5edcf3, transparent: true, opacity: 0.62, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      edge.position.set(sx * 1.79, 6 + (TETHER_TOP - 6) / 2, 0);
      tether.add(edge);
    }

    // longitudinal load cables
    const cableMat = new THREE.MeshStandardMaterial({ color: col(0x8b9aa0), roughness: 0.3, metalness: 0.92, envMapIntensity: 1.1 });
    const cablePositions = [
      [-1.42, 0.31], [-0.82, 0.36], [0.82, 0.36], [1.42, 0.31],
      [-1.42, -0.31], [1.42, -0.31], [-0.45, -0.42], [0.45, -0.42]
    ];
    for (const [x, z] of cablePositions) {
      const rad = Math.abs(x) > 1.1 ? 0.095 : 0.065;
      const cable = new THREE.Mesh(
        new THREE.CylinderGeometry(rad, rad, TETHER_TOP - 6, 5, 1),
        cableMat
      );
      cable.position.set(x, 6 + (TETHER_TOP - 6) / 2, z);
      tether.add(cable);
    }

    // segmented magnetic guide rails
    const railMat = new THREE.MeshStandardMaterial({ color: col(0x14252d), roughness: 0.28, metalness: 0.9 });
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, TETHER_TOP - 8, 6, 1), railMat);
      rail.position.set(sx * 0.98, 6 + (TETHER_TOP - 6) / 2, 0.46);
      tether.add(rail);
    }

    const segGeo = new THREE.BoxGeometry(0.42, 0.16, 0.26);
    const segMat = new THREE.MeshStandardMaterial({
      color: col(0x1b3d47), emissive: col(0x26c4e4), emissiveIntensity: 1.55,
      roughness: 0.35, metalness: 0.3
    });
    const segCount = Math.floor((TETHER_TOP - 12) / 4.6) * 2;
    const segments = new THREE.InstancedMesh(segGeo, segMat, segCount);
    let si = 0;
    for (let y = 10; y < TETHER_TOP - 12 && si < segCount; y += 4.6) {
      for (const sx of [-1, 1]) {
        dummy.position.set(sx * 0.98, y, 0.59);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        segments.setMatrixAt(si++, dummy.matrix);
      }
    }
    segments.count = si;
    segments.instanceMatrix.needsUpdate = true;
    tether.add(segments);

    // tension collars
    const collarMat = new THREE.MeshStandardMaterial({ color: col(0x222e34), roughness: 0.42, metalness: 0.78 });
    const collarGeo = new THREE.BoxGeometry(4.5, 0.42, 1.6);
    const collarLights = [];
    for (let y = 18; y < TETHER_TOP; y += 30) {
      const collar = new THREE.Mesh(collarGeo, collarMat);
      collar.position.set(0, y, 0);
      tether.add(collar);
      if (y % 60 === 18 || Math.random() > 0.55) {
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 6), emissiveRed);
        lamp.position.set(0, y + 0.34, 0.86);
        tether.add(lamp);
        collarLights.push(lamp);
      }
    }

    // moving energy pulses
    const pulseTex = radialTexture(128, 0, 64, [
      [0, 'rgba(210,255,255,1)'], [0.15, 'rgba(80,230,255,.9)'], [0.48, 'rgba(40,180,255,.24)'], [1, 'rgba(20,120,255,0)']
    ]);
    const pulses = [];
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: pulseTex, color: 0x9ef4ff, transparent: true, opacity: 0.72,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true
      }));
      s.scale.setScalar(2.2 + Math.random() * 1.5);
      tether.add(s);
      pulses.push({ sprite: s, offset: i * 143, speed: 36 + Math.random() * 20 });
    }

    // base collar at top of anchor
    const basePlate = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.35, 1.1, 12), steelDark);
    basePlate.position.y = 5.4;
    tether.add(basePlate);

    /* ------------------------------- cabin --------------------------------- */
    const cabin = new THREE.Group();
    cabin.name = 'GLASS_CABIN';
    cabin.position.set(0, APP.START_Y, 2.95);
    root.add(cabin);

    const cabinMetal = new THREE.MeshStandardMaterial({ color: col(0x27353d), roughness: 0.28, metalness: 0.9, envMapIntensity: 1.25 });
    const cabinDark = new THREE.MeshStandardMaterial({ color: col(0x0c1317), roughness: 0.45, metalness: 0.7 });
    const cabinWhite = new THREE.MeshStandardMaterial({ color: col(0xbfc9cc), roughness: 0.2, metalness: 0.7 });
    const glass = new THREE.MeshPhysicalMaterial({
      color: col(0x8ac5d2), metalness: 0.0, roughness: 0.055,
      transparent: true, opacity: 0.16, side: THREE.DoubleSide,
      depthWrite: false, clearcoat: 1.0, clearcoatRoughness: 0.06,
      envMapIntensity: 1.6, emissive: col(0x0a2330), emissiveIntensity: 0.18
    });

    const glassBody = new THREE.Mesh(new THREE.CylinderGeometry(1.72, 1.79, 3.95, 32, 1, true), glass);
    cabin.add(glassBody);

    // floor and roof
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(1.78, 1.82, 0.25, 32), cabinDark);
    floor.position.y = -2.0;
    cabin.add(floor);
    const floorTop = new THREE.Mesh(new THREE.CylinderGeometry(1.68, 1.72, 0.09, 32), new THREE.MeshStandardMaterial({ color: col(0x4b4f4b), roughness: 0.8, metalness: 0.2 }));
    floorTop.position.y = -1.86;
    cabin.add(floorTop);

    const roof = new THREE.Mesh(new THREE.CylinderGeometry(1.82, 1.74, 0.42, 32), cabinMetal);
    roof.position.y = 2.0;
    cabin.add(roof);
    const roofCap = new THREE.Mesh(new THREE.CylinderGeometry(1.18, 1.55, 0.46, 24), cabinDark);
    roofCap.position.y = 2.42;
    cabin.add(roofCap);
    const roofLight = new THREE.Mesh(new THREE.TorusGeometry(1.24, 0.035, 6, 32), emissiveCyan);
    roofLight.rotation.x = Math.PI / 2;
    roofLight.position.y = 2.24;
    cabin.add(roofLight);

    // rings + ribs
    for (const y of [-1.96, 0, 1.96]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.78, 0.065, 8, 40), cabinMetal);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      cabin.add(ring);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.07, 3.95, 0.07), cabinMetal);
      rib.position.set(Math.cos(a) * 1.76, 0, Math.sin(a) * 1.76);
      rib.rotation.y = -a;
      cabin.add(rib);
    }

    // porthole rings on the outward-facing side (and rear)
    for (const zSign of [1, -1]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.075, 8, 32), cabinWhite);
      ring.position.set(0, 0.55, zSign * 1.72);
      cabin.add(ring);
      const inner = new THREE.Mesh(new THREE.TorusGeometry(0.61, 0.02, 6, 32), emissiveCyan);
      inner.position.set(0, 0.55, zSign * 1.75);
      cabin.add(inner);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.16, 0.03), cabinWhite);
        bar.position.set(Math.cos(a) * 0.72, 0.55 + Math.sin(a) * 0.72, zSign * 1.74);
        bar.rotation.z = a;
        cabin.add(bar);
      }
    }

    // bottom bogie / maglev shoes
    const bogie = new THREE.Group();
    bogie.position.y = -2.25;
    cabin.add(bogie);
    const bogieBody = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.25, 0.7, 24), cabinDark);
    bogie.add(bogieBody);
    const bogieRing = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.055, 6, 28), emissiveCyan);
    bogieRing.rotation.x = Math.PI / 2;
    bogieRing.position.y = -0.37;
    bogie.add(bogieRing);
    for (const sx of [-1, 1]) {
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 1.05), steelDark);
      shoe.position.set(sx * 1.05, -0.05, -2.55);
      bogie.add(shoe);
      const shoeLight = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 0.1), emissiveCyan);
      shoeLight.position.set(sx * 1.05, -0.05, -3.08);
      bogie.add(shoeLight);
    }
    const bogieArm = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.38, 0.52), cabinMetal);
    bogieArm.position.set(0, 0.05, -1.55);
    bogie.add(bogieArm);

    // upper clamp arms connecting to the tether
    for (const sy of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.26, 0.34), cabinMetal);
      arm.position.set(0, sy * 1.28, -2.25);
      cabin.add(arm);
      const clamp = new THREE.Mesh(new THREE.BoxGeometry(4.1, 0.4, 0.72), cabinDark);
      clamp.position.set(0, sy * 1.28, -2.98);
      cabin.add(clamp);
      const clampGlow = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.08, 0.1), emissiveCyan);
      clampGlow.position.set(0, sy * 1.28, -3.36);
      cabin.add(clampGlow);
    }

    // roof equipment
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 1.5, 6), cabinWhite);
    mast.position.y = 3.25;
    cabin.add(mast);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), emissiveRed);
    beacon.position.y = 4.02;
    cabin.add(beacon);
    const antenna = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.02, 5, 16), cabinWhite);
    antenna.rotation.x = Math.PI / 2.2;
    antenna.position.set(0.36, 2.9, 0.15);
    cabin.add(antenna);

    // interior
    const interior = new THREE.Group();
    interior.position.y = -1.8;
    cabin.add(interior);
    const seatMat = new THREE.MeshStandardMaterial({ color: col(0x3f4a4e), roughness: 0.85, metalness: 0.08 });
    const seatAccent = new THREE.MeshStandardMaterial({ color: col(0x2a6472), emissive: col(0x0b2b32), roughness: 0.6, metalness: 0.2 });
    for (const sx of [-0.52, 0.52]) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.16, 0.56), seatMat);
      base.position.set(sx, 0.42, -0.12);
      interior.add(base);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.72, 0.16), seatAccent);
      back.position.set(sx, 0.78, -0.38);
      back.rotation.x = -0.12;
      interior.add(back);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.12), seatMat);
      head.position.set(sx, 1.22, -0.42);
      interior.add(head);
    }
    const console = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.17, 0.42), cabinDark);
    console.position.set(0, 0.66, 0.74);
    console.rotation.x = -0.18;
    interior.add(console);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.76, 0.27), new THREE.MeshBasicMaterial({ color: 0x7af0ff, transparent: true, opacity: 0.75 }));
    screen.position.set(0, 0.78, 0.93);
    screen.rotation.x = -0.55;
    interior.add(screen);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.035, 0.035), cabinWhite);
    rail.position.set(0, 1.1, 1.35);
    interior.add(rail);
    for (const sx of [-0.92, 0.92]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.5, 0.03), cabinWhite);
      post.position.set(sx, 0.86, 1.35);
      interior.add(post);
    }

    const cabinLight = new THREE.PointLight(0xffd5a2, 1.9, 8, 2);
    cabinLight.position.set(0, 1.15, 0.1);
    cabin.add(cabinLight);
    const cabinFill = new THREE.PointLight(0x8be6ff, 0.85, 6, 2);
    cabinFill.position.set(0, -1.1, 1.1);
    cabin.add(cabinFill);

    // soft underglow / landing beam near the pad
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x7ddfff, transparent: true, opacity: 0.065,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
    });
    const beam = new THREE.Mesh(new THREE.ConeGeometry(5.5, 16, 24, 1, true), beamMat);
    beam.position.y = -10.5;
    beam.rotation.x = Math.PI;
    cabin.add(beam);

    const cabinBeaconSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sunGlowTex, color: 0xff5a42, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true
    }));
    cabinBeaconSprite.scale.setScalar(1.6);
    cabinBeaconSprite.position.y = 4.02;
    cabin.add(cabinBeaconSprite);

    /* ------------------------------ station -------------------------------- */
    const station = new THREE.Group();
    station.name = 'TIANYONG_STATION';
    station.position.set(0, APP.TOP + 28, 0);
    root.add(station);

    const stationWhite = new THREE.MeshStandardMaterial({ color: col(0xd6dde0), roughness: 0.40, metalness: 0.52, envMapIntensity: 0.8 });
    const stationDark = new THREE.MeshStandardMaterial({ color: col(0x2f3b44), roughness: 0.48, metalness: 0.72 });
    const stationGold = new THREE.MeshStandardMaterial({ color: col(0xb98a4d), roughness: 0.34, metalness: 0.9, emissive: col(0x1c1004), emissiveIntensity: 0.2 });
    const stationCyan = new THREE.MeshStandardMaterial({ color: col(0x14333d), emissive: col(0x4ad9f2), emissiveIntensity: 2.1, roughness: 0.35, metalness: 0.3 });
    const stationWarm = new THREE.MeshStandardMaterial({ color: col(0x4b3720), emissive: col(0xffc07a), emissiveIntensity: 2.4, roughness: 0.3, metalness: 0.2 });
    const solarMat = new THREE.MeshStandardMaterial({ color: col(0x0c2233), roughness: 0.3, metalness: 0.65, emissive: col(0x071521), emissiveIntensity: 0.9 });

    const ringGroup = new THREE.Group();
    ringGroup.position.y = 7;
    station.add(ringGroup);

    const mainRing = new THREE.Mesh(new THREE.TorusGeometry(58, 2.5, 14, 120), stationWhite);
    mainRing.rotation.x = Math.PI / 2;
    ringGroup.add(mainRing);
    const trimRing = new THREE.Mesh(new THREE.TorusGeometry(58, 0.14, 5, 120), stationCyan);
    trimRing.rotation.x = Math.PI / 2;
    trimRing.position.y = 2.15;
    ringGroup.add(trimRing);
    const lowerRing = new THREE.Mesh(new THREE.TorusGeometry(50, 0.55, 6, 90), stationDark);
    lowerRing.rotation.x = Math.PI / 2;
    lowerRing.position.y = -3.2;
    ringGroup.add(lowerRing);

    // spokes
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(58, 1.2, 1.5), stationDark);
      spoke.position.set(Math.cos(a) * 29, 0, Math.sin(a) * 29);
      spoke.rotation.y = -a;
      ringGroup.add(spoke);
      const glow = new THREE.Mesh(new THREE.BoxGeometry(56, 0.12, 0.12), stationCyan);
      glow.position.set(Math.cos(a) * 29, 0.7, Math.sin(a) * 29);
      glow.rotation.y = -a;
      ringGroup.add(glow);
      const hubJoin = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 3.4, 10), stationGold);
      hubJoin.position.set(Math.cos(a) * 11.2, 0, Math.sin(a) * 11.2);
      ringGroup.add(hubJoin);
    }

    // habitat modules around the ring
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const module = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 3.1, 12, 14), i % 3 === 0 ? stationWhite : stationDark);
      module.rotation.z = Math.PI / 2;
      module.rotation.y = -a - Math.PI / 2;
      module.position.set(Math.cos(a) * 58, 0.3, Math.sin(a) * 58);
      ringGroup.add(module);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(2.9, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), stationGold);
      cap.rotation.z = -Math.PI / 2;
      cap.position.set(Math.cos(a) * 63.8, 0.3, Math.sin(a) * 63.8);
      ringGroup.add(cap);
      const band = new THREE.Mesh(new THREE.TorusGeometry(3.05, 0.10, 5, 24), stationCyan);
      band.rotation.z = Math.PI / 2;
      band.rotation.y = -a - Math.PI / 2;
      band.position.set(Math.cos(a) * 58, 0.3, Math.sin(a) * 58);
      ringGroup.add(band);
    }

    // ring windows (instanced emissive boxes)
    const winCount = isSmall() ? 110 : 190;
    const winGeo = new THREE.BoxGeometry(0.42, 0.22, 0.10);
    const windows = new THREE.InstancedMesh(winGeo, stationWarm, winCount);
    for (let i = 0; i < winCount; i++) {
      const a = (i / winCount) * Math.PI * 2 + Math.random() * 0.03;
      const layer = i % 3;
      const y = layer === 0 ? 1.25 : layer === 1 ? -1.2 : 0.05;
      const rad = layer === 2 ? 54.5 : 56.0;
      dummy.position.set(Math.cos(a) * rad, y, Math.sin(a) * rad);
      dummy.rotation.set(0, -a, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      windows.setMatrixAt(i, dummy.matrix);
    }
    windows.instanceMatrix.needsUpdate = true;
    ringGroup.add(windows);

    // central hub
    const hub = new THREE.Group();
    station.add(hub);
    const hubBody = new THREE.Mesh(new THREE.CylinderGeometry(9.2, 11, 26, 24), stationWhite);
    hub.add(hubBody);
    const hubBand1 = new THREE.Mesh(new THREE.TorusGeometry(9.4, 0.18, 6, 40), stationCyan);
    hubBand1.rotation.x = Math.PI / 2;
    hubBand1.position.y = 6;
    hub.add(hubBand1);
    const hubBand2 = hubBand1.clone();
    hubBand2.position.y = -6;
    hub.add(hubBand2);
    const hubTop = new THREE.Mesh(new THREE.SphereGeometry(9.2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), stationDark);
    hubTop.position.y = 13;
    hub.add(hubTop);
    const hubBottom = new THREE.Mesh(new THREE.CylinderGeometry(8.6, 6.4, 4.5, 24), stationDark);
    hubBottom.position.y = -15.2;
    hub.add(hubBottom);

    // docking port / collar
    const dock = new THREE.Group();
    dock.position.y = -19.5;
    station.add(dock);
    const dockCone = new THREE.Mesh(new THREE.CylinderGeometry(5.1, 7.2, 6, 24), stationDark);
    dockCone.position.y = 1.2;
    dock.add(dockCone);
    const dockRing = new THREE.Mesh(new THREE.TorusGeometry(5.3, 0.35, 8, 36), stationWhite);
    dockRing.rotation.x = Math.PI / 2;
    dockRing.position.y = -2.2;
    dock.add(dockRing);
    const dockRingGlow = new THREE.Mesh(new THREE.TorusGeometry(5.0, 0.10, 6, 36), stationCyan);
    dockRingGlow.rotation.x = Math.PI / 2;
    dockRingGlow.position.y = -2.4;
    dock.add(dockRingGlow);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 3.4, 1.1), stationGold);
      arm.position.set(Math.cos(a) * 5.6, -1.2, Math.sin(a) * 5.6);
      arm.rotation.y = -a;
      dock.add(arm);
    }
    const dockBeacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 10), emissiveRed);
    dockBeacon.position.set(0, -3.8, 3.6);
    dock.add(dockBeacon);
    const dockLight = new THREE.PointLight(0xff5b43, 0.9, 46, 2);
    dockLight.position.set(0, -3.5, 0);
    dock.add(dockLight);

    // solar arrays
    const solarGroup = new THREE.Group();
    solarGroup.position.y = 5;
    station.add(solarGroup);
    const solarWings = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const wing = new THREE.Group();
      wing.position.set(Math.cos(a) * 32, 0, Math.sin(a) * 32);
      wing.rotation.y = -a;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(14, 0.35, 0.5), stationDark);
      arm.position.x = 7;
      wing.add(arm);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(26, 0.16, 12), solarMat);
      panel.position.x = 25;
      wing.add(panel);
      const rib = new THREE.Mesh(new THREE.BoxGeometry(26, 0.22, 0.12), stationGold);
      rib.position.set(25, 0.1, 0);
      wing.add(rib);
      solarGroup.add(wing);
      solarWings.push(wing);
    }

    // antenna dish
    const dish = new THREE.Mesh(new THREE.SphereGeometry(4.2, 18, 9, 0, Math.PI * 2, 0, Math.PI / 3), stationWhite);
    dish.rotation.x = -Math.PI / 2.4;
    dish.position.set(2.8, 18, 1.5);
    station.add(dish);
    const dishMast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 7, 6), stationGold);
    dishMast.position.set(1.5, 15.5, 0.8);
    dishMast.rotation.z = 0.2;
    station.add(dishMast);

    // navigation lights
    const stationBeacons = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.26, 6, 6), i % 2 ? emissiveRed : emissiveCyan);
      b.position.set(Math.cos(a) * 60.5, 7.4, Math.sin(a) * 60.5);
      station.add(b);
      stationBeacons.push(b);
    }

    const stationGlowTex = radialTexture(256, 0, 128, [
      [0, 'rgba(210,255,255,.9)'], [0.12, 'rgba(90,220,255,.5)'],
      [0.45, 'rgba(40,120,200,.12)'], [1, 'rgba(20,40,90,0)']
    ]);
    const stationGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: stationGlowTex, color: 0x9cecff, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, fog: false
    }));
    stationGlow.scale.setScalar(170);
    stationGlow.position.y = 6;
    station.add(stationGlow);

    const stationLight = new THREE.PointLight(0x79dfff, 0.0, 260, 2);
    stationLight.position.set(0, 0, 0);
    station.add(stationLight);

    /* ---------------------------- sky / color ------------------------------ */
    const lowZenith = col(0x173c58);
    const lowHorizon = col(0xd99567);
    const lowGround = col(0x2f2018);
    const highZenith = col(0x010208);
    const highHorizon = col(0x0b2234);
    const highGround = col(0x010104);
    const lowFog = new THREE.Color(0x8f6f58);
    const highFog = new THREE.Color(0x06121e);
    const sunWarm = new THREE.Color(0xffc18a);
    const sunWhite = new THREE.Color(0xfff3e6);

    let lastP = -1;
    function update(dt, elapsed, progress, height, time) {
      const p = clamp(progress, 0, 1);
      const high = smoothstep(0.055, 0.30, p);

      // camera-following sky and stars
      skyGroup.position.copy(camera.position);
      starGroup.position.copy(camera.position);
      // keep the star shell beyond the planet once it comes into view
      starGroup.scale.setScalar(lerp(1, 2.8, smoothstep(0.16, 0.34, p)));
      starGroup.rotation.y = time * 0.0018;
      starGroup.rotation.x = Math.sin(time * 0.008) * 0.02;

      skyUniforms.uHigh.value = high;
      skyUniforms.uTime.value = time;
      skyUniforms.uZenith.value.copy(lowZenith).lerp(highZenith, high);
      skyUniforms.uHorizon.value.copy(lowHorizon).lerp(highHorizon, high);
      skyUniforms.uGround.value.copy(lowGround).lerp(highGround, high);
      skyUniforms.uSunColor.value.copy(col(0xffbd7d)).lerp(col(0xfff4e8), high * 0.7);
      skyUniforms.uSunI.value = lerp(1.0, 0.72, high);

      const starOpacity = smoothstep(0.14, 0.50, p);
      starsFar.material.opacity = starOpacity * 0.88;
      starsBright.material.opacity = starOpacity;
      milky.material.opacity = starOpacity * 0.30;
      sunSprite.material.opacity = lerp(0.95, 0.26, high);
      sunHalo.material.opacity = lerp(0.24, 0.030, high);
      sunSprite.scale.setScalar(lerp(760, 300, high));
      sunHalo.scale.setScalar(lerp(2800, 1100, high));

      // atmosphere / fog: haze must clear as soon as the cabin is above the deck,
      // otherwise the 12000-unit-distant planet is fogged into a flat beige wash
      const fogHigh = smoothstep(0.035, 0.20, p);
      scene.fog.color.copy(lowFog).lerp(highFog, fogHigh);
      scene.fog.density = lerp(0.00052, 0.000012, fogHigh);

      // the launch site falls away; a self-lit planet takes over below
      terrain.visible = p < 0.24;
      rocks.visible = p < 0.18;
      pad.visible = p < 0.15;
      for (let i = 0; i < mesas.length; i++) mesas[i].visible = p < 0.21;

      const earthFade = smoothstep(0.15, 0.26, p);
      earthGroup.visible = earthFade > 0.002;
      if (earthGroup.visible) {
        earthMat.uniforms.uOpacity.value = earthFade;
        earthMat.uniforms.uTime.value = time;
        earthGroup.rotation.y = 0.7 + time * 0.0011;
      }

      // lighting
      sunLight.color.copy(sunWarm).lerp(sunWhite, high * 0.85);
      sunLight.intensity = lerp(1.35, 2.35, high);
      hemi.intensity = lerp(0.58, 0.20, high);
      rim.intensity = lerp(0.28, 0.12, high);

      // cabin motion + breathing
      const bob = Math.sin(time * 1.65) * 0.075 + Math.sin(time * 0.43) * 0.12;
      const sway = Math.sin(time * 0.72) * 0.022;
      cabin.position.y = height + bob;
      cabin.position.x = sway;
      cabin.rotation.z = Math.sin(time * 0.9) * 0.0045;
      cabin.rotation.y = Math.sin(time * 0.31) * 0.012;
      cabinLight.intensity = 1.9 + Math.sin(time * 2.1) * 0.08;
      cabinBeaconSprite.material.opacity = 0.55 + Math.sin(time * 4.2) * 0.3;
      dockRingGlow.material.emissiveIntensity = 1.6 + Math.sin(time * 3.2) * 0.55;

      // beam fades as the cabin leaves the pad
      beamMat.opacity = 0.065 * (1 - smoothstep(0.02, 0.12, p));

      // tether energy pulses
      for (const item of pulses) {
        const y = 8 + ((time * item.speed + item.offset) % (TETHER_TOP - 20));
        item.sprite.position.set(0, y, 0.62);
        const d = Math.abs(y - height);
        const near = clamp(1 - d / 40, 0, 1);
        item.sprite.material.opacity = 0.75 * (0.35 + near * 0.65) * (0.75 + Math.sin(time * 3 + item.offset) * 0.2);
      }

      // cloud drift + flash near deck
      clouds.rotation.y = time * 0.0016;
      const cloudFade = 1 - smoothstep(0.115, 0.255, p) * 0.95;
      const camX = camera.position.x, camY = camera.position.y, camZ = camera.position.z;
      for (let i = 0; i < cloudItems.length; i++) {
        const it = cloudItems[i];
        it.sprite.position.x = it.baseX + Math.sin(time * 0.02 + it.phase) * 1.6;
        // sprites that swallow the lens read as a flat wash: fade them out up close
        const dx = it.sprite.position.x - camX;
        const dy = it.sprite.position.y - camY;
        const dz = it.sprite.position.z - camZ;
        const near = 1 - smoothstep(60, 210, Math.sqrt(dx * dx + dy * dy + dz * dz));
        it.sprite.material.opacity = it.baseOpacity * cloudFade * (1 - near);
        it.sprite.visible = it.sprite.material.opacity > 0.004;
      }
      const distToCloud = Math.abs(height - CLOUD_LOW);
      if (p > 0.05 && p < 0.45 && distToCloud < 34) {
        state.cloudFlash = Math.max(state.cloudFlash, (1 - distToCloud / 34) * 0.26);
      }

      // station
      ringGroup.rotation.y = time * 0.035;
      solarGroup.rotation.y = -time * 0.012;
      for (let i = 0; i < solarWings.length; i++) {
        solarWings[i].rotation.z = Math.sin(time * 0.05 + i) * 0.04;
      }
      stationGlow.material.opacity = lerp(0.18, 0.72, smoothstep(0.35, 0.95, p)) * (0.85 + Math.sin(time * 1.8) * 0.15);
      stationGlow.scale.setScalar(lerp(110, 190, high));
      stationLight.intensity = smoothstep(0.45, 1.0, p) * 1.6;
      dockLight.intensity = 0.7 + Math.sin(time * 5.2) * 0.35;
      dockBeacon.material.emissiveIntensity = 1.5 + Math.sin(time * 5.2) * 0.9;
      const dockApproach = smoothstep(0.94, 1.0, p);
      dockRing.scale.setScalar(1 + dockApproach * 0.015 * Math.sin(time * 8));
      for (let i = 0; i < stationBeacons.length; i++) {
        stationBeacons[i].material.emissiveIntensity = 1.6 + Math.sin(time * 2.4 + i * 1.7) * 0.8;
      }
      station.rotation.y = Math.sin(time * 0.05) * 0.02;

      // launch pad ambience
      const pulse = 0.7 + Math.sin(time * 2.2) * 0.3;
      beacons.material.emissiveIntensity = 1.4 + pulse * 1.1;
      for (let i = 0; i < floodSprites.length; i++) {
        floodSprites[i].material.opacity = 0.42 + Math.sin(time * 7 + i) * 0.06;
        floodLights[i].intensity = 1.15 + Math.sin(time * 7 + i) * 0.08;
      }
      if (gantryLight) gantryLight.material.emissiveIntensity = 1.2 + Math.sin(time * 3.1) * 0.8;

      // smoke
      if (smokeActive) {
        const age = time - smokeStart;
        if (age > 14) {
          smokeActive = false;
          smokeMat.opacity = 0;
        } else {
          const arr = smokeGeo.attributes.position.array;
          for (let i = 0; i < smokeCount; i++) {
            const v = smokeVel[i];
            arr[i * 3] += v.x * dt;
            arr[i * 3 + 1] += v.y * dt;
            arr[i * 3 + 2] += v.z * dt;
            v.y -= 1.2 * dt;
            v.multiplyScalar(1 - 0.32 * dt);
          }
          smokeGeo.attributes.position.needsUpdate = true;
          smokeMat.opacity = Math.max(0, 0.55 * (1 - age / 12)) * smoothstep(0, 0.5, age);
          smokeMat.size = 12 + age * 3.4;
        }
      }

      // dust motes
      dust.rotation.y = time * 0.006;

      // station visibility from the launch pad: small but present
      if (p < 0.1) {
        stationGlow.material.opacity *= 0.85;
      }

      lastP = p;
    }

    function triggerLaunch(now) {
      smokeStart = now != null ? now : (APP.clock ? APP.clock.getElapsedTime() : 0);
      smokeActive = true;
      smokeMat.opacity = 0.0;
      const arr = smokeGeo.attributes.position.array;
      for (let i = 0; i < smokeCount; i++) {
        const a = Math.random() * Math.PI * 2;
        const rad = Math.random() * 5.5;
        arr[i * 3] = Math.cos(a) * rad;
        arr[i * 3 + 1] = 4.2 + Math.random() * 2;
        arr[i * 3 + 2] = Math.sin(a) * rad;
        const spd = 4 + Math.random() * 20;
        smokeVel[i].set(Math.cos(a) * spd, 3 + Math.random() * 19, Math.sin(a) * spd);
      }
      smokeGeo.attributes.position.needsUpdate = true;
    }

    return {
      root, cabin, tether, station, skyGroup, clouds, stars: starGroup,
      update, triggerLaunch, terrainHeight, sunDir,
      stationPosition: new THREE.Vector3(0, APP.TOP + 28, 0)
    };
  }

  window.buildSkyhookWorld = buildWorld;
})();
