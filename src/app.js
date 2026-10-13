import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const $ = id => document.getElementById(id), TAU = Math.PI * 2, rad = d => d * Math.PI / 180, mod = (x, m) => ((x % m) + m) % m;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const MOBILE = matchMedia('(pointer:coarse)').matches || !!window.Capacitor;   // телефон / APK: облегчённый профиль
const status = t => { $('st').textContent = t; };

// ===== Параметры (получены анализом engine.glb; сырая система координат модели: ось цилиндров = Z, ряд = Y) =====
const IDLE = 800, REDLINE = 8000, INERTIA = .4;
// ===== Турбина =====
const TURBO_MAX = 180000;      // макс. обороты крыльчатки, об/мин
const TURBO_TAU_UP = .40;      // инерция раскрутки, сек
const TURBO_TAU_DN = .70;      // инерция сброса, сек
const BOOST_MAX = 1.5;         // бар, физический максимум
const BOOST_LIMIT = 1.2;       // бар, срез вестгейта
const BOOST_GAIN = 1.2;        // множитель момента: T *= (1 + boost*BOOST_GAIN)
const BOV_THRESH = .30;        // бар, порог срабатывания blow-off
const GEARS = [3.5, 2.1, 1.4, 1.0, 0.8], GEAR_R = -3.3, FINAL = 3.7, KC = .8, TCAP = 350, STALL_RPM = 500;   // КПП, задний ход, главная пара, сцепление
const WHEEL_R = .33, MASS = 1500, CD = .3, AREA = 2.2, RHO = 1.2, G0 = 9.81, LOADF = 3000;                       // автомобиль: радиус колеса (м), масса, аэродинамика, нагрузка (Н при 100%)
// ===== Перегрев и разрушение =====
const TEMP_COLD = 20;          // °C, температура при запуске
const TEMP_NORM = 90;          // °C, рабочая температура
const TEMP_WARN = 115;         // °C, начало жёлтой зоны
const TEMP_CRIT = 130;         // °C, красная зона, риск разрушения
const TEMP_DEATH = 150;        // °C, разрушение двигателя
const TEMP_MAX_DISPLAY = 160;  // °C, шкала датчика
const HEAT_RATE = .28;         // °C/сек на 1000 RPM (нагрев от нагрузки)
const COOL_RATE = .4;         // °C/сек (охлаждение)
const COOL_AIRFLOW = 1.6;      // множитель охлаждения от скорости
const G = { pitch: 5, y0: 0, crankZ: -7, r: 2, L: 6, lift: .5 };      // шаг цилиндров, ось коленвала, радиус кривошипа, шатун, ход клапана
const PHASE = [0, Math.PI, Math.PI, 0], FIRE = [0, 3 * Math.PI, Math.PI, 2 * Math.PI]; // порядок 1-3-4-2
const IN = { open: rad(-10), dur: rad(230) }, EX = { open: rad(500), dur: rad(240) };   // фазы газораспределения
const peak = p => mod(p.open + p.dur / 2, 4 * Math.PI);
const lift01 = (a, p) => { const d = mod(a - p.open, 4 * Math.PI); if (d >= p.dur) return 0; const s = Math.sin(Math.PI * d / p.dur); return s * s; };
const pinZ = ph => G.crankZ + G.r * Math.cos(ph) + Math.sqrt(G.L * G.L - (G.r * Math.sin(ph)) ** 2);

// ===== Рендерер (задача 2C) =====
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: MOBILE, stencil: !MOBILE, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.8;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true; renderer.info.autoReset = false;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x14171c); scene.environmentIntensity = .6;
const camera = new THREE.PerspectiveCamera(40, 1, .1, 1000);
const controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.dampingFactor = .08;
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

// ===== Свет (2D) =====
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x303038, .4), new THREE.AmbientLight(0xffffff, .15));
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -.0004; sun.shadow.normalBias = .03; scene.add(sun, sun.target);
const pl = [0, 1].map(() => { const l = new THREE.PointLight(0xff9a55, 1, 1, 2); scene.add(l); return l; });

// ===== Постобработка (2E): MSAA + stencil для разреза =====
const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, stencilBuffer: true });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .05, .4, 1.2); composer.addPass(bloom);   // порог 1.2: в HDR-сцене bloom берёт только действительно яркое
composer.addPass(new OutputPass());
const QS = [{ n: 'Высокая', pr: 2, shadow: true, post: true }, { n: 'Средняя', pr: 1.5, shadow: false, post: true }, { n: 'Низкая', pr: MOBILE ? 1.25 : 1, shadow: false, post: false }];
if (MOBILE) QS.shift();                 // на телефоне «Высокой» нет: тени, MSAA и stencil-разрез слишком тяжёлые
let qi = MOBILE ? 1 : 2, usePost = false;
function resize() {
  const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix(); tachResize(); tachTResize(); speedoResize(); tachTmpResize();
}
function applyQ() { const q = QS[qi]; renderer.setPixelRatio(Math.min(devicePixelRatio, q.pr)); sun.castShadow = q.shadow; usePost = q.post; $('q').textContent = 'Графика: ' + q.n; resize(); }
$('q').onclick = () => { qi = (qi + 1) % QS.length; applyQ(); };

// ===== Окружение (2B): мгновенная встроенная студия, HDRI подтягивается в фоне и не блокирует запуск =====
function setRoomEnv() { const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), .04).texture; pm.dispose(); }
const withTimeout = (pr, ms) => Promise.race([pr, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);
async function upgradeEnv() {
  if (MOBILE) { status('Окружение: встроенная студия (мобильный профиль)'); return; }   // без загрузки HDRI по сети
  for (const u of ['hdri/studio_small_03_1k.hdr', 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_03_1k.hdr']) {
    try {
      const h = await withTimeout(new Promise((ok, no) => new RGBELoader().load(u, ok, undefined, no)), 8000);
      const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromEquirectangular(h).texture; h.dispose(); pm.dispose();
      status('HDRI: ' + u.split('/').pop()); return;
    } catch (e) { console.warn('HDRI не загрузился:', u, e.message); }
  }
  status('Окружение: встроенная студия (HDRI недоступен)');
}

// ===== PBR-материалы (2A) =====
const MT = (color, metalness, roughness, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
const MAT = {
  steel: MT(0x9ea3ab, .9, .3), piston: MT(0xc4c8cf, .9, .3), ring: MT(0x55585e, .85, .4), rod: MT(0x8e949c, .9, .3),
  crank: MT(0x7d8289, .9, .3), cast: MT(0x3a3a3d, .7, .65), alu: MT(0xb8b8bc, .85, .4), valve: MT(0xc9ccd2, .9, .25),
  spring: MT(0x5f7fa8, .85, .35), ceramic: MT(0xf2efe6, 0, .35), electrode: MT(0xb8bcc2, .9, .3, { emissive: 0xff8a3d, emissiveIntensity: .15 }),
  rubber: MT(0x1a1a1a, 0, .95), cam: MT(0xa7abb2, .9, .3), flywheel: MT(0x9aa0a8, .95, .25), mark: MT(0xf4f4f4, 0, .5),
  gear: MT(0x8f959d, .9, .35), hous: MT(0xb8b8bc, .85, .35, { side: THREE.DoubleSide }), bell: MT(0xb8b8bc, .85, .35, { side: THREE.DoubleSide, transparent: true, opacity: .28, depthWrite: false }),
  friction: MT(0x4a3426, .3, .9, { emissive: 0x8b0000, emissiveIntensity: 0 }), rim: MT(0xc8ccd2, .9, .3, { side: THREE.DoubleSide })
};
function pickMat(p) {
  if (/rubber|gasket|hose|seal|прокладк/i.test(p.m.name)) return MAT.rubber;
  switch (p.role) {
    case 'piston': return MAT.piston; case 'ring': return MAT.ring; case 'rod': return MAT.rod;
    case 'web': case 'journal': case 'crankpin': return MAT.crank;
    case 'camshaft': case 'camjournal': case 'lobe': return MAT.cam;
    case 'valve': case 'bucket': case 'retainer': return MAT.valve;
    case 'spring': return MAT.spring; case 'liner': return MAT.cast; case 'deck': case 'port': return MAT.alu;
    case 'plug': return p.tris > 16000 ? (p.s.z > 1.05 ? MAT.ceramic : MAT.steel) : p.tris < 3700 && p.s.z < .3 ? MAT.electrode : MAT.steel;
    default: return MAT.steel;
  }
}

// ===== Классификация мешей: имена мешей + число треугольников + габариты =====
function classify(m) {
  const g = m.geometry, b = g.boundingBox, c = b.getCenter(V(0, 0, 0)), s = b.getSize(V(0, 0, 0)), n = m.name;
  const tris = Math.round((g.index ? g.index.count : g.attributes.position.count) / 3); let role = 'static';
  if (/^piston/i.test(n)) role = tris > 1000 ? 'piston' : 'ring';
  else if (/^valves/i.test(n)) role = tris > 4000 ? 'valve' : 'bucket';
  else if (/valve.?spring/i.test(n)) role = tris > 20000 ? 'spring' : tris > 2000 ? 'retainer' : 'keeper';
  else if (/^cams/i.test(n)) role = 'lobe';
  else if (/spark.?plug/i.test(n)) role = 'plug';
  else if (/cylinder.?body/i.test(n)) role = tris < 1000 ? 'liner' : tris < 3000 ? 'deck' : 'port';
  else if (tris > 8000) role = 'rod';
  else if (tris >= 400 && tris <= 430) role = 'wristpin';
  else if (tris >= 460 && tris <= 480) role = 'journal';
  else if (tris >= 4000 && tris <= 4400) role = 'web';
  else if (tris >= 120 && tris <= 260) role = s.y > 5 ? 'camshaft' : Math.abs(c.x) > 2 ? 'camjournal' : 'crankpin';
  const cyl = Math.max(0, Math.min(3, Math.round((c.y - G.y0) / G.pitch)));
  const side = c.y > G.y0 + cyl * G.pitch ? 1 : 0, sx = c.x < 0 ? -1 : 1;
  return { m, role, cyl, c, s, tris, side, sx, key: `${cyl}|${sx}|${side}` };
}
function stemAxis(geo) {            // главная ось вершин (PCA) = ось штока клапана, направлена вверх (+Z)
  const p = geo.attributes.position, pts = []; for (let i = 0; i < p.count; i += 3) pts.push(V(p.getX(i), p.getY(i), p.getZ(i)));
  const mu = pts.reduce((s, q) => s.add(q), V(0, 0, 0)).multiplyScalar(1 / pts.length), C = [0, 0, 0, 0, 0, 0];
  pts.forEach(q => { const d = q.sub(mu); C[0] += d.x * d.x; C[1] += d.x * d.y; C[2] += d.x * d.z; C[3] += d.y * d.y; C[4] += d.y * d.z; C[5] += d.z * d.z; });
  let v = V(0, 0, 1); for (let k = 0; k < 30; k++) v = V(C[0] * v.x + C[1] * v.y + C[2] * v.z, C[1] * v.x + C[3] * v.y + C[4] * v.z, C[2] * v.x + C[4] * v.y + C[5] * v.z).normalize();
  return v.z < 0 ? v.negate() : v;
}
function noseAngle(geo, ax, az) {    // направление «носика» кулачка (самая дальняя от оси вершина)
  const p = geo.attributes.position; let best = -1, ang = 0;
  for (let i = 0; i < p.count; i++) { const dx = p.getX(i) - ax, dz = p.getZ(i) - az, d = dx * dx + dz * dz; if (d > best) { best = d; ang = Math.atan2(dx, dz); } }
  return ang;
}

// ===== Сборка кинематической схемы поверх готовых мешей =====
const world = new THREE.Group(), outer = new THREE.Group(), orient = new THREE.Group(), rig = new THREE.Group();
orient.rotation.x = -Math.PI / 2; outer.rotation.y = -Math.PI / 2;   // Z-вверх → Y-вверх, ряд цилиндров вдоль X
scene.add(world); world.add(outer); outer.add(orient); orient.add(rig);
const cyls = [], vgs = [], lobes = [], shafts = [], sparks = [], hl = [];   // hl — материалы для подсветки в X-ray
const crankG = new THREE.Group(); crankG.position.z = G.crankZ; rig.add(crankG);
let ready = false, bbox = new THREE.Box3(), R = 20, DR = null, RA = 0; const bboxT = new THREE.Box3(), bboxAll = new THREE.Box3();

// Мобильный профиль: пружины (≈44% полигонов) и крупные детали свечей заменяются лёгкими процедурными аналогами того же размера и формы (1.2 млн → ≈540 тыс. △)
function lighten(p) {
  const g0 = p.m.geometry;
  if (p.role === 'spring') {
    const pa = g0.attributes.position, ax = stemAxis(g0), c = p.c.clone();
    const e1 = (Math.abs(ax.x) < .9 ? V(1, 0, 0) : V(0, 1, 0)).cross(ax).normalize(), e2 = ax.clone().cross(e1);
    let tmin = 1e9, tmax = -1e9, rmax = 0; const q = V(0, 0, 0);
    for (let i = 0; i < pa.count; i += 2) { q.set(pa.getX(i) - c.x, pa.getY(i) - c.y, pa.getZ(i) - c.z); const t = q.dot(ax); tmin = Math.min(tmin, t); tmax = Math.max(tmax, t); rmax = Math.max(rmax, Math.hypot(q.dot(e1), q.dot(e2))); }
    const wire = Math.max(.05, rmax * .16), R = Math.max(.1, rmax - wire), turns = 6, N = turns * 14, pts = [];
    for (let i = 0; i <= N; i++) { const u = i / N, t = tmin + wire + (tmax - tmin - 2 * wire) * u, a = u * turns * TAU; pts.push(c.clone().addScaledVector(ax, t).addScaledVector(e1, Math.cos(a) * R).addScaledVector(e2, Math.sin(a) * R)); }
    const nm = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), N * 2, wire, 5, false), p.m.material);
    nm.name = p.m.name; g0.dispose(); p.m = nm; return;
  }
  if (p.role === 'plug' && !(p.tris < 3700 && p.s.z < .3)) {            // электрод (искра, emissive) оставляем как есть
    const r = Math.max(p.s.x, p.s.y) / 2, nm = new THREE.Mesh(new THREE.CylinderGeometry(r, r, p.s.z, 12).rotateX(Math.PI / 2), p.m.material);   // ось свечи = Z модели
    nm.position.copy(p.c); nm.name = p.m.name; g0.dispose(); p.m = nm;
  }
}
function buildRig(gltf) {
  const meshes = []; gltf.scene.traverse(o => { if (o.isMesh) { o.geometry.computeBoundingBox(); meshes.push(o); } });
  const parts = meshes.map(classify), cnt = {}; parts.forEach(p => { cnt[p.role] = (cnt[p.role] || 0) + 1; });
  console.log('Ноды модели (' + meshes.length + '):\n' + meshes.map(m => m.name).join('\n')); console.table(cnt);
  for (let i = 0; i < 4; i++) cyls.push({ i, phase: PHASE[i], pg: new THREE.Group(), rod: null, a: 0 });
  cyls.forEach(c => rig.add(c.pg));
  const att = (parent, m, off) => { m.removeFromParent(); m.position.copy(off || V(0, 0, 0)); parent.add(m); };
  const vmap = new Map(), shaftPos = new Map(), cylY = i => G.y0 + i * G.pitch;
  for (const p of parts) {
    if (MOBILE) lighten(p);
    const { m, role, cyl } = p; m.castShadow = m.receiveShadow = true;
    if (!(m.material.map || m.material.normalMap)) m.material = pickMat(p);   // собственные текстуры модели не перезаписываем
    if (role === 'piston' || role === 'ring' || role === 'wristpin') att(cyls[cyl].pg, m);
    else if (role === 'web' || role === 'journal' || role === 'crankpin') att(crankG, m, V(0, 0, -G.crankZ));
    else if (role === 'rod') {
      const B0 = V(0, p.c.y, G.crankZ + G.r * Math.cos(PHASE[cyl])), pv = new THREE.Group(); pv.position.copy(B0); att(pv, m, B0.clone().negate()); rig.add(pv); cyls[cyl].rod = { pv, y: p.c.y };
    } else if (role === 'valve' || role === 'bucket' || role === 'retainer') {
      if (!vmap.has(p.key)) { const g = new THREE.Group(); rig.add(g); vmap.set(p.key, { g, axis: V(0, 0, 1), cyl, intake: p.sx < 0, bucket: null, side: p.side, sx: p.sx }); vgs.push(vmap.get(p.key)); }
      const v = vmap.get(p.key); att(v.g, m); if (role === 'valve') v.axis = stemAxis(m.geometry); if (role === 'bucket') v.bucket = p.c;
    } else if (role === 'camshaft' || role === 'camjournal') { if (role === 'camshaft') shaftPos.set(`${cyl}|${p.sx}`, p.c); shafts.push(p); }
    else if (role === 'lobe') lobes.push(p); else rig.add(m);
    if (role === 'plug' && p.tris < 3700 && p.s.z < .3) cyls[cyl].tip = m.geometry.boundingBox.min.z;
  }
  // кулачки/распредвалы: свои оси вращения (по центру вала), синхронизация носика с толкателем
  lobes.forEach(p => {
    const sp = shaftPos.get(`${p.cyl}|${p.sx}`) || p.c, pv = new THREE.Group(), v = vmap.get(p.key);
    pv.position.set(sp.x, p.c.y, sp.z); att(pv, p.m, pv.position.clone().negate()); rig.add(pv);
    const psi0 = noseAngle(p.m.geometry, sp.x, sp.z), psiP = v && v.bucket ? Math.atan2(v.bucket.x - sp.x, v.bucket.z - sp.z) : Math.PI;
    p.pv = pv; p.psi0 = psi0; p.psiP = psiP; p.v = v;
  });
  shafts.forEach(p => { const sp = shaftPos.get(`${p.cyl}|${p.sx}`) || p.c, pv = new THREE.Group(); pv.position.set(sp.x, p.c.y, sp.z); att(pv, p.m, pv.position.clone().negate()); rig.add(pv); p.pv = pv; });
  // искры: Points, additive, 24 частицы (задача 4)
  const glow = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, '#fff'); r.addColorStop(.4, 'rgba(255,255,255,.5)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const sm = new THREE.PointsMaterial({ size: .45, map: glow, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  cyls.forEach(c => {
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(72), 3)); geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(72), 3));
    const pts = new THREE.Points(geo, sm); pts.frustumCulled = false; pts.visible = false; pts.userData = { t: 9, vel: new Float32Array(72), p0: V(0, cylY(c.i), (c.tip ?? 3.6) - .3) };
    rig.add(pts); sparks.push(pts);
  });
  // --- Маховик (процедурный): диск ⌀15 ед. (≈0.3 м при масштабе модели 1 ед. ≈ 20 мм), толщина 1.5, зубчатый венец 90 зубьев, белая метка ---
  const FW_Y = 19.5, FW_R = 7.5;                         // конец коленвала у цилиндра 4; для другой стороны поставь −3.5
  const fw = new THREE.Group(); fw.position.y = FW_Y; crankG.add(fw);                 // дочерний crankG → вращается с коленвалом (RPM = обороты двигателя)
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(FW_R, FW_R, 1.5, 96), MAT.flywheel);
  const flange = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 2.6, 32), MAT.flywheel); flange.position.y = -2.0;
  const teeth = new THREE.InstancedMesh(new THREE.BoxGeometry(.7, 1.5, .45), MAT.flywheel, 90), tm = new THREE.Matrix4(), tq = new THREE.Quaternion();
  for (let i = 0; i < 90; i++) { const a = i / 90 * TAU; tq.setFromEuler(new THREE.Euler(0, -a, 0)); tm.compose(V((FW_R + .3) * Math.cos(a), 0, (FW_R + .3) * Math.sin(a)), tq, V(1, 1, 1)); teeth.setMatrixAt(i, tm); }
  const mark = new THREE.Mesh(new THREE.BoxGeometry(5, .08, .7), MAT.mark); mark.position.set(3.8, .78, 0);
  fw.add(disc, flange, teeth, mark); [disc, flange, teeth, mark].forEach(m => { m.castShadow = m.receiveShadow = true; }); addTwins(disc); addTwins(flange);
  // центрирование и размеры
  world.updateMatrixWorld(true); bbox.setFromObject(world); world.position.sub(bbox.getCenter(V(0, 0, 0))); world.updateMatrixWorld(true); bbox.setFromObject(world);
  R = Math.max(...bbox.getSize(V(0, 0, 0)).toArray());
  // X-ray: stencil-«крышки» (двойные меши с общей геометрией, следуют за анимацией как дети меша)
  meshes.forEach((m, i) => {
    if (MOBILE || parts[i].role === 'spring' || parts[i].role === 'keeper') return;     // пружины (50% полигонов) не закрываем — экономия FPS
    const b = new THREE.Mesh(m.geometry, stBack), f = new THREE.Mesh(m.geometry, stFront); b.renderOrder = f.renderOrder = 1; b.visible = f.visible = false; m.add(b, f); capTwins.push(b, f);
  });
  buildDrivetrain();
  [MAT.piston, MAT.ring, MAT.valve, MAT.gear].forEach(x => hl.push(x));
  ready = true; return cnt;
}

// ===== X-ray: clipping plane + stencil capping (задача 3) =====
function addTwins(m) { if (MOBILE) return; const b = new THREE.Mesh(m.geometry, stBack), f = new THREE.Mesh(m.geometry, stFront); b.renderOrder = f.renderOrder = 1; b.visible = f.visible = false; m.add(b, f); capTwins.push(b, f); }
const cutPlane = new THREE.Plane(V(0, 0, -1), 0), capTwins = [];
const stOps = op => ({ stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, stencilFail: op, stencilZFail: op, stencilZPass: op });
const stBack = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, side: THREE.BackSide, clippingPlanes: [cutPlane], ...stOps(THREE.IncrementWrapStencilOp) });
const stFront = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, side: THREE.FrontSide, clippingPlanes: [cutPlane], ...stOps(THREE.DecrementWrapStencilOp) });
const cap = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.MeshStandardMaterial({ color: 0x8a9099, metalness: .2, roughness: .6, stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc, stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp }));
cap.renderOrder = 3; cap.visible = false; cap.onAfterRender = r => r.clearStencil(); scene.add(cap);
let xr = false;
function setDepth() {
  const t = $('depth').value / 100; $('dv').textContent = Math.round(t * 100) + '%';
  const u = (t - .5) * 2, hw = Math.max(Math.abs(bboxAll.min.z), Math.abs(bboxAll.max.z), bbox.max.z);   // квадратичная шкала: у центра (мотор) точнее, к краям — до колеса
  cutPlane.constant = -Math.sign(u) * u * u * hw;
}
function setXray(on) {
  xr = on; $('xr').classList.toggle('on', on); $('dw').style.display = on ? '' : 'none'; cap.visible = on && !MOBILE;
  Object.values(MAT).forEach(m => { m.clippingPlanes = on ? [cutPlane] : null; if (MOBILE) { if (m.userData.s0 === undefined) m.userData.s0 = m.side; m.side = on ? THREE.DoubleSide : m.userData.s0; } m.needsUpdate = true; });   // без stencil-крышек: показываем внутренние стенки
  hl.forEach(m => { m.emissive.set(on ? 0xff6b35 : 0x000000); m.emissiveIntensity = on ? .25 : 0; });
  capTwins.forEach(t => { t.visible = on; });
  if (on) setDepth();
}
$('xr').onclick = () => setXray(!xr); $('depth').oninput = setDepth;
addEventListener('keydown', e => { if (e.code === 'KeyX') setXray(!xr); if (e.code === 'KeyQ') $('q').click(); });

// ===== Симуляция: педаль, инерция RPM, время =====
const sim = { theta: 0, thetaU: 0, rpm: 0, paused: false, timeScale: 1, target: 0, thr: 0, cut: false, wheel: 0, gear: 0, cTarget: 0, cPress: 0, load: 0, stalled: true, strain: 0, v: 0, clutchRPM: 0, aIn: 0, aOut: 0, aWh: 0, cheat: 0, slip: 0, hand: false, turbo: 0, boost: 0, boostTgt: 0, bov: 0, heat: 0, turboTheta: 0, cutBoost: 0, cranking: false, crankTime: 0, temp: TEMP_COLD, destroyed: false, smokeTimer: 0, smokeParts: [] };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const A = { ctx: null, muted: matchMedia('(pointer:coarse)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches, vol: .6, layers: [], once: {}, unit: .12, prevStalled: false, startUntil: 0, prevCl: false, tireG: null };
const stepPedal = dt => {
  let k = sim.target > sim.thr ? .10 : .22; sim.thr += (sim.target - sim.thr) * (1 - Math.exp(-dt / k));
  k = sim.cTarget > sim.cPress ? .08 : .25; sim.cPress += (sim.cTarget - sim.cPress) * (1 - Math.exp(-dt / k));   // сцепление: быстро выжать, плавно отпустить
};
// ===== Турбина: лаг, буст, вестгейт, BOV, нагрев =====
function stepTurbo(dt) {
  const run = !sim.stalled && sim.rpm > 100;
  const thr = run ? sim.thr : 0;

  // 1. Раскрутка крыльчатки (лаг вверх/вниз)
  const turboTgt = thr * (sim.rpm / REDLINE) * TURBO_MAX;
  const tau = turboTgt > sim.turbo ? TURBO_TAU_UP : TURBO_TAU_DN;
  sim.turbo += (turboTgt - sim.turbo) * (1 - Math.exp(-dt / tau));

  // 2. Целевой буст (нелинейная зависимость — снизу растёт медленнее)
  const ratio = sim.turbo / TURBO_MAX;
  sim.boostTgt = Math.pow(ratio, 1.5) * BOOST_MAX;

  // 3. BOV: если газ отпущен, а буст ещё есть — сбрасываем
  if (sim.target > .5) sim.bovArmed = true;                    // «взводим» BOV, когда газ нажат
  const throttleReleased = sim.target < .1;
  if (throttleReleased && sim.bovArmed && sim.boost > BOV_THRESH && sim.bov <= 0) {
    sim.bovArmed = false;
    sim.bov = .25;   // таймер пшика, сек
    if (typeof bovSound === 'function') bovSound();
  }
  if (sim.bov > 0) {
    sim.bov = Math.max(0, sim.bov - dt);
    sim.boostTgt *= .15;   // резкий сброс
  }

  // 4. Вестгейт: срезаем буст выше лимита
  if (sim.boostTgt > BOOST_LIMIT) sim.boostTgt = BOOST_LIMIT;

  // 5. Сам буст — сглаживание к целевому
  sim.boost += (sim.boostTgt - sim.boost) * (1 - Math.exp(-dt / .10));

  // 6. Отсечка по передуву (кратковременная)
  if (sim.boost > BOOST_LIMIT + .05) sim.cutBoost = .10;
  if (sim.cutBoost > 0) sim.cutBoost = Math.max(0, sim.cutBoost - dt);

  // 7. Нагрев горячей части
  const heatTgt = (sim.rpm / REDLINE) * (sim.boost / BOOST_MAX);
  sim.heat += (heatTgt - sim.heat * .55) * dt * 1.5;
  sim.heat = Math.max(0, Math.min(1, sim.heat));

  // 8. Угол поворота крыльчатки для визуала (ограничен от стробоскопа)
  const visualRPM = Math.min(sim.turbo, 1800);
  sim.turboTheta = mod(sim.turboTheta + visualRPM * TAU / 60 * dt, TAU);
}
// Двигатель (rpm) + колёса (wheel, «об/мин вала колёс»): передаваемый момент Tc = сцепл. · KC · (rpm − wheel·i), не больше TCAP·сцепл.
// ===== Перегрев =====
function stepHeat(dt) {
  if (sim.destroyed) return;
  
  // Нагрев: от оборотов + буста + нагрузки + отсутствия охлаждения на низкой скорости
  const rpmHeat = (sim.rpm / REDLINE) * HEAT_RATE * 1000 / 1000 * 60;   // °C в минуту → сек
  const boostHeat = sim.boost * 8;                                       // буст греет сильнее
  const loadHeat = sim.load * 6;
  const heat = (rpmHeat * (sim.rpm / 1000) + boostHeat + loadHeat);
  
  // Охлаждение: радиатор + обдув от скорости
  const airflow = 1 + (Math.abs(sim.v * 3.6) / 100) * COOL_AIRFLOW;
  const cooled = (sim.temp - TEMP_NORM) * COOL_RATE * airflow * (sim.rpm > 100 ? 1 : .3);
  const cool = sim.temp > TEMP_NORM ? cooled : 0;
  
  sim.temp += (heat - cool) * dt / 60 * 60;   // переводим минуты в секунды
  sim.temp = Math.max(TEMP_COLD, Math.min(TEMP_DEATH + 20, sim.temp));
  
  // Разрушение
  if (!sim.destroyed && sim.temp >= TEMP_DEATH) {
    destroyEngine();
  }
}

function destroyEngine() {
  sim.destroyed = true;
  sim.stalled = true;
  sim.cranking = false;
  sim.rpm = 0;
  sim.boost = 0;
  sim.turbo = 0;
  console.warn('🔥 ДВИГАТЕЛЬ РАЗРУШЕН при ' + Math.round(sim.temp) + '°C');
  // звук разрушения
  if (typeof clunkSound === 'function') clunkSound();
}
// Ремонт после разрушения: новый (холодный) двигатель, без перезагрузки страницы
function repairEngine() {
  if (!sim.destroyed) return;
  sim.destroyed = false; sim.stalled = true; sim.cranking = false; sim.crankTime = 0; sim.cut = false; sim.cutBoost = 0;
  sim.rpm = 0; sim.turbo = 0; sim.boost = 0; sim.boostTgt = 0; sim.bov = 0; sim.bovArmed = false;
  sim.temp = TEMP_COLD; sim.cheat = 0; sim.slip = 0; sim.strain = 0;
  if (sim.smokeGeo) { const pos = sim.smokeGeo.attributes.position.array; sim.smokeParts.forEach((q, i) => { q.life = -1; pos[i * 3 + 2] = -9999; }); sim.smokeGeo.attributes.position.needsUpdate = true; }
}
// Двигатель (rpm) + колёса (wheel, «об/мин вала колёс»): передаваемый момент Tc = сцепл. · KC · (rpm − wheel·i), не больше TCAP·сцепл.
function stepEngine(dt) {
  const n = Math.max(1, Math.ceil(dt / .004)), h = dt / n, eng = 1 - sim.cPress;
  const G = sim.gear > 0 ? GEARS[sim.gear - 1] : sim.gear < 0 ? GEAR_R : 0, ratio = G * FINAL; let strain = 0, slipAmt = 0;
  for (let i = 0; i < n; i++) {
    const r = sim.rpm, wRPM = sim.v / (TAU * WHEEL_R) * 60;
    // ведомый диск (вход КПП): с включённой передачей жёстко связан с колёсами; в нейтрали тянется двигателем через сцепление или тормозится
    sim.clutchRPM = G !== 0 ? wRPM * ratio : sim.clutchRPM + (r * eng - sim.clutchRPM) * (1 - Math.exp(-h / .35));
    let Tc = 0;                                                                   // момент, передаваемый сцеплением: сцепл. · k · проскальзывание, не больше ёмкости
    if (G !== 0 && eng > .001) { const cap = TCAP * eng; Tc = clamp(eng * KC * (r - sim.clutchRPM), -cap, cap); }
    if (sim.cranking) {
      // ===== СТАРТЕР КРУТИТ =====
      // момент стартера + (если RPM достаточно) момент самого двигателя
      const Tstart = 55;                          // момент стартера (тянет до ~350 RPM)
      let Tm = 0;
      if (r > 200) {
        const e = Math.max(sim.thr, .35);         // на старте немного топлива
        const boostMul = 1 + sim.boost * BOOST_GAIN;
        Tm = 200 * (1 - .55 * ((r - 4200) / 4200) ** 2) * e * boostMul;
      }
      const F = (8 + 3 * r / 1000) * 1.6;         // трение на малых оборотах
      sim.rpm = Math.max(0, r + (Tm + Tstart - F - Tc) / INERTIA * h * 60 / TAU);
      sim.crankTime += h;
      
      // подхватился: обороты > 500 и прошло немного времени
      if (sim.rpm > 500 && sim.crankTime > .25) {
        sim.cranking = false;
        sim.stalled = false;
        sim.crankTime = 0;
        sim.rpm = Math.max(sim.rpm, IDLE * .9);
      }
      // не завёлся за 4 секунды
      if (sim.crankTime > 4) {
        sim.cranking = false;
        sim.crankTime = 0;
        sim.stalled = true;
      }
    }
    else if (sim.stalled) { sim.rpm = r * Math.exp(-h / .15); if (sim.rpm < 1) sim.rpm = 0; }
    else {
      if (r >= REDLINE) sim.cut = true; else if (r < REDLINE - 150) sim.cut = false;
      const e = Math.max(sim.thr, Math.min(.5, Math.max(0, .13 + .002 * (IDLE - r))));
      // Момент с учётом буста
      const boostMul = 1 + sim.boost * BOOST_GAIN;
      const knock = (sim.boost > .8 && r < 3000) ? (1 + (Math.random() - .5) * .10) : 1;   // детонация на низах
      const cutNow = sim.cut || sim.cutBoost > 0;
      const T = cutNow ? 0 : 200 * (1 - .55 * ((r - 4200) / 4200) ** 2) * e * boostMul * knock;
      const F = (8 + 3 * r / 1000 + .8 * (r / 1000) ** 2) * (1.6 - .6 * e);
      sim.rpm = Math.max(0, r + (T - F - Tc) / INERTIA * h * 60 / TAU);
      if (G !== 0 && eng > .35 && sim.rpm < STALL_RPM) sim.stalled = true;         // заглох
    }
    // автомобиль: тяга F = Tc·i·i_гл / r_кол; сопротивление воздуха, качения, нагрузка (подъём/прицеп), ручник блокирует колёса
    const v = sim.v, Fx = (G !== 0 ? Tc * ratio / WHEEL_R : 0) - LOADF * sim.load - .5 * CD * AREA * RHO * v * Math.abs(v), Fr = .015 * MASS * G0;
    if (Math.abs(v) < .05 && Math.abs(Fx) < Fr) sim.v = 0; else sim.v = v + (Fx - Fr * clamp(v / .3, -1, 1)) / MASS * h;
    if (sim.hand) sim.v = 0;
    strain = Math.max(strain, Math.abs(Tc) / TCAP);
    if (G !== 0) slipAmt = Math.max(slipAmt, eng * clamp(Math.abs(r - sim.clutchRPM) / 600, 0, 1));
    const P = Math.abs(Tc * (r - sim.clutchRPM)) * TAU / 60, tgt = Math.min(1.2, P / 12000);   // нагрев фрикционных накладок от проскальзывания
    sim.cheat += (tgt - sim.cheat) * (1 - Math.exp(-h / (tgt > sim.cheat ? .5 : 2.5)));
  }
  sim.strain = strain; sim.slip = slipAmt; sim.wheel = sim.v / (TAU * WHEEL_R) * 60;
}
function stopEngine() { sim.stalled = true; sim.cranking = false; }
function startEngine() {
  if (sim.destroyed) return;
  if (sim.cranking || !sim.stalled) return;
  sim.cranking = true;
  sim.crankTime = 0;
  sim.cut = false;
}
const pedal = $('pedal');
const pset = e => { const r = pedal.getBoundingClientRect(); sim.target = Math.min(1, Math.max(0, (r.bottom - e.clientY) / r.height)); };
pedal.addEventListener('pointerdown', e => { pedal.setPointerCapture(e.pointerId); pset(e); });
pedal.addEventListener('pointermove', e => { if (pedal.hasPointerCapture(e.pointerId)) pset(e); });
['pointerup', 'pointercancel'].forEach(t => pedal.addEventListener(t, () => { sim.target = 0; }));
const gas = e => e.code === 'Space' || e.code === 'ArrowUp';
addEventListener('keydown', e => { if (gas(e)) { sim.target = 1; e.preventDefault(); } }); addEventListener('keyup', e => { if (gas(e)) sim.target = 0; }); addEventListener('blur', () => { sim.target = 0; });
$('pause').onclick = () => { sim.paused = !sim.paused; $('pause').textContent = sim.paused ? 'Пуск' : 'Пауза'; };
[1, .5, .25, .1].forEach(v => { const b = document.createElement('button'); b.textContent = v + '×'; b.className = v === sim.timeScale ? '' : 'alt';
  b.onclick = () => { sim.timeScale = v; [...$('ts').children].forEach(x => x.className = x === b ? '' : 'alt'); }; $('ts').appendChild(b); });

// ===== Передачи, сцепление, нагрузка (UI) =====
const gearBtns = ['R', 'N', 1, 2, 3, 4, 5].map(g => { const b = document.createElement('button'); b.textContent = g; b.className = 'alt'; b.onclick = () => setGear(g === 'R' ? -1 : g === 'N' ? 0 : g); $('gears').appendChild(b); return b; });
function setGear(g) { sim.gear = g; gearBtns.forEach((b, i) => { b.className = i === g + 1 ? '' : 'alt'; }); $('gr').textContent = g < 0 ? 'R' : g || 'N'; if (A.ctx) playOnce('shift', .8); }
setGear(0);
const cl = $('clutch');   // педаль: выжал = сцепление отключено; «Сцепление» в % — это степень включения
const cset = e => { const r = cl.getBoundingClientRect(); sim.cTarget = clamp((r.bottom - e.clientY) / r.height, 0, 1); };
cl.addEventListener('pointerdown', e => { cl.setPointerCapture(e.pointerId); cset(e); });
cl.addEventListener('pointermove', e => { if (cl.hasPointerCapture(e.pointerId)) cset(e); });
['pointerup', 'pointercancel'].forEach(t => cl.addEventListener(t, () => { sim.cTarget = 0; }));
let loadOn = false;
const upLoad = () => { sim.load = loadOn ? $('lds').value / 100 : 0; $('ldb').className = loadOn ? '' : 'alt'; $('ldv').textContent = $('lds').value + '%'; };
$('ldb').onclick = () => { loadOn = !loadOn; upLoad(); }; $('lds').oninput = upLoad; upLoad();
const toggleHand = () => { sim.hand = !sim.hand; $('hb').className = sim.hand ? '' : 'alt'; };
$('hb').onclick = toggleHand; $('startb').onclick = () => { if (sim.destroyed) repairEngine(); else startEngine(); }; $('killb').onclick = stopEngine;
const isClutch = e => e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyC';
addEventListener('keydown', e => {
  if (e.code === 'KeyN' || e.code === 'Digit0') setGear(0); if (e.code === 'KeyR') setGear(-1); if (e.code === 'KeyH') toggleHand();
  const m = /^Digit([1-5])$/.exec(e.code); if (m) setGear(+m[1]);
  if (e.code === 'KeyE') { if (sim.destroyed) repairEngine(); else startEngine(); } if (e.code === 'KeyK') stopEngine(); if (isClutch(e)) sim.cTarget = 1; if (e.code === 'KeyM') $('mute').click();
});
addEventListener('keyup', e => { if (isClutch(e)) sim.cTarget = 0; });

// ===== Вибрация: 2-й порядок (inline-4) + шум, сильнее под нагрузкой =====
function vibrate() {
  if (sim.paused) { outer.position.set(0, 0, 0); return; }
  const amp = R * .0012 * (.3 + sim.rpm / REDLINE) * (1 + 3 * sim.strain + 2 * sim.load * (sim.gear !== 0 ? 1 : 0)), q = () => (Math.random() - .5) * amp * .4;
  outer.position.set(q(), Math.sin(2 * sim.theta) * amp + q(), q());
}

// ===== Звук: сэмплы по слоям RPM (запасной синтез, если файлов в sounds/ нет) =====
// ref — обороты, на которых записан сэмпл (playbackRate = rpm / ref); fade = [0 до, 1 от, 1 до, 0 после] — кроссфейд по RPM.
// Можно переопределить, не трогая код: файл sounds/layers.json, напр. {"idle":{"ref":850},"high":{"ref":6200}}
const LAYERS = [
  { id: 'idle', file: 'engine_idle.wav', ref: 800, fade: [-1, -1, 1200, 1800] },
  { id: 'low', file: 'engine_low.wav', ref: 2000, fade: [1000, 1800, 2800, 3500] },
  { id: 'mid', file: 'engine_mid.wav', ref: 4000, fade: [2500, 3500, 4500, 5500] },
  { id: 'high', file: 'engine_high.wav', ref: 6000, fade: [4500, 5500, 1e9, 1e9] }
];
const ONESHOTS = { start: 'engine_start.wav', stop: 'engine_shutdown.wav', clutch: 'clutch_engage.wav', shift: 'gear_shift.wav' };
const fadeGain = (r, [a, b, c, d]) => r <= a ? 0 : r < b ? (r - a) / (b - a) : r <= c ? 1 : r < d ? 1 - (r - c) / (d - c) : 0;
async function loadBuf(file) { try { const r = await fetch('sounds/' + file); if (!r.ok) return null; return await A.ctx.decodeAudioData(await r.arrayBuffer()); } catch (e) { return null; } }
async function loadSamples() {
  const c = A.ctx;
  try { const r = await fetch('sounds/layers.json'); if (r.ok) { const o = await r.json(); LAYERS.forEach(L => { if (o[L.id]) Object.assign(L, o[L.id]); }); } } catch (e) { /* необязательный файл */ }
  const res = await Promise.all([...LAYERS.map(L => loadBuf(L.file)), ...Object.values(ONESHOTS).map(loadBuf), loadBuf('tire_roll.wav')]);
  LAYERS.forEach((L, i) => { if (!res[i]) return;
    const src = c.createBufferSource(); src.buffer = res[i]; src.loop = true; const g = c.createGain(); g.gain.value = 0; src.connect(g); g.connect(A.bus); src.start(); A.layers.push({ ...L, src, g }); });
  Object.keys(ONESHOTS).forEach((k, i) => { A.once[k] = res[LAYERS.length + i]; });
  const tb = res[res.length - 1];
  if (tb) { const s = c.createBufferSource(); s.buffer = tb; s.loop = true; A.tireG = c.createGain(); A.tireG.gain.value = 0; s.connect(A.tireG); A.tireG.connect(A.master); s.start(); }
  const msg = A.layers.length ? 'Звук: сэмплы ' + A.layers.map(l => l.id).join('/') : 'Звук: файлов в sounds/ нет — играет запасной синтез';
  console.log(msg); status(msg);
}
function playOnce(name, vol = 1, spatial = false) {
  const b = A.once[name]; if (!A.ctx || !b) return 0;
  const s = A.ctx.createBufferSource(), g = A.ctx.createGain(); s.buffer = b; g.gain.value = vol; s.connect(g); g.connect(spatial ? A.pan : A.master); s.start(); return b.duration;
}
function startAudio() {
  if (A.ctx) { A.ctx.resume(); return; }
  const c = A.ctx = new (window.AudioContext || window.webkitAudioContext)();
  A.master = c.createGain(); A.master.gain.value = 0; A.an = c.createAnalyser(); A.an.fftSize = 512; A.buf = new Uint8Array(512);
  A.master.connect(A.an); A.an.connect(c.destination);
  // мастер-цепочка слоёв: bus → lowpass (800–8000 Гц по RPM) → drive (WaveShaper) → сухой + короткая реверберация 0.3 с → HRTF-панорама → master
  A.bus = c.createGain(); A.fl = c.createBiquadFilter(); A.fl.type = 'lowpass'; A.fl.frequency.value = 1500;
  A.pre = c.createGain(); A.ws = c.createWaveShaper(); const cur = new Float32Array(1024); for (let i = 0; i < 1024; i++) cur[i] = Math.tanh(2.2 * (i / 511.5 - 1)) / Math.tanh(2.2);
  A.ws.curve = cur; A.ws.oversample = '2x';
  A.dry = c.createGain(); A.wet = c.createGain(); A.wet.gain.value = .22; A.conv = c.createConvolver();
  const len = Math.floor(c.sampleRate * .3), ir = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5); }
  A.conv.buffer = ir;
  A.pan = c.createPanner(); A.pan.panningModel = 'HRTF'; A.pan.distanceModel = 'inverse'; A.pan.refDistance = 5; A.pan.maxDistance = 50; A.pan.rolloffFactor = 1;
  A.pan.positionX.value = 0; A.pan.positionY.value = 0; A.pan.positionZ.value = 0;
  A.bus.connect(A.fl); A.fl.connect(A.pre); A.pre.connect(A.ws); A.ws.connect(A.dry); A.ws.connect(A.conv); A.conv.connect(A.wet); A.dry.connect(A.pan); A.wet.connect(A.pan); A.pan.connect(A.master);
  // запасной синтез (пока нет сэмплов)
  A.eng = c.createGain(); A.eng.gain.value = 0; A.lp = c.createBiquadFilter(); A.lp.type = 'lowpass'; A.lp.Q.value = .7; A.lp.frequency.value = 600; A.eng.connect(A.lp); A.lp.connect(A.master);
  const mk = (type, gain) => { const o = c.createOscillator(); o.type = type; o.frequency.value = 30; const g = c.createGain(); g.gain.value = gain; o.connect(g); g.connect(A.eng); o.start(); return o; };
  A.o1 = mk('sawtooth', .5); A.o2 = mk('square', .22); A.o3 = mk('triangle', .35);
  const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const ns = c.createBufferSource(); ns.buffer = nb; ns.loop = true; A.nf = c.createBiquadFilter(); A.nf.type = 'lowpass'; A.nf.frequency.value = 500; A.ng = c.createGain(); A.ng.gain.value = 0;
  ns.connect(A.nf); A.nf.connect(A.ng); A.ng.connect(A.master); ns.start();
  // Свист турбины (spool) и шум для BOV (твоя доработка)
  A.turbGain = c.createGain(); A.turbGain.gain.value = 0;
  A.turbFilt = c.createBiquadFilter(); A.turbFilt.type = 'bandpass'; A.turbFilt.Q.value = 8; A.turbFilt.frequency.value = 800;
  A.turbOsc = c.createOscillator(); A.turbOsc.type = 'sine'; A.turbOsc.frequency.value = 800;
  A.turbOsc.connect(A.turbFilt); A.turbFilt.connect(A.turbGain); A.turbGain.connect(A.master); A.turbOsc.start();
  const bovBuf = c.createBuffer(1, c.sampleRate * .3, c.sampleRate), bd = bovBuf.getChannelData(0); for (let i = 0; i < bd.length; i++) bd[i] = Math.random() * 2 - 1;
  A.bovBuf = bovBuf;
  A.prevStalled = sim.stalled; A.prevCranking = false; loadSamples();
}
window.bovSound = function () {      // пшик blow-off valve
  if (!A.ctx || A.muted) return;
  const s = A.ctx.createBufferSource(); s.buffer = A.bovBuf;
  const hp = A.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
  const g = A.ctx.createGain(); g.gain.value = .18;
  s.connect(hp); hp.connect(g); g.connect(A.master);
  s.start(); s.stop(A.ctx.currentTime + .25);
};
['pointerdown', 'keydown'].forEach(ev => addEventListener(ev, startAudio));   // AudioContext только после жеста пользователя
$('mute').textContent = A.muted ? '🔇 Звук' : '🔊 Звук';
$('mute').onclick = () => { A.muted = !A.muted; $('mute').textContent = A.muted ? '🔇 Звук' : '🔊 Звук'; startAudio(); };
A.vol = +$('vol').value; $('vol').oninput = e => { A.vol = +e.target.value; };
function audioUpdate() {
  if (!A.ctx) return; const c = A.ctx, t = c.currentTime, TC = .05;
  if (sim.cranking !== A.prevCranking) {                                      // стартёр: играет сэмпл, холостой слой вступает за 0.25 с до конца
    A.prevCranking = sim.cranking;
    if (sim.cranking) A.startUntil = t + Math.max(0, playOnce('start', 1, true) - .25);
  }
  if (sim.stalled !== A.prevStalled && !sim.cranking) {                      // заглох/остановили → shutdown
    A.prevStalled = sim.stalled;
    if (sim.stalled) playOnce('stop', 1, true);
  }
  const cl = sim.cPress > .5; if (cl !== A.prevCl) { A.prevCl = cl; playOnce('clutch', .6); }
  const starting = t < A.startUntil, run = !sim.paused && !sim.stalled && sim.rpm > 20 && !starting;
  const pf = Math.sqrt(Math.max(.05, sim.timeScale)), rr = sim.rpm / REDLINE;                   // замедление времени → питч ниже
  const lvl = run ? (.4 + .5 * sim.thr + .12 * rr + .1 * sim.strain) * (sim.cut ? .4 : 1) : 0;
  const ramp = run ? .05 : .5;                                                                   // при остановке слои затухают 500 мс
  A.layers.forEach(L => {
    const gv = run ? fadeGain(sim.rpm, L.fade) * lvl : 0;
    L.g.gain.cancelScheduledValues(t); L.g.gain.setValueAtTime(L.g.gain.value, t); L.g.gain.linearRampToValueAtTime(gv, t + ramp);
    L.src.playbackRate.setTargetAtTime(clamp(sim.rpm / L.ref * pf, .25, 3), t, TC);
  });
  A.fl.frequency.setTargetAtTime(clamp(800 + 7200 * rr, 800, 8000), t, TC); A.pre.gain.setTargetAtTime(1 + .5 * rr, t, TC);
  const synth = A.layers.length ? 0 : 1, f = sim.rpm / 60 * 2 * pf;                              // запасной синтез: 2 вспышки на оборот
  const vol = run ? (.07 + .10 * rr + .20 * sim.thr + .08 * sim.strain) * (sim.cut ? .35 : 1) * synth : 0;
  A.o1.frequency.setTargetAtTime(Math.max(5, f), t, TC); A.o2.frequency.setTargetAtTime(Math.max(10, f * 2), t, TC); A.o3.frequency.setTargetAtTime(Math.max(2.5, f / 2), t, TC);
  A.eng.gain.setTargetAtTime(vol, t, TC); A.lp.frequency.setTargetAtTime(300 + sim.rpm * .7 + 900 * sim.thr, t, TC);
  A.nf.frequency.setTargetAtTime(250 + sim.rpm * .15, t, TC); A.ng.gain.setTargetAtTime(run ? (.10 * (1 - rr) + .12 * sim.thr) * synth : 0, t, TC);
  if (A.tireG) A.tireG.gain.setTargetAtTime(Math.min(.5, Math.abs(sim.v * 3.6) / 80), t, TC);
  A.master.gain.setTargetAtTime(A.muted ? 0 : A.vol * .8, t, .03);
  if (A.turbOsc) {                                                              // свист турбины
    const tf = 800 + (sim.turbo / TURBO_MAX) * 4000;
    A.turbFilt.frequency.setTargetAtTime(tf, t, .05); A.turbOsc.frequency.setTargetAtTime(tf, t, .05);
    A.turbGain.gain.setTargetAtTime(run ? (sim.turbo / TURBO_MAX) * .15 : 0, t, .08);
  }
  // слушатель = камера (HRTF: звук меняется при вращении камеры); единицы сцены → метры (A.unit)
  const L = c.listener, p = camera.position, k = A.unit, fw = V(0, 0, -1).applyQuaternion(camera.quaternion), up = V(0, 1, 0).applyQuaternion(camera.quaternion);
  L.positionX.value = p.x * k; L.positionY.value = p.y * k; L.positionZ.value = p.z * k;
  L.forwardX.value = fw.x; L.forwardY.value = fw.y; L.forwardZ.value = fw.z; L.upX.value = up.x; L.upY.value = up.y; L.upZ.value = up.z;
  A.an.getByteTimeDomainData(A.buf); let sum = 0; for (const v of A.buf) { const x = (v - 128) / 128; sum += x * x; }
  $('lvl').style.width = Math.min(100, Math.sqrt(sum / A.buf.length) * 350) + '%';
}

// ===== Поза механизма по углу коленвала =====
function pose(th) {
  crankG.rotation.y = th;
  cyls.forEach((c, i) => {
    const ph = th + c.phase, z = pinZ(ph); c.a = mod(th - FIRE[i] + TAU, 4 * Math.PI);
    c.pg.position.z = z - pinZ(c.phase);                                      // поршень + кольца + палец
    if (c.rod) { const Bx = G.r * Math.sin(ph), Bz = G.crankZ + G.r * Math.cos(ph); c.rod.pv.position.set(Bx, c.rod.y, Bz); c.rod.pv.rotation.y = Math.atan2(-Bx, z - Bz); }
  });
  vgs.forEach(v => { const l = G.lift * lift01(cyls[v.cyl].a, v.intake ? IN : EX); v.g.position.copy(v.axis).multiplyScalar(-l); });   // клапан, толкатель, тарелка — вдоль штока
  lobes.forEach(p => { const a = cyls[p.cyl].a; p.pv.rotation.y = p.psiP - p.psi0 + (a - peak(p.sx < 0 ? IN : EX)) / 2; });                  // вал вращается вдвое медленнее
  shafts.forEach(p => { p.pv.rotation.y = cyls[p.cyl].a / 2; });
}
// ===== Искры =====
const lastK = [null, null, null, null]; let flash = 0;
function ignite() {
  const adv = rad(10 + 25 * sim.rpm / REDLINE);
  cyls.forEach((c, i) => {
    const k = Math.floor((sim.thetaU - FIRE[i] + adv) / (4 * Math.PI));
    if (lastK[i] === null) { lastK[i] = k; return; }
    if (k > lastK[i]) { lastK[i] = k; if (!sim.cut && !sim.stalled) fire(sparks[i]); }
  });
}
function fire(p) {
  const u = p.userData, a = p.geometry.attributes.position.array; u.t = 0; flash = 1;
  for (let i = 0; i < 24; i++) { const d = V(Math.random() - .5, Math.random() - .5, Math.random() - .5).normalize().multiplyScalar(5 + Math.random() * 10); u.vel.set([d.x, d.y, d.z], i * 3); a[i * 3] = u.p0.x; a[i * 3 + 1] = u.p0.y; a[i * 3 + 2] = u.p0.z; }
  p.visible = true;
}
function updSpark(p, dt) {
  if (!p.visible) return; const u = p.userData; u.t += dt; const L = .07; if (u.t > L) { p.visible = false; return; }
  const a = p.geometry.attributes.position.array, c = p.geometry.attributes.color.array, k = u.t / L;
  for (let i = 0; i < 24; i++) { for (let j = 0; j < 3; j++) a[i * 3 + j] += u.vel[i * 3 + j] * dt; const f = 1 - k; c[i * 3] = f; c[i * 3 + 1] = f * (1 - .55 * k); c[i * 3 + 2] = f * (1 - .9 * k); }
  p.geometry.attributes.position.needsUpdate = p.geometry.attributes.color.needsUpdate = true;
}

// ===== Тахометр =====
const tach = $('tach'), tg = tach.getContext('2d'); let ts = 0, needle = IDLE;
function tachResize() { const s = tach.clientWidth, d = Math.min(devicePixelRatio, 2); tach.width = tach.height = Math.round(s * d); ts = s; tg.setTransform(d, 0, 0, d, 0, 0); }
const tA = r => rad(135) + Math.min(r, REDLINE) / REDLINE * rad(270);
function drawTach(dt) {
  needle += (sim.rpm - needle) * (1 - Math.exp(-dt / .04)); const s = ts, c = s / 2, Rr = s * .46, g = tg;
  g.clearRect(0, 0, s, s); g.beginPath(); g.arc(c, c, s / 2 - 1, 0, 7); g.fillStyle = 'rgba(26,30,37,.85)'; g.fill();
  g.beginPath(); g.arc(c, c, Rr * 1.04, tA(REDLINE * .93), tA(REDLINE)); g.strokeStyle = '#e03131'; g.lineWidth = s * .03; g.stroke();
  g.strokeStyle = g.fillStyle = '#e8eaed'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '600 ' + s * .09 + 'px system-ui';
const step = REDLINE / 8;   // всегда 8 делений на шкале
for (let v = 0; v <= REDLINE; v += step) {
  const a = tA(v), mj = (v % step) < 1, ca = Math.cos(a), sa = Math.sin(a), r2 = Rr * (mj ? .82 : .9);
  g.lineWidth = mj ? 2 : 1;
  g.beginPath(); g.moveTo(c + ca * Rr, c + sa * Rr); g.lineTo(c + ca * r2, c + sa * r2); g.stroke();
  if (mj) g.fillText((v / 1000).toFixed(v % 1000 ? 1 : 0), c + ca * Rr * .66, c + sa * Rr * .66);
}
  const a = tA(needle), ca = Math.cos(a), sa = Math.sin(a); g.strokeStyle = '#e8590c'; g.lineWidth = s * .025; g.lineCap = 'round';
  g.beginPath(); g.moveTo(c - ca * Rr * .12, c - sa * Rr * .12); g.lineTo(c + ca * Rr * .88, c + sa * Rr * .88); g.stroke();
  g.fillStyle = sim.cut ? '#e03131' : '#e8eaed'; g.font = '700 ' + s * .1 + 'px system-ui'; g.fillText(Math.round(sim.rpm), c, c + Rr * .5);
  g.globalAlpha = .7; g.fillStyle = '#e8eaed'; g.font = s * .06 + 'px system-ui'; g.fillText('×1000 об/мин', c, c + Rr * .7); g.globalAlpha = 1;
}
// ===== Тахометр турбины с давлением =====
const tachT = $('tachTurbo'), tgT = tachT.getContext('2d');
let tsT = 0, needleT = 0, needleB = 0;

function tachTResize() {
  const s = tachT.clientWidth, d = Math.min(devicePixelRatio, 2);
  tachT.width = tachT.height = Math.round(s * d);
  tsT = s;
  tgT.setTransform(d, 0, 0, d, 0, 0);
}

// Углы: 0 RPM = 135°, 180000 RPM = 405° (270° ход, как у основного)
const tAT = r => rad(135) + Math.min(r, TURBO_MAX) / TURBO_MAX * rad(270);
// Давление: -1 бар = 135°, +2 бар = 405°
const tAB = b => rad(135) + (Math.min(b, 2) + 1) / 3 * rad(270);

function drawTurboTach(dt) {
  // Сглаживание стрелок
  needleT += (sim.turbo - needleT) * (1 - Math.exp(-dt / .06));
  needleB += (sim.boost - needleB) * (1 - Math.exp(-dt / .08));

  const s = tsT, c = s / 2, Rr = s * .44, g = tgT;
  g.clearRect(0, 0, s, s);

  // Фон
  g.beginPath(); g.arc(c, c, s / 2 - 1, 0, 7);
  g.fillStyle = 'rgba(26,30,37,.85)'; g.fill();

  // Внешняя дуга: синяя (вакуум) → жёлтая → красная (передув)
  const grad = g.createConicGradient ? g.createConicGradient(rad(135), c, c) : null;
  if (grad) {
    grad.addColorStop(0, '#3b82f6');
    grad.addColorStop(.5, '#facc15');
    grad.addColorStop(.85, '#e8590c');
    grad.addColorStop(1, '#e03131');
    g.strokeStyle = grad;
  } else {
    g.strokeStyle = '#e8590c';
  }
  g.lineWidth = s * .04;
  g.beginPath(); g.arc(c, c, Rr * 1.05, tAB(-1), tAB(2)); g.stroke();

  // Метки давления
  g.strokeStyle = g.fillStyle = '#e8eaed';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '600 ' + s * .08 + 'px system-ui';
  for (let b = -1; b <= 2; b += .5) {
    const a = tAB(b), mj = (b % 1 === 0);
    const ca = Math.cos(a), sa = Math.sin(a), r2 = Rr * (mj ? .82 : .9);
    g.lineWidth = mj ? 2 : 1;
    g.beginPath();
    g.moveTo(c + ca * Rr, c + sa * Rr);
    g.lineTo(c + ca * r2, c + sa * r2);
    g.stroke();
    if (mj) g.fillText(b.toFixed(1), c + ca * Rr * .66, c + sa * Rr * .66);
  }

  // Внутренняя шкала турбины (RPM), тоньше
  g.strokeStyle = '#8892a0';
  g.font = s * .055 + 'px system-ui';
  for (let v = 0; v <= TURBO_MAX; v += 30000) {
    const a = tAT(v);
    const ca = Math.cos(a), sa = Math.sin(a);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(c + ca * Rr * .58, c + sa * Rr * .58);
    g.lineTo(c + ca * Rr * .48, c + sa * Rr * .48);
    g.stroke();
  }

  // Стрелка буста (основная) — оранжевая
  const ab = tAB(needleB), cb = Math.cos(ab), sb = Math.sin(ab);
  g.strokeStyle = '#e8590c'; g.lineWidth = s * .028; g.lineCap = 'round';
  g.beginPath();
  g.moveTo(c - cb * Rr * .10, c - sb * Rr * .10);
  g.lineTo(c + cb * Rr * .85, c + sb * Rr * .85);
  g.stroke();

  // Стрелка турбины (тонкая, синяя) — показывает RPM крыльчатки
  const at = tAT(needleT), ct = Math.cos(at), st = Math.sin(at);
  g.strokeStyle = '#4a9eff'; g.lineWidth = s * .014;
  g.beginPath();
  g.moveTo(c - ct * Rr * .08, c - st * Rr * .08);
  g.lineTo(c + ct * Rr * .72, c + st * Rr * .72);
  g.stroke();

  // Центральный кружок
  g.beginPath(); g.arc(c, c, s * .035, 0, 7);
  g.fillStyle = '#1a1e25'; g.fill();
  g.strokeStyle = '#e8590c'; g.lineWidth = 2; g.stroke();

  // Текст: давление + RPM турбины
  const over = sim.boost > BOOST_LIMIT;
  g.fillStyle = over ? '#e03131' : '#e8eaed';
  g.font = '700 ' + s * .13 + 'px system-ui';
  g.fillText(sim.boost.toFixed(2), c, c + Rr * .42);
  g.font = s * .07 + 'px system-ui';
  g.fillStyle = '#8892a0';
  g.fillText('бар', c, c + Rr * .58);
  g.font = s * .06 + 'px system-ui';
  g.fillStyle = '#4a9eff';
  g.fillText((sim.turbo / 1000).toFixed(0) + 'k об/мин', c, c + Rr * .75);
}
// ===== Трансмиссия (процедурная, в системе координат модели): сцепление → КПП (5 пар) → кардан → задний мост → колесо =====
function gearGeo(r, n, thick, phaseT) {          // зубчатое колесо: ось Y; зуб №0 в направлении φ=0 (phaseT=0) либо впадина там (phaseT=π+π/n)
  const sh = new THREE.Shape(), rt = r + .2, rr = r - .3, dA = TAU / n;
  for (let k = 0; k < n; k++) {
    const c = -Math.PI / 2 + phaseT + k * dA, a = [c - dA * .30, c - dA * .17, c + dA * .17, c + dA * .30], rd = [rr, rt, rt, rr];
    a.forEach((t, i) => { const x = rd[i] * Math.cos(t), y = rd[i] * Math.sin(t); if (k === 0 && i === 0) sh.moveTo(x, y); else sh.lineTo(x, y); });
  }
  sh.closePath(); const hole = new THREE.Path(); hole.absarc(0, 0, Math.min(1.1, r * .3), 0, TAU, true); sh.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false, curveSegments: 6 }); g.rotateX(-Math.PI / 2); g.translate(0, -thick / 2, 0); return g;
}
function buildDrivetrain() {
  const ZC = G.crankZ, D = 11, dt = new THREE.Group(), T = []; rig.add(dt); DR = { O: [], wheels: [] };   // ось трансмиссии = ось коленвала (z = ZC), вдоль Y
  const mesh = (parent, geo, mat, x = 0, y = 0, z = 0, cap = false) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); if (cap) T.push(m); return m; };
  const spin = (y, x = 0, z = ZC) => { const g = new THREE.Group(); g.position.set(x, y, z); dt.add(g); return g; };
  const cylY = (r, h, seg = 32, open = false) => new THREE.CylinderGeometry(r, r, h, seg, 1, open), cylX = (r, h, seg = 32, open = false) => cylY(r, h, seg, open).rotateZ(Math.PI / 2);
  // --- сцепление: нажимной диск (ведущий) вращается с коленвалом, ведомый — с валом КПП; при выжиме расходятся ---
  DR.plate = new THREE.Group(); DR.plate.position.y = 21.15; crankG.add(DR.plate);
  mesh(DR.plate, cylY(6.5, .8, 48), MAT.flywheel, 0, 0, 0, true); mesh(DR.plate, new THREE.BoxGeometry(2, .82, .5), MAT.mark, 4.5, 0, 0);
  DR.driven = spin(20.5); mesh(DR.driven, cylY(6.2, .5, 48), MAT.friction, 0, 0, 0, true); mesh(DR.driven, cylY(1.7, 1.0, 24), MAT.steel); mesh(DR.driven, new THREE.BoxGeometry(2, .52, .5), MAT.mark, 4.2, 0, 0);
  mesh(dt, cylY(9.6, 9, 56, true), MAT.bell, 0, 22.5, ZC);                                  // колокол (полупрозрачный — маховик виден)
  // --- КПП: корпус со скруглёнными углами, входной вал, вал-прокладка, 5 пар шестерён ---
  mesh(dt, new RoundedBoxGeometry(20, 14.5, 29, 4, 1.4), MAT.hous, 0, 34.0, ZC - 4.5);
  const nIn = Math.round(TAU * 5.5 / 1.1);
  DR.inShaft = spin(24.5); mesh(DR.inShaft, cylY(.9, 7, 16), MAT.steel, 0, 0, 0, true); mesh(DR.inShaft, gearGeo(5.5, nIn, 1.6, Math.PI + Math.PI / nIn), MAT.gear, 0, 27.2 - 24.5, 0, true);
  DR.cnt = spin(33.5, 0, ZC - D); mesh(DR.cnt, cylY(.9, 14, 16), MAT.steel, 0, 0, 0, true); mesh(DR.cnt, gearGeo(5.5, nIn, 1.6, 0), MAT.gear, 0, 27.2 - 33.5, 0, true);
  GEARS.forEach((ratio, i) => {            // rO/rC = передаточное число; rC + rO = межосевое расстояние
    const y = 29.5 + 2.2 * i, rC = D / (1 + ratio), rO = D * ratio / (1 + ratio), nC = Math.max(9, Math.round(TAU * rC / 1.1)), nO = Math.round(TAU * rO / 1.1);
    mesh(DR.cnt, gearGeo(rC, nC, 1.7, 0), MAT.gear, 0, y - 33.5, 0, true);
    const o = mesh(dt, gearGeo(rO, nO, 1.7, Math.PI + Math.PI / nO), MAT.gear, 0, y, ZC, true); o.userData.k = nC / nO; DR.O.push(o);
  });
  // --- выходной вал + карданный вал (~1 м) с крестовинами на концах и ведущей шестернёй главной пары ---
  DR.drive = spin(62); mesh(DR.drive, cylY(1.2, 66, 24), MAT.steel, 0, 0, 0, true); mesh(DR.drive, new THREE.BoxGeometry(.5, 40, .3), MAT.mark, 0, 0, 1.25);
  [-19, 29].forEach(y => { const j = new THREE.Group(); j.position.y = y; DR.drive.add(j);
    mesh(j, cylX(.55, 4.6, 12), MAT.steel); mesh(j, cylY(.55, 4.6, 12).rotateX(Math.PI / 2), MAT.steel); mesh(j, new THREE.BoxGeometry(3.2, 2.2, 3.2), MAT.steel); });
  mesh(DR.drive, new THREE.CylinderGeometry(.9, 2.4, 3.6, 24), MAT.gear, 0, 34.8, 0, true);
  // --- задний мост: балка-кожух, дифференциал (шарообразный кожух), главная пара, полуоси ---
  mesh(dt, cylX(2.8, 76, 32, true), MAT.hous, 0, 102, ZC); mesh(dt, new THREE.SphereGeometry(8, 32, 16), MAT.hous, 0, 102, ZC);
  DR.axle = spin(102); mesh(DR.axle, gearGeo(5.5, 28, 1.4, 0).rotateZ(Math.PI / 2), MAT.gear, 0, 0, 0, true); mesh(DR.axle, cylX(.9, 76, 16), MAT.steel, 0, 0, 0, true);
  // --- колёса (заднее правое и левое): шина, обод, 5 спиц, ступица, белая метка на внешней стороне ---
  [43, -43].forEach(wx => {
    const w = spin(102, wx), out = Math.sign(wx); DR.wheels.push(w);
    const tire = mesh(w, new THREE.TorusGeometry(14.2, 2.3, 20, 56).rotateY(Math.PI / 2), MAT.rubber, 0, 0, 0, true); tire.scale.x = 2;
    mesh(w, cylX(11.8, 8, 48, true), MAT.rim); mesh(w, cylX(3.4, 9, 24), MAT.rim, 0, 0, 0, true);
    for (let k = 0; k < 5; k++) { const sp = new THREE.Group(); sp.rotation.x = k * TAU / 5; w.add(sp); mesh(sp, new THREE.BoxGeometry(1.4, 9, 2.4), MAT.rim, 0, 7.6, 0); }
    mesh(w, new THREE.BoxGeometry(.3, 1, 3.5), MAT.mark, 4.7 * out, 0, 13);
  });
  // габариты видов; потом — «крышки» разреза и земля (чтобы не попадали в габариты)
  world.updateMatrixWorld(true); bboxAll.setFromObject(world); bboxT.setFromObject(dt); RA = Math.max(...bboxAll.getSize(V(0, 0, 0)).toArray());
  T.forEach(addTwins);
  const gnd = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.ShadowMaterial({ opacity: .35 })); gnd.position.set(0, 60, ZC - 16.5); gnd.receiveShadow = true; dt.add(gnd);
  const grid = new THREE.GridHelper(400, 40, 0x555a63, 0x30343b); grid.rotation.x = Math.PI / 2; grid.position.set(0, 60, ZC - 16.5); dt.add(grid);
}
function driveAdvance(sdt) {                       // накопленные углы валов (с учётом замедления времени)
  const wR = sim.v / (TAU * WHEEL_R) * 60;
  sim.aIn += sim.clutchRPM * TAU / 60 * sdt; sim.aOut += wR * FINAL * TAU / 60 * sdt; sim.aWh += wR * TAU / 60 * sdt;
}
function driveUpdate() {
  if (!DR) return; const p = sim.cPress;
  DR.plate.position.y = 21.15 + 2.2 * p; DR.driven.position.y = 20.5 + .8 * p;                   // педаль сцепления раздвигает диски
  DR.driven.rotation.y = DR.inShaft.rotation.y = sim.aIn; DR.cnt.rotation.y = -sim.aIn;            // вход КПП и промежуточный вал (в противоход)
  DR.O.forEach(o => { o.rotation.y = sim.aIn * o.userData.k; });                                  // шестерни выходного вала — свои скорости по передачам
  DR.drive.rotation.y = sim.aOut; DR.axle.rotation.x = sim.aWh; DR.wheels.forEach(w => { w.rotation.x = sim.aWh; });    // кардан, главная пара/полуоси, колесо
  MAT.friction.emissiveIntensity = Math.min(1, sim.cheat);                                         // накладки сцепления краснеют от проскальзывания
}
// ===== Спидометр и график оборотов =====
const spd = $('speedo'), sg = spd.getContext('2d'); let sps = 0, spN = 0;
function speedoResize() { const s = spd.clientWidth, d = Math.min(devicePixelRatio, 2); spd.width = spd.height = Math.round(s * d); sps = s; sg.setTransform(d, 0, 0, d, 0, 0); }
const tAS = k => rad(135) + Math.min(k, 280) / 280 * rad(270);
function drawSpeedo(dt) {
  const kmh = Math.abs(sim.v * 3.6); spN += (kmh - spN) * (1 - Math.exp(-Math.max(0, dt) / .12)); const s = sps, c = s / 2, Rr = s * .44, g = sg;
  g.clearRect(0, 0, s, s); g.beginPath(); g.arc(c, c, s / 2 - 1, 0, 7); g.fillStyle = 'rgba(26,30,37,.85)'; g.fill();
  g.strokeStyle = g.fillStyle = '#e8eaed'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '600 ' + s * .08 + 'px system-ui';
  for (let k = 0; k <= 280; k += 20) { const a = tAS(k), mj = k % 40 === 0, ca = Math.cos(a), sa = Math.sin(a), r2 = Rr * (mj ? .82 : .9);
    g.lineWidth = mj ? 2 : 1; g.beginPath(); g.moveTo(c + ca * Rr, c + sa * Rr); g.lineTo(c + ca * r2, c + sa * r2); g.stroke(); if (mj && k % 80 === 0) g.fillText(k, c + ca * Rr * .66, c + sa * Rr * .66); }
  const a = tAS(spN), ca = Math.cos(a), sa = Math.sin(a); g.strokeStyle = '#4a9eff'; g.lineWidth = s * .025; g.lineCap = 'round';
  g.beginPath(); g.moveTo(c - ca * Rr * .1, c - sa * Rr * .1); g.lineTo(c + ca * Rr * .88, c + sa * Rr * .88); g.stroke();
  g.fillStyle = '#e8eaed'; g.font = '700 ' + s * .14 + 'px system-ui'; g.fillText(Math.round(kmh), c, c + Rr * .48);
  g.globalAlpha = .7; g.font = s * .07 + 'px system-ui'; g.fillText('км/ч · ' + (sim.gear < 0 ? 'R' : sim.gear || 'N'), c, c + Rr * .72); g.globalAlpha = 1;
}
const gcv = $('graph'), gg = gcv.getContext('2d'), hist = []; let ht = 0;
(() => { const d = Math.min(devicePixelRatio, 2); gcv.width = 220 * d; gcv.height = 90 * d; gg.setTransform(d, 0, 0, d, 0, 0); })();
function drawGraph(dt) {
  ht += dt; if (ht > .1) { ht = 0; hist.push([sim.rpm, Math.abs(sim.clutchRPM)]); if (hist.length > 100) hist.shift(); }
  const W = 220, H = 90, g = gg; g.clearRect(0, 0, W, H); g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1;
  for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(0, H * i / 4); g.lineTo(W, H * i / 4); g.stroke(); }
  [[0, '#e8590c'], [1, '#4a9eff']].forEach(([k, col]) => { g.strokeStyle = col; g.lineWidth = 1.6; g.beginPath();
    hist.forEach((p, i) => { const x = i / 100 * W, y = H - 6 - Math.min(1, p[k] / REDLINE) * (H - 12); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); });
  g.font = '10px system-ui'; g.fillStyle = '#e8590c'; g.fillText('двигатель', 6, 11); g.fillStyle = '#4a9eff'; g.fillText('вход КПП (колёса)', 66, 11);
}

// ===== Датчик температуры =====
const tachTmp = $('tachTemp'), tgTmp = tachTmp.getContext('2d');
let tsTmp = 0, needleTemp = TEMP_COLD, warnBlink = 0;

function tachTmpResize() {
  const s = tachTmp.clientWidth, d = Math.min(devicePixelRatio, 2);
  tachTmp.width = tachTmp.height = Math.round(s * d);
  tsTmp = s;
  tgTmp.setTransform(d, 0, 0, d, 0, 0);
}

const tAmp = t => rad(135) + Math.min(t, TEMP_MAX_DISPLAY) / TEMP_MAX_DISPLAY * rad(270);

function drawTempTach(dt) {
  needleTemp += (sim.temp - needleTemp) * (1 - Math.exp(-dt / .15));
  warnBlink += dt * 8;

  const s = tsTmp, c = s / 2, Rr = s * .42, g = tgTmp;
  g.clearRect(0, 0, s, s);

  // Фон
  g.beginPath(); g.arc(c, c, s / 2 - 1, 0, 7);
  g.fillStyle = 'rgba(26,30,37,.85)'; g.fill();

  // Цветная дуга: синяя (холод) → зелёная (норма) → жёлтая (warn) → красная (crit)
  const grad = g.createConicGradient ? g.createConicGradient(rad(135), c, c) : null;
  if (grad) {
    grad.addColorStop(0, '#3b82f6');
    grad.addColorStop(.35, '#4cc38a');
    grad.addColorStop(.7, '#facc15');
    grad.addColorStop(.9, '#e8590c');
    grad.addColorStop(1, '#e03131');
    g.strokeStyle = grad;
  } else {
    g.strokeStyle = '#e8590c';
  }
  g.lineWidth = s * .06;
  g.beginPath(); g.arc(c, c, Rr * 1.05, tAmp(0), tAmp(TEMP_MAX_DISPLAY)); g.stroke();

  // Метки
  g.strokeStyle = g.fillStyle = '#e8eaed';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '600 ' + s * .075 + 'px system-ui';
  for (let t = 0; t <= TEMP_MAX_DISPLAY; t += 20) {
    const a = tAmp(t), mj = (t % 40 === 0);
    const ca = Math.cos(a), sa = Math.sin(a), r2 = Rr * (mj ? .78 : .88);
    g.lineWidth = mj ? 1.5 : 1;
    g.beginPath();
    g.moveTo(c + ca * Rr, c + sa * Rr);
    g.lineTo(c + ca * r2, c + sa * r2);
    g.stroke();
    if (mj) g.fillText(t, c + ca * Rr * .62, c + sa * Rr * .62);
  }

  // Стрелка
  const isHot = sim.temp > TEMP_WARN;
  const isCrit = sim.temp > TEMP_CRIT;
  const isDead = sim.destroyed;
  
  // Мигание при критической
  let needleColor = '#4cc38a';
  if (isDead) needleColor = '#e03131';
  else if (isCrit) needleColor = (Math.sin(warnBlink) > 0) ? '#e03131' : '#7a0d0d';
  else if (isHot) needleColor = '#facc15';
  
  const a = tAmp(needleTemp), ca = Math.cos(a), sa = Math.sin(a);
  g.strokeStyle = needleColor; 
  g.lineWidth = s * .04; 
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(c - ca * Rr * .10, c - sa * Rr * .10);
  g.lineTo(c + ca * Rr * .85, c + sa * Rr * .85);
  g.stroke();

  // Центральный кружок
  g.beginPath(); g.arc(c, c, s * .05, 0, 7);
  g.fillStyle = '#1a1e25'; g.fill();
  g.strokeStyle = needleColor; g.lineWidth = 2; g.stroke();

  // Цифра температуры
  g.fillStyle = isDead ? '#e03131' : (isCrit ? '#e03131' : '#e8eaed');
  g.font = '700 ' + s * .16 + 'px system-ui';
  g.fillText(Math.round(sim.temp) + '°', c, c + Rr * .45);
  g.font = s * .075 + 'px system-ui';
  g.fillStyle = '#8892a0';
  g.fillText('°C', c, c + Rr * .62);
  
  // Иконка при перегреве
  if (isDead) {
    g.font = '700 ' + s * .12 + 'px system-ui';
    g.fillStyle = '#e03131';
    g.fillText('🔥', c, c - Rr * .55);
  } else if (isCrit && Math.sin(warnBlink) > 0) {
    g.font = '700 ' + s * .12 + 'px system-ui';
    g.fillStyle = '#e03131';
    g.fillText('⚠', c, c - Rr * .55);
  }
}
// ===== Дым при перегреве =====
function initSmoke() {
  const N = 30;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), life = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos[i * 3 + 2] = -9999; life[i] = -1; }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 1.2, vertexColors: true, transparent: true,
    depthWrite: false, blending: THREE.NormalBlending, opacity: .6
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  sim.smokeParts = [];
  for (let i = 0; i < N; i++) sim.smokeParts.push({ life: -1, vx: 0, vy: 0, vz: 0 });
  sim.smokeGeo = geo;
}

function updSmoke(dt) {
  if (!sim.smokeGeo) return;
  const heat = Math.max(0, (sim.temp - TEMP_WARN) / (TEMP_DEATH - TEMP_WARN));
  const shouldSmoke = heat > 0 && (sim.rpm > 100 || sim.destroyed);
  const rate = heat * heat * 8;   // чем горячее, тем больше дыма
  const parts = sim.smokeParts, pos = sim.smokeGeo.attributes.position.array, col = sim.smokeGeo.attributes.color.array;
  
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.life > 0) {
      p.life -= dt;
      pos[i*3] += p.vx * dt;
      pos[i*3+1] += p.vy * dt;
      pos[i*3+2] += p.vz * dt;
      p.vy += dt * .5;   // дым поднимается
      const f = Math.max(0, p.life / 1.5);
      const dark = sim.destroyed ? .15 : .4;
      col[i*3]   = dark * f + .05;
      col[i*3+1] = dark * f + .05;
      col[i*3+2] = dark * f + .05;
      if (p.life <= 0) { pos[i*3+2] = -9999; }
    } else if (shouldSmoke && Math.random() < rate * dt) {
      // спавним у головки блока (примерно середина по Y)
      const cy = (Math.random() - .5) * 4;
      const cz = bbox.max.z * .3;
      pos[i*3]   = cy;
      pos[i*3+1] = 0;
      pos[i*3+2] = cz;
      p.vx = (Math.random() - .5) * .3;
      p.vy = .5 + Math.random() * .5;
      p.vz = (Math.random() - .5) * .3;
      p.life = 1.2 + Math.random() * .6;
    }
  }
  sim.smokeGeo.attributes.position.needsUpdate = true;
  sim.smokeGeo.attributes.color.needsUpdate = true;
}
// ===== Камера и свет по размерам модели =====
function fitAll() {
  const t = Math.tan(camera.fov * Math.PI / 360), s = bbox.getSize(V(0, 0, 0)), d = 1.15 * (Math.max(s.y / (2 * t), s.x / (2 * t * camera.aspect)) + s.z / 2);
  camera.position.set(.55, .4, .9).normalize().multiplyScalar(d); A.unit = 5 / d; controls.target.set(0, 0, 0); controls.minDistance = d * .15; controls.maxDistance = d * 4;
  camera.near = d / 200; camera.far = d * 30; camera.updateProjectionMatrix(); controls.update();
  sun.position.set(5, 10, 7).multiplyScalar(R / 10); const sc = sun.shadow.camera; const RR = Math.max(R, RA); sc.left = sc.bottom = -RR * .8; sc.right = sc.top = RR * .8; sc.near = .1; sc.far = RR * 4; sc.updateProjectionMatrix();
  pl[0].position.set(-R * .15, 0, R * .08); pl[1].position.set(R * .15, 0, R * .08); pl.forEach(l => { l.intensity = R * R * .04; l.distance = R * .6; });
}
function fitBox(b) {
  const t = Math.tan(camera.fov * Math.PI / 360), sz = b.getSize(V(0, 0, 0)), c = b.getCenter(V(0, 0, 0));
  const d = 1.1 * (Math.max(sz.y / (2 * t), sz.x / (2 * t * camera.aspect)) + sz.z / 2);
  camera.position.copy(c).add(V(.55, .4, .9).normalize().multiplyScalar(d)); controls.target.copy(c);
  controls.minDistance = d * .15; controls.maxDistance = d * 4; camera.near = d / 200; camera.far = d * 30; camera.updateProjectionMatrix(); controls.update();
}
let view = 0; const VIEWS = ['мотор', 'трансмиссия', 'всё'];
function setView(i) { view = i; $('vw').textContent = 'Вид: ' + VIEWS[i]; if (i === 0) fitAll(); else fitBox(i === 1 ? bboxT : bboxAll); }
$('vw').onclick = () => setView((view + 1) % 3); $('reset').onclick = () => setView(view);

// ===== Главный цикл =====
let last = performance.now(), fN = 0, fT = 0, gdt = 0, gf = 0, stDead = null;
function frame(now) {
  const dt = Math.min(Math.max((now - last) / 1000, 0), .05); last = now; stepPedal(dt);
  if (ready) {
   if (!sim.paused) { 
  const sdt = dt * sim.timeScale; 
  stepTurbo(sdt); 
  stepEngine(sdt); stepHeat(sdt); driveAdvance(sdt); 
  const d = sim.rpm * TAU / 60 * sdt; 
  sim.thetaU += d; 
  sim.theta = mod(sim.theta + d, 4 * Math.PI); 
  ignite(); 
}
    pose(sim.theta); driveUpdate(); vibrate(); sparks.forEach(p => updSpark(p, dt)); updSmoke(dt); flash *= Math.exp(-dt / .06); MAT.electrode.emissiveIntensity = .15 + 2 * flash;
    if (xr) { cutPlane.coplanarPoint(cap.position); cap.lookAt(cap.position.clone().sub(cutPlane.normal)); }
  }
  $('pfill').style.height = sim.thr * 100 + '%'; $('cfill').style.height = sim.cPress * 100 + '%'; $('rpmv').textContent = Math.round(sim.rpm);
  $('spd').textContent = Math.round(Math.abs(sim.v * 3.6)); $('cbar').style.width = (1 - sim.cPress) * 100 + '%'; $('slip').style.opacity = sim.slip > .3 ? 1 : .15; $('cev').textContent = Math.round((1 - sim.cPress) * 100); $('stall').style.display = (sim.stalled && !sim.cranking) ? 'flex' : 'none';
  if (sim.destroyed !== stDead) { stDead = sim.destroyed; const dead = stDead;
    $('stt').textContent = dead ? '💥 Двигатель разрушен' : 'Двигатель заглох'; $('sts').textContent = dead ? 'Перегрев. Нужен ремонт.' : 'выжми сцепление или поставь N, затем';
    $('startb').textContent = dead ? '🔧 Починить двигатель' : 'Завести (E)'; $('stall').firstElementChild.style.outline = dead ? '2px solid #e03131' : 'none'; }
  const tv = $('tempv'); if (tv) { tv.textContent = Math.round(sim.temp); tv.style.color = sim.destroyed ? '#e03131' : sim.temp > TEMP_CRIT ? '#e03131' : sim.temp > TEMP_WARN ? '#facc15' : '#4cc38a'; }
  gdt += dt; if (!MOBILE || (gf++ & 1)) { drawTach(gdt); drawTurboTach(gdt); drawSpeedo(gdt); drawGraph(gdt); drawTempTach(gdt); gdt = 0; }   // на телефоне стрелки обновляются через кадр
  audioUpdate(); controls.update();
  renderer.info.reset(); usePost ? composer.render() : renderer.render(scene, camera);
  fN++; fT += dt; if (fT > .5) { $('fps').textContent = Math.round(fN / fT) + ' FPS · ' + (renderer.info.render.triangles / 1000 | 0) + 'k △'; fN = fT = 0; }
  requestAnimationFrame(frame);
}

// ===== Старт =====
addEventListener('resize', resize); applyQ();
const lt = t => { $('lt').textContent = t; };
const tick = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));   // дать интерфейсу перерисоваться
(async () => {
  const dr = new DRACOLoader(); dr.setDecoderPath('vendor/jsm/libs/draco/gltf/');
  const gl = new GLTFLoader().setDRACOLoader(dr).setMeshoptDecoder(MeshoptDecoder);
  const t0 = performance.now(), T = n => console.log('[загрузка] ' + n + ': ' + Math.round(performance.now() - t0) + ' мс');
  const wd = setTimeout(() => lt('Всё ещё грузится… F12 → Console покажет этап'), 15000);
  try {
    setRoomEnv(); T('окружение'); lt('Загрузка модели…'); await tick();
    const gltf = await new Promise((ok, no) => gl.load('models/engine.glb', ok, e => {
      lt('Загрузка модели… ' + (e.loaded / 1048576).toFixed(1) + ' МБ'); if (e.total) $('bar').style.width = (e.loaded / e.total * 100) + '%'; }, no));
    T('GLB скачан и разобран'); lt('Сборка механизма…'); await tick();
    const cnt = buildRig(gltf); initSmoke(); T('механизм собран'); lt('Подготовка графики…'); await tick();
    fitAll(); resize(); status(Object.entries(cnt).map(([k, v]) => k + ':' + v).join(' ')); T('готово');
  } catch (err) {
    clearTimeout(wd); console.error(err); $('lt').innerHTML = 'Не удалось загрузить <code>models/engine.glb</code>:<br>' + String(err.message || err) + '<br><small>F12 — консоль</small>'; return;
  }
  clearTimeout(wd); $('load').style.opacity = 0; setTimeout(() => $('load').remove(), 600); requestAnimationFrame(frame);
  upgradeEnv();
})();
