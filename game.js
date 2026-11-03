// HARBOUR GP — 港町ストリートレース（Three.js）
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Sky } from "three/addons/objects/Sky.js";

const Q = new URLSearchParams(location.search);
const DEBUG_AUTO = Q.get("auto") === "1";          // プレイヤーも自動運転（テスト用）
const TIME_SCALE = parseFloat(Q.get("ts") || "1");
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = mulberry(7);
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ======================= レンダラー・シーン =======================
const canvas = $("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.55;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xb9c8d6, 220, 1400);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 3000);
addEventListener("resize", () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

function applyQuality(q) {
  const high = q !== "low";
  renderer.setPixelRatio(high ? Math.min(devicePixelRatio, 1.5) : 1);
  renderer.shadowMap.enabled = high;
  sun.castShadow = high;
  scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
}

// 空と太陽
const sky = new Sky();
sky.scale.setScalar(4000);
scene.add(sky);
const su = sky.material.uniforms;
su.turbidity.value = 4; su.rayleigh.value = 1.2; su.mieCoefficient.value = 0.004; su.mieDirectionalG.value = 0.85;
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 38), THREE.MathUtils.degToRad(215));
su.sunPosition.value.copy(sunDir);
const pmrem = new THREE.PMREMGenerator(renderer);
{
  const envScene = new THREE.Scene();
  const s2 = new Sky(); s2.scale.setScalar(1000); envScene.add(s2);
  Object.assign(s2.material.uniforms.sunPosition.value, sunDir);
  s2.material.uniforms.turbidity.value = 4; s2.material.uniforms.rayleigh.value = 1.2;
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
}
scene.environmentIntensity = 0.55;
const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x6b6250, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
sun.position.copy(sunDir).multiplyScalar(200);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera; sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 500;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

// ======================= コース =======================
const CTRL = [
  [0, 0], [0, 120], [0, 240], [0, 330], [12, 375], [50, 400], [110, 405], [180, 415], [240, 435], [285, 470],
  [320, 515], [365, 555], [425, 572], [468, 565], [487, 543], [478, 520], [450, 512], [415, 500], [380, 470],
  [352, 432], [330, 385], [312, 330], [300, 260], [292, 190], [290, 120], [292, 70], [282, 45], [262, 35],
  [248, 15], [232, -2], [200, -20], [150, -40], [100, -60], [55, -65], [20, -50],
];
const HALF = 6.0;               // 道幅の半分
const WALL = HALF + 1.3;        // ガードレールの位置
const N = 1700;
const curve = new THREE.CatmullRomCurve3(CTRL.map(([x, y]) => new THREE.Vector3(x, 0, y)), true, "centripetal");
const pts = curve.getSpacedPoints(N).slice(0, N);
const TR = { x: new Float32Array(N), z: new Float32Array(N), tx: new Float32Array(N), tz: new Float32Array(N),
  nx: new Float32Array(N), nz: new Float32Array(N), s: new Float32Array(N), k: new Float32Array(N),
  line: new Float32Array(N), vmax: new Float32Array(N) };
for (let i = 0; i < N; i++) { TR.x[i] = pts[i].x; TR.z[i] = pts[i].z; }
let L = 0;
for (let i = 0; i < N; i++) {
  const j = (i + 1) % N, h = (i - 1 + N) % N;
  let tx = TR.x[j] - TR.x[h], tz = TR.z[j] - TR.z[h];
  const l = Math.hypot(tx, tz); tx /= l; tz /= l;
  TR.tx[i] = tx; TR.tz[i] = tz; TR.nx[i] = tz; TR.nz[i] = -tx;   // 左向きの法線
  TR.s[i] = L;
  L += Math.hypot(TR.x[j] - TR.x[i], TR.z[j] - TR.z[i]);
}
const DS = L / N;
for (let i = 0; i < N; i++) {
  const j = (i + 1) % N;
  TR.k[i] = ((TR.tx[j] - TR.tx[i]) * TR.nx[i] + (TR.tz[j] - TR.tz[i]) * TR.nz[i]) / DS;   // +は左カーブ
}
const wrap = (i) => ((i % N) + N) % N;
function smoothArr(a, w, passes = 1) {
  let src = a;
  for (let p = 0; p < passes; p++) {
    const out = new Float32Array(N);
    for (let i = 0; i < N; i++) { let s = 0; for (let d = -w; d <= w; d++) s += src[wrap(i + d)]; out[i] = s / (2 * w + 1); }
    src = out;
  }
  return src;
}
const kS = smoothArr(TR.k, 6, 2);
// AIの走行ライン（コーナーの内側を通る）
{
  const raw = new Float32Array(N);
  for (let i = 0; i < N; i++) raw[i] = clamp(kS[wrap(i + 10)] * 260, -1, 1) * (HALF - 1.7);
  TR.line.set(smoothArr(raw, 22, 2));
}
// AIの目標速度（曲がれる速さ → 手前からブレーキ）
const GRIP0 = 1.62, DOWNF = 0.00042, G = 9.81;
{
  for (let i = 0; i < N; i++) {
    let kk = 0; for (let d = -4; d <= 4; d++) kk = Math.max(kk, Math.abs(kS[wrap(i + d)]));
    const R = 1 / Math.max(kk, 1e-5);
    const den = 1 - G * DOWNF * R;
    TR.vmax[i] = den > 0.05 ? Math.min(Math.sqrt((G * GRIP0 * R) / den), 90) : 90;
  }
  for (let pass = 0; pass < 3; pass++)
    for (let i = N - 1; i >= 0; i--) {
      const j = wrap(i + 1);
      TR.vmax[i] = Math.min(TR.vmax[i], Math.sqrt(TR.vmax[j] ** 2 + 2 * 27 * DS));
    }
}
function nearestIdx(x, z) {
  let best = 0, bd = 1e18;
  for (let i = 0; i < N; i += 4) { const d = (TR.x[i] - x) ** 2 + (TR.z[i] - z) ** 2; if (d < bd) { bd = d; best = i; } }
  return best;
}
function project(x, z, hint) {
  let best = hint, bd = 1e18;
  for (let d = -45; d <= 45; d++) {
    const i = wrap(hint + d);
    const dd = (TR.x[i] - x) ** 2 + (TR.z[i] - z) ** 2;
    if (dd < bd) { bd = dd; best = i; }
  }
  const dx = x - TR.x[best], dz = z - TR.z[best];
  const along = dx * TR.tx[best] + dz * TR.tz[best];
  const lat = dx * TR.nx[best] + dz * TR.nz[best];
  let s = TR.s[best] + along; if (s < 0) s += L; if (s >= L) s -= L;
  return { i: best, s, lat };
}
const idxAtS = (s) => wrap(Math.round(((s % L) + L) % L / DS));
function pointAt(s, lat) { const i = idxAtS(s); return [TR.x[i] + TR.nx[i] * lat, TR.z[i] + TR.nz[i] * lat, i]; }

const FIN_I = nearestIdx(0, 150);
const S_FIN = TR.s[FIN_I];
const TUN_A = nearestIdx(316, 345), TUN_B = nearestIdx(291, 125);   // トンネル区間
const inTunnelIdx = (i) => (TUN_A <= TUN_B ? i >= TUN_A && i <= TUN_B : i >= TUN_A || i <= TUN_B);

// ======================= 見た目の部品 =======================
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
const asphaltTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = "#3a3b3e"; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 9000; i++) { const v = 40 + Math.random() * 40; g.fillStyle = `rgb(${v},${v},${v + 2})`; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
});
const windowTex = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#e9e3d8"; g.fillRect(0, h * 0.86, w, h * 0.14);
  g.fillStyle = "#6d5a48"; g.fillRect(w * 0.22, h * 0.18, w * 0.16, h * 0.58); g.fillRect(w * 0.62, h * 0.18, w * 0.16, h * 0.58);
  g.fillStyle = "#1b2430"; g.fillRect(w * 0.38, h * 0.18, w * 0.24, h * 0.58);
  g.fillStyle = "#d9d2c6"; g.fillRect(w * 0.3, h * 0.76, w * 0.4, h * 0.05);
});
const checkerTex = canvasTex(64, 64, (g, w, h) => {
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? "#111" : "#eee"; g.fillRect(x * 8, y * 8, 8, 8); }
});

function ribbon(lat0, lat1, y0, y1, step = 1, colorFn = null, uvLen = 0, iFrom = 0, iTo = N) {
  const pos = [], uv = [], col = [], idx = [];
  let n = 0;
  const closed = iFrom === 0 && iTo === N;
  const count = closed ? N + 1 : iTo - iFrom + 1;
  for (let c = 0; c < count; c += step) {
    const i = wrap(iFrom + c);
    pos.push(TR.x[i] + TR.nx[i] * lat0, y0, TR.z[i] + TR.nz[i] * lat0, TR.x[i] + TR.nx[i] * lat1, y1, TR.z[i] + TR.nz[i] * lat1);
    const v = uvLen ? (c * DS) / uvLen : 0;
    uv.push(0, v, 1, v);
    if (colorFn) { const cc = colorFn(i, c); col.push(...cc, ...cc); }
    if (n > 0) { const a = 2 * (n - 1); idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    n++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  if (colorFn) g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function mesh(g, m, shadow = false) { const o = new THREE.Mesh(g, m); o.receiveShadow = true; o.castShadow = shadow; scene.add(o); return o; }
const std = (o) => new THREE.MeshStandardMaterial(o);

// 路面・白線・路肩
{
  const road = ribbon(-HALF, HALF, 0, 0, 1, null, 12);
  asphaltTex.repeat.set(3, 1);
  const m = std({ map: asphaltTex, roughness: 0.85, color: 0x9a9a9a, side: THREE.DoubleSide });
  mesh(road, m);
  for (const sd of [-1, 1]) {
    mesh(ribbon(sd * (HALF - 0.45), sd * (HALF - 0.3), 0.01, 0.01, 2), std({ color: 0xe8e8e8, roughness: 0.6, side: THREE.DoubleSide }));
    mesh(ribbon(sd * HALF, sd * (WALL + 0.2), 0.0, 0.0, 2), std({ color: 0x7c7a76, roughness: 0.9, side: THREE.DoubleSide }));
  }
  // 縁石: カーブの内外に赤白
  const kerb = (sd) => ribbon(sd * (HALF - 0.05), sd * (HALF + 1.0), 0.02, 0.05, 1,
    (i, c) => (Math.floor(c * DS / 1.6) % 2 ? [0.85, 0.85, 0.85] : [0.75, 0.04, 0.03]));
  const kerbMat = std({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide });
  for (const sd of [-1, 1]) {
    const g = kerb(sd);
    // カーブ以外は消す（頂点を地面の下へ）
    const p = g.attributes.position;
    for (let v = 0; v < p.count; v++) {
      const i = wrap(Math.floor(v / 2));
      let mx = 0; for (let d = -12; d <= 12; d++) mx = Math.max(mx, Math.abs(kS[wrap(i + d)]));
      if (mx < 1 / 140) p.setY(v, -0.3);
    }
    mesh(g, kerbMat);
  }
  // チェッカーライン
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, 1.2), std({ map: checkerTex, roughness: 0.6 }));
  checkerTex.repeat.set(1, 1);
  const ang = Math.atan2(TR.tx[FIN_I], TR.tz[FIN_I]);
  fl.rotation.set(-Math.PI / 2, 0, ang); fl.position.set(TR.x[FIN_I], 0.015, TR.z[FIN_I]); fl.receiveShadow = true;
  const ct = checkerTex.clone(); ct.repeat.set(12, 1.2); ct.needsUpdate = true; fl.material.map = ct;
  scene.add(fl);
  // グリッドの白枠
  const gridMat = std({ color: 0xeeeeee, roughness: 0.6 });
  for (let k = 0; k < 22; k++) {
    const [gx, gz, gi] = pointAt(S_FIN - 12 - k * 8, k % 2 ? -2.4 : 2.4);
    const b = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.01, 0.15), gridMat);
    b.position.set(gx, 0.012, gz); b.rotation.y = Math.atan2(TR.tx[gi], TR.tz[gi]); scene.add(b);
  }
}

// ガードレール・広告ボード・フェンス・トンネル
const BOARD_COLS = [[0.02, 0.12, 0.45], [0.85, 0.85, 0.85], [0.6, 0.03, 0.03], [0.03, 0.03, 0.03], [0.05, 0.35, 0.15], [0.85, 0.55, 0.05]];
{
  const armco = std({ color: 0xb8bcc2, metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide });
  const boards = std({ vertexColors: true, roughness: 0.5, side: THREE.DoubleSide });
  const wire = std({ color: 0x444a50, metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide });
  for (const sd of [-1, 1]) {
    mesh(ribbon(sd * WALL, sd * WALL, 0.3, 0.62, 2), armco, true);
    mesh(ribbon(sd * WALL, sd * WALL, 0.72, 1.04, 2), armco, true);
    mesh(ribbon(sd * (WALL + 0.06), sd * (WALL + 0.06), 1.04, 1.7, 1, (i, c) => BOARD_COLS[(Math.floor(c * DS / 7) + (sd > 0 ? 3 : 0)) % 6]), boards);
    for (const y of [2.4, 3.1, 3.8]) mesh(ribbon(sd * (WALL + 0.25), sd * (WALL + 0.25), y, y + 0.03, 4), wire);
  }
  // 柱（インスタンス）
  const postG = new THREE.BoxGeometry(0.09, 4.2, 0.09);
  const cnt = Math.floor(N / 4) * 2;
  const posts = new THREE.InstancedMesh(postG, wire, cnt);
  const m4 = new THREE.Matrix4(); let k = 0;
  for (let i = 0; i < N; i += 4) for (const sd of [-1, 1]) {
    if (inTunnelIdx(i)) { m4.makeScale(0, 0, 0); posts.setMatrixAt(k++, m4); continue; }
    m4.makeTranslation(TR.x[i] + TR.nx[i] * sd * (WALL + 0.27), 2.1, TR.z[i] + TR.nz[i] * sd * (WALL + 0.27));
    posts.setMatrixAt(k++, m4);
  }
  posts.count = k; scene.add(posts);
  // トンネル
  const conc = std({ color: 0x8a847c, roughness: 0.95, side: THREE.DoubleSide });
  const a = TUN_A, len = wrap(TUN_B - TUN_A);
  for (const sd of [-1, 1]) {
    mesh(ribbon(sd * (WALL + 0.9), sd * (WALL + 0.9), 0, 7.2, 2, null, 0, a, a + len), conc, true);
    mesh(ribbon(sd * (WALL + 2.2), sd * (WALL + 2.2), 0, 9.5, 2, null, 0, a, a + len), conc, true);
  }
  mesh(ribbon(-(WALL + 0.9), WALL + 0.9, 7.2, 7.2, 2, null, 0, a, a + len), conc, true);
  mesh(ribbon(-(WALL + 2.2), WALL + 2.2, 9.5, 9.5, 2, null, 0, a, a + len), std({ color: 0x9b958c, roughness: 1, side: THREE.DoubleSide }), true);
  const lampG = new THREE.BoxGeometry(0.4, 0.06, 1.8);
  const lamps = new THREE.InstancedMesh(lampG, new THREE.MeshBasicMaterial({ color: 0xffd9a0 }), Math.ceil(len / 4) * 2);
  k = 0;
  for (let c = 2; c < len; c += 4) {
    const i = wrap(a + c);
    for (const lt of [-3.2, 3.2]) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(TR.tx[i], TR.tz[i]));
      m4.compose(new THREE.Vector3(TR.x[i] + TR.nx[i] * lt, 7.15, TR.z[i] + TR.nz[i] * lt), q, new THREE.Vector3(1, 1, 1));
      lamps.setMatrixAt(k++, m4);
    }
  }
  lamps.count = k; scene.add(lamps);
  // トンネル入口・出口の壁
  for (const i of [TUN_A, TUN_B]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(44, 6, 1.5), conc);
    w.position.set(TR.x[i], 10.2, TR.z[i]); w.rotation.y = Math.atan2(TR.tx[i], TR.tz[i]); w.castShadow = true; scene.add(w);
    for (const sd of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(14, 13.2, 1.5), conc);
      p.position.set(TR.x[i] + TR.nx[i] * sd * 16.4, 6.6, TR.z[i] + TR.nz[i] * sd * 16.4); p.rotation.y = w.rotation.y; p.castShadow = true; scene.add(p);
    }
  }
}

// 空間ハッシュ（コースの近くに建物を置かないため）
const HASH = new Map();
for (let i = 0; i < N; i += 2) { const key = `${Math.floor(TR.x[i] / 20)},${Math.floor(TR.z[i] / 20)}`; if (!HASH.has(key)) HASH.set(key, []); HASH.get(key).push(i); }
function distToTrack(x, z) {
  let bd = 1e9; const cx = Math.floor(x / 20), cz = Math.floor(z / 20);
  for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) { const arr = HASH.get(`${cx + a},${cz + b}`); if (!arr) continue; for (const i of arr) bd = Math.min(bd, Math.hypot(TR.x[i] - x, TR.z[i] - z)); }
  return bd;
}
const isWater = (x, z) => x < -16 || z < -82;

// 地面・海
{
  const land = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1300), std({ color: 0x9c968c, roughness: 0.95 }));
  land.rotation.x = -Math.PI / 2; land.position.set(-16 + 700, -0.02, -82 + 650); land.receiveShadow = true; scene.add(land);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: 0x0c3b4a, roughness: 0.08, metalness: 0.1 }));
  sea.rotation.x = -Math.PI / 2; sea.position.y = -1.3; scene.add(sea);
  const qm = std({ color: 0x8f8a80, roughness: 0.9 });
  const q1 = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, 1300), qm); q1.position.set(-16, -0.7, -82 + 650); scene.add(q1);
  const q2 = new THREE.Mesh(new THREE.BoxGeometry(1400, 1.4, 1.2), qm); q2.position.set(-16 + 700, -0.7, -82); scene.add(q2);
  // 遠くの山・岬
  const hillM = std({ color: 0x5d6b4c, roughness: 1, flatShading: true });
  const rockM = std({ color: 0x8a8070, roughness: 1, flatShading: true });
  const hills = [[900, 700, 420, 160], [600, 1100, 520, 190], [1200, 200, 380, 140], [200, 1150, 460, 170], [-600, 80, 260, 110], [-520, -380, 220, 90]];
  hills.forEach(([x, z, r, h], i) => { const c = new THREE.Mesh(new THREE.ConeGeometry(r, h, 9, 3), i > 3 ? rockM : hillM); c.position.set(x, h / 2 - 8, z); scene.add(c); });
}

// 建物
{
  const geoms = [], roofs = [];
  const pastel = [0xd9b98a, 0xece0c4, 0xd9947a, 0xedd17e, 0xf0ebe2, 0xbf9a80, 0xe7c7a0, 0xc9a68f].map((c) => new THREE.Color(c));
  const tryPlace = (x, z, w, d, h, rot) => {
    if (isWater(x - w, z - d) || isWater(x + w, z + d)) return;
    if (distToTrack(x, z) < Math.max(w, d) * 0.75 + WALL + 6) return;
    if (x > 6 && x < 50 && z > 20 && z < 250) return;   // 観客スタンドの場所
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv, nrm = g.attributes.normal;
    for (let v = 0; v < uv.count; v++) {
      const ax = Math.abs(nrm.getX(v)) > 0.5, ay = Math.abs(nrm.getY(v)) > 0.5;
      if (ay) { uv.setXY(v, 0.02, 0.9); continue; }
      uv.setXY(v, uv.getX(v) * (ax ? d : w) / 3.2, uv.getY(v) * h / 3.2);
    }
    const col = pastel[Math.floor(rand() * pastel.length)];
    const cols = new Float32Array(uv.count * 3); for (let v = 0; v < uv.count; v++) col.toArray(cols, v * 3);
    g.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    g.rotateY(rot); g.translate(x, h / 2 - 0.1, z);
    geoms.push(g);
    const r = new THREE.BoxGeometry(w + 0.6, 0.6, d + 0.6); r.rotateY(rot); r.translate(x, h + 0.2, z); roofs.push(r);
  };
  for (let x = -10; x < 640; x += 17) for (let z = -76; z < 700; z += 17) {
    const w = 9 + rand() * 7, d = 9 + rand() * 7;
    const far = Math.min(1, Math.hypot(x - 240, z - 260) / 450);
    tryPlace(x + rand() * 4, z + rand() * 4, w, d, 10 + rand() * 18 + far * 22, (rand() - 0.5) * 0.2);
  }
  const bm = std({ map: windowTex, vertexColors: true, roughness: 0.85 });
  windowTex.wrapS = windowTex.wrapT = THREE.RepeatWrapping;
  const b = mesh(mergeGeometries(geoms), bm, true);
  mesh(mergeGeometries(roofs), std({ color: 0x8a3f22, roughness: 0.85 }), true);
}

// ヤシの木
{
  const trunk = new THREE.CylinderGeometry(0.16, 0.26, 8, 6); trunk.translate(0, 4, 0);
  const fronds = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const g = new THREE.PlaneGeometry(3.4, 0.9, 4, 1);
    const p = g.attributes.position;
    for (let v = 0; v < p.count; v++) { const x = p.getX(v) + 1.7; p.setXYZ(v, x, -0.28 * x * x * 0.35 + 0.4, p.getY(v)); }
    g.rotateY(a); g.translate(0, 8, 0); fronds.push(g);
  }
  const fr = mergeGeometries(fronds);
  const list = [];
  for (let i = 0; i < N; i += 22) for (const sd of [-1, 1]) {
    const x = TR.x[i] + TR.nx[i] * sd * (WALL + 3.2), z = TR.z[i] + TR.nz[i] * sd * (WALL + 3.2);
    if (inTunnelIdx(i) || isWater(x, z) || distToTrack(x, z) < WALL + 2) continue;
    list.push([x, z, 0.85 + rand() * 0.35, rand() * 6.28]);
  }
  const tm = new THREE.InstancedMesh(trunk, std({ color: 0x6e5840, roughness: 0.9 }), list.length);
  const fm = new THREE.InstancedMesh(fr, std({ color: 0x2f5a1e, roughness: 0.7, side: THREE.DoubleSide }), list.length);
  const m4 = new THREE.Matrix4();
  list.forEach(([x, z, s, r], k) => { m4.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r, 0)), new THREE.Vector3(s, s, s)); tm.setMatrixAt(k, m4); fm.setMatrixAt(k, m4); });
  tm.castShadow = fm.castShadow = true; scene.add(tm, fm);
}

// ヨット
{
  const hullShape = new THREE.Shape();
  hullShape.moveTo(-1, 0); hullShape.lineTo(1, 0); hullShape.lineTo(0.7, -0.8); hullShape.lineTo(-0.7, -0.8); hullShape.lineTo(-1, 0);
  const hull = new THREE.ExtrudeGeometry(hullShape, { depth: 1, bevelEnabled: false });
  hull.translate(0, 0, -0.5);
  { const p = hull.attributes.position; for (let v = 0; v < p.count; v++) { const z = p.getZ(v); if (z > 0.2) p.setX(v, p.getX(v) * (1 - (z - 0.2) * 1.6)); } hull.computeVertexNormals(); }
  const d1 = new THREE.BoxGeometry(1.6, 0.5, 0.55); d1.translate(0, 0.25, -0.12);
  const d2 = new THREE.BoxGeometry(1.2, 0.4, 0.35); d2.translate(0, 0.7, -0.15);
  const win = new THREE.BoxGeometry(1.62, 0.16, 0.45); win.translate(0, 0.32, -0.12);
  const white = mergeGeometries([hull, d1, d2].map((g) => g.toNonIndexed()));
  const yW = new THREE.InstancedMesh(white, std({ color: 0xf2f2f4, roughness: 0.3 }), 400);
  const yG = new THREE.InstancedMesh(win, std({ color: 0x15202a, roughness: 0.1, metalness: 0.5 }), 400);
  const m4 = new THREE.Matrix4(); let k = 0;
  const put = (x, z, len, rot) => {
    if (k >= 400) return;
    const w = len * 0.24;
    m4.compose(new THREE.Vector3(x, -0.6, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)), new THREE.Vector3(w, w * 1.1, len));
    yW.setMatrixAt(k, m4); yG.setMatrixAt(k, m4); yW.setColorAt(k, new THREE.Color(rand() < 0.2 ? 0x1a2238 : 0xffffff)); k++;
  };
  for (const [row, minL, maxL] of [[-30, 14, 22], [-62, 18, 34], [-105, 24, 46]]) {
    let z = -60;
    while (z < 520) { const len = minL + rand() * (maxL - minL); if (rand() < 0.88) put(row - len / 2, z, len, Math.PI / 2); z += len * 0.26 + 2.5; }
  }
  for (const [row, minL, maxL] of [[-96, 14, 24], [-130, 20, 36]]) {
    let x = 10;
    while (x < 480) { const len = minL + rand() * (maxL - minL); if (rand() < 0.85) put(x, row - len / 2, len, 0); x += len * 0.26 + 2.5; }
  }
  yW.count = yG.count = k; yW.castShadow = true; scene.add(yW, yG);
  // 桟橋
  const pm = std({ color: 0x6b5338, roughness: 0.8 });
  for (const x of [-27, -59, -102]) { const p = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.3, 600), pm); p.position.set(x, -0.95, 230); scene.add(p); }
}

// 観客スタンド（スタート直線の内側）
const STAND = { x: 26, z: 135 };
{
  const tiers = [], ppl = [];
  for (let t = 0; t < 12; t++) {
    const g = new THREE.BoxGeometry(1.2, 0.6, 210); g.translate(10.5 + t * 1.15, 0.3 + t * 0.6, STAND.z); tiers.push(g);
  }
  mesh(mergeGeometries(tiers), std({ color: 0x5b5e63, roughness: 0.8 }), true);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(17, 0.3, 214), std({ color: 0x23262b, roughness: 0.5, metalness: 0.4 }));
  roof.position.set(18, 11.2, STAND.z); roof.castShadow = true; scene.add(roof);
  const crowdG = new THREE.BoxGeometry(0.42, 0.95, 0.42); crowdG.translate(0, 0.47, 0);
  const crowd = new THREE.InstancedMesh(crowdG, std({ roughness: 0.8 }), 4200);
  const cc = [0xd33a2c, 0xf2f2f2, 0x1d1d1d, 0x2a56c6, 0xf1c40f, 0xa47a5e, 0x2e8b57, 0xff7a1a].map((c) => new THREE.Color(c));
  const m4 = new THREE.Matrix4(); let k = 0;
  for (let t = 0; t < 12; t++) for (let z = STAND.z - 103; z < STAND.z + 103; z += 0.55) {
    if (rand() < 0.12 || k >= 4200) continue;
    m4.makeTranslation(10.4 + t * 1.15 + (rand() - 0.5) * 0.2, 0.6 + t * 0.6, z); crowd.setMatrixAt(k, m4); crowd.setColorAt(k, cc[Math.floor(rand() * cc.length)]); k++;
  }
  crowd.count = k; scene.add(crowd);
}

// ゴールゲートとスタートシグナル
const startLamps = [];
{
  const gm = std({ color: 0x16181c, metalness: 0.6, roughness: 0.4 });
  const i = FIN_I, ang = Math.atan2(TR.tx[i], TR.tz[i]);
  const grp = new THREE.Group(); grp.position.set(TR.x[i], 0, TR.z[i]); grp.rotation.y = ang; scene.add(grp);
  for (const sd of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.7, 8, 0.7), gm); p.position.set(sd * (WALL + 0.8), 4, 0); p.castShadow = true; grp.add(p); }
  const beam = new THREE.Mesh(new THREE.BoxGeometry((WALL + 0.8) * 2 + 0.7, 1.4, 1.0), gm); beam.position.y = 7.6; beam.castShadow = true; grp.add(beam);
  for (const sd of [-1, 1]) { const c = new THREE.Mesh(new THREE.PlaneGeometry((WALL + 0.8) * 2, 1.1), std({ map: (() => { const t = checkerTex.clone(); t.repeat.set(14, 1); t.needsUpdate = true; return t; })() })); c.position.set(0, 7.6, sd * 0.51); if (sd < 0) c.rotation.y = Math.PI; grp.add(c); }
  const panel = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.0, 0.3), gm); panel.position.set(0, 6.4, -0.6); grp.add(panel);
  for (let k = 0; k < 5; k++) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1a0a, emissiveIntensity: 0 }));
    l.position.set(-1.6 + k * 0.8, 6.4, -0.8); grp.add(l); startLamps.push(l);
  }
}

// ======================= 車 =======================
const TEAMS = [
  ["Hero", "NOCTURNE", "#1a1a1a"], ["Rival1", "BIANCO ROSSO", "#d0d0d0"], ["Teal", "VERDE LIME", "#1f7a7a"], ["Purple", "VIOLA GIALLA", "#5a2a8a"],
  ["Ember", "EMBER NAVY", "#b04010"], ["Pink", "NOIR ROSE", "#e0307a"], ["Sky", "AZZURRO", "#4a90e0"], ["Forest", "FORESTA ORO", "#1d5a2a"],
  ["Crimson", "CRIMSON", "#8a0a12"], ["Navy", "NAVY SILVER", "#1a2a6a"], ["Frost", "FROST", "#e8eaf0"],
];
const NUMS = { Hero: [27, 28], Rival1: [12, 13], Teal: [31, 32], Purple: [7, 8], Ember: [4, 5], Pink: [10, 11], Sky: [21, 22], Forest: [15, 16], Crimson: [44, 45], Navy: [63, 64], Frost: [88, 89] };
const WB = 3.4, WHEEL_R = 0.36;
const cars = [];
let player = null;

const VMAX = 89;
class Car {
  constructor(name, team, color, num, isPlayer) {
    Object.assign(this, { name, team, color, num, isPlayer });
    this.x = 0; this.z = 0; this.h = 0; this.vx = 0; this.vz = 0; this.yaw = 0;
    this.steer = 0; this.thr = 0; this.brk = 0; this.idx = 0; this.s = 0; this.lat = 0;
    this.dist = 0; this.lapStart = 0; this.best = Infinity; this.last = 0; this.finished = false; this.finishTime = 0;
    this.skill = 1; this.avoid = 0; this.react = 0; this.hitT = 0; this.wheelRot = 0; this.speed = 0;
  }
  get fwd() { return [Math.sin(this.h), Math.cos(this.h)]; }
  place(s, lat) {
    const [x, z, i] = pointAt(s, lat);
    this.x = x; this.z = z; this.h = Math.atan2(TR.tx[i], TR.tz[i]); this.vx = this.vz = 0; this.idx = i;
    const p = project(x, z, i); this.s = p.s; this.lat = p.lat; this.idx = p.i;
  }
}

function physics(c, dt) {
  const [fx, fz] = c.fwd;
  const lx = fz, lz = -fx;                       // 左向き
  let vf = c.vx * fx + c.vz * fz, vl = c.vx * lx + c.vz * lz;
  const onKerb = Math.abs(c.lat) > HALF - 0.1;
  const grip = onKerb ? 0.8 : 1;
  // 加速・減速
  let acc = 0;
  if (c.thr > 0 && vf >= -0.5) acc += c.thr * Math.min(12.5 * Math.max(0, 1 - (Math.abs(vf) / VMAX) ** 2.2), 10.5 * grip + (vf > 15 ? 3 : 0));
  const brakeDec = 22 + 0.0028 * vf * vf;
  if (c.brk > 0) { if (vf > 0.5) acc -= c.brk * brakeDec; else if (c.canReverse) acc -= c.brk * 5 * (vf > -8 ? 1 : 0); else if (vf > -0.5) vf = Math.min(vf, 0); }
  acc -= 0.00052 * vf * Math.abs(vf) + (c.thr < 0.05 ? 0.6 * Math.sign(vf) : 0);
  if (onKerb) acc -= 0.004 * vf * Math.abs(vf);
  let vfNew = vf + acc * dt;
  if (!c.canReverse && c.brk > 0 && vfNew < 0 && vf >= -0.1) vfNew = 0;
  vf = (vf > 0 && vfNew < 0 && c.brk > 0 && c.thr === 0 && vf > 0.5) ? 0 : vfNew;
  // ハンドル（速いほど切れ角が小さい）
  const maxSteer = 0.36 / (1 + Math.max(vf, 0) / 26) + 0.025;
  const delta = c.steer * maxSteer;
  const aMax = G * (GRIP0 + DOWNF * vf * vf) * grip * Math.sqrt(1 - 0.55 * c.brk * c.brk * (vf > 5 ? 1 : 0));
  let yawWant = (vf * Math.tan(delta)) / WB;
  const yawLim = aMax / Math.max(Math.abs(vf), 2);
  const yawRate = clamp(yawWant, -yawLim * 1.12, yawLim * 1.12);     // 限界を少し超えると滑る
  c.h += yawRate * dt;
  c.yaw = yawRate;
  // 新しい向きで速度を分解し、横滑りをタイヤのグリップで打ち消す
  const [gx, gz] = [Math.sin(c.h), Math.cos(c.h)];
  const glx = gz, glz = -gx;
  const wx = fx * vf + lx * vl, wz = fz * vf + lz * vl;
  let nf = wx * gx + wz * gz, nl = wx * glx + wz * glz;
  const fric = aMax * dt * 1.05;
  nl = Math.abs(nl) <= fric ? 0 : nl - Math.sign(nl) * fric;
  c.vx = gx * nf + glx * nl; c.vz = gz * nf + glz * nl;
  c.x += c.vx * dt; c.z += c.vz * dt;
  c.speed = nf;
  c.slip = Math.abs(nl);
  // コース上の位置と壁
  const p = project(c.x, c.z, c.idx);
  let ds = p.s - c.s; if (ds > L / 2) ds -= L; if (ds < -L / 2) ds += L;
  c.dist += ds; c.s = p.s; c.lat = p.lat; c.idx = p.i;
  const lim = WALL - 1.0;
  if (Math.abs(c.lat) > lim) {
    const sd = Math.sign(c.lat), i = p.i;
    const push = Math.abs(c.lat) - lim;
    c.x -= TR.nx[i] * sd * push; c.z -= TR.nz[i] * sd * push; c.lat = sd * lim;
    const vn = c.vx * TR.nx[i] + c.vz * TR.nz[i];
    if (vn * sd > 0) {
      c.vx -= 1.25 * vn * TR.nx[i]; c.vz -= 1.25 * vn * TR.nz[i];
      c.vx *= 0.86; c.vz *= 0.86;
      const th = Math.atan2(TR.tx[i], TR.tz[i]);
      let dh = th - c.h; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
      if (Math.abs(dh) < 1.4) c.h += dh * 0.3;
      if (c.isPlayer && Math.abs(vn) > 2) audio.hit(Math.min(1, Math.abs(vn) / 15));
      c.hitT = 0.3;
    }
  }
}

function collideCars() {
  for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) {
    const A = cars[a], B = cars[b];
    const dx = B.x - A.x, dz = B.z - A.z;
    if (dx * dx + dz * dz > 49) continue;
    const [afx, afz] = A.fwd, [bfx, bfz] = B.fwd;
    for (const oa of [-1.75, 0, 1.75]) for (const ob of [-1.75, 0, 1.75]) {
      const ax = A.x + afx * oa, az = A.z + afz * oa, bx = B.x + bfx * ob, bz = B.z + bfz * ob;
      const ex = bx - ax, ez = bz - az, d = Math.hypot(ex, ez);
      if (d < 1.85 && d > 1e-4) {
        const nx = ex / d, nz = ez / d, pen = (1.85 - d) / 2;
        A.x -= nx * pen; A.z -= nz * pen; B.x += nx * pen; B.z += nz * pen;
        const rv = (B.vx - A.vx) * nx + (B.vz - A.vz) * nz;
        if (rv < 0) {
          const j = -(1 + 0.25) * rv / 2;
          A.vx -= j * nx; A.vz -= j * nz; B.vx += j * nx; B.vz += j * nz;
          if ((A.isPlayer || B.isPlayer) && -rv > 1.5) audio.hit(Math.min(1, -rv / 10));
        }
      }
    }
  }
}

// AI（プレイヤーの自動運転にも使う）
function aiDrive(c, dt, raceOn) {
  const vf = Math.max(c.speed, 0);
  if (!raceOn) { c.thr = 0; c.brk = 1; c.steer = 0; return; }
  if (c.react > 0) { c.react -= dt; c.thr = 0; c.brk = 0; return; }
  // 前の車を避ける
  let want = 0;
  for (const o of cars) {
    if (o === c) continue;
    let ds = o.s - c.s; if (ds < -L / 2) ds += L; if (ds > L / 2) ds -= L;
    if (ds > 0 && ds < 16 + vf * 0.15 && Math.abs(o.lat - (c.lat)) < 2.3) {
      if (o.speed < vf - 0.5) want = o.lat > c.lat ? -1 : 1;
    }
  }
  c.avoid = lerp(c.avoid, want * 2.6, 1 - Math.exp(-dt * 1.5));
  const look = 7 + vf * 0.32;
  const ti = idxAtS(c.s + look);
  const tlat = clamp(TR.line[ti] + c.avoid, -HALF + 1.2, HALF - 1.2);
  const tx = TR.x[ti] + TR.nx[ti] * tlat, tz = TR.z[ti] + TR.nz[ti] * tlat;
  const [fx, fz] = c.fwd;
  const dx = tx - c.x, dz = tz - c.z;
  const fwdD = dx * fx + dz * fz, leftD = dx * fz - dz * fx;
  const alpha = Math.atan2(leftD, fwdD);
  const delta = Math.atan((2 * WB * Math.sin(alpha)) / Math.max(look, 4));
  const maxSteer = 0.36 / (1 + vf / 26) + 0.025;
  c.steer = clamp(delta / maxSteer, -1, 1);
  // 速度
  let vt = 1e9;
  for (let d = 0; d < 40; d += 2) vt = Math.min(vt, TR.vmax[idxAtS(c.s + vf * 0.12 + d)]);
  vt *= c.skill;
  if (want !== 0 && Math.abs(c.avoid) < 1.2) vt = Math.min(vt, vf - 0.5);
  const err = vt - vf;
  c.thr = clamp(err * 0.6 + 0.2, 0, 1);
  c.brk = clamp(-err * 0.18, 0, 1);
  if (c.brk > 0.05) c.thr = 0;
}

// ======================= 入力 =======================
const keys = {};
addEventListener("keydown", (e) => {
  keys[e.code] = true;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
  if (e.code === "KeyC") camMode = (camMode + 1) % 2;
  if (e.code === "KeyM") audio.toggle();
  if (e.code === "KeyR" && state === "race" && player && !player.finished) respawn(player);
  if (e.code === "Escape") togglePause();
});
addEventListener("keyup", (e) => { keys[e.code] = false; });
addEventListener("blur", () => { if (state === "race" || state === "countdown") setPause(true); });
function readPlayer(c, dt, raceOn) {
  c.canReverse = false;
  if (DEBUG_AUTO || c.finished) return aiDrive(c, dt, raceOn);
  const up = keys.ArrowUp || keys.KeyW, dn = keys.ArrowDown || keys.KeyS;
  const lt = keys.ArrowLeft || keys.KeyA, rt = keys.ArrowRight || keys.KeyD;
  c.thr = lerp(c.thr, up ? 1 : 0, 1 - Math.exp(-dt * 10));
  c.brk = lerp(c.brk, dn ? 1 : 0, 1 - Math.exp(-dt * 14));
  const target = (lt ? 1 : 0) - (rt ? 1 : 0);
  const rate = target === 0 ? 7 : 3.2;                 // 戻りは速く、切り始めはなめらか
  c.steer = lerp(c.steer, target, 1 - Math.exp(-dt * rate));
  c.canReverse = raceOn && dn && !up && c.speed < 0.6;
  if (!raceOn) { c.brk = 1; }
}
function respawn(c) {
  const i = c.idx; c.x = TR.x[i] + TR.nx[i] * TR.line[i] * 0.3; c.z = TR.z[i] + TR.nz[i] * TR.line[i] * 0.3;
  c.h = Math.atan2(TR.tx[i], TR.tz[i]); c.vx = c.vz = 0; c.steer = 0;
  const p = project(c.x, c.z, i); c.s = p.s; c.lat = p.lat;
}

// ======================= 音 =======================
const audio = (() => {
  let ctx = null, master, on = true, eng = null, voices = [], crowdG, rev, revG, dryG;
  function noiseBuf(sec = 2) { const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; }
  function shaper(k) { const n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / n) * 2 - 1; c[i] = Math.tanh(k * x); } return c; }
  function makeEngine(gain) {
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), o3 = ctx.createOscillator();
    o1.type = "sawtooth"; o2.type = "sawtooth"; o3.type = "square";
    const g1 = ctx.createGain(), g2 = ctx.createGain(), g3 = ctx.createGain();
    g1.gain.value = 0.5; g2.gain.value = 0.35; g3.gain.value = 0.12;
    const ws = ctx.createWaveShaper(); ws.curve = shaper(2.5);
    const bp = ctx.createBiquadFilter(); bp.type = "peaking"; bp.frequency.value = 1400; bp.gain.value = 8; bp.Q.value = 0.8;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 4200;
    const out = ctx.createGain(); out.gain.value = gain;
    const nz = ctx.createBufferSource(); nz.buffer = noiseBuf(); nz.loop = true;
    const nbp = ctx.createBiquadFilter(); nbp.type = "bandpass"; nbp.frequency.value = 2600; nbp.Q.value = 0.9;
    const ng = ctx.createGain(); ng.gain.value = 0.0;
    o1.connect(g1); o2.connect(g2); o3.connect(g3); [g1, g2, g3].forEach((g) => g.connect(ws));
    ws.connect(bp); bp.connect(lp); lp.connect(out);
    nz.connect(nbp); nbp.connect(ng); ng.connect(out);
    [o1, o2, o3, nz].forEach((o) => o.start());
    return { o1, o2, o3, lp, out, ng, set(f, thr, vol, t) {
      o1.frequency.setTargetAtTime(f, t, 0.02); o2.frequency.setTargetAtTime(f * 0.5 * 1.004, t, 0.02); o3.frequency.setTargetAtTime(f * 2, t, 0.02);
      lp.frequency.setTargetAtTime(1800 + 3600 * thr, t, 0.05); out.gain.setTargetAtTime(vol, t, 0.04); ng.gain.setTargetAtTime(0.06 + 0.12 * thr, t, 0.05);
    } };
  }
  return {
    init() {
      if (ctx) return;
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0.55;
      const comp = ctx.createDynamicsCompressor(); master.connect(comp); comp.connect(ctx.destination);
      dryG = ctx.createGain(); dryG.connect(master);
      rev = ctx.createConvolver();
      const len = ctx.sampleRate * 1.6, ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
      rev.buffer = ir; revG = ctx.createGain(); revG.gain.value = 0.15; rev.connect(revG); revG.connect(master);
      eng = makeEngine(0.0); eng.out.connect(dryG); eng.out.connect(rev);
      for (let k = 0; k < 4; k++) { const v = makeEngine(0); v.out.connect(dryG); v.out.connect(rev); voices.push(v); }
      const cs = ctx.createBufferSource(); cs.buffer = noiseBuf(3); cs.loop = true;
      const cb = ctx.createBiquadFilter(); cb.type = "bandpass"; cb.frequency.value = 900; cb.Q.value = 0.5;
      crowdG = ctx.createGain(); crowdG.gain.value = 0; cs.connect(cb); cb.connect(crowdG); crowdG.connect(master); cs.start();
    },
    resume() { if (ctx && ctx.state !== "running") ctx.resume(); },
    toggle() { on = !on; if (master) master.gain.value = on ? 0.55 : 0; },
    update(dt) {
      if (!ctx || !player) return;
      const t = ctx.currentTime;
      const g = gearOf(player.speed);
      const f = (g.rpm / 60) * 3 * 0.5;
      eng.set(f, player.thr, paused ? 0 : 0.18 + 0.22 * player.thr, t);
      // 近くのAI車（ドップラー付き）
      const lx = camera.position.x, lz = camera.position.z;
      const near = cars.filter((c) => c !== player).map((c) => [c, Math.hypot(c.x - lx, c.z - lz)]).sort((a, b) => a[1] - b[1]).slice(0, 4);
      near.forEach(([c, d], k) => {
        const gg = gearOf(c.speed);
        const dirx = (lx - c.x) / (d + 1e-3), dirz = (lz - c.z) / (d + 1e-3);
        const vr = c.vx * dirx + c.vz * dirz - (player.vx * dirx + player.vz * dirz) * (camMode === 1 ? 1 : 0.9);
        const dop = 343 / Math.max(343 - clamp(vr, -150, 150), 100);
        voices[k].set((gg.rpm / 60) * 1.5 * dop * (0.97 + k * 0.012), c.thr, paused ? 0 : 0.5 / (1 + (d / 9) ** 1.6), t);
      });
      const dCrowd = Math.hypot(player.x - STAND.x, player.z - STAND.z);
      crowdG.gain.setTargetAtTime(paused ? 0 : (finishCheer > 0 ? 0.35 : 0.05) / (1 + dCrowd / 120), t, 0.3);
      revG.gain.setTargetAtTime(inTunnelIdx(player.idx) ? 0.9 : 0.12, t, 0.15);
    },
    hit(v) {
      if (!ctx) return;
      const b = ctx.createBufferSource(); b.buffer = noiseBuf(0.3);
      const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 900;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.6 * v, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      b.connect(f); f.connect(g); g.connect(master); b.start();
    },
    beep(freq, dur = 0.18) {
      if (!ctx) return;
      const o = ctx.createOscillator(); o.frequency.value = freq; o.type = "square";
      const g = ctx.createGain(); g.gain.setValueAtTime(0.12, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + dur);
    },
  };
})();
const GEARS = [0, 85, 120, 155, 190, 225, 260, 292, 340];
function gearOf(v) {
  const kmh = Math.max(0, v * 3.6);
  let g = 1; while (g < 8 && kmh > GEARS[g]) g++;
  const lo = GEARS[g - 1] * (g > 1 ? 0.78 : 0), hi = GEARS[g];
  const rpm = 4200 + clamp((kmh - lo) / (hi - lo), 0, 1) * 7800;
  return { g, rpm };
}

// ======================= カメラ =======================
let camMode = 0;
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
function updateCamera(dt, snap = false) {
  const c = player; if (!c) return;
  const [fx, fz] = c.fwd;
  if (camMode === 0) {
    const sp = Math.max(c.speed, 0);
    const back = 7.2 + sp * 0.012;
    const want = new THREE.Vector3(c.x - fx * back, 2.35, c.z - fz * back);
    const look = new THREE.Vector3(c.x + fx * 5, 1.0, c.z + fz * 5);
    const k = snap ? 1 : 1 - Math.exp(-dt * 7);
    camPos.lerp(want, k); camLook.lerp(look, snap ? 1 : 1 - Math.exp(-dt * 12));
    camera.fov = lerp(camera.fov, 60 + sp * 0.14, 1 - Math.exp(-dt * 3));
  } else {
    camPos.set(c.x - fx * 0.45, 1.13, c.z - fz * 0.45);
    camLook.set(c.x + fx * 30, 0.85, c.z + fz * 30);
    camera.fov = lerp(camera.fov, 74, 1 - Math.exp(-dt * 3));
  }
  // 壁の外にカメラが出ないように
  const p = project(camPos.x, camPos.z, c.idx);
  if (Math.abs(p.lat) > WALL - 0.4) { const sd = Math.sign(p.lat), push = Math.abs(p.lat) - (WALL - 0.4); camPos.x -= TR.nx[p.i] * sd * push; camPos.z -= TR.nz[p.i] * sd * push; }
  camera.position.copy(camPos);
  if (camMode === 0 && c.hitT > 0) camera.position.y += (Math.random() - 0.5) * c.hitT * 0.4;
  camera.lookAt(camLook);
  camera.updateProjectionMatrix();
  sun.position.set(c.x + sunDir.x * 200, sunDir.y * 200, c.z + sunDir.z * 200);
  sun.target.position.set(c.x, 0, c.z);
  hemi.intensity = lerp(hemi.intensity, inTunnelIdx(c.idx) ? 0.25 : 0.9, 1 - Math.exp(-dt * 4));
  scene.environmentIntensity = hemi.intensity * 0.6;
}

// ======================= HUD・ミニマップ =======================
const mapC = $("mapc"), mapG = mapC.getContext("2d");
let mapBase = null;
const bounds = (() => { let a = 1e9, b = -1e9, c = 1e9, d = -1e9; for (let i = 0; i < N; i++) { a = Math.min(a, TR.x[i]); b = Math.max(b, TR.x[i]); c = Math.min(c, TR.z[i]); d = Math.max(d, TR.z[i]); } return { a, b, c, d }; })();
const mapScale = 190 / Math.max(bounds.b - bounds.a, bounds.d - bounds.c);
const toMap = (x, z) => [104 + (x - (bounds.a + bounds.b) / 2) * mapScale, 104 - (z - (bounds.c + bounds.d) / 2) * mapScale];
function drawMapBase() {
  const c = document.createElement("canvas"); c.width = c.height = 208; const g = c.getContext("2d");
  g.lineWidth = 7; g.strokeStyle = "rgba(255,255,255,0.18)"; g.lineJoin = "round"; g.beginPath();
  for (let i = 0; i <= N; i += 4) { const [x, y] = toMap(TR.x[wrap(i)], TR.z[wrap(i)]); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
  g.lineWidth = 2.5; g.strokeStyle = "rgba(255,255,255,0.75)"; g.stroke();
  g.lineWidth = 4; g.strokeStyle = "#555"; g.beginPath();
  for (let c2 = 0; c2 <= wrap(TUN_B - TUN_A); c2 += 4) { const [x, y] = toMap(TR.x[wrap(TUN_A + c2)], TR.z[wrap(TUN_A + c2)]); c2 ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
  const [fx, fy] = toMap(TR.x[FIN_I], TR.z[FIN_I]); g.fillStyle = "#fff"; g.fillRect(fx - 6, fy - 1.5, 12, 3);
  mapBase = c;
}
const fmt = (t) => { if (!isFinite(t) || t <= 0) return "--:--.---"; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(3).padStart(6, "0")}`; };
let boardT = 0;
function order() {
  return [...cars].sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1; if (b.finished) return 1;
    return b.dist - a.dist;
  });
}
function updateHUD(dt) {
  const c = player; if (!c) return;
  const ord = order();
  const pos = ord.indexOf(c) + 1;
  $("pos").textContent = `${pos}/${cars.length}`;
  const lap = clamp(Math.floor(c.dist / L) + 1, 1, LAPS);
  $("lap").textContent = `${lap}/${LAPS}`;
  const cur = state === "race" && !c.finished ? raceT - c.lapStart : c.last;
  $("cur").textContent = fmt(state === "race" || c.finished ? cur : 0);
  $("last").innerHTML = `LAST ${fmt(c.last)} &nbsp; BEST ${fmt(c.best)}`;
  const g = gearOf(c.speed);
  $("spd").textContent = Math.round(Math.abs(c.speed) * 3.6);
  $("gear").textContent = c.speed < -0.5 ? "R" : g.g;
  $("rpm").firstElementChild.style.width = `${clamp((g.rpm - 4000) / 8200, 0, 1) * 100}%`;
  boardT -= dt;
  if (boardT <= 0) {
    boardT = 0.25;
    const lead = ord[0];
    const rows = ord.map((o, k) => {
      let gap = "";
      if (k === 0) gap = o.finished ? "WIN" : "LEADER";
      else if (o.finished) gap = `+${(o.finishTime - lead.finishTime).toFixed(1)}`;
      else { const dd = lead.dist - o.dist; gap = dd > L ? `+${Math.floor(dd / L)}L` : `+${(dd / Math.max(lead.speed, 30)).toFixed(1)}`; }
      return `<div class="row ${o === c ? "me" : ""}"><span class="p">${k + 1}</span><span class="sw" style="background:${o.color}"></span><span>#${o.num} ${o.team}</span><span class="gap">${gap}</span></div>`;
    });
    const me = ord.indexOf(c);
    const show = new Set([0, 1, 2, me - 1, me, me + 1].filter((v) => v >= 0 && v < ord.length));
    $("board").innerHTML = [...show].sort((a, b) => a - b).map((k) => rows[k]).join("");
  }
  // ミニマップ
  if (!mapBase) drawMapBase();
  mapG.clearRect(0, 0, 208, 208); mapG.drawImage(mapBase, 0, 0);
  for (const o of cars) { if (o === c) continue; const [x, y] = toMap(o.x, o.z); mapG.fillStyle = o.color; mapG.beginPath(); mapG.arc(x, y, 3, 0, 7); mapG.fill(); }
  const [x, y] = toMap(c.x, c.z); mapG.fillStyle = "#ff3b30"; mapG.strokeStyle = "#fff"; mapG.lineWidth = 2; mapG.beginPath(); mapG.arc(x, y, 5, 0, 7); mapG.fill(); mapG.stroke();
}
let msgT = 0;
function showMsg(t, sec = 1.5) { const m = $("msg"); m.textContent = t; m.style.opacity = 1; msgT = sec; }

// チェッカーフラッグと紙吹雪（画面上）
const flagC = $("flag"), flagG = flagC.getContext("2d");
let finishCheer = 0, confetti = [];
function fireConfetti() {
  flagC.width = innerWidth; flagC.height = innerHeight;
  const cols = ["#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#ffffff", "#ff2d92"];
  for (let i = 0; i < 260; i++) confetti.push({ x: Math.random() * innerWidth, y: -Math.random() * innerHeight * 0.6, vx: (Math.random() - 0.5) * 60, vy: 80 + Math.random() * 120, r: Math.random() * 6, vr: (Math.random() - 0.5) * 10, c: cols[i % cols.length], w: 6 + Math.random() * 6 });
}
function drawFlagFx(dt, t) {
  if (finishCheer <= 0 && !confetti.length) return;
  flagG.clearRect(0, 0, flagC.width, flagC.height);
  if (finishCheer > 0) {
    finishCheer -= dt;
    const W = Math.min(innerWidth * 0.34, 440), H = W * 0.62, X0 = innerWidth / 2 - W / 2, Y0 = innerHeight * 0.16;
    const nx = 10, ny = 6, cw = W / nx, ch = H / ny;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const u = i / nx, wv = Math.sin(t * 7 - u * 6) * 14 * u, wv2 = Math.sin(t * 7 - (u + 1 / nx) * 6) * 14 * (u + 1 / nx);
      flagG.fillStyle = (i + j) % 2 ? "#111" : "#f4f4f4";
      flagG.beginPath(); flagG.moveTo(X0 + i * cw, Y0 + j * ch + wv); flagG.lineTo(X0 + (i + 1) * cw, Y0 + j * ch + wv2);
      flagG.lineTo(X0 + (i + 1) * cw, Y0 + (j + 1) * ch + wv2); flagG.lineTo(X0 + i * cw, Y0 + (j + 1) * ch + wv); flagG.fill();
    }
    flagG.fillStyle = "#ccc"; flagG.fillRect(X0 - 8, Y0 - 10, 6, H + 160);
  }
  confetti = confetti.filter((p) => p.y < innerHeight + 20);
  for (const p of confetti) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
    flagG.save(); flagG.translate(p.x, p.y); flagG.rotate(p.r); flagG.fillStyle = p.c; flagG.fillRect(-p.w / 2, -2, p.w, 4); flagG.restore();
  }
}

// ======================= レース進行 =======================
let state = "title", paused = false, raceT = 0, cdT = 0, lightsOn = 0, goDelay = 0, LAPS = 3, resultShown = false;
function setupRace() {
  LAPS = parseInt($("laps").value, 10) || 3;
  const diff = parseFloat($("diff").value);
  // スタート順: 主役は11番手
  const others = cars.filter((c) => c !== player);
  others.sort((a, b) => b.base - a.base);
  const grid = [...others.slice(0, 10), player, ...others.slice(10)];
  grid.forEach((c, k) => {
    c.place(S_FIN - 12 - k * 8, k % 2 ? -2.4 : 2.4);
    c.dist = (c.s - S_FIN > L / 2 ? c.s - S_FIN - L : c.s - S_FIN);
    c.lapStart = 0; c.best = Infinity; c.last = 0; c.finished = false; c.finishTime = 0;
    c.thr = c.brk = c.steer = 0; c.avoid = 0; c.speed = 0;
    c.skill = c === player ? 1 : clamp(c.base * diff, 0.85, 1.02);
    c.react = c === player ? 0 : 0.12 + Math.random() * 0.3;
  });
  clearInterval(resTimer);
  raceT = 0; cdT = 0; lightsOn = 0; goDelay = 0.6 + Math.random() * 0.9; resultShown = false;
  finishCheer = 0; confetti = []; flagG.clearRect(0, 0, flagC.width, flagC.height);
  startLamps.forEach((l) => (l.material.emissiveIntensity = 0));
  state = "countdown";
  $("lights").style.display = "flex"; [...$("lights").children].forEach((l) => l.classList.remove("on"));
  ["tl", "times", "board", "map", "speedo", "help"].forEach((id) => $(id).classList.remove("hidden"));
  $("result").classList.add("hidden");
  updateCamera(0, true);
}
function stepRace(dt) {
  if (state === "countdown") {
    cdT += dt;
    const n = Math.min(5, Math.floor(cdT / 0.9));
    if (n > lightsOn) { lightsOn = n; [...$("lights").children].forEach((l, k) => l.classList.toggle("on", k < n)); startLamps.forEach((l, k) => (l.material.emissiveIntensity = k < n ? 6 : 0)); audio.beep(520); }
    if (cdT > 4.5 + goDelay) {
      state = "race"; raceT = 0;
      [...$("lights").children].forEach((l) => l.classList.remove("on")); startLamps.forEach((l) => (l.material.emissiveIntensity = 0));
      setTimeout(() => ($("lights").style.display = "none"), 1200);
      showMsg("GO!", 1.0); audio.beep(1040, 0.35);
    }
  }
  const raceOn = state === "race" || state === "finished";
  if (raceOn) raceT += dt;
  for (const c of cars) {
    if (c === player) readPlayer(c, dt, raceOn); else aiDrive(c, dt, raceOn);
  }
  const sub = 2, h = dt / sub;
  if (raceOn) for (let k = 0; k < sub; k++) { for (const c of cars) physics(c, h); collideCars(); }
  // 周回
  for (const c of cars) {
    if (c.finished || !raceOn) continue;
    const lapNow = Math.floor(c.dist / L);
    if (c.lapIdx === undefined) c.lapIdx = Math.floor(c.dist / L);
    if (lapNow > c.lapIdx) {
      if (c.lapIdx >= 0) { c.last = raceT - c.lapStart; c.best = Math.min(c.best, c.last); }
      c.lapStart = raceT; c.lapIdx = lapNow;
      if (lapNow >= LAPS) {
        c.finished = true; c.finishTime = raceT;
        if (c === player) onPlayerFinish();
      } else if (c === player && lapNow === LAPS - 1) showMsg("FINAL LAP", 1.6);
      else if (c === player && lapNow >= 1) showMsg(`LAP ${lapNow + 1}`, 1.2);
    }
  }
}
function onPlayerFinish() {
  state = "finished";
  const pos = order().indexOf(player) + 1;
  showMsg(pos === 1 ? "WINNER!" : `FINISH  P${pos}`, 3.5);
  finishCheer = 4.5; fireConfetti();
  setTimeout(showResults, 5200);
}
let resTimer = null;
function showResults() {
  if (resultShown) return; resultShown = true;
  renderResults(); clearInterval(resTimer); resTimer = setInterval(renderResults, 1000);
  $("result").classList.remove("hidden");
}
function renderResults() {
  const ord = order(), pos = ord.indexOf(player) + 1;
  $("resTitle").textContent = pos === 1 ? "WINNER!" : `P${pos} FINISH`;
  $("resSub").textContent = `タイム ${fmt(player.finishTime)} ／ ベストラップ ${fmt(player.best)}`;
  const lead = ord[0];
  $("resTable").innerHTML = ord.map((o, k) => {
    const t = k === 0 ? fmt(o.finishTime) : o.finished ? `+${(o.finishTime - lead.finishTime).toFixed(3)}` : (o.dist < (LAPS - 1) * L ? `+${LAPS - 1 - Math.floor(o.dist / L) + 1}周` : "走行中");
    return `<tr class="${o === player ? "me" : ""}"><td>${k + 1}</td><td><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${o.color};margin-right:6px"></span>#${o.num} ${o.team}</td><td style="text-align:right">${t}</td><td style="text-align:right;opacity:.7">${fmt(o.best)}</td></tr>`;
  }).join("");
}
function setPause(p) {
  if (state === "title" || state === "finished" && resultShown) return;
  paused = p; $("pause").classList.toggle("hidden", !p);
}
function togglePause() { setPause(!paused); }
$("resumeBtn").onclick = () => setPause(false);
$("restartBtn").onclick = () => { setPause(false); setupRace(); };
$("againBtn").onclick = () => setupRace();

// ======================= 読み込み =======================
const loader = new GLTFLoader();
const wheelPos = { FL: [-0.8, 0.36, -1.7], FR: [0.8, 0.36, -1.7], RL: [-0.76, 0.36, 1.7], RR: [0.76, 0.36, 1.7] };
loader.load("./assets/cars.glb", (gltf) => {
  const byName = {};
  gltf.scene.traverse((o) => { if (o.isMesh || o.isGroup || o.isObject3D) byName[o.name] = o; });
  const wf = byName.wheel_front, wr = byName.wheel_rear;
  const baseRank = ["Rival1", "Crimson", "Teal", "Navy", "Ember", "Frost", "Purple", "Sky", "Forest", "Pink", "Hero"];
  for (const [tn, team, color] of TEAMS) for (let k = 0; k < 2; k++) {
    const name = k === 0 ? tn : tn + "Mate";
    const body = byName[name + "_body"];
    const isP = name === "Hero";
    const car = new Car(name, team, color, NUMS[tn][k], isP);
    const grp = new THREE.Group();
    if (body) { body.position.set(0, 0, 0); body.rotation.set(0, 0, 0); grp.add(body); body.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); }
    car.wheels = [];
    for (const key of ["FL", "FR", "RL", "RR"]) {
      const src = key[0] === "F" ? wf : wr;
      const piv = new THREE.Group(); piv.position.set(...wheelPos[key]);
      const spin = new THREE.Group(); piv.add(spin);
      if (src) { const w = src.clone(); w.position.set(0, 0, 0); w.rotation.set(0, 0, 0); w.traverse((m) => { if (m.isMesh) m.castShadow = true; }); spin.add(w); }
      grp.add(piv); car.wheels.push({ piv, spin, front: key[0] === "F" });
    }
    scene.add(grp); car.obj = grp;
    const r = baseRank.indexOf(tn);
    car.base = 1.0 - r * 0.0085 - k * 0.006 - Math.random() * 0.004;
    cars.push(car);
    if (isP) player = car;
  }
  // 起動前の見た目のためにいったん並べる
  cars.forEach((c, k) => c.place(S_FIN - 12 - k * 8, k % 2 ? -2.4 : 2.4));
  syncCars(0);
  updateCamera(0, true);
  $("startBtn").disabled = false; $("startBtn").textContent = "レース開始";
  $("loadbar").firstElementChild.style.width = "100%";
  if (Q.get("skip") === "1") startGame();
}, (e) => { if (e.total) $("loadbar").firstElementChild.style.width = `${(e.loaded / e.total) * 100}%`; }, (err) => { $("startBtn").textContent = "読み込みエラー"; console.error(err); });

if (Q.get("laps")) $("laps").value = Q.get("laps");
function startGame() {
  audio.init(); audio.resume();
  applyQuality($("quality").value);
  $("title").classList.add("hidden");
  setupRace();
}
$("startBtn").onclick = startGame;

function syncCars(dt) {
  for (const c of cars) {
    c.obj.position.set(c.x, 0, c.z);
    c.obj.rotation.y = c.h + Math.PI;
    c.wheelRot -= (c.speed * dt) / WHEEL_R;
    const st = c.steer * (0.36 / (1 + Math.max(c.speed, 0) / 26) + 0.025);
    for (const w of c.wheels) { w.spin.rotation.x = c.wheelRot; if (w.front) w.piv.rotation.y = st; }
    if (c.hitT > 0) c.hitT -= dt;
  }
}

// ======================= メインループ =======================
let lastT = performance.now(), fpsAcc = 0, fpsN = 0;
window.__game = { cars: () => cars, player: () => player, state: () => state, L, order };
// テスト用: 描画せずにレースを早送り
window.__simulate = (sec, h = 1 / 60) => {
  let wallHits = 0;
  for (let t = 0; t < sec; t += h) {
    const before = cars.map((c) => c.hitT);
    stepRace(h); syncCars(h); updateCamera(h); if (msgT > 0) { msgT -= h; if (msgT <= 0) $("msg").style.opacity = 0; }
    cars.forEach((c, k) => { if (c.hitT > 0.29 && before[k] <= 0.01) wallHits++; });
  }
  return { state, raceT, wallHits, ord: order().map((c) => `${c.name}:${c.finished ? "F" + c.finishTime.toFixed(1) : (c.dist / L).toFixed(2)}`), player: { dist: player.dist, best: player.best, finished: player.finished } };
};
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min((now - lastT) / 1000, 1 / 20); lastT = now;
  dt *= TIME_SCALE;
  if (!paused && cars.length) {
    if (state !== "title") stepRace(dt);
    syncCars(dt);
    updateCamera(dt);
    updateHUD(dt);
  }
  audio.update(dt);
  if (msgT > 0) { msgT -= dt; if (msgT <= 0) $("msg").style.opacity = 0; }
  drawFlagFx(dt, now / 1000);
  renderer.render(scene, camera);
  fpsAcc += dt; fpsN++; if (fpsAcc > 1) { window.__fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
}
requestAnimationFrame(frame);
