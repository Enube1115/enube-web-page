// HARBOUR GP — 港町ストリートレース（Three.js）
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Sky } from "three/addons/objects/Sky.js";
import { MeshoptDecoder } from "./lib/meshopt_decoder.js";

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
// ---- コース（2種類）。選んだコースはページを読み直して作り直す ----
const SETTINGS = (() => { try { return JSON.parse(localStorage.getItem("hgp_settings") || "{}"); } catch (e) { return {}; } })();
const TRACK_ID = Q.get("track") === "2" ? 2 : Q.get("track") === "1" ? 1 : +SETTINGS.track === 2 ? 2 : 1;
const TRACKS = {
  1: { name: "ハーバー市街地", sub: "高速コーナーとトンネル", tunnel: [[316, 345], [291, 125]], ctrl: [[0, 0], [0, 120], [0, 240], [0, 330], [12, 375], [50, 400], [110, 405], [180, 415], [240, 435], [285, 470],
  [320, 515], [365, 555], [425, 572], [468, 565], [487, 543], [478, 520], [450, 512], [415, 500], [380, 470],
  [352, 432], [330, 385], [312, 330], [300, 260], [292, 190], [290, 120], [292, 70], [282, 45], [262, 35],
  [248, 15], [232, -2], [200, -20], [150, -40], [100, -60], [55, -65], [20, -50]] },
  2: { name: "マリーナ・ヘアピン", sub: "シケイン・ヘアピン・S字の多いテクニカルコース", tunnel: [[372, 292], [364, 190]], ctrl: [
    [0, 0], [0, 120], [0, 240], [0, 320], [14, 362], [55, 377], [100, 380], [130, 380], [150, 386], [172, 374], [195, 386],
    [240, 405], [290, 410], [332, 421], [372, 438], [398, 415], [388, 378], [372, 300], [366, 200], [360, 125], [345, 75],
    [310, 55], [260, 72], [215, 50], [170, 72], [125, 52], [88, 24], [66, -12], [48, -45], [22, -56], [4, -30],
  ] },
};
const TRK = TRACKS[TRACK_ID];
const CTRL = TRK.ctrl;
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
    const gA = GRIP0 * 1.08;
    const denA = 1 - G * DOWNF * 1.08 * R;
    TR.vmax[i] = denA > 0.05 ? Math.min(Math.sqrt((G * gA * R) / denA), 90) : 90;
  }
  TR.vcorner = Float32Array.from(TR.vmax);
  for (let pass = 0; pass < 3; pass++)
    for (let i = N - 1; i >= 0; i--) {
      const j = wrap(i + 1);
      TR.vmax[i] = Math.min(TR.vmax[i], Math.sqrt(TR.vmax[j] ** 2 + 2 * 31 * DS));
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
// コース上の位置・向き（となりの点との間を補間する）
function trackAt(s) {
  const u = (((s % L) + L) % L) / DS, f0 = Math.floor(u), f = u - f0, i0 = wrap(f0), i1 = wrap(f0 + 1);
  let tx = lerp(TR.tx[i0], TR.tx[i1], f), tz = lerp(TR.tz[i0], TR.tz[i1], f); const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
  return { x: lerp(TR.x[i0], TR.x[i1], f), z: lerp(TR.z[i0], TR.z[i1], f), tx, tz, nx: tz, nz: -tx, i: f < 0.5 ? i0 : i1 };
}
function pointAt(s, lat) { const i = idxAtS(s); return [TR.x[i] + TR.nx[i] * lat, TR.z[i] + TR.nz[i] * lat, i]; }

const FIN_I = nearestIdx(0, 150);
const S_FIN = TR.s[FIN_I];
const TUN_A = nearestIdx(...TRK.tunnel[0]), TUN_B = nearestIdx(...TRK.tunnel[1]);   // トンネル区間
const wrapDs = (d) => (d > L / 2 ? d - L : d < -L / 2 ? d + L : d);
const smooth01 = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
// ピットレーン（スタート直線の観客席側）: S_FIN からの距離。A〜B=入口, B〜C=速度制限区間, C〜D=出口
const PIT_SD = Math.sign(TR.nx[FIN_I]) || 1;
const PIT = { A: -150, B: -100, C: 100, D: 150, lane: 10, box: 14, lim: 22, wall: 16.8 };
const pitRel = (s) => wrapDs(s - S_FIN);
const inPitGap = (i) => { const r = pitRel(TR.s[i]); return (r > PIT.A - 2 && r < PIT.B) || (r > PIT.C && r < PIT.D + 2); };
const inPitZone = (i) => { const r = pitRel(TR.s[i]); return r > PIT.A - 10 && r < PIT.D + 10; };
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
let ROAD_MAT = null, BUILD_MAT = null;
{
  const road = ribbon(-HALF, HALF, 0, 0, 1, null, 12);
  asphaltTex.repeat.set(3, 1);
  const m = std({ map: asphaltTex, roughness: 0.85, color: 0x9a9a9a, side: THREE.DoubleSide });
  mesh(road, m); ROAD_MAT = m;
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
  const iA = idxAtS(S_FIN + PIT.A), iB = idxAtS(S_FIN + PIT.B), iC = idxAtS(S_FIN + PIT.C), iD = idxAtS(S_FIN + PIT.D);
  for (const sd of [-1, 1]) {
    // ピット側はピット入口・出口の所だけガードレールを切る
    const segs = sd === PIT_SD ? [[iB, iB + wrap(iC - iB)], [iD, iD + wrap(iA - iD)]] : [[0, N]];
    for (const [a, b] of segs) {
      mesh(ribbon(sd * WALL, sd * WALL, 0.3, 0.62, 2, null, 0, a, b), armco, true);
      mesh(ribbon(sd * WALL, sd * WALL, 0.72, 1.04, 2, null, 0, a, b), armco, true);
      mesh(ribbon(sd * (WALL + 0.06), sd * (WALL + 0.06), 1.04, 1.7, 1, (i, c) => BOARD_COLS[(Math.floor(c * DS / 7) + (sd > 0 ? 3 : 0)) % 6], 0, a, b), boards);
      for (const y of [2.4, 3.1, 3.8]) mesh(ribbon(sd * (WALL + 0.25), sd * (WALL + 0.25), y, y + 0.03, 4, null, 0, a, b), wire);
    }
  }
  // 柱（インスタンス）
  const postG = new THREE.BoxGeometry(0.09, 4.2, 0.09);
  const cnt = Math.floor(N / 4) * 2;
  const posts = new THREE.InstancedMesh(postG, wire, cnt);
  const m4 = new THREE.Matrix4(); let k = 0;
  for (let i = 0; i < N; i += 4) for (const sd of [-1, 1]) {
    if (inTunnelIdx(i) || (sd === PIT_SD && inPitGap(i))) { m4.makeScale(0, 0, 0); posts.setMatrixAt(k++, m4); continue; }
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

// ブレーキの目安看板（大きく減速するコーナーの手前 150 / 100 / 50 m）
{
  const tex = {};
  for (const n of [150, 100, 50]) tex[n] = canvasTex(128, 96, (g, w, h) => {
    g.fillStyle = "#f4f4f4"; g.fillRect(0, 0, w, h); g.fillStyle = "#111"; g.font = "bold 62px Helvetica, Arial"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(n), w / 2, h / 2 + 4);
  }, false);
  const corners = [];
  for (let i = 0; i < N; i++) {
    const a = TR.vcorner[wrap(i - 1)], b = TR.vcorner[i];
    if (a >= 58 && b < 58) corners.push(i);           // 曲がれる速さが約210km/h未満になる地点
  }
  const postM = std({ color: 0x333333, roughness: 0.6 });
  for (const ci of corners) {
    // 本当にブレーキが必要な所だけ（手前100mの最高速度との差が大きい）
    let vin = 0; for (let d = 40; d < 160; d += 4) vin = Math.max(vin, TR.vcorner[wrap(ci - Math.round(d / DS))]);
    if (vin - TR.vcorner[ci] < 18) continue;
    let mn = 99; for (let d = 0; d < 40; d++) mn = Math.min(mn, TR.vcorner[wrap(ci + d)]);
    const sd = Math.sign(-kS[wrap(ci + 15)]) || 1;     // コーナーの外側に置く
    for (const n of [150, 100, 50]) {
      const i = wrap(ci - Math.round(n / DS));
      if (inTunnelIdx(i)) continue;
      const board = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.0), std({ map: tex[n], roughness: 0.5 }));
      const lt = sd * (WALL + 0.12);
      board.position.set(TR.x[i] + TR.nx[i] * lt, 2.2, TR.z[i] + TR.nz[i] * lt);
      board.rotation.y = Math.atan2(TR.tx[i], TR.tz[i]) + Math.PI;
      scene.add(board);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.7, 0.08), postM); post.position.set(board.position.x, 0.85, board.position.z); scene.add(post);
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
    if (x > 6 && x < 50 && z > -15 && z < 320) return;   // 観客スタンド・ピットの場所
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
  const bm = std({ map: windowTex, vertexColors: true, roughness: 0.85 }); BUILD_MAT = bm;
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
    if (inTunnelIdx(i) || isWater(x, z) || distToTrack(x, z) < WALL + 2 || (sd === PIT_SD && inPitZone(i))) continue;
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
    const g = new THREE.BoxGeometry(1.2, 0.6, 210); g.translate(24.5 + t * 1.15, 0.3 + t * 0.6, STAND.z); tiers.push(g);
  }
  mesh(mergeGeometries(tiers), std({ color: 0x5b5e63, roughness: 0.8 }), true);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(17, 0.3, 214), std({ color: 0x23262b, roughness: 0.5, metalness: 0.4 }));
  roof.position.set(32, 11.2, STAND.z); roof.castShadow = true; scene.add(roof);
  const crowdG = new THREE.BoxGeometry(0.42, 0.95, 0.42); crowdG.translate(0, 0.47, 0);
  const crowd = new THREE.InstancedMesh(crowdG, std({ roughness: 0.8 }), 4200);
  const cc = [0xd33a2c, 0xf2f2f2, 0x1d1d1d, 0x2a56c6, 0xf1c40f, 0xa47a5e, 0x2e8b57, 0xff7a1a].map((c) => new THREE.Color(c));
  const m4 = new THREE.Matrix4(); let k = 0;
  for (let t = 0; t < 12; t++) for (let z = STAND.z - 103; z < STAND.z + 103; z += 0.55) {
    if (rand() < 0.12 || k >= 4200) continue;
    m4.makeTranslation(24.4 + t * 1.15 + (rand() - 0.5) * 0.2, 0.6 + t * 0.6, z); crowd.setMatrixAt(k, m4); crowd.setColorAt(k, cc[Math.floor(rand() * cc.length)]); k++;
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
// 11チーム×2台。マシン性能（top=最高速m/s, pwr=加速, grip=コーナー, brk=ブレーキ）とドライバー（pace=速さ, cons=安定感, agg=攻撃性）
// ※チーム名・ドライバー名はすべて架空
const TEAMS = [
  { key: "Hero", name: "NOCTURNE RACING", short: "NOCTURNE", color: "#1a1a1a", nums: [27, 28], trait: "総合力が高い",
    car: { top: 89.0, pwr: 1.02, grip: 1.02, brk: 1.01 },
    drivers: [{ jp: "カイト・アラシ", code: "ARA", pace: 1.0, cons: 0.85, agg: 0.75 }, { jp: "ユウマ・サクラバ", code: "SAK", pace: 0.99, cons: 0.8, agg: 0.5 }] },
  { key: "Rival1", name: "BIANCO ROSSO CORSE", short: "BIANCO ROSSO", color: "#d0d0d0", nums: [12, 13], trait: "最強の万能マシン",
    car: { top: 89.0, pwr: 1.01, grip: 1.02, brk: 1.01 },
    drivers: [{ jp: "ルカ・ベネデッティ", code: "BEN", pace: 0.999, cons: 0.85, agg: 0.6 }, { jp: "マルコ・ヴァレンテ", code: "VAL", pace: 0.993, cons: 0.85, agg: 0.55 }] },
  { key: "Teal", name: "VERDE LIME GP", short: "VERDE LIME", color: "#1f7a7a", nums: [31, 32], trait: "コーナーの王者／直線は遅い",
    car: { top: 86.5, pwr: 0.98, grip: 1.07, brk: 1.0 },
    drivers: [{ jp: "オスカー・リンドクヴィスト", code: "LIN", pace: 0.998, cons: 0.8, agg: 0.65 }, { jp: "テオ・マルシャン", code: "MAR", pace: 0.99, cons: 0.75, agg: 0.5 }] },
  { key: "Purple", name: "VIOLA MOTORSPORT", short: "VIOLA", color: "#5a2a8a", nums: [7, 8], trait: "ブレーキ最強／加速は弱め",
    car: { top: 86.5, pwr: 0.96, grip: 1.045, brk: 1.08 },
    drivers: [{ jp: "ディエゴ・ナヴァーロ", code: "NAV", pace: 0.995, cons: 0.65, agg: 0.9 }, { jp: "レン・クロサワ", code: "KUR", pace: 0.985, cons: 0.8, agg: 0.45 }] },
  { key: "Ember", name: "EMBER NAVY RACING", short: "EMBER NAVY", color: "#b04010", nums: [4, 5], trait: "ブレーキング勝負",
    car: { top: 88.0, pwr: 1.0, grip: 0.99, brk: 1.06 },
    drivers: [{ jp: "フェリックス・ブラント", code: "BRA", pace: 0.997, cons: 0.75, agg: 0.8 }, { jp: "サム・ウィットロック", code: "WHI", pace: 0.986, cons: 0.85, agg: 0.4 }] },
  { key: "Pink", name: "NOIR ROSE F.T.", short: "NOIR ROSE", color: "#e0307a", nums: [10, 11], trait: "新人コンビ／当たれば速い",
    car: { top: 87.5, pwr: 1.0, grip: 0.985, brk: 0.98 },
    drivers: [{ jp: "ニコ・フェラス", code: "FRZ", pace: 1.002, cons: 0.5, agg: 0.95 }, { jp: "イヴァン・ペトロフ", code: "PET", pace: 0.98, cons: 0.55, agg: 0.75 }] },
  { key: "Sky", name: "AZZURRO RACING", short: "AZZURRO", color: "#4a90e0", nums: [21, 22], trait: "最高速No.1／コーナーは苦手",
    car: { top: 94.5, pwr: 1.01, grip: 0.97, brk: 0.98 },
    drivers: [{ jp: "ユーゴ・ルフェーヴル", code: "LEF", pace: 0.994, cons: 0.8, agg: 0.6 }, { jp: "エイデン・コール", code: "COL", pace: 0.985, cons: 0.85, agg: 0.5 }] },
  { key: "Forest", name: "FORESTA ORO", short: "FORESTA ORO", color: "#1d5a2a", nums: [15, 16], trait: "後方チーム／安定感はある",
    car: { top: 87.0, pwr: 0.96, grip: 0.975, brk: 0.98 },
    drivers: [{ jp: "マテオ・ルイス", code: "RUI", pace: 0.982, cons: 0.9, agg: 0.4 }, { jp: "ヨナス・ケラー", code: "KEL", pace: 0.978, cons: 0.85, agg: 0.45 }] },
  { key: "Crimson", name: "CRIMSON WORKS", short: "CRIMSON", color: "#8a0a12", nums: [44, 45], trait: "0-100加速＆最高速のパワー型",
    car: { top: 91.0, pwr: 1.08, grip: 0.975, brk: 0.99 },
    drivers: [{ jp: "ラファエル・コスタ", code: "COS", pace: 0.996, cons: 0.7, agg: 0.85 }, { jp: "エミル・サンドベリ", code: "SAN", pace: 0.988, cons: 0.75, agg: 0.6 }] },
  { key: "Navy", name: "NAVY SILVER TEAM", short: "NAVY SILVER", color: "#1a2a6a", nums: [63, 64], trait: "0-100加速No.1",
    car: { top: 88.0, pwr: 1.1, grip: 0.985, brk: 1.0 },
    drivers: [{ jp: "ヴィクター・ヘイル", code: "HAL", pace: 0.997, cons: 0.8, agg: 0.75 }, { jp: "ケンジ・モリ", code: "MOR", pace: 0.99, cons: 0.85, agg: 0.55 }] },
  { key: "Frost", name: "FROST RACING", short: "FROST", color: "#e8eaf0", nums: [88, 89], trait: "バランス型の中堅",
    car: { top: 88.0, pwr: 0.99, grip: 1.0, brk: 1.0 },
    drivers: [{ jp: "アドリアン・デュヴァル", code: "DUV", pace: 0.993, cons: 0.85, agg: 0.6 }, { jp: "レオ・ハートマン", code: "HAR", pace: 0.987, cons: 0.8, agg: 0.5 }] },
];
const WB = 3.4, WHEEL_R = 0.36;
const cars = [];
let player = null;

const VMAX = 89;
class Car {
  constructor(name, T, k, isPlayer) {
    const d = T.drivers[k];
    Object.assign(this, { name, isPlayer, team: T.short, teamName: T.name, color: T.color, num: T.nums[k], T, code: d.code, driver: d.jp });
    // マシン性能（チーム共通）とドライバーの特徴
    this.vtop = T.car.top; this.pwr = T.car.pwr; this.gripF = T.car.grip; this.brkF = T.car.brk;
    this.pace = d.pace; this.cons = d.cons; this.agg = d.agg;
    // 雨の上手さ（-1〜1）: 安定感が高いほど少し上手い＋個人差
    this.rainSkill = clamp((d.cons - 0.75) * 4 + (((d.code.charCodeAt(0) * 7 + d.code.charCodeAt(2) * 3) % 11) - 5) * 0.16, -1, 1);
    this.dnf = false; this.spinT = 0; this.losing = 0;
    this.form = 0; this.errT = 0; this.wear = 0; this.drsOn = false; this.drsArm = -1; this.passSide = 0;
    this.lineOff = (Math.random() - 0.5) * 0.8;
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

// ハンドルの最大切れ角: フルに切ると「ちょうどタイヤの限界を少し超える」角度にする（キーボードでも曲がりやすく）
function steerMax(v) {
  const a = G * (GRIP0 + DOWNF * v * v);
  const byGrip = Math.atan((1.18 * WB * a) / Math.max(v * v, 1));
  return Math.min(0.42, byGrip);
}
function physics(c, dt) {
  if (c.dnf) { c.vx = c.vz = 0; c.speed = 0; return; }
  if (c.pit) return pitPhysics(c, dt);
  if (c.spinT > 0 || c.losing > 0) return spinPhysics(c, dt);
  if (c.crashT) {
    c.crashT -= dt; c.vx = c.vz = 0; c.speed = 0;
    if (c.crashT <= 0) { c.crashT = 0; respawn(c); }
    return;
  }
  const [fx, fz] = c.fwd;
  const lx = fz, lz = -fx;                       // 左向き
  let vf = c.vx * fx + c.vz * fz, vl = c.vx * lx + c.vz * lz;
  const onKerb = Math.abs(c.lat) > HALF - 0.1;
  const grip = (onKerb ? 0.8 - 0.15 * WX.wet : 1) * wetGrip(c);     // 雨の路面は滑る
  // 加速・減速
  let acc = 0;
  const vtop = c.vtop * (c.drsOn ? 1.035 : 1) * (c.damage ? 0.95 : 1);
  if (c.thr > 0 && vf >= -0.5) acc += c.thr * Math.min(12.5 * c.pwr * Math.max(0, 1 - (Math.abs(vf) / vtop) ** 2.2), (10.5 * grip + (vf > 15 ? 3 : 0)) * Math.sqrt(c.pwr));
  const brakeDec = (22 + 0.0028 * vf * vf) * c.brkF * (1 - 0.15 * WX.wet);
  if (c.brk > 0.05) { if (vf > 0.5) acc -= c.brk * brakeDec; else if (c.canReverse) acc -= c.brk * 5 * (vf > -8 ? 1 : 0); else if (vf > -0.5) vf = Math.min(vf, 0); }
  acc -= 0.00052 * vf * Math.abs(vf) * (1 - 0.4 * (c.draft || 0)) * (c.drsOn ? 0.8 : 1) + (c.thr < 0.05 ? 0.6 * Math.sign(vf) : 0);   // 前の車の真後ろは空気抵抗が減る
  if (onKerb) acc -= 0.004 * vf * Math.abs(vf);
  let vfNew = vf + acc * dt;
  if (!c.canReverse && c.brk > 0.05 && vfNew < 0 && vf >= -0.1) vfNew = 0;
  vf = (vf > 0 && vfNew < 0 && c.brk > 0 && c.thr === 0 && vf > 0.5) ? 0 : vfNew;
  // ハンドル（速いほど切れ角が小さい）
  const maxSteer = steerMax(Math.max(vf, 0));
  const delta = c.steer * maxSteer;
  const aMax = G * (GRIP0 + DOWNF * vf * vf) * grip * c.gripF * (1 - c.wear) * Math.sqrt(1 - 0.55 * c.brk * c.brk * (vf > 5 ? 1 : 0));
  let yawWant = (vf * Math.tan(delta)) / WB;
  const yawLim = aMax / Math.max(Math.abs(vf), 2);
  // 限界を少し超えるまでは曲がれるが、大きく超えるとフロントが逃げて曲がらなくなる（アンダーステア）
  const overRaw = Math.abs(yawWant) / yawLim - 1;
  const cap = yawLim * (overRaw > 0.2 ? Math.max(0.6, 1.15 - 0.55 * Math.min(1, overRaw - 0.2)) : 1.15);
  const yawRate = clamp(yawWant, -cap, cap);
  // 限界を超えてハンドルを切るとタイヤが鳴いて減速（オーバースピードは損）
  const over = Math.abs(yawWant) / yawLim - 1;
  c.over = over > 0 && vf > 8 ? Math.min(1, over) : 0;
  if (c.over > 0) { const scrub = c.over * 10 * dt; vf = Math.max(vf - scrub, 0); }
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
  wearTyre(c, ds);      // タイヤが減る（種類ごとに寿命が違う）
  const lim = WALL - 1.0;
  if (Math.abs(c.lat) > lim) {
    const sd = Math.sign(c.lat), i = p.i;
    const push = Math.abs(c.lat) - lim;
    c.x -= TR.nx[i] * sd * push; c.z -= TR.nz[i] * sd * push; c.lat = sd * lim;
    const vn = c.vx * TR.nx[i] + c.vz * TR.nz[i];
    // 壁をこすっている間は強く減速
    const vt = c.vx * TR.tx[i] + c.vz * TR.tz[i];          // 壁に沿った速さ
    if (Math.abs(vt) > 4) { const nvt = vt - Math.sign(vt) * 35 * dt; c.vx += (nvt - vt) * TR.tx[i]; c.vz += (nvt - vt) * TR.tz[i]; }
    // 壁に刺さって止まりかけたら、コースの向きへゆっくり向き直す（抜け出しやすく）
    if (Math.abs(c.speed) < 4) {
      const th0 = Math.atan2(TR.tx[i], TR.tz[i]);
      let d0 = th0 - c.h; while (d0 > Math.PI) d0 -= 2 * Math.PI; while (d0 < -Math.PI) d0 += 2 * Math.PI;
      c.h += clamp(d0, -1.4 * dt, 1.4 * dt);
    }
    if (vn * sd > 0 && Math.abs(vn) > CRASH_V && !c.crashT) {
      // 強く突っ込んだらクラッシュ: 止まって2秒後にコースへ戻される
      c.vx = c.vz = 0; c.crashT = 2.0; c.hitT = 0.6;
      window.__crashes = (window.__crashes || 0) + 1;
      if (c.isPlayer) { audio.hit(1); showMsg("CRASH!", 1.6); }
    } else if (vn * sd > 0) {
      c.vx -= 1.3 * vn * TR.nx[i]; c.vz -= 1.3 * vn * TR.nz[i];
      const loss = 0.66 - Math.min(0.3, Math.abs(vn) * 0.03);     // 強く当たるほど大きく失速
      c.vx *= loss; c.vz *= loss;
      if (Math.abs(vn) > 1) window.__wallHits = (window.__wallHits || 0) + 1;
      // 壁に強く当たると壊れることがある（プレイヤーは「やさしい」なら壊れない・「ふつう」はかなり強く当たった時だけ）
      const dI = $("diff").selectedIndex;
      if (state === "race") {
        if (!c.isPlayer || MODE !== "drive") { if (Math.abs(vn) > 11 && Math.random() < 0.35) damageCar(c, "壁に接触"); }
        else if (dI >= 1 && Math.abs(vn) > (dI === 2 ? 13 : 16) && Math.random() < (dI === 2 ? 0.3 : 0.2)) damageCar(c, "壁に接触");
      }
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
    if (A.dnf || B.dnf || A.pit || B.pit) continue;
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
          A.vx -= j * nx; A.vz -= j * nz; B.vx += j * nx; B.vz += j * nz; A.collT = raceT; B.collT = raceT;
          if (-rv > 9 && state === "race" && raceT > 6 && A.T !== B.T && Math.random() < 0.12) { const v = Math.random() < 0.5 ? A : B; if (!(v.isPlayer && MODE === "drive" && $("diff").selectedIndex === 0)) damageCar(v, "接触"); }
          if ((A.isPlayer || B.isPlayer) && -rv > 1.5) audio.hit(Math.min(1, -rv / 10));
        }
      }
    }
  }
}

// AI（プレイヤーの自動運転にも使う）。solo=true は予選（他車を無視）
function aiDrive(c, dt, raceOn, solo = false) {
  const vf = Math.max(c.speed, 0);
  if (!raceOn) { c.thr = 0; c.brk = 1; c.steer = 0; return; }
  if (c.pit || c.dnf) return;
  if (c.react > 0) { c.react -= dt; c.thr = 0; c.brk = 0; return; }
  // 調子の波と、たまのミス（安定感が低いドライバーほど起きやすい）
  if (!solo) {
    c.form += (-c.form * 0.25 + (Math.random() - 0.5) * 0.045) * dt;
    if (c.errT > 0) c.errT -= dt;
    else if (raceT > 8 && !SC.on && !FL.red && Math.random() < (1 - c.cons) * 0.03 * (1 + 1.2 * WX.wet) * dt) {
      c.errT = 1.2 + Math.random();
      // 雨の日のミスはスピンになりやすい
      if (vf > 22 && !c.finished && Math.random() < 0.03 + 0.2 * WX.wet * (1 - 0.3 * c.rainSkill)) startSpin(c);
    }
  }
  // 前の車: 速ければ抜きにいく、遅ければ後ろにつく
  let follow = Infinity, side = 0;
  if (!solo) for (const o of cars) {
    if (o === c || o.crashT || o.dnf) continue;
    let ds = o.s - c.s; if (ds < -L / 2) ds += L; if (ds > L / 2) ds -= L;
    if (ds > 0 && ds < 24 + vf * 0.22 && Math.abs(o.lat - c.lat) < 2.5) {
      let faster = vf > o.speed + 0.3 || c.drsOn || (c.draft > 0.45 && c.agg > 0.5);
      if (o.T === c.T && o.yieldTo !== c && Math.abs(o.dist - c.dist) < L / 2) faster = false;     // 周回遅れのチームメイトは普通に抜く     // チームメイトとは無理に争わない（チームオーダーが出た時だけ抜く）
      if (faster && Math.random() < 0.5 + c.agg) side = c.passSide || (o.lat > c.lat ? -1 : 1);
      else follow = Math.min(follow, o.speed + (ds - 9) * 0.35);
    }
  }
  const zl = solo ? 0 : zoneLevel(c);
  if ((SC.on || FL.red || zl) && !solo) { side = 0; follow = Infinity; c.passSide = 0; c.passT = 0; }     // SC・赤旗・黄旗中は追い越し禁止
  if (side) { c.passSide = side; c.passT = 1.2; } else if ((c.passT = (c.passT || 0) - dt) <= 0) c.passSide = 0;
  const look = 7 + vf * 0.32;
  const ti = idxAtS(c.s + look);
  // コーナーでは横に大きく動かない（壁に寄りすぎない）
  let kAhead = 0; for (let d = 0; d < 60; d += 6) kAhead = Math.max(kAhead, Math.abs(kS[idxAtS(c.s + d)]));
  const room = kAhead > 1 / 90 ? 0.45 : 1;
  c.avoid = lerp(c.avoid, c.passSide * 2.5 * room, 1 - Math.exp(-dt * (1.2 + c.agg)));
  let tlat = clamp(TR.line[ti] + c.lineOff * room + c.avoid, -HALF + 1.5, HALF - 1.5);
  if (!solo && c.blueT > 0.4) tlat = clamp(tlat + c.yieldSide * 3, -HALF + 1.2, HALF - 1.2);     // ブルーフラッグ: 道を譲る
  if (!solo && c.yieldTo && c.yieldT > 0) tlat = clamp(tlat + (c.yieldTo.lat > c.lat ? -2.5 : 2.5), -HALF + 1.2, HALF - 1.2);     // チームオーダー: 道を譲る
  let toPit = 1e9;
  if (!solo && (c.pitReq || c.redQueue)) { toPit = wrapDs(S_FIN + PIT.A - c.s); if (toPit > 0 && toPit < 220) tlat = lerp(tlat, PIT_SD * 4.3, smooth01(1 - toPit / 220)); }
  const tx = TR.x[ti] + TR.nx[ti] * tlat, tz = TR.z[ti] + TR.nz[ti] * tlat;
  const [fx, fz] = c.fwd;
  const dx = tx - c.x, dz = tz - c.z;
  const fwdD = dx * fx + dz * fz, leftD = dx * fz - dz * fx;
  const alpha = Math.atan2(leftD, fwdD);
  const delta = Math.atan((2 * WB * Math.sin(alpha)) / Math.max(look, 4));
  c.steer = clamp(delta / steerMax(vf), -1, 1);
  // 目標速度: このマシンのグリップとブレーキで、前方150mのコーナーに間に合う速さ
  const kG = 0.975 * Math.sqrt(c.gripF * (1 - c.wear) * wetGrip(c)) * (1 - 0.012 * WX.wet) * c.pace * (1 + c.form + (c.day || 0)) * c.skill * (c.errT > 0 ? 1.06 : 1);
  const dec = 30 * c.brkF * (1 - 0.15 * WX.wet);
  let vt = c.vtop * (c.drsOn ? 1.035 : 1);
  const s0 = c.s + vf * 0.1;
  for (let d = 0; d < 150; d += 3) {
    const vc = TR.vcorner[idxAtS(s0 + d)] * kG;
    const v = Math.sqrt(vc * vc + 2 * dec * d);
    if (v < vt) vt = v;
  }
  if (!c.passSide && follow < vt) vt = Math.max(follow, 5);
  if (!solo && !c.finished) {
    if (SC.on || FL.red) vt = Math.min(vt, scFollowSpeed(c, vt));
    if (zl === 2) vt = Math.min(vt * 0.6, 40); else if (zl === 1) vt *= 0.9;
    if (c.blueT > 0.4) vt *= 0.9;
    if (c.yieldTo && c.yieldT > 0 && kAhead < 1 / 150) vt *= 0.95;
    if (toPit > 0 && toPit < 260) vt = Math.min(vt, Math.sqrt(48 * 48 + 2 * 24 * toPit));
  }
  const err = vt - vf;
  c.thr = clamp(err * 0.6 + 0.2, 0, 1);
  c.brk = clamp(-err * 0.18, 0, 1);
  if (c.brk > 0.05) c.thr = 0;
}

// ======================= 入力 =======================
const keys = {};
// 矢印キー・WASDを、IME入力中や古いブラウザでも拾えるように e.code / e.key / keyCode の全部で判定
const KEYMAP = { 37: "ArrowLeft", 38: "ArrowUp", 39: "ArrowRight", 40: "ArrowDown", 87: "KeyW", 65: "KeyA", 83: "KeyS", 68: "KeyD" };
function keyName(e) {
  if (e.code && e.code !== "Unidentified" && e.code !== "") return e.code;
  if (e.key && e.key.startsWith("Arrow")) return e.key;
  return KEYMAP[e.keyCode] || e.key;
}
function setKey(e, down) {
  const n = keyName(e); keys[n] = down;
  if (e.key && e.key.startsWith("Arrow")) keys[e.key] = down;
  if (KEYMAP[e.keyCode]) keys[KEYMAP[e.keyCode]] = down;
}
addEventListener("keydown", (e) => {
  if (REPLAY) {
    if (e.code === "Escape") closeReplay();
    else if (e.code === "Space" || e.code === "KeyP") $("rpPlay").click();
    e.preventDefault(); return;
  }
  setKey(e, true);
  if (e.target && e.target.tagName === "SELECT" && state !== "title") e.target.blur();
  if (state !== "title" && (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(keyName(e)) || KEYMAP[e.keyCode])) e.preventDefault();
  if (e.code === "KeyC") camMode = (camMode + 1) % 2;
  if (e.code === "KeyM") audio.toggle();
  if (e.code === "KeyR" && state === "race" && player && !player.finished && !player.pit && !player.dnf) respawn(player);
  if (e.code === "KeyB" && !paused) playerPitToggle();
  if (e.code === "KeyT" && !paused) playerNextTyre();
  if (e.code === "Escape" || e.code === "KeyP" || (e.code === "Space" && state !== "title")) { e.preventDefault(); if (!skipping) togglePause(); }
  if (MODE === "watch" && state !== "title" && !paused) {
    const sp = { Digit1: 1, Digit2: 2, Digit4: 4, Digit8: 8 }[e.code];
    if (sp) setSpeed(sp);
    if (e.code === "KeyF") $("camBet").click();
  }
});
addEventListener("keyup", (e) => setKey(e, false));
addEventListener("blur", () => { for (const k in keys) keys[k] = false; if (state === "race" || state === "countdown") setPause(true); });
document.addEventListener("visibilitychange", () => { if (document.hidden && (state === "race" || state === "countdown")) setPause(true); });
function readPlayer(c, dt, raceOn) {
  c.canReverse = false;
  if (window.__bot && !c.finished) { const k = window.__bot(c, dt, raceOn); for (const n of ["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"]) keys[n] = !!k[n]; }
  else if (DEBUG_AUTO || c.finished) return aiDrive(c, dt, raceOn);
  const up = keys.ArrowUp || keys.KeyW, dn = keys.ArrowDown || keys.KeyS;
  const lt = keys.ArrowLeft || keys.KeyA, rt = keys.ArrowRight || keys.KeyD;
  c.thr = lerp(c.thr, up ? 1 : 0, 1 - Math.exp(-dt * 10));
  c.brk = lerp(c.brk, dn ? 1 : 0, 1 - Math.exp(-dt * 14)); if (c.brk < 0.02) c.brk = 0;
  if (c.thr < 0.02) c.thr = 0;
  const target = (lt ? 1 : 0) - (rt ? 1 : 0);
  const rate = target === 0 ? 9 : 8;                   // 押したらすぐ曲がり始める
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
  let ctx = null, master, on = true, eng = null, voices = [], crowdG, rev, revG, dryG, squealG, revving = false;
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
      master = ctx.createGain(); master.gain.value = on ? 0.55 : 0;
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
      // タイヤのスキール音（限界を超えた時）
      const sq = ctx.createBufferSource(); sq.buffer = noiseBuf(2); sq.loop = true;
      const sb = ctx.createBiquadFilter(); sb.type = "bandpass"; sb.frequency.value = 1500; sb.Q.value = 9;
      const sb2 = ctx.createBiquadFilter(); sb2.type = "bandpass"; sb2.frequency.value = 2300; sb2.Q.value = 12;
      squealG = ctx.createGain(); squealG.gain.value = 0; sq.connect(sb); sq.connect(sb2); sb.connect(squealG); sb2.connect(squealG); squealG.connect(master); sq.start();
    },
    resume() { if (ctx && ctx.state !== "running") ctx.resume(); },
    toggle() { on = !on; if (master) master.gain.value = on ? 0.55 : 0; try { saveSettings(); } catch (e) {} },
    setOn(v) { on = v; if (master) master.gain.value = on ? 0.55 : 0; },
    isOn() { return on; },
    update(dt) {
      const player = viewCar();
      if (!ctx || !player) return;
      const t = ctx.currentTime;
      const g = gearOf(player.speed);
      // スタート前はエンジンを吹かして待つ
      const cdRev = state === "countdown" ? 7200 + 2600 * (0.5 + 0.5 * Math.sin(t * 2.3) * Math.sin(t * 5.1 + 1)) : 0;
      if (cdRev) g.rpm = Math.max(g.rpm, cdRev);
      const f = (g.rpm / 60) * 3 * 0.5;
      const quiet = paused || state === "title";
      eng.set(f, cdRev ? 0.7 : player.thr, quiet ? 0 : (MODE === "watch" && shot !== "chase" && shot !== "onboard" ? 0.06 : 0.18 + 0.22 * player.thr), t);
      // 近くのAI車（ドップラー付き）
      const lx = camera.position.x, lz = camera.position.z;
      const near = cars.filter((c) => c !== player).map((c) => [c, Math.hypot(c.x - lx, c.z - lz)]).sort((a, b) => a[1] - b[1]).slice(0, 4);
      near.forEach(([c, d], k) => {
        const gg = gearOf(c.speed); if (cdRev) gg.rpm = Math.max(gg.rpm, cdRev * (0.92 + 0.05 * k));
        const dirx = (lx - c.x) / (d + 1e-3), dirz = (lz - c.z) / (d + 1e-3);
        const vr = c.vx * dirx + c.vz * dirz - (player.vx * dirx + player.vz * dirz) * (camMode === 1 ? 1 : 0.9);
        const dop = 343 / Math.max(343 - clamp(vr, -150, 150), 100);
        voices[k].set((gg.rpm / 60) * 1.5 * dop * (0.97 + k * 0.012), c.thr, quiet ? 0 : 0.5 / (1 + (d / 9) ** 1.6), t);
      });
      const dCrowd = Math.hypot(player.x - STAND.x, player.z - STAND.z);
      crowdG.gain.setTargetAtTime(quiet ? 0 : (finishCheer > 0 ? 0.35 : 0.05) / (1 + dCrowd / 120), t, 0.3);
      revG.gain.setTargetAtTime(inTunnelIdx(player.idx) ? 0.9 : 0.12, t, 0.15);
      const sl = quiet || MODE === "watch" ? 0 : clamp((player.over || 0) * 1.2 + Math.max(0, (player.slip || 0) - 0.6) * 0.25, 0, 1);
      squealG.gain.setTargetAtTime(sl * 0.9, t, 0.05);
    },
    hit(v) {
      if (!ctx) return;
      const b = ctx.createBufferSource(); b.buffer = noiseBuf(0.3);
      const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 900;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.6 * v, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      b.connect(f); f.connect(g); g.connect(master); b.start();
    },
    beep(freq, dur = 0.18) {
      if (!ctx || skipping) return;
      const o = ctx.createOscillator(); o.frequency.value = freq; o.type = "square";
      const g = ctx.createGain(); g.gain.setValueAtTime(0.12, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + dur);
    },
    // スタート直前のエンジンを吹かす音（観戦・ドライブ共通）
    rev(on) { revving = on; },
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
  const c = viewCar(); if (!c) return;
  const [fx, fz] = c.fwd;
  if (MODE === "watch" && state !== "title") {
    director(dt, snap);
    if (shotNew) { snap = true; shotNew = false; }
    const cc = viewCar();
    if (shot !== "chase" && shot !== "onboard") return watchCam(cc, dt, snap);
    if (cc !== c) return updateCamera(dt, true);
  }
  const mode = MODE === "watch" ? (shot === "onboard" ? 1 : 0) : camMode;
  if (mode === 0) {
    const sp = Math.max(c.speed, 0);
    const back = 7.2 + sp * 0.012;
    const want = new THREE.Vector3(c.x - fx * back, 2.35, c.z - fz * back);
    const look = new THREE.Vector3(c.x + fx * 5, 1.0, c.z + fz * 5);
    // 車と一緒に動かしてから向きの変化だけをなめらかに追う（高速でも置いていかれない）
    camPos.x += c.vx * dt; camPos.z += c.vz * dt; camLook.x += c.vx * dt; camLook.z += c.vz * dt;
    const k = snap ? 1 : 1 - Math.exp(-dt * 6);
    camPos.lerp(want, k); camLook.lerp(look, snap ? 1 : 1 - Math.exp(-dt * 12));
    camera.fov = lerp(camera.fov, 60 + sp * 0.14, 1 - Math.exp(-dt * 3));
  } else {
    camPos.set(c.x - fx * 0.45, 1.13, c.z - fz * 0.45);
    camLook.set(c.x + fx * 30, 0.85, c.z + fz * 30);
    camera.fov = lerp(camera.fov, 74, 1 - Math.exp(-dt * 3));
  }
  // 壁の外にカメラが出ないように
  const p = project(camPos.x, camPos.z, c.idx);
  if (!c.pit && Math.abs(p.lat) > WALL - 0.4) { const sd = Math.sign(p.lat), push = Math.abs(p.lat) - (WALL - 0.4); camPos.x -= TR.nx[p.i] * sd * push; camPos.z -= TR.nz[p.i] * sd * push; }
  camera.position.copy(camPos);
  if (mode === 0 && c.hitT > 0) camera.position.y += (Math.random() - 0.5) * c.hitT * 0.4;
  camera.lookAt(camLook);
  camera.updateProjectionMatrix();
  lightFollow(c, dt);
}
function lightFollow(c, dt) {
  sun.position.set(c.x + sunDir.x * 200, sunDir.y * 200, c.z + sunDir.z * 200);
  sun.target.position.set(c.x, 0, c.z);
  const inT = inTunnelIdx(c.idx) && (shot === "chase" || shot === "onboard" || MODE === "drive");
  hemi.intensity = lerp(hemi.intensity, (inT ? 0.25 : 0.9) * WX.hemiMul, 1 - Math.exp(-dt * 4));
  scene.environmentIntensity = hemi.intensity * 0.6 * WX.envMul;
  updateRainFx(dt);
}
// ---- 観戦カメラ: TV中継のように自動でカットを切り替える ----
let camFollowBet = false;
function pickFocus() {
  const ord = order().filter((c) => !c.finished && !c.dnf);
  if (!ord.length) return order()[0];
  if (camFollowBet && BET.car) return BET.car;
  // 0.6秒差以内のバトルを優先（上位ほど優先）
  for (let k = 1; k < Math.min(ord.length, 14); k++) {
    if ((ord[k - 1].dist - ord[k].dist) / Math.max(ord[k].speed, 30) < 0.6 && Math.random() < 0.75) return ord[k];
  }
  const r = Math.random();
  if (r < 0.3 && BET.car && !BET.car.finished && !BET.car.dnf) return BET.car;
  if (r < 0.65) return ord[0];
  return ord[Math.floor(Math.random() * Math.min(ord.length, 10))];
}
function setShot(type, c) {
  focus = c; shot = type; shotPassed = false;
  shotT = type === "trackside" ? 7 : type === "onboard" ? 5 : 4.5 + Math.random() * 3;
  if (type === "trackside") {
    // 少し先のコース脇にカメラを置き、近づいて通過するのを撮る。
    // 置く前に「車が通る道筋が何か所も見通せるか」を確かめ、ダメなら場所を変える
    const base = 70 + Math.max(c.speed, 20) * 1.6;
    if (nearTunnel(c.s, base * 1.4 + 40)) { setShot("chase", c); return; }
    let ok = null;
    const sd0 = Math.sign(-kS[wrap(idxAtS(c.s + base) + 10)]) || 1;
    for (const mul of [1, 0.75, 1.3, 0.55]) for (const sd of [sd0, -sd0]) {
      if (ok) break;
      const ahead = base * mul, i = idxAtS(c.s + ahead), lt = sd * (WALL + 0.6);
      // 広告ボード(〜1.7m)とフェンス(〜3.8m)より高い位置から見下ろす
      const P = new THREE.Vector3(TR.x[i] + TR.nx[i] * lt, 4.6 + Math.random() * 1.6, TR.z[i] + TR.nz[i] * lt);
      let clear = true;
      for (const f of [0.15, 0.4, 0.65, 0.85, -0.25]) {
        const j = idxAtS(c.s + ahead * (1 - f));
        if (blocked(P, TR.x[j] + TR.nx[j] * c.lat, 1.0, TR.z[j] + TR.nz[j] * c.lat)) { clear = false; break; }
      }
      if (clear) { ok = P; ok.s = TR.s[i]; }
    }
    if (!ok) { setShot("chase", c); return; }
    shotPt = ok;
  }
  shotNew = true; occT = 0; occCheckT = 0.25; occLast = false;     // カットの瞬間はカメラを一気に移す
}
// トンネル（とその前後）にいるか
function nearTunnel(s, ahead = 0) {
  for (let d = -20; d <= ahead; d += 10) if (inTunnelIdx(idxAtS(s + d))) return true;
  return false;
}
// カメラと車の間に建物・壁・看板などがあるか（光線を飛ばして調べる）
const ray = new THREE.Raycaster();
let OCC = null, occT = 0, occCheckT = 0, occLast = false, finishShotDone = false;
function blocked(from, tx, ty, tz) {
  buildOcc();
  const target = new THREE.Vector3(tx, ty, tz);
  const dir = target.clone().sub(from); const dist = dir.length(); if (dist < 3) return false;
  ray.set(from, dir.normalize()); ray.far = dist - 2.5; ray.near = 0.3;
  return ray.intersectObjects(OCC, false).length > 0;
}
function buildOcc() {
  if (!OCC) { OCC = []; const carSet = new Set(cars.map((o) => o.obj)); scene.traverse((o) => { if (!o.isMesh || o === sky) return; let p = o; while (p) { if (carSet.has(p) || p.userData.noOcc) return; p = p.parent; } if (o.geometry && o.geometry.type === "PlaneGeometry" && o.position.y < 0) return; OCC.push(o); }); }
}
function isOccluded(c) { return blocked(camera.position.clone(), c.x, 1.0, c.z); }
// 観戦カメラのモード: tv=中継（自動） / car=選んだ車 / pit=ピットの映像
let WCAM = "tv", WCAM_CAR = null, WCAM_ONB = false;
function setWCam(mode, car) {
  if (mode === "car" && car) { if (WCAM === "car" && WCAM_CAR === car) WCAM_ONB = !WCAM_ONB; else WCAM_ONB = false; WCAM_CAR = car; }
  WCAM = mode; camFollowBet = false; $("camBet").classList.remove("on");
  document.querySelectorAll(".wcam").forEach((b) => b.classList.toggle("on", b.dataset.m === WCAM));
  shotT = 0; occT = 0;
}
function pitFocus() {
  const inPit = cars.filter((c) => c.pit && !c.dnf);
  if (!inPit.length) return null;
  return inPit.find((c) => c.pit.phase === "stop") || inPit.sort((a, b) => Math.abs(pitRel(a.s)) - Math.abs(pitRel(b.s)))[0];
}
function director(dt, snap) {
  shotT -= dt;
  if (state !== "countdown" && state !== "replay") {
    if (WCAM === "car" && WCAM_CAR && !WCAM_CAR.dnf) {
      const want = WCAM_ONB ? "onboard" : "chase";
      if (focus !== WCAM_CAR || shot !== want) setShot(want, WCAM_CAR);
      shotT = 99; return;
    }
    if (WCAM === "pit") {
      const pc = pitFocus();
      if (shot !== "pit" || (pc && focus !== pc)) { focus = pc || focus || order()[0]; shot = "pit"; shotNew = true; }
      shotT = 99; return;
    }
  }
  // 空撮・コース脇のカメラで車が見えない時間が続いたら、すぐ別のカットへ
  if (focus && state !== "countdown" && (shot === "heli" || shot === "trackside" || shot === "finish")) {
    occCheckT -= dt;
    if (occCheckT <= 0) { occCheckT = 0.12; occLast = isOccluded(focus); }
    occT = occLast ? occT + dt : 0;
    if (occT > 0.35) { occT = 0; window.__occCuts = (window.__occCuts || 0) + 1; setShot("chase", focus); return; }
  } else occT = 0;
  if (shot === "heli" && focus && nearTunnel(focus.s, 60)) { setShot("chase", focus); return; }
  const lead = order()[0];
  // 最終ラップでトップがゴール300m手前に来たら、ゴールラインの横から撮る
  if (state === "race" && lead && !lead.finished && LAPS * L - lead.dist < 150 && LAPS * L - lead.dist > 0 && shot !== "finish" && !finishShotDone) {
    finishShotDone = true;
    focus = lead; shot = "finish"; shotT = 12; shotNew = true; occT = 0; occCheckT = 0.25;
    // ゴールゲートの柱より内側（路肩の上）から、迫ってくるトップを撮る
    const i = wrap(FIN_I + 14), lt = -(HALF + 0.6);
    shotPt = new THREE.Vector3(TR.x[i] + TR.nx[i] * lt, 4.2, TR.z[i] + TR.nz[i] * lt);
    return;
  }
  if (shot === "grid" && state === "countdown") return;
  if (shot === "trackside" && focus) {
    let ds = focus.s - shotPt.s; if (ds < -L / 2) ds += L; if (ds > L / 2) ds -= L;
    if (ds > 25) shotT = Math.min(shotT, 0.6);
  }
  if (shotT > 0 && !snap) return;
  if (shot === "finish" && state !== "race" && shotT > 0) return;
  const c = pickFocus();
  const r = Math.random();
  let type = r < 0.32 ? "chase" : r < 0.55 ? "heli" : r < 0.85 ? "trackside" : "onboard";
  if (type === "heli" && nearTunnel(c.s, 100)) type = "chase";
  setShot(type, c);
}
function watchCam(c, dt, snap) {
  const [fx, fz] = c.fwd;
  let want, look = new THREE.Vector3(c.x + fx * 3, 0.8, c.z + fz * 3), fov = 50;
  if (shot === "pit") {
    // ピットの映像: 作業中・ピットレーンを走る車を壁の上から撮る。誰もいなければピットレーン全体
    if (c.pit) {
      const rel = pitRel(c.s), T = trackAt(S_FIN + rel - 15), lt = PIT_SD * (WALL + 0.4);
      want = new THREE.Vector3(T.x + T.nx * lt, 4.6, T.z + T.nz * lt);
      look.set(c.x, 0.6, c.z); fov = 42;
    } else {
      const T = trackAt(S_FIN + PIT.B - 10), T2 = trackAt(S_FIN + 20), lt = PIT_SD * 6;
      want = new THREE.Vector3(T.x + T.nx * lt, 9, T.z + T.nz * lt);
      look.set(T2.x + T2.nx * PIT_SD * 13, 0, T2.z + T2.nz * PIT_SD * 13); fov = 45;
    }
    camPos.lerp(want, snap ? 1 : 1 - Math.exp(-dt * 3));
  } else if (shot === "heli" || shot === "grid") {
    // 空撮はコースの真上あたりから（横にずらしすぎると建物に隠れる）
    const back = shot === "grid" ? 38 : 20, up = shot === "grid" ? 28 : 16;
    const bi = idxAtS(c.s - back);
    want = new THREE.Vector3(TR.x[bi] + TR.nx[bi] * 3, up, TR.z[bi] + TR.nz[bi] * 3);
    if (shot === "grid") look.set(c.x - fx * 60, 0, c.z - fz * 60);
    camPos.x += c.vx * dt; camPos.z += c.vz * dt;
    camPos.lerp(want, snap ? 1 : 1 - Math.exp(-dt * 2.5));
    fov = 45;
  } else {
    // 固定カメラ（コース脇・ゴールライン）: 距離に合わせてズーム
    camPos.copy(shotPt);
    const d = Math.hypot(c.x - shotPt.x, c.z - shotPt.z);
    fov = clamp((2 * Math.atan(9 / Math.max(d, 1)) * 180) / Math.PI, 8, 62);
    look.set(c.x, 0.7, c.z);
  }
  camLook.lerp(look, snap ? 1 : 1 - Math.exp(-dt * 14));
  camera.position.copy(camPos);
  camera.fov = lerp(camera.fov, fov, snap ? 1 : 1 - Math.exp(-dt * 6));
  camera.lookAt(camLook);
  camera.updateProjectionMatrix();
  lightFollow(c, dt);
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
// ゴールした車の差（周回遅れでゴールした車は「+1周」）
function finGap(o, lead, d) {
  if ((o.finLaps || LAPS) < (lead.finLaps || LAPS)) return `+${(lead.finLaps || LAPS) - o.finLaps}周`;
  return `+${(o.finishTime + (o.pen || 0) - lead.finishTime - (lead.pen || 0)).toFixed(d)}`;
}
function order() {
  return [...cars].sort((a, b) => {
    if (!!a.dnf !== !!b.dnf) return a.dnf ? 1 : -1;
    if (a.finished && b.finished) return ((b.finLaps || LAPS) - (a.finLaps || LAPS)) || (a.finishTime + (a.pen || 0) - b.finishTime - (b.pen || 0));
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
  $("draft").style.opacity = c.draft > 0.25 && state === "race" && !c.pit ? 1 : 0;
  updateTyreHud();
  boardT -= dt;
  if (boardT <= 0) {
    boardT = 0.25;
    const lead = ord[0];
    const rows = ord.map((o, k) => {
      let gap = "";
      if (o.dnf) gap = "DNF";
      else if (k === 0) gap = o.finished ? "WIN" : "LEADER";
      else if (o.finished) gap = finGap(o, lead, 1);
      else { const dd = lead.dist - o.dist; gap = dd > L ? `+${Math.floor(dd / L)}L` : `+${(dd / Math.max(lead.speed, 30)).toFixed(1)}`; }
      return `<div class="row ${o === c ? "me" : ""}"><span class="p">${k + 1}</span><span class="sw" style="background:${o.color}"></span><span>${o.code} <span style="opacity:.6">${o.team}</span></span><span class="gap">${gap}</span></div>`;
    });
    const me = ord.indexOf(c);
    const show = new Set([0, 1, 2, me - 1, me, me + 1].filter((v) => v >= 0 && v < ord.length));
    $("board").innerHTML = [...show].sort((a, b) => a - b).map((k) => rows[k]).join("");
  }
  // ミニマップ
  if (!mapBase) drawMapBase();
  mapG.clearRect(0, 0, 208, 208); mapG.drawImage(mapBase, 0, 0);
  drawMapExtras();
  for (const o of cars) { if (o === c || o.dnf) continue; const [x, y] = toMap(o.x, o.z); mapG.fillStyle = o.color; mapG.beginPath(); mapG.arc(x, y, 3, 0, 7); mapG.fill(); }
  const [x, y] = toMap(c.x, c.z); mapG.fillStyle = "#ff3b30"; mapG.strokeStyle = "#fff"; mapG.lineWidth = 2; mapG.beginPath(); mapG.arc(x, y, 5, 0, 7); mapG.fill(); mapG.stroke();
}
// ---- 観戦HUD: タイミングタワー・速報・注目カード ----
let towerT = 0, tickT = 0;
const tickerLog = [];
function ticker(t) { tickerLog.push(`${raceT.toFixed(1)} ${t}`); if (tickerLog.length > 400) tickerLog.shift(); tickerQ.push(t); if (tickerQ.length > 4) tickerQ.shift(); tickT = 6; renderTicker(); }
function renderTicker() { $("ticker").innerHTML = tickerQ.slice(-3).map((t, k, a) => `<div style="opacity:${0.45 + 0.55 * (k === a.length - 1 ? 1 : 0.4)}">${t}</div>`).join(""); }
function updateWatchHUD(dt) {
  const c = focus; if (!c) return;
  const ord = order(), lead = ord[0];
  const lap = clamp(Math.floor(lead.dist / L) + 1, 1, LAPS);
  $("wlap").textContent = state === "countdown" ? "STARTING GRID" : lead.finished ? "CHEQUERED FLAG" : `LAP ${lap} / ${LAPS}`;
  towerT -= dt;
  if (towerT <= 0) {
    towerT = 0.25;
    $("towerWx").textContent = `${WX.icon} LIVE`;
    $("towerList").innerHTML = (SC.on ? '<div class="trow scrow">SAFETY CAR</div>' : "") + ord.map((o, k) => {
      let gap;
      if (o.dsq) gap = "DSQ"; else if (o.dnf) gap = "DNF";
      else if (k === 0) gap = o.finished ? "WIN" : "LEADER";
      else if (o.finished) gap = finGap(o, lead, 1);
      else { const dd = lead.dist - o.dist; gap = dd > L ? `+${Math.floor(dd / L)}L` : `+${(dd / Math.max(lead.speed, 30)).toFixed(1)}`; }
      const tags = (o.dnf ? "" : tyreBadge(o.tyre || "M")) + (o.pit ? '<b class="pit">PIT</b>' : "") + (o.damage ? '<i class="dmg"></i>' : "") + (o.pen ? `<b class="pen">+${o.pen}s</b>` : "") + (o.dsq ? '<b class="out">DSQ</b>' : "") + (o.drsOn ? '<b class="drs">DRS</b>' : "") + (fastest.car === o ? '<b class="fl"></b>' : "") + (o.crashT || o.spinT > 0 ? '<b class="out">!</b>' : "");
      const cls = (o === focus ? " foc" : "") + (o === BET.car ? " bet" : "") + (o.dnf ? " dnf" : "");
      return `<div class="trow${cls}${WCAM === "car" && WCAM_CAR === o ? " sel" : ""}" data-code="${o.code}"><span class="p">${k + 1}</span><span class="sw" style="background:${o.color}"></span><span class="cd">${o.code}</span>${tags}<span class="gap">${state === "countdown" ? "" : gap}</span></div>`;
    }).join("");
    const pos = ord.indexOf(c) + 1, g = gearOf(c.speed);
    $("fcard").innerHTML = `<div class="fpos">P${pos}</div><div><div class="fname"><span class="sw" style="background:${c.color}"></span>${c.code} ${c.driver} <span style="opacity:.6">#${c.num}</span></div><div class="fteam">${c.teamName} ・ ${TYRES[c.tyre || "M"].jp} ${Math.round(Math.min(c.tyreWear || 0, 1.5) * 100)}%${c.pen ? ` ・ +${c.pen}秒` : ""}</div></div>`
      + (BET.car ? `<div class="fbet">あなたの予想: <b>${BET.car.code}</b> ${BET.type === "win" ? "優勝" : "表彰台"} ／ 今 <b>P${ord.indexOf(BET.car) + 1}</b></div>` : "");
  }
  const g = gearOf(c.speed);
  $("spd").textContent = Math.round(Math.abs(c.speed) * 3.6); $("gear").textContent = g.g;
  $("rpm").firstElementChild.style.width = `${clamp((g.rpm - 4000) / 8200, 0, 1) * 100}%`;
  if (tickT > 0) { tickT -= dt; if (tickT <= 0) { tickerQ = []; renderTicker(); } }
  if (!mapBase) drawMapBase();
  mapG.clearRect(0, 0, 208, 208); mapG.drawImage(mapBase, 0, 0);
  drawMapExtras();
  for (const o of cars) { if (o.dnf) continue; const [x, y] = toMap(o.x, o.z); mapG.fillStyle = o.color; mapG.strokeStyle = o === focus ? "#fff" : o === BET.car ? "#ffcc00" : "rgba(0,0,0,.5)"; mapG.lineWidth = o === focus || o === BET.car ? 2.5 : 1; mapG.beginPath(); mapG.arc(x, y, o === focus || o === BET.car ? 5 : 3.2, 0, 7); mapG.fill(); mapG.stroke(); }
}
function onLeaderFinish(c) {
  leaderDoneT = 0; if (SC.on) endSC(true);
  showMsg(`${c.code} WINS!`, 3.5); ticker(`🏁 ${c.driver}（${c.teamName}）が優勝！`);
  finishCheer = 4.5; fireConfetti();
}
function showWatchResults() {
  resultShown = true; state = "finished"; ["wtop", "ticker"].forEach((id) => $(id).classList.add("hidden"));
  const ord = order(), lead = ord[0];
  const pos = BET.car ? ord.indexOf(BET.car) + 1 : 0;
  const hit = BET.car && (BET.type === "win" ? pos === 1 : pos <= 3);
  let line = "";
  if (BET.car && !BET.done) {
    BET.done = true;
    if (hit) { const pay = Math.floor(BET.amount * BET.odds); coins += pay; line = `<div class="betres win">🎉 当たり！ ${BET.car.code} は ${pos}位　＋${pay.toLocaleString()} コイン（${BET.odds}倍）</div>`; }
    else line = `<div class="betres lose">はずれ… ${BET.car.code} は ${BET.car.dnf ? "リタイア" : pos + "位"}　−${BET.amount.toLocaleString()} コイン</div>`;
    saveCoins(); BET.line = line; recordBet(hit);
  }
  const podium = ord.slice(0, 3).map((o, k) => `<div class="pod p${k + 1}"><div class="pn">${k + 1}</div><div class="sw" style="background:${o.color}"></div><div class="pc">${o.code}</div><div class="pd">${o.driver}</div><div class="pt">${o.teamName}</div></div>`).join("");
  const dnfs = cars.filter((o) => o.dnf).map((o) => o.code);
  const summary = `天気: ${WX.label}${SC.count ? ` ・ セーフティカー ${SC.count}回` : ""}${dnfs.length ? ` ・ リタイア ${dnfs.join(", ")}` : ""}`;
  $("wresBody").innerHTML = `${BET.line || ""}<div class="coins">所持コイン <b>${coins.toLocaleString()}</b> <span style="opacity:.65;font-size:12px;margin-left:10px">${summary}</span></div><div class="podium">${podium}</div>
    <table class="res">${ord.map((o, k) => {
      const t = o.dsq ? "失格" : o.dnf ? "リタイア" : k === 0 ? fmt(o.finishTime) + (o.pen ? ` (+${o.pen}s)` : "") : o.finished ? `${finGap(o, lead, 3)}${o.pen ? ` (+${o.pen}s)` : ""}` : (o.dist < (LAPS - 1) * L ? `+${LAPS - Math.floor(o.dist / L)}周` : "走行中");
      return `<tr class="${o === BET.car ? "me" : ""}"><td>${k + 1}</td><td><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${o.color};margin-right:6px"></span>${o.code} ${o.driver} <small>${(o.stints || [o.tyre || "M"]).join("→")}</small></td><td style="opacity:.6">${o.teamName}</td><td style="text-align:right">${t}</td><td style="text-align:right;${fastest.car === o ? "color:#c86bff;font-weight:700" : "opacity:.7"}">${fmt(o.best)}</td></tr>`;
    }).join("")}</table>`;
  $("wresult").classList.remove("hidden");
}

// ---- 予想（ベット）画面 ----
let betSel = null, betType = "win", betAmt = 100, betGrid = [];
function openBet() {
  MODE = "watch"; state = "title"; paused = false; resultShown = false; leaderDoneT = -1;
  clearInterval(resTimer); finishCheer = 0; confetti = []; flagG.clearRect(0, 0, flagC.width, flagC.height);
  ["tower", "wtop", "ticker", "fcard", "map", "speedo", "wresult", "pause", "result", "tl", "times", "board", "help", "tyreHud", "flagBanner"].forEach((id) => $(id).classList.add("hidden"));
  $("lights").style.display = "none"; $("msg").style.opacity = 0; msgT = 0;
  startLamps.forEach((l) => (l.material.emissiveIntensity = 0));
  cars.forEach((c) => { c.finished = false; c.crashT = 0; c.lapIdx = undefined; c.speed = 0; });
  $("title").classList.add("hidden");
  $("bet").classList.remove("hidden");
  resetIncidents();
  rollWeather("random"); rollTOD("random");
  betGrid = qualifying();
  computeOdds(betGrid);
  betSel = null;
  renderBet();
  // 予選順に並べて見せる
  betGrid.forEach((c, k) => c.place(S_FIN - 12 - k * 8, k % 2 ? -2.4 : 2.4)); syncCars(0);
  focus = betGrid[0]; shot = "grid"; updateCamera(0, true);
}
function statBar(v, lo, hi) { const p = clamp((v - lo) / (hi - lo), 0.05, 1); return `<i style="width:${Math.round(p * 100)}%"></i>`; }
function z100(c) { return (27.8 / Math.min(12.5 * c.pwr, 13.5 * Math.sqrt(c.pwr)) + 0.35).toFixed(1); }
function renderBet() {
  $("coinsNow").textContent = coins.toLocaleString();
  $("betWx").innerHTML = `コース: <b>${TRK.name}</b> ・ 天気: <b>${WX.icon} ${WX.label}</b>（${TOD_JP[TOD.kind]}） ― ${WX.note}${QNOTE ? `<br><span style="opacity:.8">${QNOTE}</span>` : ""}`;
  $("betList").innerHTML = betGrid.map((c, k) => {
    const odds = betType === "win" ? c.oddsWin : c.oddsPod;
    return `<div class="brow${c === betSel ? " sel" : ""}" data-k="${k}">
      <span class="gp">${k + 1}</span><span class="sw" style="background:${c.color}"></span>
      <span class="bn"><b>${c.code}</b> ${c.driver}${WX.kind !== "sun" && WX.kind !== "cloud" ? (c.rainSkill > 0.45 ? '<i class="rw">雨◎</i>' : c.rainSkill < -0.45 ? '<i class="rw" style="background:#555">雨×</i>' : "") : ""}<br><small>${c.teamName}・${c.T.trait}</small></span>
      <span class="bs"><span title="最高速">速${statBar(c.vtop, 85, 93)}</span><span title="加速">加${statBar(c.pwr, 0.92, 1.15)}</span><span title="コーナー">曲${statBar(c.gripF, 0.95, 1.07)}</span><span title="ブレーキ">止${statBar(c.brkF, 0.96, 1.08)}</span></span>
      <span class="bq">予選 ${fmt(c.qtime).slice(2)} <span class="bt">${tyreBadge(c.startTyre || "M")}</span><br><small>${Math.round(c.vtop * 3.6)}km/h ・ 0-100 ${z100(c)}秒</small></span>
      <span class="bo">${odds}倍</span></div>`;
  }).join("");
  $("betList").querySelectorAll(".brow").forEach((el) => (el.onclick = () => { betSel = betGrid[+el.dataset.k]; renderBet(); }));
  document.querySelectorAll(".btype").forEach((b) => b.classList.toggle("on", b.dataset.t === betType));
  document.querySelectorAll(".bamt").forEach((b) => b.classList.toggle("on", +b.dataset.a === betAmt || (b.dataset.a === "all" && betAmt === coins)));
  const amt = Math.min(betAmt, coins);
  if (betSel && coins <= 0) { $("betInfo").innerHTML = "コインがありません。「コインを1000に戻す」を押すか、予想せずに観戦できます"; $("betGo").textContent = "予想せずに観戦する"; $("resetCoins").classList.remove("hidden"); return; }
  $("betInfo").innerHTML = betSel ? `<b>${betSel.code}</b> ${betSel.driver} が${betType === "win" ? "優勝" : "3位以内"} に <b>${amt.toLocaleString()}</b> コイン → 当たれば <b>${Math.floor(amt * (betType === "win" ? betSel.oddsWin : betSel.oddsPod)).toLocaleString()}</b> コイン` : "予想するマシンを選んでください（選ばずに観戦だけもOK）";
  $("betGo").textContent = betSel ? "この予想でスタート" : "予想せずに観戦する";
  $("resetCoins").classList.toggle("hidden", coins >= 100);
}
document.querySelectorAll(".btype").forEach((b) => (b.onclick = () => { betType = b.dataset.t; renderBet(); }));
document.querySelectorAll(".bamt").forEach((b) => (b.onclick = () => { betAmt = b.dataset.a === "all" ? coins : +b.dataset.a; renderBet(); }));
$("wlaps").onchange = () => { WATCH_LAPS = +$("wlaps").value; };
$("resetCoins").onclick = () => { coins = 1000; saveCoins(); renderBet(); };
$("betBack").onclick = () => { $("bet").classList.add("hidden"); MODE = "drive"; goHome(); };
function startWatch(auto = false) {
  if (auto && !betSel) { betSel = betGrid[Math.floor(Math.random() * 6)]; }
  const amt = betSel ? Math.max(0, Math.min(betAmt, coins)) : 0;
  BET.car = amt > 0 ? betSel : null; BET.type = betType; BET.done = false; BET.line = "";
  BET.amount = amt;
  BET.odds = BET.car ? (betType === "win" ? BET.car.oddsWin : BET.car.oddsPod) : 0;
  setWCam("tv"); camFollowBet = false; $("camBet").classList.remove("on"); $("camBet").classList.toggle("hidden", !BET.car);
  if (BET.car) { coins -= BET.amount; saveCoins(); }
  WATCH_LAPS = +$("wlaps").value || 5;
  audio.init(); audio.resume();
  applyQuality($("quality").value);
  $("bet").classList.add("hidden");
  speedMul = 1; document.querySelectorAll(".spd").forEach((b) => b.classList.toggle("on", b.dataset.s === "1"));
  setupRace(betGrid);
}
$("betGo").onclick = () => startWatch();
document.querySelectorAll(".spd").forEach((b) => (b.onclick = () => setSpeed(+b.dataset.s)));
$("camBet").onclick = () => { if (WCAM !== "tv") setWCam("tv"); camFollowBet = !camFollowBet; $("camBet").classList.toggle("on", camFollowBet); shotT = 0; };
$("wAgain").onclick = () => { $("wresult").classList.add("hidden"); openBet(); };

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
  if (finishCheer <= 0 && !confetti.length) { if (drawFlagFx.dirty) { flagG.clearRect(0, 0, flagC.width, flagC.height); drawFlagFx.dirty = false; } return; }
  drawFlagFx.dirty = true;
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

// ======================= 天気・タイヤ・ピット・旗・事故・セーフティカー =======================
const estRaceTime = () => (MODE === "watch" ? WATCH_LAPS : LAPS || 3) * (TRACK_ID === 2 ? 42 : 39);

// ---------- 天気 ----------
const WX_DEF = {
  sun: { label: "晴れ", icon: "☀️", note: "ドライ。予選の速さがそのまま出やすい" },
  cloud: { label: "くもり", icon: "☁️", note: "ドライ。少し肌寒く、タイヤの選び方が大事" },
  rain: { label: "雨", icon: "🌧️", note: "ウェット。スピン・クラッシュが増え、雨に強いドライバーが有利" },
  shower: { label: "途中から雨", icon: "🌦️", note: "レース中に雨が降り出す。タイヤ交換のタイミングが勝負" },
  storm: { label: "豪雨", icon: "⛈️", note: "途中で大雨になり赤旗中断の可能性。大荒れ" },
};
const WX = { kind: "sun", label: "晴れ", icon: "☀️", note: "", wet: 0, rainVis: 0, heavy: 0, heavyTarget: 0, raining: false, rainAt: -1, heavyAt: -1, heavyDone: false, hemiMul: 1, envMul: 1, _last: -1 };
WX.reset = function () {
  const k = WX.kind, est = estRaceTime();
  WX.raining = k === "rain"; WX.wet = WX.raining ? 1 : 0; WX.rainVis = WX.wet; WX.heavy = 0; WX.heavyTarget = 0;
  WX.rainAt = k === "shower" ? est * (0.2 + Math.random() * 0.35) : k === "storm" ? est * (0.1 + Math.random() * 0.12) : -1;
  WX.heavyAt = k === "storm" ? WX.rainAt + est * (0.12 + Math.random() * 0.1) : -1;
  WX.heavyDone = false; WX._last = -1; WX.redAt = -1;
  applyWeatherLook();
};
function rollWeather(sel) {
  let k = sel;
  if (!WX_DEF[k]) { const r = Math.random(); k = r < 0.36 ? "sun" : r < 0.58 ? "cloud" : r < 0.76 ? "rain" : r < 0.91 ? "shower" : "storm"; }
  WX.kind = k; Object.assign(WX, WX_DEF[k]); WX.reset();
}
const wetEff = () => WX.wet + 0.4 * WX.heavy;
const LOOK = {
  sun: { sun: 3.2, hemi: 1, env: 1, fog: 0xb9c8d6, fn: 220, ff: 1400, turb: 4, ray: 1.2 },
  cloud: { sun: 1.3, hemi: 0.82, env: 0.7, fog: 0xaab3bb, fn: 150, ff: 1000, turb: 10, ray: 2.6 },
  rain: { sun: 0.5, hemi: 0.62, env: 0.45, fog: 0x7b848c, fn: 40, ff: 480 },
  storm: { sun: 0.22, hemi: 0.45, env: 0.3, fog: 0x575f66, fn: 22, ff: 250 },
};
const _c1 = new THREE.Color(), _c2 = new THREE.Color();
function applyWeatherLook() {
  const v = clamp(WX.rainVis, 0, 1), hv = clamp(WX.heavy, 0, 1);
  const key = v * 1000 + hv * 10 + WX.wet + (WX.kind === "sun" ? 0.5 : 0) + ({ day: 0, evening: 2e5, night: 4e5 }[TOD.kind] || 0);
  if (Math.abs(key - WX._last) < 0.002) return; WX._last = key;
  const B = WX.kind === "sun" ? LOOK.sun : LOOK.cloud, R = LOOK.rain, S = LOOK.storm;
  const mix = (a, b, c) => lerp(lerp(a, b, v), c, hv);
  sun.intensity = mix(B.sun, R.sun, S.sun);
  WX.hemiMul = mix(B.hemi, R.hemi, S.hemi); WX.envMul = mix(B.env, R.env, S.env);
  _c1.setHex(B.fog).lerp(_c2.setHex(R.fog), v).lerp(_c2.setHex(S.fog), hv);
  scene.fog.color.copy(_c1); scene.fog.near = mix(B.fn, R.fn, S.fn); scene.fog.far = mix(B.ff, R.ff, S.ff);
  su.turbidity.value = B.turb; su.rayleigh.value = B.ray;
  sky.visible = v < 0.45;
  scene.background = sky.visible ? null : _c1.clone();
  applyTODLook(v);
  if (ROAD_MAT) { ROAD_MAT.roughness = lerp(0.85, 0.26, WX.wet); ROAD_MAT.color.setHex(0x9a9a9a).lerp(_c2.setHex(0x55585b), WX.wet); }
}
// 雨粒（カメラのまわりだけに降らせる）
const RAIN_N = 4000, RAIN_BOX = 70;
const rainDrops = new Float32Array(RAIN_N * 3), rainPos = new Float32Array(RAIN_N * 6);
for (let i = 0; i < RAIN_N; i++) { rainDrops[i * 3] = (Math.random() - 0.5) * RAIN_BOX; rainDrops[i * 3 + 1] = Math.random() * 30; rainDrops[i * 3 + 2] = (Math.random() - 0.5) * RAIN_BOX; }
const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
const rainLines = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xd2dbe4, transparent: true, opacity: 0.4, depthWrite: false }));
rainLines.frustumCulled = false; rainLines.visible = false; rainLines.userData.noOcc = true; scene.add(rainLines);
function updateRainFx(dt) {
  const v = Math.min(WX.rainVis + WX.heavy * 0.5, 1.5);
  rainLines.visible = v > 0.03; if (!rainLines.visible) return;
  const n = Math.floor(RAIN_N * Math.min(1, v)); rainGeo.setDrawRange(0, n * 2);
  rainLines.material.opacity = 0.25 + 0.2 * Math.min(v, 1.4);
  const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z, fall = (24 + 10 * WX.heavy) * Math.min(dt, 0.05), len = 0.8 + 0.6 * WX.heavy, H = RAIN_BOX / 2;
  for (let i = 0; i < n; i++) {
    let x = rainDrops[i * 3], y = rainDrops[i * 3 + 1] - fall, z = rainDrops[i * 3 + 2];
    if (y < cy - 8) y += 30; if (y > cy + 22) y -= 30;
    x = cx + ((((x - cx + H) % RAIN_BOX) + RAIN_BOX) % RAIN_BOX) - H;
    z = cz + ((((z - cz + H) % RAIN_BOX) + RAIN_BOX) % RAIN_BOX) - H;
    rainDrops[i * 3] = x; rainDrops[i * 3 + 1] = y; rainDrops[i * 3 + 2] = z;
    const o = i * 6; rainPos[o] = x; rainPos[o + 1] = y; rainPos[o + 2] = z; rainPos[o + 3] = x + 0.12; rainPos[o + 4] = y + len; rainPos[o + 5] = z + 0.05;
  }
  rainGeo.attributes.position.needsUpdate = true;
}
function updateWeather(dt) {
  if (WX.rainAt >= 0 && raceT >= WX.rainAt && !WX.raining) {
    WX.raining = true;
    ticker("🌧️ 雨が降ってきた！ 路面が少しずつ濡れていく"); say("雨が降ってきました", 1); flagTemp("stripe", "路面が滑りやすい（雨）", 5);
    if (MODE === "drive") showMsg("雨が降ってきた", 2);
  }
  if (WX.heavyAt >= 0 && raceT >= WX.heavyAt && !WX.heavyDone) {
    WX.heavyDone = true; WX.heavyTarget = 1;
    ticker("⛈️ 豪雨！ 前がほとんど見えない"); say("豪雨です。前がほとんど見えません", 1);
    WX.redAt = raceT + 7;
  }
  if (WX.redAt > 0 && raceT >= WX.redAt) { WX.redAt = -1; redFlag("豪雨で危険"); }
  WX.rainVis = clamp(WX.rainVis + Math.sign((WX.raining ? 1 : 0) - WX.rainVis) * dt / 10, 0, 1);
  WX.wet = clamp(WX.wet + Math.sign((WX.raining ? 1 : 0) - WX.wet) * dt / 35, 0, 1);
  WX.heavy = clamp(WX.heavy + Math.sign(WX.heavyTarget - WX.heavy) * dt / 6, 0, 1);
  applyWeatherLook();
}

// ---------- タイヤ ----------
// dry=乾いた路面のグリップ, life=5周レースでの寿命（周）。インター・ウェットは乾いた路面だと急に減る
const TYRES = {
  S: { jp: "ソフト", col: "#ff3030", dry: 1.04, life: 2.6 },
  M: { jp: "ミディアム", col: "#ffd21a", dry: 1.0, life: 4.2 },
  H: { jp: "ハード", col: "#f2f2f2", dry: 0.965, life: 7.0 },
  I: { jp: "インター", col: "#2fd060", dry: 0.93, life: 4.5 },
  W: { jp: "ウェット", col: "#2f80ff", dry: 0.86, life: 6.0 },
};
const tyreBadge = (t) => `<i class="ty" style="border-color:${TYRES[t].col}">${t}</i>`;
function tyreGripBase(t, w) {
  if (t === "I") return w < 0.6 ? lerp(0.93, 0.95, w / 0.6) : lerp(0.95, 0.88, Math.min(1, (w - 0.6) / 0.8));
  if (t === "W") return (w < 0.6 ? lerp(0.86, 0.9, w / 0.6) : lerp(0.9, 0.93, Math.min(1, (w - 0.6) / 0.4))) - Math.max(0, w - 1) * 0.05;
  return TYRES[t].dry * (1 - 0.3 * Math.min(w, 1)) - Math.max(0, w - 1) * 0.1;
}
const wearPenalty = (wf) => Math.min(0.3, 0.05 * Math.min(wf, 1) + Math.max(0, wf - 1) * 0.25);
function wetGrip(c) {
  const w = wetEff();
  let g = tyreGripBase(c.tyre || "M", w) * (1 - wearPenalty(c.tyreWear || 0));
  g *= 1 + (c.rainSkill || 0) * 0.035 * Math.min(w, 1);
  if (c.damage) g *= 0.97;
  if (FL.zones.length) for (const z of FL.zones) if (z.level === "oil" && inZone(c, z)) { g *= 0.93; break; }
  return g;
}
function wearTyre(c, ds) {
  if (ds <= 0) return;
  const t = c.tyre || "M", w = Math.min(wetEff(), 1), wetT = t === "I" || t === "W";
  const mult = wetT ? 1 + 2.2 * (1 - w) : 1 - 0.45 * w;
  c.tyreWear = (c.tyreWear || 0) + (ds / L) / lifeLaps(t) * mult;
}
// タイヤの寿命（周）: 長いレースほど長持ち。5周=基準、10周で約1.5倍、30周で約2.9倍
const lifeLaps = (t) => TYRES[t].life * Math.pow(Math.max(LAPS, 5) / 5, 0.6);
const pitClosed = () => LAPS <= 3;     // 3周レースはピットインなし
// 今の天気と残り周回に合うタイヤ
function pickTyre(c, lapsLeft) {
  const w = wetEff();
  // 雨用タイヤ同士（インター⇔ウェット）を行ったり来たりしないよう、今が雨用ならその種類を続ける
  if (w > 0.22 || (WX.raining && w > 0.1) || WX.heavyTarget) {
    if (c.tyre === "I" || c.tyre === "W") return c.tyre;
    return w > 0.9 || WX.heavyTarget ? "W" : "I";
  }
  if (lapsLeft <= lifeLaps("S") * 0.92) return "S";
  if (lapsLeft <= lifeLaps("M") * 0.92) return Math.random() < 0.7 ? "M" : "H";
  return "H";
}
function startTyreFor(c) {
  const w = wetEff();
  if (w > 0.75) return Math.random() < 0.6 ? "W" : "I";
  if (w > 0.25) return "I";
  const r = Math.random() + (c.agg - 0.6) * 0.3;
  return r > 0.68 ? "S" : r > 0.25 ? "M" : "H";
}
function setTyre(c, t) {
  c.tyre = t; c.tyreWear = 0;
  if (c.bandMat) { c.bandMat.color.set(TYRES[t].col); c.bandMat.emissive && c.bandMat.emissive.set(0x000000); }
}

// ---------- ピットレーン ----------
// スタート直線の観客席側。S_FIN からの距離で場所を決める
const boxRel = (c) => -75 + TEAMS.indexOf(c.T) * 14;
const PIT_CREW = [];
function buildPitLane() {
  const i0 = idxAtS(S_FIN + PIT.A), nI = Math.round((PIT.D - PIT.A) / DS);
  const outerLat = (c) => { const r = PIT.A + c * DS; return r < PIT.B ? lerp(WALL - 0.3, PIT.wall, smooth01((r - PIT.A) / (PIT.B - PIT.A))) : r > PIT.C ? lerp(PIT.wall, WALL - 0.3, smooth01((r - PIT.C) / (PIT.D - PIT.C))) : PIT.wall; };
  const strip = (latA, latB, y, mat, from = 0, to = nI) => {
    const pos = [], idx = []; let n = 0;
    for (let c = from; c <= to; c++) {
      const i = wrap(i0 + c), a = typeof latA === "function" ? latA(c) : latA, b = typeof latB === "function" ? latB(c) : latB;
      pos.push(TR.x[i] + TR.nx[i] * PIT_SD * a, typeof y === "number" ? y : y[0], TR.z[i] + TR.nz[i] * PIT_SD * a, TR.x[i] + TR.nx[i] * PIT_SD * b, typeof y === "number" ? y : y[1], TR.z[i] + TR.nz[i] * PIT_SD * b);
      if (n > 0) { const k = 2 * (n - 1); idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } n++;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    return mesh(g, mat);
  };
  const cB = Math.round((PIT.B - PIT.A) / DS), cC = Math.round((PIT.C - PIT.A) / DS);
  strip(WALL - 0.2, outerLat, 0.006, ROAD_MAT);                                   // 路面
  const white = std({ color: 0xeeeeee, roughness: 0.6, side: THREE.DoubleSide });
  strip(11.75, 11.9, 0.012, white, cB, cC);                                       // 作業エリアとの境目
  const armco = std({ color: 0xb8bcc2, metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide });
  for (const [a, b] of [[0.3, 0.62], [0.72, 1.04]]) { const f = (c) => outerLat(c) + 0.3; strip(f, f, [a, b], armco); }
  // ピット入口・出口のライン
  for (const r of [PIT.B - 5, PIT.C + 5]) {
    const i = idxAtS(S_FIN + r), lt = PIT_SD * (PIT.lane + 1.5);
    const m = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.01, 0.3), white); m.position.set(TR.x[i] + TR.nx[i] * PIT_SD * PIT.lane, 0.014, TR.z[i] + TR.nz[i] * PIT_SD * PIT.lane);
    m.rotation.y = Math.atan2(TR.tx[i], TR.tz[i]); scene.add(m);
    void lt;
  }
  // ガレージ（チームカラーの看板付き）と作業場所
  const gm = std({ color: 0x2b2e33, roughness: 0.7 }), dark = std({ color: 0x0c0d10, roughness: 0.9 });
  TEAMS.forEach((T, k) => {
    const r = -75 + k * 14, i = idxAtS(S_FIN + r), ang = Math.atan2(TR.tx[i], TR.tz[i]);
    const at = (lat, y) => new THREE.Vector3(TR.x[i] + TR.nx[i] * PIT_SD * lat, y, TR.z[i] + TR.nz[i] * PIT_SD * lat);
    const g = new THREE.Mesh(new THREE.BoxGeometry(5.5, 4.8, 13.6), gm); g.position.copy(at(PIT.wall + 3.1, 2.4)); g.rotation.y = ang; g.castShadow = true; scene.add(g);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.2), dark); door.position.copy(at(PIT.wall + 0.32, 1.6)); door.rotation.y = ang - PIT_SD * Math.PI / 2; scene.add(door);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(12.5, 0.9), std({ color: T.color, roughness: 0.5, emissive: T.color, emissiveIntensity: 0.25 })); sign.position.copy(at(PIT.wall + 0.31, 4.0)); sign.rotation.y = door.rotation.y; scene.add(sign);
    const box = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 6.5), std({ color: T.color, roughness: 0.8, transparent: true, opacity: 0.55 })); box.rotation.set(-Math.PI / 2, 0, ang); box.position.copy(at(PIT.box, 0.016)); scene.add(box);
    // ピットクルー（止まった時だけ出る）
    const crew = new THREE.Group(); crew.visible = false; crew.userData.noOcc = true;
    const cm = std({ color: T.color, roughness: 0.7 }), helm = std({ color: 0xeeeeee, roughness: 0.4 });
    for (const [dx, dz] of [[-1.5, -1.8], [1.5, -1.8], [-1.5, 1.6], [1.5, 1.6], [0, 3.2], [-2.3, 0], [2.3, 0]]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, 0.4), cm); p.position.set(dx, 0.55, dz); crew.add(p);
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), helm); h.position.set(dx, 1.25, dz); crew.add(h);
    }
    crew.position.copy(at(PIT.box, 0)); crew.rotation.y = ang; scene.add(crew); PIT_CREW[k] = crew;
  });
}
function startPit(c) {
  c.pit = { phase: "in", lat0: c.lat, v: Math.max(c.speed, 8), t: 0, red: !!FL.red, queueRel: 0, stop: c.pitWhy || "tyre" };
  if (FL.red) c.pit.queueRel = nextRedSlot();
  c.pitReq = false; c.crashT = 0; c.drsOn = false; c.passSide = 0;
  if (!FL.red) ticker(`🔧 ${c.code} がピットイン${c.damage ? "（マシン修理）" : ""}`);
}
function nextRedSlot() { const r = PIT.C - 8 - FL.redSlots * 8.4; FL.redSlots++; return Math.max(r, PIT.B + 2); }
function pitLatAt(c, rel) {
  const P = c.pit;
  let lat;
  if (rel < PIT.B) lat = lerp(P.lat0, PIT_SD * PIT.lane, smooth01((rel - PIT.A) / (PIT.B - PIT.A)));
  else if (rel > PIT.C) lat = lerp(PIT_SD * PIT.lane, PIT_SD * 3.5, smooth01((rel - PIT.C) / (PIT.D - PIT.C)));
  else lat = PIT_SD * PIT.lane;
  if (!P.red) { const b = 1 - smooth01((Math.abs(rel - boxRel(c)) - 3) / 16); lat = lerp(lat, PIT_SD * PIT.box, b); }
  return lat;
}
function pitPhysics(c, dt) {
  const P = c.pit; let rel = pitRel(c.s);
  // チームメイトが作業中なら、すぐ後ろで待つ（ダブルストップ）
  const mate = P.red ? null : cars.find((o) => o !== c && o.T === c.T && o.pit && !o.pit.red && o.pit.phase === "stop");
  const target = P.red ? P.queueRel : mate ? boxRel(c) - 10 : boxRel(c);
  let vT;
  if (P.phase === "in") {
    vT = rel < PIT.B - 5 ? PIT.lim + Math.max(0, PIT.B - 5 - rel) * 0.8 : PIT.lim;
    let dStop = target - rel; if (dStop < -2) { dStop = 0; }
    vT = Math.min(vT, Math.sqrt(2 * 9 * Math.max(dStop, 0)) + (dStop > 0.3 ? 0.8 : 0));
    if (mate && dStop < 0.5) { vT = 0; P.v = Math.min(P.v, 1); }
    else if (dStop < 0.5 && P.v < 1.5) {
      P.phase = "stop"; P.v = 0;
      if (P.red) P.t = Infinity;
      else {
        P.t = 2.1 + Math.random() * 0.7 + (c.damage ? 6 + Math.random() * 3 : 0);
        if (Math.random() < 0.07) { P.t += 2.5 + Math.random() * 3; P.slow = true; }
        P.total = P.t; const crew = PIT_CREW[TEAMS.indexOf(c.T)]; if (crew) crew.visible = true;
      }
    }
  } else if (P.phase === "stop") {
    vT = 0;
    if (!P.red) {
      P.t -= dt;
      if (P.t <= 0) {
        P.phase = "out";
        const crew = PIT_CREW[TEAMS.indexOf(c.T)]; if (crew) crew.visible = false;
        const was = c.tyre, nt = c.nextTyre || pickTyre(c, LAPS - c.dist / L);
        setTyre(c, nt); c.stints = (c.stints || [was]).concat(nt); c.pits = (c.pits || 0) + 1;
        if (c.damage) { c.damage = 0; c.meat = 0; }
        c.nextTyre = null; c.pitWhy = null;
        const msg = `🔧 ${c.code} ピット作業 ${P.total.toFixed(1)}秒 → ${TYRES[nt].jp}${P.slow ? "（作業でもたついた！）" : ""}`;
        if (MODE === "watch" ? true : c === player || c.code === order()[0].code) ticker(msg);
        if (c === player) showMsg(`${TYRES[nt].jp} に交換 ${P.total.toFixed(1)}秒`, 2);
      }
    }
  } else vT = rel < PIT.C ? PIT.lim : PIT.lim + (rel - PIT.C) * 1.2;
  if (P.red && P.phase === "out") P.phase = "in";
  const acc = vT > P.v ? (P.phase === "out" && rel > PIT.C ? 12 : 9) : 45;
  P.v = vT > P.v ? Math.min(vT, P.v + acc * dt) : Math.max(vT, P.v - acc * dt);
  const ds = P.v * dt;
  c.s = (((c.s + ds) % L) + L) % L; c.dist += ds; rel += ds;
  // 位置と向きはコースの点の間をなめらかに補間して決める（点に吸い付いてガタガタしないように）
  const lat = pitLatAt(c, rel), slope = (pitLatAt(c, rel + 0.6) - pitLatAt(c, rel - 0.6)) / 1.2;
  const T = trackAt(c.s);
  c.x = T.x + T.nx * lat; c.z = T.z + T.nz * lat;
  c.h = Math.atan2(T.tx + T.nx * slope, T.tz + T.nz * slope);
  c.idx = T.i; c.lat = lat; c.speed = P.v;
  c.vx = Math.sin(c.h) * P.v; c.vz = Math.cos(c.h) * P.v;
  c.thr = 0.3; c.brk = 0; c.steer = 0;
  if (rel >= PIT.D) { c.pit = null; c.react = 0; c.passSide = 0; c.avoid = 0; c.drsArm = -1; }
}

// ---------- 旗 ----------
const FL = { zones: [], red: null, redAt: -1, redSlots: 0, temp: null, tempT: 0, drsAt: 20, posT: 0 };
const ZONE_BACK = 200, ZONE_FWD = 40;
function inZone(c, z) { const d = wrapDs(c.s - z.s); return d > -ZONE_BACK && d < ZONE_FWD; }
function zoneLevel(c) { let lv = 0; for (const z of FL.zones) if (z.level !== "oil" && inZone(c, z)) lv = Math.max(lv, z.level); return lv; }
// 追い越しが違反になる黄旗区間（出てから2秒以上たち、抜かれた車が事故の当事者でない）
function yellowPassIllegal(c, passed) { for (const z of FL.zones) if (z.level !== "oil" && raceT - z.t0 > 2 && z.car !== passed && inZone(c, z)) return true; return false; }
function addZone(s, level, dur, car) { FL.zones.push({ s, level, until: raceT + dur, car, t0: raceT }); }
function flagTemp(kind, text, sec = 3) { FL.temp = { kind, text }; FL.tempT = sec; }
function updateZones() {
  const before = FL.zones.length;
  FL.zones = FL.zones.filter((z) => {
    if (z.car && z.level !== "oil" && (z.car.spinT > 0 || z.car.losing > 0)) z.until = Math.max(z.until, raceT + 3);
    if (raceT < z.until) return true;
    if (z.level === 2) FL.zones.push({ s: z.s, level: "oil", until: raceT + 40 });     // 破片やオイルが残る
    return false;
  });
  if (FL.zones.length < before && !SC.on && !FL.red && !FL.zones.some((z) => z.level !== "oil")) flagTemp("green", "GREEN ― 黄旗区間が終わり、全開で走ってOK", 2.5);
}
// 旗のマーシャルポスト（コース脇で振られる旗）
const FLAG_POOL = [];
{
  const poleM = std({ color: 0x333333, roughness: 0.6 });
  for (let k = 0; k < 8; k++) {
    const g = new THREE.Group(); g.visible = false; g.userData.noOcc = true;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 6), poleM); pole.position.y = 0.8; g.add(pole);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.75, 6, 1), new THREE.MeshStandardMaterial({ color: 0xffd400, side: THREE.DoubleSide, roughness: 0.7 }));
    f.position.set(0.58, 1.25, 0); g.add(f); g.userData.flag = f;
    scene.add(g); FLAG_POOL.push(g);
  }
}
function placeMarshalFlags(t) {
  const want = [];
  if (FL.red) for (const r of [0, 0.25, 0.5, 0.75]) want.push([S_FIN + r * L + 30, 0xe10600]);
  else {
    if (SC.on) for (const r of [0.1, 0.45, 0.8]) want.push([S_FIN + r * L, 0xffd400]);
    for (const z of FL.zones) {
      const col = z.level === "oil" ? 0xff6a00 : 0xffd400;
      want.push([z.s - 70, col]); if (z.level === 2) want.push([z.s - 150, col]);
    }
  }
  FLAG_POOL.forEach((g, k) => {
    const w = want[k]; g.visible = !!w; if (!w) return;
    const i = idxAtS(w[0]), lt = -PIT_SD * (WALL + 0.35);
    g.position.set(TR.x[i] + TR.nx[i] * lt, 1.7, TR.z[i] + TR.nz[i] * lt);
    g.rotation.y = Math.atan2(TR.tx[i], TR.tz[i]) + Math.PI / 2 + Math.sin(t * 5 + k) * 0.5;
    g.userData.flag.material.color.setHex(w[1]);
  });
}
// 画面上部の旗表示。全体の旗（赤・SC）> 一時的な知らせ > 見ている車への旗 の順
const FLAG_JP = { yellow: "YELLOW", dyellow: "DOUBLE YELLOW", red: "RED FLAG", green: "GREEN", white: "WHITE", stripe: "SLIPPERY", blue: "BLUE FLAG", bw: "WARNING", meatball: "DAMAGE", black: "BLACK FLAG", chequered: "CHEQUERED FLAG", sc: "SAFETY CAR" };
let flagUiKey = "";
function localFlag(c) {
  if (!c || c.finished || c.dnf) return null;
  if (c.dsq) return { kind: "black", text: "失格 ― ピットに戻れ" };
  if (c.damage && !c.pit) return { kind: "meatball", text: `${c.code}：マシン損傷 ― すぐピットへ` + (c === player && MODE === "drive" ? "（Bで予約）" : "") };
  const lv = zoneLevel(c);
  if (lv === 2) return { kind: "dyellow", text: "DOUBLE YELLOW ― コース上に止まった車。大きく減速・追い越し禁止" };
  if (lv === 1) return { kind: "yellow", text: "YELLOW ― 危険あり。減速・追い越し禁止" };
  if (c.blueT > 0.4) return { kind: "blue", text: `BLUE FLAG ― ${c.code}：後ろから速い車。道を譲れ` };
  if (c.bwT > 0) return { kind: "bw", text: `WARNING ― ${c.code}：トラックリミット違反。次はペナルティ` };
  for (const z of FL.zones) if (z.level === "oil" && inZone(c, z)) return { kind: "stripe", text: "SLIPPERY ― 破片・オイルで路面が滑りやすい" };
  for (const o of cars) {
    if (o === c || o.dnf || o.pit || o.finished) continue;
    const d = wrapDs(o.s - c.s);
    if (d > 0 && d < 260 && o.speed < 28 && c.speed > o.speed + 15 && raceT > 8) return { kind: "white", text: `WHITE ― 前方に遅い車（${o.code}）` };
  }
  return null;
}
function updateFlagUI(dt) {
  if (FL.tempT > 0) { FL.tempT -= dt; if (FL.tempT <= 0) FL.temp = null; }
  let f = null;
  if (FL.red) f = { kind: "red", text: FL.red.phase === "wait" ? `RED FLAG ― 中断中。まもなくスタンディングスタートで再開` : `RED FLAG ― ${FL.red.reason}。レース中断、全車ピットへ` };
  else if (SC.on) f = { kind: "sc", text: SC.phase === "out" ? "SAFETY CAR ― 追い越し禁止" : SC.phase === "in" ? "SAFETY CAR IN THIS LAP ― この周で終了" : "まもなくリスタート" };
  else if (FL.temp) f = FL.temp;
  else if (state === "race") f = localFlag(viewCar());
  const el = $("flagBanner");
  const key = f ? f.kind + f.text : "";
  if (key === flagUiKey) return; flagUiKey = key;
  el.classList.toggle("hidden", !f || state === "title");
  if (!f) return;
  el.className = `hud ${f.kind}${MODE === "drive" ? " drive" : ""}`;
  el.firstElementChild.innerHTML = `<i class="fl fl-${f.kind}"></i>${f.text}`;
}
function penalize(c, sec, why) {
  c.pen = (c.pen || 0) + sec;
  ticker(`⚠️ ${c.code} に${sec}秒ペナルティ（${why}）`);
  if (c === player && MODE === "drive") { showMsg(`+${sec}秒ペナルティ（${why}）`, 2.5); say("ペナルティです", 1); }
}
function disqualify(c, why) {
  if (c.dsq) return;
  c.dsq = true; ticker(`⬛ ${c.code} に黒旗 ― 失格（${why}）`);
  retire(c, true);
  if (c === player && MODE === "drive") { showMsg("失格（黒旗）", 3.5); state = "finished"; finishCheer = 0; setTimeout(showResults, 3800); }
}
// トラックリミット・黄旗中の追い越し・ブルーフラッグ・ダメージ
function checkRules(dt) {
  for (const c of cars) {
    if (c.dnf || c.pit || c.finished || c.spinT > 0 || c.losing > 0) { c.offT = 0; continue; }
    if (c.bwT > 0) c.bwT -= dt;
    const corner = Math.abs(kS[c.idx]) > 1 / 220;
    if (Math.abs(c.lat) > HALF + 0.12 && corner && c.speed > 22) c.offT = (c.offT || 0) + dt; else if (Math.abs(c.lat) < HALF - 0.3) { c.offT = 0; c.tlDone = false; }
    if (c.offT > 0.3 && !c.tlDone) {
      c.tlDone = true; c.tlv = (c.tlv || 0) + 1;
      if (c.tlv === 3) { c.bwT = 6; ticker(`🏳️ ${c.code} に白黒旗（トラックリミット警告）`); }
      else if (c.tlv > 3) penalize(c, 5, "トラックリミット");
      else if (c === player && MODE === "drive") showMsg(`トラックリミット違反 ${c.tlv}回目`, 1.6);
    }
    // ブルーフラッグ: 1周以上前の車がすぐ後ろに来た
    let blue = false, yl = 0;
    for (const o of cars) {
      if (o === c || o.dnf || o.pit || o.finished) continue;
      const d = wrapDs(c.s - o.s);
      if (d > 0 && d < 45 && o.dist > c.dist + L * 0.5) { blue = true; yl = o.lat; break; }
    }
    if (blue) {
      c.blueT = (c.blueT || 0) + dt; c.yieldSide = yl > c.lat ? -1 : 1;
      // ペナルティはプレイヤーだけ（CPUはちゃんと譲る）
      if (c.blueT > 7 && c === player && MODE === "drive") { c.blueT = 0.5; c.blueIgn = (c.blueIgn || 0) + 1; if (c.blueIgn >= 3) { c.blueIgn = 0; penalize(c, 5, "ブルーフラッグ無視"); } }
    } else c.blueT = 0;
  }
  // 黄旗・SC中の追い越し（0.3秒ごとに順位を比べる）
  FL.posT -= dt;
  if (FL.posT <= 0) {
    FL.posT = 0.3;
    const ord = order();
    ord.forEach((c, k) => {
      const prev = c.lastPos2;
      c.lastPos2 = k + 1;
      if (!prev || k + 1 >= prev || c.dnf || c.pit || c.finished || raceT < 8) return;
      const passed = ord[k + 1];
      if (!passed || passed.dnf || passed.pit || passed.spinT > 0 || passed.losing > 0 || passed.speed < 20 || (passed.lastPos2 || 99) > prev) return;
      if (passed.speed < 30 || passed.damage) return;
      if (FL.red || (SC.on && SC.phase !== "restart") || yellowPassIllegal(c, passed)) penalize(c, 5, SC.on ? "SC中の追い越し" : "黄旗中の追い越し");
    });
  }
}
function damageCar(c, why) {
  if (pitClosed()) return;
  if (c.damage || c.dnf || c.pit || FL.red || c.hadDamage || (FL.dmgN || 0) >= 3) return;
  FL.dmgN = (FL.dmgN || 0) + 1; c.hadDamage = true;
  c.damage = 1; c.meat = 0;
  ticker(`🟠 ${c.code} にオレンジディスク旗 ― マシン損傷（${why}）。ピットで修理を`);
  if (c === player && MODE === "drive") showMsg("マシン損傷！ B でピットへ", 2.5);
  else { c.pitReq = true; c.pitWhy = "repair"; c.nextTyre = pickTyre(c, LAPS - c.dist / L); }
}

// ---------- スピン・クラッシュ ----------
function startSpin(c) {
  if (c.pit || c.spinT > 0 || c.losing > 0 || c.dnf) return;
  c.spinT = 1.5 + Math.random() * 0.6; c.spinDir = Math.random() < 0.5 ? -1 : 1;
  ticker(`🟨 ${c.code} がスピン！`); say(`${sname(c)}がスピン`, 0);
  addZone(c.s, 1, 7, c);
}
function startCrash(c) {
  if (c.pit || c.dnf || c.losing > 0) return;
  c.losing = 2.6; c.spinDir = -Math.sign(kS[idxAtS(c.s + 15)]) || 1; c.spinT = 0;
}
function spinPhysics(c, dt) {
  const losing = c.losing > 0;
  if (losing) c.losing -= dt; else c.spinT -= dt;
  const T = losing ? c.losing : c.spinT;
  const th = Math.atan2(TR.tx[c.idx], TR.tz[c.idx]);
  if (!losing && T < 0.45) { let d = th - c.h; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; c.h += d * Math.min(1, dt * 7); }
  else c.h += c.spinDir * (losing ? 2.0 : 3 + 3 * T) * dt;
  const k = Math.exp(-(losing ? 0.45 : 1.7) * dt); c.vx *= k; c.vz *= k;
  c.x += c.vx * dt; c.z += c.vz * dt;
  const p = project(c.x, c.z, c.idx);
  const ds = wrapDs(p.s - c.s); c.dist += ds; c.s = p.s; c.lat = p.lat; c.idx = p.i;
  c.speed = Math.hypot(c.vx, c.vz) * 0.7; c.thr = 0; c.brk = 0; c.steer = c.spinDir;
  const lim = WALL - 1.0;
  if (Math.abs(c.lat) > lim) {
    if (losing) return retire(c);
    const sd = Math.sign(c.lat), push = Math.abs(c.lat) - lim;
    c.x -= TR.nx[p.i] * sd * push; c.z -= TR.nz[p.i] * sd * push; c.lat = sd * lim;
    const vn = c.vx * TR.nx[p.i] + c.vz * TR.nz[p.i]; if (vn * sd > 0) { c.vx -= vn * TR.nx[p.i]; c.vz -= vn * TR.nz[p.i]; }
    c.hitT = 0.3;
  }
  if (losing && c.losing <= 0) return retire(c);
  if (!losing && c.spinT <= 0) {
    c.spinT = 0; c.h = th; const v = Math.hypot(c.vx, c.vz) * 0.5;
    c.vx = Math.sin(th) * v; c.vz = Math.cos(th) * v; c.react = 0.5;
    if (Math.random() < 0.12) damageCar(c, "スピンで接触");
  }
}
function retire(c, quiet = false) {
  if (c.dnf) return;
  c.dnf = true; c.losing = 0; c.spinT = 0; c.vx = c.vz = 0; c.speed = 0; c.dnfT = raceT; c.pitReq = false; c.damage = 0;
  if (c.pit) { c.pit = null; c.obj.visible = false; return; }
  const sd = Math.sign(c.lat) || 1, lat = sd * (WALL - 0.75);
  const [x, z, i] = pointAt(c.s, lat); c.x = x; c.z = z; c.lat = lat; c.idx = i; c.hitT = 0.8;
  if (quiet) { c.obj.visible = false; return; }
  window.__dnf = (window.__dnf || 0) + 1; say(`${sname(c)}、クラッシュ！`, 2);
  ticker(`💥 ${c.code}（${c.team}）がクラッシュ！ リタイア` + (c === BET.car ? " ― あなたの予想した車…" : ""));
  showMsg(`${c.code} CRASH!`, 2.2);
  if (MODE === "watch") { setShot("heli", c); shotT = 4.5; }
}
// レースごとの事故の予定（いつ・どんな大きさ）
const INC = { list: [] };
function planIncidents() {
  INC.list = [];
  const wet = WX.kind === "rain" || WX.kind === "storm" ? 1 : WX.kind === "shower" ? 0.5 : 0;
  const r = Math.random();
  let n = wet > 0.5 ? (r < 0.15 ? 0 : r < 0.62 ? 1 : 2) : wet > 0 ? (r < 0.3 ? 0 : r < 0.78 ? 1 : 2) : (r < 0.4 ? 0 : r < 0.86 ? 1 : 2);
  const laps = MODE === "watch" ? WATCH_LAPS : LAPS;
  if (laps > 5) n = Math.min(5, Math.round(n * Math.sqrt(laps / 5) + Math.random() * 0.6));     // 長いレースほど事故も起きやすい
  if (MODE === "drive") n = Math.min(n, laps > 10 ? 3 : 1 + (Math.random() < 0.3 ? 1 : 0));
  const est = estRaceTime();
  for (let k = 0; k < n; k++) INC.list.push({ t: 15 + Math.random() * (est * 0.8 - 15), car: null, wait: 0, done: false });
  INC.list.sort((a, b) => a.t - b.t);
}
function pickVictim() {
  const pool = cars.filter((c) => !c.dnf && !c.finished && !c.pit && c !== player || (c === player && MODE === "watch" && !c.dnf && !c.finished && !c.pit));
  let tot = 0; const w = pool.map((c) => { const v = (1.25 - c.cons) * (0.6 + c.agg) * (1 + wetEff() * (0.5 - 0.4 * c.rainSkill)); tot += v; return v; });
  let x = Math.random() * tot; for (let k = 0; k < pool.length; k++) { x -= w[k]; if (x <= 0) return pool[k]; }
  return pool[0];
}
function updateIncidents(dt) {
  if (state !== "race") return;
  updateZones();
  for (const I of INC.list) {
    if (I.done || raceT < I.t) continue;
    if (SC.on || FL.red) { I.t = raceT + 15; continue; }
    if (!I.car || I.car.dnf || I.car.finished || I.car.pit) I.car = pickVictim();
    const c = I.car; if (!c) { I.done = true; continue; }
    I.wait += dt;
    const corner = Math.abs(kS[idxAtS(c.s + 18)]) > 1 / 75 && c.speed > 24;
    if (corner || I.wait > 25) { I.done = true; c.crashSev = Math.random(); startCrash(c); }
  }
  // リタイアした車の後始末（SC・赤旗・黄旗）
  for (const c of cars) {
    if (!c.dnf || c.handled || c.dsq) continue;
    c.handled = true;
    const lead = leaderCar(), left = lead ? LAPS - lead.dist / L : 0;
    const sev = c.crashSev ?? Math.random();
    if (sev < 0.22 && left > 1.3 && !SC.on) {
      // 大クラッシュ: 後ろの車も巻き込まれて赤旗
      let o2 = null, bd = 70;
      for (const o of cars) { if (o === c || o.dnf || o.pit || o === player) continue; const d = wrapDs(c.s - o.s); if (d > 0 && d < bd) { bd = d; o2 = o; } }
      if (o2) { o2.crashSev = 1; o2.handled = true; o2.losing = 0.01; o2.spinDir = c.spinDir; ticker(`💥 ${o2.code} も避けきれず巻き込まれた！`); }
      FL.redAt = raceT + 3; FL.redReason = "大クラッシュ";
      addZone(c.s, 2, 999, c);
    } else if (sev < 0.75 && left > 0.8 && !SC.on) {
      addZone(c.s, 2, 6, c); deploySC();
    } else {
      addZone(c.s, 2, 16 + Math.random() * 8, c); c.hideAt = raceT + 14;
      ticker(`🟨🟨 ダブルイエロー ― ${c.code} の車を撤去中`);
    }
  }
  if (FL.redAt > 0 && raceT >= FL.redAt) { FL.redAt = -1; redFlag(FL.redReason || "危険"); }
  for (const c of cars) if (c.dnf && c.obj.visible && c.hideAt && raceT > c.hideAt) c.obj.visible = false;
}
function leaderCar() { return order().find((c) => !c.dnf) || null; }

// ---------- セーフティカー ----------
const SC = { on: false, phase: "", s: 0, v: 0, t: 0, count: 0, obj: null };
{
  const g = new THREE.Group(); g.visible = false; g.userData.noOcc = true;
  const body = std({ color: 0xb9bdc3, metalness: 0.75, roughness: 0.3 });
  const b1 = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.62, 4.6), body); b1.position.y = 0.58; b1.castShadow = true; g.add(b1);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 1.9), std({ color: 0x111418, metalness: 0.4, roughness: 0.15 })); cab.position.set(0, 1.12, -0.35); g.add(cab);
  const tex = canvasTex(256, 48, (gg, w, h) => { gg.fillStyle = "#c9a400"; gg.fillRect(0, 0, w, h); gg.fillStyle = "#111"; gg.font = "bold 30px Helvetica, Arial"; gg.textAlign = "center"; gg.textBaseline = "middle"; gg.fillText("SAFETY CAR", w / 2, h / 2 + 2); }, false);
  for (const sd of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.45), std({ map: tex, roughness: 0.5 })); p.position.set(sd * 0.985, 0.6, 0); p.rotation.y = sd * Math.PI / 2; g.add(p); }
  const wm = std({ color: 0x111111, roughness: 0.8 });
  for (const [x, z] of [[-0.9, 1.45], [0.9, 1.45], [-0.9, -1.45], [0.9, -1.45]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.28, 14), wm); w.rotation.z = Math.PI / 2; w.position.set(x, 0.34, z); g.add(w); }
  SC.lamps = [];
  for (const x of [-0.38, 0.38]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.22), new THREE.MeshStandardMaterial({ color: 0x332200, emissive: 0xffa000, emissiveIntensity: 0 })); l.position.set(x, 1.43, -0.3); g.add(l); SC.lamps.push(l); }
  scene.add(g); SC.obj = g;
}
function deploySC() {
  if (SC.on || FL.red) return;
  const lead = leaderCar(); if (!lead) return;
  SC.on = true; SC.phase = "out"; SC.t = 0; SC.count++;
  SC.s = (lead.s + 130) % L; SC.v = 30; SC.obj.visible = true;
  ticker("🚨 セーフティカー出動！ 全車追い越し禁止"); say("セーフティカーが出動しました", 2);
  for (const c of cars) { c.drsOn = false; c.drsArm = -1; }
}
function endSC(silent = false) {
  if (!SC.on) return;
  SC.on = false; SC.phase = ""; SC.obj.visible = false; FL.drsAt = raceT + 15;
  if (!silent) { ticker("🟢 グリーンフラッグ！ レース再開"); say("グリーンフラッグ、レース再開です", 2); flagTemp("green", "GREEN ― レース再開！", 3); }
}
function updateSC(dt) {
  if (!SC.on) return;
  SC.t += dt;
  const lead = leaderCar();
  if (SC.phase !== "restart") {
    let vt = 46;
    for (let d = 0; d < 90; d += 6) vt = Math.min(vt, TR.vcorner[idxAtS(SC.s + d)] * 0.72 + d * 0.15);
    const gap = lead ? wrapDs(SC.s - lead.s) : 0;
    if (gap > 160) vt = Math.min(vt, 24);
    SC.v += clamp(vt - SC.v, -10 * dt, 7 * dt);
    SC.s = (SC.s + SC.v * dt) % L;
    const T = trackAt(SC.s);
    SC.obj.position.set(T.x, 0, T.z); SC.obj.rotation.y = Math.atan2(T.tx, T.tz);
    const on = SC.phase === "out" && Math.floor(SC.t * 3) % 2;
    SC.lamps[0].material.emissiveIntensity = SC.phase === "out" ? (on ? 4 : 0.3) : 0;
    SC.lamps[1].material.emissiveIntensity = SC.phase === "out" ? (on ? 0.3 : 4) : 0;
    const left = lead ? LAPS - lead.dist / L : 0;
    if (SC.phase === "out" && ((SC.t > 32 && gap < 70) || left < 1.05)) { SC.phase = "in"; ticker("🟡 セーフティカーはこの周で戻ります"); }
    const toFin = wrapDs(S_FIN - SC.s);
    if (SC.phase === "in" && toFin > 0 && toFin < 170) { SC.phase = "restart"; SC.obj.visible = false; ticker("🏁 セーフティカーがピットへ。トップがペースを決めてリスタート"); }
    if (SC.t > 14) for (const c of cars) if (c.dnf && c.obj.visible) c.obj.visible = false;
  }
}
// セーフティカー・赤旗の時の隊列: すぐ前の車（またはSC）との間隔を保つ速さ
function scFollowSpeed(c, vt) {
  let bd = 1e9, bv = 0;
  for (const o of cars) {
    if (o === c || o.dnf || o.pit || o.finished) continue;
    const d = wrapDs(o.s - c.s); if (d > 0 && d < bd) { bd = d; bv = o.speed; }
  }
  if (SC.on && SC.obj.visible) { const d = wrapDs(SC.s - c.s); if (d > 0 && d < bd) { bd = d; bv = SC.v; } }
  const cap = FL.red ? 36 : 999;
  if (bd > 260) return Math.min(vt * 0.9, cap);
  const v = bd > 11 ? Math.sqrt(bv * bv + 2 * 14 * (bd - 11)) : bv + (bd - 11) * 0.8;
  return Math.min(Math.max(v, 0), cap);
}


// ---------- チームの協力（チームオーダー） ----------
// 同じチームの2台が近い時、後ろの方が明らかに速い（タイヤ・調子・性能）なら前の車が道を譲る
const TEAMRADIO = {};
function teamOrders(dt) {
  for (const c of cars) if (c.yieldT > 0) { c.yieldT -= dt; if (c.yieldT <= 0 || !c.yieldTo || c.yieldTo.dist > c.dist + 8) { c.yieldT = 0; c.yieldTo = null; } }
  teamOrders.t = (teamOrders.t || 0) - dt; if (teamOrders.t > 0) return; teamOrders.t = 0.5;
  if (SC.on || FL.red || raceT < 15) return;
  const rate = (c) => c.pace * (1 + c.form + (c.day || 0)) * Math.sqrt(c.gripF * wetGrip(c)) * (c.damage ? 0.97 : 1);
  for (const T of TEAMS) {
    const pair = cars.filter((c) => c.T === T && !c.dnf && !c.pit && !c.finished);
    if (pair.length < 2) continue;
    const [A, B] = pair[0].dist > pair[1].dist ? pair : [pair[1], pair[0]];   // A=前, B=後ろ
    const gap = (A.dist - B.dist) / Math.max(B.speed, 30);
    const key = T.key;
    const n = TEAMRADIO[key + "_n"] || 0;
    if (gap < 1.1 && rate(B) > rate(A) + 0.006 && !A.yieldTo && n < 2 && (TEAMRADIO[key] || -99) < raceT - 60) {
      TEAMRADIO[key] = raceT; TEAMRADIO[key + "_n"] = n + 1;
      if (A === player && MODE === "drive") { showMsg(`無線：${B.code} を先に行かせて`, 2.5); continue; }
      A.yieldTo = B; A.yieldT = 8;
      ticker(`📻 チームオーダー：${A.code} が ${B.code} に順位を譲る（${T.short}）`);
      if (B === player && MODE === "drive") showMsg(`無線：${A.code} が道を譲ってくれる`, 2.2);
    }
  }
}

// ---------- 赤旗 ----------
function redFlag(reason) {
  if (FL.red || state !== "race") return;
  const lead = leaderCar(); if (!lead || LAPS - lead.dist / L < 0.7) return;
  if (SC.on) endSC(true);
  FL.red = { phase: "in", t0: raceT, reason }; FL.redSlots = 0;
  FL.zones = FL.zones.filter((z) => z.level === "oil");
  ticker(`🟥 赤旗！ ${reason}。レース中断、全車ゆっくりピットレーンへ`);
  showMsg("RED FLAG", 2.5); say("赤旗です。レースは中断されます", 2);
  for (const c of cars) {
    if (c.dnf || c.finished) continue;
    c.pitReq = false; c.redQueue = true; c.drsOn = false; c.drsArm = -1;
    if (c.pit) {
      c.pit.red = true;
      const rel = pitRel(c.s);
      c.pit.queueRel = nextRedSlot();
      if (c.pit.queueRel < rel + 4) c.pit.queueRel = Math.min(PIT.D - 2, rel + 6);
      if (c.pit.phase === "stop") { c.pit.phase = "in"; const crew = PIT_CREW[TEAMS.indexOf(c.T)]; if (crew) crew.visible = false; }
    }
  }
}
function updateRed(dt) {
  if (!FL.red) return;
  const R = FL.red;
  if (R.phase === "in") {
    const all = cars.every((c) => c.dnf || c.finished || (c.pit && c.pit.phase === "stop"));
    if (all || raceT - R.t0 > 100) {
      R.phase = "wait"; R.wait = 6;
      for (const c of cars) if (c.dnf) c.obj.visible = false;
      if (WX.heavyTarget) { WX.heavyTarget = 0; WX.heavy = 0; }
      ticker("🟥 中断中… マシンは自由にタイヤ交換できます");
    }
  } else {
    R.wait -= dt;
    if (R.wait <= 0) restartAfterRed();
  }
}
function restartAfterRed() {
  const ord = order().filter((c) => !c.dnf && !c.finished);
  const leadLaps = Math.floor(ord[0].dist / L);
  FL.red = null; FL.zones = []; FL.drsAt = 1e9;
  ord.forEach((c, k) => {
    c.pit = null; c.redQueue = false; c.pitReq = false; c.spinT = 0; c.losing = 0; c.crashT = 0; c.stuckT = 0;
    const lp = pitClosed() ? c.tyre : c === player && MODE === "drive" && c.nextTyre ? c.nextTyre : pickTyre(c, LAPS - leadLaps); if (lp !== c.tyre) { c.stints = (c.stints || [c.tyre]).concat(lp); } setTyre(c, lp);
    c.damage = 0;
    c.place(S_FIN - 12 - k * 8, k % 2 ? -2.4 : 2.4);
    c.dist = leadLaps * L + (c.s - S_FIN > L / 2 ? c.s - S_FIN - L : c.s - S_FIN);
    c.lapIdx = Math.floor(c.dist / L); c.noLapTime = true;
    c.thr = c.brk = c.steer = 0; c.avoid = 0; c.speed = 0; c.passSide = 0; c.drsOn = false; c.drsArm = -1;
    c.react = c === player && MODE === "drive" ? 0 : 0.12 + Math.random() * 0.3;
  });
  PIT_CREW.forEach((g) => g && (g.visible = false));
  restartCountdown = true;
  state = "countdown"; cdT = 0; lightsOn = 0; goDelay = 0.6 + Math.random() * 0.9;
  $("lights").style.display = "flex"; [...$("lights").children].forEach((l) => l.classList.remove("on"));
  ticker("🔴 スタンディングスタートで再開！"); say("スタンディングスタートで再開します", 2);
  if (MODE === "watch") { focus = ord[0]; shot = "grid"; shotT = 6; shotNew = true; }
  syncCars(0); updateCamera(0, true);
}
let restartCountdown = false;

// ---------- まとめてリセット ----------
function resetIncidents() {
  SC.on = false; SC.phase = ""; SC.count = 0; SC.obj.visible = false;
  FL.zones = []; FL.red = null; FL.redAt = -1; FL.redReason = ""; FL.dmgN = 0; FL.temp = null; FL.tempT = 0; FL.drsAt = 20; FL.posT = 0; flagUiKey = "x";
  INC.list = []; restartCountdown = false; for (const k in TEAMRADIO) delete TEAMRADIO[k];
  PIT_CREW.forEach((g) => g && (g.visible = false));
  FLAG_POOL.forEach((g) => (g.visible = false));
  $("flagBanner").classList.add("hidden");
  for (const c of cars) {
    Object.assign(c, { dnf: false, dsq: false, spinT: 0, losing: 0, handled: false, hideAt: 0, crashSev: undefined, pit: null, pitReq: false, pitWhy: null, nextTyre: null, redQueue: false,
      damage: 0, hadDamage: false, meat: 0, pen: 0, yieldTo: null, yieldT: 0, tlv: 0, offT: 0, tlDone: false, bwT: 0, blueT: 0, blueIgn: 0, lastPos2: 0, pits: 0, noLapTime: false, stratLap: -9 });
    c.obj.visible = true;
  }
}
// AIのピット作戦（ピット入口の手前で毎周1回判断）
function aiStrategy(c) {
  const left = LAPS - c.dist / L;
  if (c.pitReq || c.pit || left < 0.75 || FL.red || pitClosed()) return;
  const wetT = c.tyre === "I" || c.tyre === "W", w = wetEff();
  let want = null;
  if (c.damage) want = pickTyre(c, left);
  else if (!wetT && w > 0.26 + (c.wxDelay || 0)) want = pickTyre(c, left);
  else if (wetT && w < 0.12) want = pickTyre(c, left);
  else if (c.tyre === "I" && w > 0.85 && Math.random() < 0.4) want = "W";
  else if (c.tyreWear > 0.93 && left > 0.9) {
    // チームメイトが今ピットに向かっているなら、限界ぎりぎりまで1周待つ（同時に入るとロスが大きい）
    const mate = cars.find((o) => o !== c && o.T === c.T);
    if (!(mate && (mate.pitReq || mate.pit) && c.tyreWear < 1.08)) want = pickTyre(c, left);
  }
  else if (SC.on && SC.phase === "out" && c.tyreWear > 0.4 && left > 1.3 && Math.random() < 0.7) want = pickTyre(c, left);
  if (want) { c.pitReq = true; c.nextTyre = want; }
}
function drawMapExtras() {
  // ピットレーン・SC・リタイア車・黄旗区間
  mapG.lineWidth = 2; mapG.strokeStyle = "rgba(255,255,255,.35)"; mapG.beginPath();
  for (let r = PIT.B; r <= PIT.C; r += 20) { const i = idxAtS(S_FIN + r); const [x, y] = toMap(TR.x[i] + TR.nx[i] * PIT_SD * 14, TR.z[i] + TR.nz[i] * PIT_SD * 14); r === PIT.B ? mapG.moveTo(x, y) : mapG.lineTo(x, y); }
  mapG.stroke();
  for (const z of FL.zones) {
    mapG.strokeStyle = z.level === "oil" ? "#ff7a00" : "#ffd400"; mapG.lineWidth = z.level === 2 ? 6 : 4; mapG.beginPath();
    for (let d = -ZONE_BACK; d <= ZONE_FWD; d += 10) { const i = idxAtS(z.s + d); const [x, y] = toMap(TR.x[i], TR.z[i]); d === -ZONE_BACK ? mapG.moveTo(x, y) : mapG.lineTo(x, y); }
    mapG.stroke();
  }
  if (FL.red) { mapG.strokeStyle = "rgba(225,6,0,.8)"; mapG.lineWidth = 3; mapG.strokeRect(2, 2, 204, 204); }
  for (const c of cars) if (c.dnf && c.obj.visible) { const [x, y] = toMap(c.x, c.z); mapG.strokeStyle = "#ffd400"; mapG.lineWidth = 2; mapG.beginPath(); mapG.moveTo(x - 4, y - 4); mapG.lineTo(x + 4, y + 4); mapG.moveTo(x + 4, y - 4); mapG.lineTo(x - 4, y + 4); mapG.stroke(); }
  if (SC.on && SC.obj.visible) { const [x, y] = toMap(SC.obj.position.x, SC.obj.position.z); mapG.fillStyle = "#ffcc00"; mapG.fillRect(x - 5, y - 5, 10, 10); mapG.fillStyle = "#000"; mapG.font = "bold 7px sans-serif"; mapG.fillText("SC", x - 4.5, y + 2.5); }
}

buildPitLane();

// ======================= モード・DRS・予選 =======================
let MODE = "drive", WATCH_LAPS = 5, GRID = [], speedMul = 1;
let focus = null, shot = "chase", shotT = 0, shotPt = null, shotPassed = false, shotNew = false;
let fastest = { t: Infinity, car: null }, tickerQ = [], eventT = 0, leaderDoneT = -1;
const BET = { car: null, type: "win", amount: 0, odds: 0, done: false };
const viewCar = () => (MODE === "watch" ? focus : player);
// DRSゾーン: 直線（曲がれる速さが最高速近い区間）の長い2か所
const DRS = (() => {
  const segs = []; let st = -1;
  for (let i = 0; i < N * 2; i++) {
    const ok = TR.vcorner[wrap(i)] >= 89.5;
    if (ok && st < 0) st = i;
    if (!ok && st >= 0) { if (st < N) segs.push([st, i - 1]); st = -1; }
  }
  return segs.map(([a, b]) => ({ a: TR.s[wrap(a)], b: TR.s[wrap(b)], len: (b - a) * DS, det: (TR.s[wrap(a)] - 30 + L) % L }))
    .filter((z) => z.len > 150).sort((x, y) => y.len - x.len).slice(0, 2);
})();
// 予選: 1台ずつ単独でアタックしたタイム（その日の調子で少しばらつく）
function qualiLap(c) {
  const save = { x: c.x, z: c.z, h: c.h, vx: c.vx, vz: c.vz, s: c.s, lat: c.lat, idx: c.idx, dist: c.dist, isPlayer: c.isPlayer };
  c.isPlayer = false;
  c.place(S_FIN - 300, 0); c.dist = -300; c.react = 0; c.spinT = 0; c.losing = 0; c.dnf = false; c.errT = 0; c.wear = 0; c.drsOn = false; c.passSide = 0; c.avoid = 0; c.skill = 1;
  c.form = (Math.random() - 0.5) * 0.012;
  const tySave = c.tyre, twSave = c.tyreWear; c.tyre = wetEff() > 0.75 ? "W" : wetEff() > 0.25 ? "I" : "S"; c.tyreWear = 0; c.pit = null; c.spinT = 0;
  const sp = 55; c.vx = Math.sin(c.h) * sp; c.vz = Math.cos(c.h) * sp; c.speed = sp;
  const h = 1 / 60; let t = 0, t0 = -1;
  for (let k = 0; k < 60 * 120; k++) {
    aiDrive(c, h, true, true); physics(c, h); t += h;
    if (t0 < 0 && c.dist >= 0) t0 = t;
    if (t0 >= 0 && c.dist >= L) break;
  }
  const lap = t - t0;
  Object.assign(c, save); c.crashT = 0; c.speed = 0; c.form = 0; c.tyre = tySave; c.tyreWear = twSave;
  return lap;
}
function qualifying() {
  // その日の調子（レースごとにランダム。予選にも決勝にも効く）
  for (const c of cars) { const g = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; c.day = g * 0.008; }
  for (const c of cars) c.qtime = qualiLap(c);
  QNOTE = "";
  // 予選でダブルイエローが出て、アタック中のラップが抹消されることがある
  if (Math.random() < 0.35) {
    const v = cars[Math.floor(Math.random() * cars.length)];
    v.qtime += 0.4 + Math.random() * 1.1;
    QNOTE = `予選: ${v.code} のアタック中にダブルイエロー → そのラップは抹消（遅い方のタイムでスタート）`;
  }
  for (const c of cars) c.startTyre = startTyreFor(c);
  return [...cars].sort((a, b) => a.qtime - b.qtime);
}
// オッズ: 予選タイムとグリッド位置から勝つ確率を見積もる（モンテカルロ）
function computeOdds(grid) {
  const tBest = Math.min(...grid.map((c) => c.qtime));
  const tau = ODDS_TAU * (1 + (WX.kind === "rain" || WX.kind === "storm" ? 0.9 : WX.kind === "shower" ? 0.6 : 0));    // 雨は荒れやすい
  const w = grid.map((c, k) => Math.exp(-(c.qtime - tBest) / tau - k * ODDS_GRID * (WX.kind === "sun" || WX.kind === "cloud" ? 1 : 0.7)));
  const nSim = 6000, win = new Array(grid.length).fill(0), pod = new Array(grid.length).fill(0);
  for (let n = 0; n < nSim; n++) {
    const ww = w.slice(); let tot = ww.reduce((a, b) => a + b, 0);
    for (let place = 0; place < 3; place++) {
      let r = Math.random() * tot, k = 0;
      while (r > ww[k]) { r -= ww[k]; k++; }
      if (place === 0) win[k]++; pod[k]++;
      tot -= ww[k]; ww[k] = 0;
    }
  }
  grid.forEach((c, k) => {
    const pw = Math.max(win[k] / nSim, 0.002), pp = Math.max(pod[k] / nSim, 0.006);
    c.oddsWin = clamp(Math.round((0.88 / pw) * 10) / 10, 1.3, 250);
    c.oddsPod = clamp(Math.round((0.88 / pp) * 10) / 10, 1.05, 120);
  });
}
const ODDS_TAU = 0.4, ODDS_GRID = 0.13;
// コイン（このブラウザだけに保存される架空のポイント）
let coins = 1000, QNOTE = "";
try { const v = parseInt(localStorage.getItem("hgp_coins"), 10); if (Number.isFinite(v)) coins = v; } catch (e) {}
function saveCoins() { try { localStorage.setItem("hgp_coins", String(coins)); } catch (e) {} }

// ======================= レース進行 =======================
let CRASH_V = 23.6;   // クラッシュになる壁への突っ込み速度(m/s)。やさしい=なし / ふつう=85km/h / つよい=58km/h
let state = "title", paused = false, raceT = 0, cdT = 0, lightsOn = 0, goDelay = 0, LAPS = 3, resultShown = false;
function setupRace(gridIn = null) {
  const watch = MODE === "watch";
  LAPS = watch ? WATCH_LAPS : parseInt($("laps").value, 10) || 3;
  const diff = watch ? 1 : parseFloat($("diff").value);
  CRASH_V = watch ? 85 / 3.6 : [Infinity, 85 / 3.6, 58 / 3.6][$("diff").selectedIndex] ?? 85 / 3.6;
  player.isPlayer = !watch;
  // スタート順: ドライブは主役が11番手（他は予選タイム順）、観戦は予選結果
  let grid = gridIn;
  if (!grid) {
    if (!watch) { rollWeather(seasonRace ? "random" : $("wx").value); rollTOD(seasonRace ? "random" : $("tod").value); }
    const q = qualifying();
    const others = q.filter((c) => c !== player);
    grid = [...others.slice(0, 10), player, ...others.slice(10)];
  }
  GRID = grid;
  resetIncidents();
  WX.reset();
  planIncidents();
  recReset(); recordDrive.done = false; leadCode = ""; ghostRec.arr = []; ghostRec.valid = false; ghostRec.next = 0;
  $("againBtn").classList.toggle("hidden", seasonRace); $("nextRaceBtn").classList.add("hidden"); $("seasonBox").innerHTML = "";
  document.querySelectorAll(".replayBtn").forEach((b) => b.classList.remove("hidden"));
  $("tip").classList.add("hidden"); tipT = 0;
  grid.forEach((c, k) => {
    c.place(S_FIN - 12 - k * 8, k % 2 ? -2.4 : 2.4);
    c.dist = (c.s - S_FIN > L / 2 ? c.s - S_FIN - L : c.s - S_FIN);
    c.lapStart = 0; c.best = Infinity; c.last = 0; c.finished = false; c.finishTime = 0; c.finLaps = 0;
    c.thr = c.brk = c.steer = 0; c.avoid = 0; c.speed = 0; c.lapIdx = undefined; c.crashT = 0; c.stuckT = 0;
    c.skill = c === player && !watch ? 1 : diff;
    c.react = c === player && !watch ? 0 : 0.12 + Math.random() * 0.3;
    c.form = 0; c.errT = 0; c.wear = 0; c.drsOn = false; c.drsArm = -1; c.passSide = 0; c.lastPos = k + 1; c.flap = false;
    const ts = $("tyreSel").value;
    const autoT = wetEff() > 0.75 ? "W" : wetEff() > 0.25 ? "I" : "M";
    const st = c === player && !watch ? (ts === "auto" ? autoT : ts) : (watch && c.startTyre ? c.startTyre : startTyreFor(c));
    setTyre(c, st); c.stints = [st]; c.wxDelay = Math.random() * 0.35;
  });
  clearInterval(resTimer);
  raceT = 0; cdT = 0; lightsOn = 0; goDelay = 0.6 + Math.random() * 0.9; resultShown = false;
  finishCheer = 0; confetti = []; flagG.clearRect(0, 0, flagC.width, flagC.height);
  startLamps.forEach((l) => (l.material.emissiveIntensity = 0));
  state = "countdown";
  $("lights").style.display = "flex"; [...$("lights").children].forEach((l) => l.classList.remove("on"));
  fastest = { t: Infinity, car: null }; tickerQ = []; eventT = 0; leaderDoneT = -1;
  const driveHud = ["tl", "times", "board", "map", "speedo", "help", "tyreHud"], watchHud = ["tower", "wtop", "ticker", "fcard", "map", "speedo"];
  [...driveHud, ...watchHud].forEach((id) => $(id).classList.add("hidden"));
  (watch ? watchHud : driveHud).forEach((id) => $(id).classList.remove("hidden"));
  $("result").classList.add("hidden"); $("wresult").classList.add("hidden");
  if (watch) { focus = grid[0]; shot = "grid"; shotT = 6; finishShotDone = false; }
  updateCamera(0, true);
}
function stepRace(dt) {
  if (state === "countdown") {
    cdT += dt;
    const n = Math.min(5, Math.floor(cdT / 0.9));
    if (n > lightsOn) { lightsOn = n; [...$("lights").children].forEach((l, k) => l.classList.toggle("on", k < n)); startLamps.forEach((l, k) => (l.material.emissiveIntensity = k < n ? 6 : 0)); audio.beep(520); }
    if (cdT > 4.5 + goDelay) {
      state = "race";
      if (restartCountdown) { restartCountdown = false; FL.drsAt = raceT + 15; } else { raceT = 0; FL.drsAt = 20; }
      [...$("lights").children].forEach((l) => l.classList.remove("on")); startLamps.forEach((l) => (l.material.emissiveIntensity = 0));
      setTimeout(() => ($("lights").style.display = "none"), 1200);
      showMsg("GO!", 1.0); audio.beep(1040, 0.35); say("スタート！", 2);
    }
  }
  const raceOn = state === "race" || state === "finished";
  if (raceOn) raceT += dt;
  if (raceOn) { updateWeather(dt); updateIncidents(dt); updateSC(dt); }
  const sub = Math.max(2, Math.ceil(dt / 0.009)), h = dt / sub;   // 早送りでも細かく計算する
  const drive = (hh) => { for (const c of cars) { if (c === player && MODE === "drive" && !FL.red) { readPlayer(c, hh, raceOn); playerLimiter(c, raceOn); } else aiDrive(c, hh, raceOn); } };
  if (!raceOn) drive(dt);
  // 順位とDRS（前の車に1秒以内でDRSゾーンに入ると、直線で空気抵抗が減る）
  const ordNow = order();
  ordNow.forEach((c, k) => { c.gapAhead = k === 0 ? 99 : (ordNow[k - 1].dist - c.dist) / Math.max(c.speed, 30); });
  for (const c of cars) {
    c.drsOn = false;
    if (c.pit || c.dnf || FL.red || SC.on) { c.drsArm = -1; continue; }
    for (let z = 0; z < DRS.length; z++) {
      const Z = DRS[z];
      const inZ = Z.a <= Z.b ? c.s >= Z.a && c.s <= Z.b : c.s >= Z.a || c.s <= Z.b;
      const det = ((c.s - Z.det + L) % L) < 6;
      if (det && raceT > FL.drsAt && !SC.on && !FL.red && c.gapAhead < 1.0 && !c.finished && !c.dnf) c.drsArm = z;
      if (inZ && c.drsArm === z) c.drsOn = true;
      if (!inZ && c.drsArm === z && ((c.s - Z.b + L) % L) < 30) c.drsArm = -1;
    }
  }
  // スリップストリーム: 前30m以内・ほぼ同じ横位置に車がいると効く
  for (const c of cars) {
    let best = 0;
    for (const o of cars) {
      if (o === c || o.dnf) continue;
      let ds = o.s - c.s; if (ds < -L / 2) ds += L; if (ds > L / 2) ds -= L;
      if (ds > 4 && ds < 30 && Math.abs(o.lat - c.lat) < 1.6) best = Math.max(best, 1 - (ds - 4) / 26);
    }
    c.draft = c.speed > 30 ? best : 0;
  }
  if (raceOn) for (let k = 0; k < sub; k++) { drive(h); for (const c of cars) physics(c, h); collideCars(); pitEntryCheck(); }
  if (raceOn) {
    updateRed(dt);
    if (state === "race") checkRules(dt);
    for (const c of cars) {
      if (c.dnf || c.pit || c.finished || (c === player && MODE === "drive")) continue;
      const r = pitRel(c.s);
      if (r > -470 && r < -420) { const key = Math.floor((c.dist + 470) / L); if (c.stratLap !== key) { c.stratLap = key; aiStrategy(c); } }
    }
  }
  // 止まって動けなくなった車を復帰させる（AIは3秒、プレイヤーは案内を出して5秒で自動）
  if (raceOn) for (const c of cars) {
    if ((c.finished && c !== player) || c.dnf || c.pit) continue;
    c.stuckT = Math.abs(c.speed) < 2.5 && raceT > 3 && !c.crashT && !(c.spinT > 0) && !(c.losing > 0) ? (c.stuckT || 0) + dt : 0;
    if (c === player && !c.finished && MODE === "drive") {
      if (c.stuckT > 1.8 && c.stuckT - dt <= 1.8) showMsg("R キーでコースに戻る", 2.5);
      if (c.stuckT > 4) { respawn(c); c.stuckT = 0; }
    } else if (c.stuckT > 3) { respawn(c); c.stuckT = 0; }
  }
  // 逆走チェック
  if (player && raceOn && !player.finished && MODE === "drive") {
    const i = player.idx, dot = Math.sin(player.h) * TR.tx[i] + Math.cos(player.h) * TR.tz[i];
    player.wrongT = dot < -0.3 && Math.abs(player.speed) > 3 ? (player.wrongT || 0) + dt : 0;
    if (player.wrongT > 1.2 && msgT <= 0) showMsg("逆走しています", 1.0);
  }
  // 周回
  for (const c of cars) {
    if (c.finished || c.dnf || !raceOn) continue;
    const lapNow = Math.floor(c.dist / L);
    if (c.lapIdx === undefined) c.lapIdx = Math.floor(c.dist / L);
    if (lapNow > c.lapIdx) {
      if (c.damage && !c.pit && c === player && MODE === "drive") { c.meat = (c.meat || 0) + 1; if (c.meat >= 2) disqualify(c, "損傷したままピットに入らなかった"); else showMsg("オレンジディスク旗！ B でピットへ（次の周で失格）", 2.5); }
      let lapCounted = false;
      if (c.noLapTime) c.noLapTime = false;
      else if (c.lapIdx >= 0) {
        lapCounted = true;
        c.last = raceT - c.lapStart; c.best = Math.min(c.best, c.last);
        if (c.last < fastest.t) { fastest = { t: c.last, car: c }; if (raceT > 30) ticker(`🟣 ファステストラップ ${c.code}（${c.team}） ${fmt(c.last)}`); }
      }
      if (c === player && MODE === "drive") ghostLap(c, c.last, lapCounted);
      c.lapStart = raceT; c.lapIdx = lapNow;
      if (SC.phase === "restart" && c === leaderCar()) endSC();
      // トップがゴールした後は、周回遅れの車もゴールラインを越えた時点でレース終了（F1と同じ）
      const someoneDone = cars.some((o) => o !== c && o.finished && (o.finLaps || LAPS) >= LAPS);
      if (lapNow >= LAPS || (someoneDone && lapNow >= 1)) {
        c.finished = true; c.finishTime = raceT; c.finLaps = Math.min(lapNow, LAPS);
        if (!cars.some((o) => o !== c && o.finished)) { flagTemp("chequered", "CHEQUERED FLAG ― チェッカーフラッグ！", 6); say(`${sname(c)}、優勝！`, 2); }
        c.pitReq = false;
        if (c === player && MODE === "drive") onPlayerFinish();
        if (MODE === "watch" && order()[0] === c && leaderDoneT < 0) onLeaderFinish(c);
      } else if (MODE === "drive" && c === player && lapNow === LAPS - 1) { showMsg("FINAL LAP", 1.6); say("ファイナルラップ！", 2); }
      else if (MODE === "drive" && c === player && lapNow >= 1) showMsg(`LAP ${lapNow + 1}`, 1.2);
      else if (MODE === "watch" && ordNow[0] === c && lapNow === LAPS - 1) { showMsg("FINAL LAP", 1.8); say("ファイナルラップ！", 2); }
    }
  }
  if (raceOn) { recTick(); ghostTick(); watchLeader(dt); if (state === "race") teamOrders(dt); }
  // 観戦: 順位が上がった車を速報
  if (MODE === "watch" && raceOn) {
    eventT -= dt;
    if (eventT <= 0) {
      eventT = 0.3;
      const ord = order();
      ord.forEach((c, k) => {
        const pos = k + 1;
        if (c.lastPos && pos < c.lastPos && !c.finished && !c.dnf && raceT > 6) {
          const passed = ord[k + 1];
          if (passed && !passed.dnf && !passed.pit && passed.lastPos < c.lastPos && (pos <= 8 || c === BET.car || passed === BET.car)) ticker(`${c.code} が ${passed.code} を抜いて ${pos}位に浮上${c.drsOn ? "（DRS）" : ""}`);
        }
        c.lastPos = pos;
      });
    }
    if (leaderDoneT >= 0) { leaderDoneT += dt; if ((cars.every((c) => c.finished || c.dnf) || leaderDoneT > 18) && !resultShown) showWatchResults(); }
  }
}

function pitEntryCheck() {
  for (const c of cars) {
    if (c.pit || c.dnf || c.finished || !(c.pitReq || c.redQueue)) continue;
    const r = pitRel(c.s);
    if (r >= PIT.A && r < PIT.A + 30) startPit(c);
  }
}
// プレイヤー: SC中・ダブルイエロー中は速度を自動で抑える
function playerLimiter(c, raceOn) {
  if (!raceOn || c.pit || c.finished) return;
  let vs = 999;
  if (SC.on) vs = scFollowSpeed(c, 999);
  const zl = zoneLevel(c); if (zl === 2) vs = Math.min(vs, 40);
  if (c.speed > vs + 2) { c.thr = 0; c.brk = Math.max(c.brk, clamp((c.speed - vs) / 12, 0, 0.7)); }
  if ($("assistSel").value === "brake") assistBrake(c);
}
function updateTyreHud() {
  const c = player; if (!c || MODE !== "drive") return;
  const T = TYRES[c.tyre || "M"], wf = c.tyreWear || 0, left = clamp(1 - wf, 0, 1);
  const col = wf > 1 ? "#ff3b30" : wf > 0.75 ? "#ffcc00" : "#34c759";
  const nt = c.nextTyre || "M";
  $("tyreHud").innerHTML = `${tyreBadge(c.tyre || "M")} <b>${T.jp}</b> 残り ${Math.round(left * 100)}%${wf > 1 ? " <b style='color:#ff6b60'>限界！</b>" : ""}<div class="twear"><i style="width:${left * 100}%;background:${col}"></i></div>`
    + (pitClosed() ? "3周レース：ピットインなし" : c.pit ? "ピット作業中…" : c.pitReq ? `<b style="color:#ffcc00">ピット予約中</b> → ${tyreBadge(nt)} ${TYRES[nt].jp}（B 取消 / T 変更）` : `B ピット予約 ・ T 次のタイヤ ${tyreBadge(nt)}`)
    + (c.pen ? `<br><b style="color:#ff8a80">ペナルティ +${c.pen}秒</b>` : "") + (c.tlv ? ` <span style="opacity:.7">トラックリミット ${c.tlv}回</span>` : "");
}
const TYRE_ORDER = ["S", "M", "H", "I", "W"];
function playerPitToggle() {
  const c = player; if (!c || MODE !== "drive" || state !== "race" || c.finished || c.pit) return;
  if (pitClosed()) { showMsg("3周レースはピットインなし", 1.5); return; }
  if (!c.nextTyre) c.nextTyre = pickTyre(c, LAPS - c.dist / L);
  c.pitReq = !c.pitReq;
  showMsg(c.pitReq ? `ピット予約：${TYRES[c.nextTyre].jp}` : "ピット予約を取り消し", 1.4);
}
function playerNextTyre() {
  const c = player; if (!c || MODE !== "drive" || c.finished) return;
  c.nextTyre = TYRE_ORDER[(TYRE_ORDER.indexOf(c.nextTyre || "M") + 1) % TYRE_ORDER.length];
  showMsg(`次のタイヤ：${TYRES[c.nextTyre].jp}`, 1.2);
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
  if (resultShown || state === "title") return; resultShown = true;
  if (MODE === "drive") recordDrive();
  renderResults(); clearInterval(resTimer); resTimer = setInterval(renderResults, 1000);
  $("result").classList.remove("hidden");
}
function renderResults() {
  const ord = order(), pos = ord.indexOf(player) + 1;
  $("resTitle").textContent = player.dsq ? "失格（黒旗）" : pos === 1 ? "WINNER!" : `P${pos} FINISH`;
  $("resSub").textContent = `タイム ${fmt(player.finishTime)}${player.pen ? `（＋ペナルティ${player.pen}秒）` : ""} ／ ベストラップ ${fmt(player.best)} ／ 天気 ${WX.label} ／ タイヤ ${(player.stints || [player.tyre]).join("→")}`;
  const lead = ord[0];
  if (seasonRace && SEASON) {
    renderSeasonBox();
    $("nextRaceBtn").classList.remove("hidden");
    $("nextRaceBtn").textContent = SEASON.round >= SEASON.total ? "シーズン結果を見る" : `次のレースへ（第${SEASON.round + 1}戦）`;
  } else { $("seasonBox").innerHTML = ""; $("nextRaceBtn").classList.add("hidden"); }
  $("resTable").innerHTML = ord.map((o, k) => {
    const t = o.dsq ? "失格" : o.dnf ? "リタイア" : k === 0 ? fmt(o.finishTime) + (o.pen ? ` (+${o.pen}s)` : "") : o.finished ? `${finGap(o, lead, 3)}${o.pen ? ` (+${o.pen}s)` : ""}` : (o.dist < (LAPS - 1) * L ? `+${LAPS - 1 - Math.floor(o.dist / L) + 1}周` : "走行中");
    return `<tr class="${o === player ? "me" : ""}"><td>${k + 1}</td><td><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${o.color};margin-right:6px"></span>${o.code} ${o.driver} <span style="opacity:.55">${o.teamName}</span></td><td style="text-align:right">${t}</td><td style="text-align:right;opacity:.7">${fmt(o.best)}</td></tr>`;
  }).join("");
}
let resumeT = 0, skipping = false;
function setPause(p) {
  if (REPLAY) return;
  if (state === "title" || state === "finished" && resultShown) return;
  if (!$("bet").classList.contains("hidden")) return;
  if (p) {
    paused = true; resumeT = 0; $("resumeCount").style.display = "none";
    for (const k in keys) keys[k] = false;
    refreshPauseMenu();
    $("pause").classList.remove("hidden");
  } else {
    $("pause").classList.add("hidden");
    // ドライブ中は3・2・1のカウントダウンをしてから再開（急に動き出さないように）
    if (MODE === "drive" && state === "race" && !player.finished) { resumeT = 3; $("resumeCount").style.display = "block"; $("resumeCount").textContent = "3"; }
    else paused = false;
    canvas.focus({ preventScroll: true });
  }
}
function togglePause() { if (resumeT > 0) return; setPause(!paused); }
function refreshPauseMenu() {
  const w = MODE === "watch";
  const c = viewCar(), ord = order(), lead = ord[0];
  const lap = clamp(Math.floor((w ? lead : c).dist / L) + 1, 1, LAPS);
  $("pauseInfo").innerHTML = state === "countdown" ? "スタート前" : w
    ? `LAP ${lap}/${LAPS} ・ トップ <b>${lead.code}</b>（${lead.teamName}）` + (BET.car ? ` ・ あなたの予想 <b>${BET.car.code}</b> は今 <b>${ord.indexOf(BET.car) + 1}位</b>` : "")
    : `LAP ${lap}/${LAPS} ・ 現在 <b>${ord.indexOf(c) + 1}位</b> / ${cars.length} ・ ベスト ${fmt(c.best)}`;
  $("pWatchRow").classList.toggle("hidden", !w);
  $("pDriveRow").classList.toggle("hidden", w);
  $("skipBtn").classList.toggle("hidden", !w || state === "countdown");
  document.querySelectorAll(".pspd").forEach((b) => b.classList.toggle("on", +b.dataset.s === speedMul));
  document.querySelectorAll(".pcam").forEach((b) => b.classList.toggle("on", +b.dataset.c === camMode));
  document.querySelectorAll(".pq").forEach((b) => b.classList.toggle("on", b.dataset.q === $("quality").value));
  document.querySelectorAll(".pas").forEach((b) => b.classList.toggle("on", b.dataset.a === $("assistSel").value));
  if (player) { $("pPit").disabled = pitClosed(); $("pPit").textContent = pitClosed() ? "3周レースはなし" : player.pitReq ? "予約中（押すと取消）" : "次の周で入る"; $("pPit").classList.toggle("on", !!player.pitReq); document.querySelectorAll(".ptyre").forEach((b) => b.classList.toggle("on", b.dataset.t === (player.nextTyre || "M"))); }
  $("pSound").textContent = audio.isOn() ? "ON" : "OFF"; $("pSound").classList.toggle("on", audio.isOn());
  $("restartBtn").textContent = w ? "予想からやり直す" : "最初から";
  $("pKeys").textContent = w ? "キー: Esc / P / スペース＝一時停止 ・ 1 2 4 8＝早送り ・ F＝予想した車を追う ・ M＝音"
    : "キー: ↑↓←→ / WASD＝運転 ・ B＝ピット予約 ・ T＝次のタイヤ ・ Esc / P / スペース＝一時停止 ・ C＝カメラ ・ R＝コースに戻る ・ M＝音";
}
function setSpeed(v) { speedMul = v; document.querySelectorAll(".spd").forEach((x) => x.classList.toggle("on", +x.dataset.s === v)); }
document.querySelectorAll(".pspd").forEach((b) => (b.onclick = () => { setSpeed(+b.dataset.s); refreshPauseMenu(); }));
document.querySelectorAll(".pcam").forEach((b) => (b.onclick = () => { camMode = +b.dataset.c; refreshPauseMenu(); }));
document.querySelectorAll(".pq").forEach((b) => (b.onclick = () => { $("quality").value = b.dataset.q; applyQuality(b.dataset.q); saveSettings(); refreshPauseMenu(); }));
document.querySelectorAll(".pas").forEach((b) => (b.onclick = () => { $("assistSel").value = b.dataset.a; saveSettings(); refreshPauseMenu(); }));
$("pSound").onclick = () => { audio.toggle(); refreshPauseMenu(); };
$("pPit").onclick = () => { if (pitClosed()) { refreshPauseMenu(); return; } if (player && !player.pit && !player.finished && state === "race") { if (!player.nextTyre) player.nextTyre = pickTyre(player, LAPS - player.dist / L); player.pitReq = !player.pitReq; } refreshPauseMenu(); };
document.querySelectorAll(".ptyre").forEach((b) => (b.onclick = () => { if (player) player.nextTyre = b.dataset.t; refreshPauseMenu(); }));
$("pauseBtn").onclick = () => togglePause();
$("wPause").onclick = () => togglePause();
// 観戦: 結果まで飛ばす（描画を止めて少しずつ計算し、画面が固まらないようにする）
$("skipBtn").onclick = () => {
  if (skipping) return;
  skipping = true; $("skipBar").classList.remove("hidden"); $("skipBtn").disabled = true;
  const bar = $("loadbar2").firstElementChild, h = 1 / 30;
  const total = Math.max(1, LAPS * L - order()[0].dist);
  const chunk = () => {
    const t0 = performance.now();
    if (!skipping) return;      // 途中でタイトルに戻った
    while (performance.now() - t0 < 30 && !resultShown && skipping) { stepRace(h); }
    const lead = order()[0];
    bar.style.width = `${clamp(1 - (LAPS * L - lead.dist) / total, 0, 1) * 100}%`;
    if (!resultShown && raceT < 3600) setTimeout(chunk, 0);
    else {
      skipping = false; $("skipBar").classList.add("hidden"); $("skipBtn").disabled = false;
      syncCars(0); paused = false; $("pause").classList.add("hidden");
      if (!resultShown) showWatchResults();
    }
  };
  chunk();
};
$("resumeBtn").onclick = () => setPause(false);
$("restartBtn").onclick = () => { paused = false; resumeT = 0; $("resumeCount").style.display = "none"; $("pause").classList.add("hidden"); if (MODE === "watch") openBet(); else setupRace(); };
$("againBtn").onclick = () => setupRace();
function goHome() {
  if (REPLAY) { REPLAY = null; ["replayTag", "replayBar"].forEach((id) => $(id).classList.add("hidden")); }
  if (seasonRace && state === "finished" && resultShown && SEASON) { commitSeasonRace(); if (SEASON.round > SEASON.total) { showSeasonFinal(); } }
  seasonRace = false; $("tip").classList.add("hidden"); $("ghostDelta").classList.add("hidden"); if (ghostObj) ghostObj.visible = false;
  skipping = false; $("skipBar").classList.add("hidden"); $("skipBtn").disabled = false;
  clearInterval(resTimer); resumeT = 0; $("resumeCount").style.display = "none";
  paused = false; state = "title"; resultShown = false;
  ["pause", "result"].forEach((id) => $(id).classList.add("hidden"));
  ["tl", "times", "board", "map", "speedo", "help", "tyreHud", "flagBanner", "tower", "wtop", "ticker", "fcard", "wresult", "bet"].forEach((id) => $(id).classList.add("hidden"));
  MODE = "drive"; player.isPlayer = true; speedMul = 1;
  $("lights").style.display = "none"; $("msg").style.opacity = 0; msgT = 0;
  finishCheer = 0; confetti = []; flagG.clearRect(0, 0, flagC.width, flagC.height);
  startLamps.forEach((l) => (l.material.emissiveIntensity = 0));
  resetIncidents(); rollWeather("sun"); WX.reset();
  cars.forEach((c, k) => { c.place(S_FIN - 12 - k * 8, k % 2 ? -2.4 : 2.4); c.speed = 0; c.crashT = 0; c.stuckT = 0; c.lapIdx = undefined; c.finished = false; });
  rollTOD("day");
  syncCars(0); updateCamera(0, true);
  updateSeasonUI();
  $("title").classList.remove("hidden");
}
document.querySelectorAll(".homeBtn").forEach((b) => (b.onclick = goHome));
// GitHub Pagesで遊んでいる時だけ「サイトのトップへ」を出す
if (location.hostname.endsWith("github.io")) document.querySelectorAll(".siteBtn").forEach((b) => { b.classList.remove("hidden"); b.href = "../"; });

// ======================= ヒント・記録・ゴースト・シーズン・リプレイ・実況・水しぶき・時間帯 =======================
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};

// ---------- 初めての人向けのヒント（1回だけ出る） ----------
let TIPS_SEEN = store.get("hgp_tips", {}), tipT = 0;
function tip(key, html, sec = 7) {
  if (TIPS_SEEN[key] || skipping || REPLAY) return;
  TIPS_SEEN[key] = 1; store.set("hgp_tips", TIPS_SEEN);
  $("tip").innerHTML = "💡 " + html; $("tip").classList.remove("hidden"); tipT = sec;
}
function updateTips(dt) {
  if (tipT > 0) { tipT -= dt; if (tipT <= 0) $("tip").classList.add("hidden"); }
  if (state === "title" || REPLAY || skipping || !cars.length) return;
  const d = MODE === "drive", c = viewCar();
  if (state === "countdown") {
    if (d) tip("drive_start", "<b>↑</b>でアクセル、<b>↓</b>でブレーキ、<b>← →</b>でハンドル。コーナーの手前でしっかり減速しよう。<b>Esc</b>で一時停止");
    else tip("watch_start", "<b>1 2 4 8</b> で早送り、<b>F</b> で予想した車を追える。結果まで飛ばすのは一時停止メニューから");
    return;
  }
  if (state !== "race") return;
  if (FL.red) tip("red", "<b>赤旗</b>：レース中断。全車ピットに戻り、そのあと止まった状態から再スタート");
  else if (SC.on) tip(d ? "sc_drive" : "sc_watch", d ? "<b>セーフティカー</b>：追い越し禁止。速度は自動で抑えられる。消えたらトップから再スタート" : "<b>セーフティカー</b>：全車が隊列で走るので差が縮まる。逆転のチャンス");
  if (WX.raining && raceT > WX.rainAt + 4) tip("rain", "<b>雨</b>：路面が濡れるとインター（緑）・ウェット（青）のタイヤが速くなる" + (d ? "。<b>B</b>でピット予約、<b>T</b>でタイヤを選ぶ" : ""));
  if (c && zoneLevel(c) > 0) tip("yellow", "<b>黄旗</b>：この先に危険あり。減速して、この区間では追い越し禁止（抜くと5秒ペナルティ）");
  if (d && player) {
    if (!pitClosed() && player.tyreWear > 0.7) tip("tyre", "タイヤが減ってきた（右下の残り%）。<b>B</b>でピット予約、<b>T</b>でタイヤを選ぶ。スタート直線の入口を通ると自動でピットへ");
    if (player.blueT > 0.4) tip("blue", "<b>青旗</b>：周回遅れ。後ろの速い車に道を譲ろう（無視するとペナルティ）");
    if (player.tlv >= 1) tip("tl", "コースからはみ出しすぎると<b>トラックリミット違反</b>。4回目からは毎回5秒ペナルティ");
    if (player.damage) tip("dmg", "<b>マシン損傷</b>！ <b>B</b>でピット予約して修理しよう。2周入らないと失格");
  } else if (!d && cars.some((o) => o.pit)) tip("pit_watch", "ピットインした車はタイヤ交換で十数秒ロス。順位表の <b>PIT</b> が目印、タイヤの色は丸いマーク");
}
$("helpBtn").onclick = () => $("help2").classList.remove("hidden");
$("helpClose").onclick = () => $("help2").classList.add("hidden");
$("tipsReset").onclick = () => { TIPS_SEEN = {}; store.set("hgp_tips", {}); $("tipsReset").textContent = "次のレースからヒントが出ます"; };

// ---------- 記録 ----------
const STATS = Object.assign({ races: 0, wins: 0, podiums: 0, bestPos: 0, bestLap: 0, bets: 0, hits: 0, maxCoins: 1000, seasons: 0, titles: 0 }, store.get("hgp_stats", {}));
if (!STATS.bestLapT) STATS.bestLapT = { 1: STATS.bestLap || 0 };     // ベストラップはコースごと
function saveStats() { store.set("hgp_stats", STATS); renderStats(); }
function renderStats() {
  const pct = STATS.bets ? Math.round((STATS.hits / STATS.bets) * 100) : 0;
  $("stats").innerHTML = `<b>あなたの記録</b><br>ドライブ ${STATS.races}戦 ${STATS.wins}勝 ・ 表彰台 ${STATS.podiums}回 ・ 最高 ${STATS.bestPos ? STATS.bestPos + "位" : "-"} ・ ベストラップ（${TRK.name}）${STATS.bestLapT[TRACK_ID] ? fmt(STATS.bestLapT[TRACK_ID]) : "-"}`
    + `<br>観戦 予想 ${STATS.bets}回 ・ 的中 ${STATS.hits}回（${pct}%） ・ 最高コイン ${STATS.maxCoins.toLocaleString()}`
    + `<br>シーズン 優勝 ${STATS.titles}回 / ${STATS.seasons}回` + (SEASON ? ` ・ <b style="color:#b993ff">進行中：第${SEASON.round}戦／全${SEASON.total}戦（${SEASON.pts[player ? player.code : "ARA"] || 0}点）</b>` : "");
}
function recordDrive() {
  if (!player || recordDrive.done) return; recordDrive.done = true;
  const pos = order().indexOf(player) + 1;
  STATS.races++;
  if (!player.dsq && !player.dnf) {
    if (pos === 1) STATS.wins++;
    if (pos <= 3) STATS.podiums++;
    if (!STATS.bestPos || pos < STATS.bestPos) STATS.bestPos = pos;
  }
  if (isFinite(player.best) && player.best > 0 && (!STATS.bestLapT[TRACK_ID] || player.best < STATS.bestLapT[TRACK_ID])) STATS.bestLapT[TRACK_ID] = player.best;
  saveStats();
}
function recordBet(hit) { STATS.bets++; if (hit) STATS.hits++; STATS.maxCoins = Math.max(STATS.maxCoins, coins); saveStats(); }

// ---------- ゴースト（自分のベストラップを半透明の車で再生） ----------
const GHOST_KEY = TRACK_ID === 1 ? "hgp_ghost" : "hgp_ghost_" + TRACK_ID;     // ゴーストはコースごと
let GHOST = store.get(GHOST_KEY, null), ghostObj = null;
const ghostRec = { arr: [], next: 0, valid: false, tlv: 0 };
function makeGhost() {
  ghostObj = player.obj.clone(true);
  ghostObj.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); m.material.transparent = true; m.material.opacity = 0.3; m.material.depthWrite = false; m.castShadow = false; m.receiveShadow = false; } });
  ghostObj.visible = false; ghostObj.userData.noOcc = true; scene.add(ghostObj);
}
function ghostTick() {
  if (MODE !== "drive" || state !== "race" || !player || player.finished) return;
  if (player.pit || SC.on || FL.red || player.spinT > 0 || player.crashT || (player.tlv || 0) !== ghostRec.tlv) ghostRec.valid = false;
  const t = raceT - player.lapStart;
  if (t >= ghostRec.next && ghostRec.arr.length < 30000) {
    ghostRec.arr.push(+t.toFixed(3), +player.x.toFixed(2), +player.z.toFixed(2), +player.h.toFixed(3), +(player.dist - (player.lapStartDist || 0)).toFixed(1));
    ghostRec.next = t + 0.05;
  }
}
function ghostLap(c, lapTime, counted) {
  if (counted && ghostRec.valid && ghostRec.arr.length > 100 && (!GHOST || lapTime < GHOST.t)) {
    const first = !GHOST;
    GHOST = { t: lapTime, d: ghostRec.arr }; store.set(GHOST_KEY, GHOST);
    if (!first) showMsg(`ゴースト更新！ ${fmt(lapTime)}`, 1.8);
  }
  ghostRec.arr = []; ghostRec.next = 0; ghostRec.valid = !c.pit; ghostRec.tlv = c.tlv || 0; c.lapStartDist = c.dist;
}
function updateGhost() {
  if (!ghostObj) return;
  const on = $("ghostSel").value === "on" && GHOST && MODE === "drive" && state === "race" && player && !player.finished && !player.pit && !REPLAY && player.lapIdx >= 0;
  const t = on ? raceT - player.lapStart : 0;
  if (!on || t > GHOST.t + 0.4) { ghostObj.visible = false; $("ghostDelta").classList.add("hidden"); return; }
  const d = GHOST.d, n = d.length / 5;
  const find = (val, off) => { let lo = 0, hi = n - 1; while (lo < hi - 1) { const m = (lo + hi) >> 1; if (d[m * 5 + off] <= val) lo = m; else hi = m; } return [lo * 5, hi * 5]; };
  let [a, b] = find(t, 0);
  let f = clamp((t - d[a]) / Math.max(d[b] - d[a], 1e-3), 0, 1);
  let dh = d[b + 3] - d[a + 3]; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
  ghostObj.position.set(lerp(d[a + 1], d[b + 1], f), 0, lerp(d[a + 2], d[b + 2], f));
  ghostObj.rotation.y = d[a + 3] + dh * f + Math.PI;
  // 自分から近すぎる時は薄く（重なって見づらいので）
  ghostObj.visible = Math.hypot(ghostObj.position.x - player.x, ghostObj.position.z - player.z) > 2.5;
  const lapD = player.dist - (player.lapStartDist || 0);
  if (lapD < 60) { $("ghostDelta").classList.add("hidden"); return; }
  [a, b] = find(lapD, 4);
  f = clamp((lapD - d[a + 4]) / Math.max(d[b + 4] - d[a + 4], 1e-3), 0, 1);
  const delta = t - lerp(d[a], d[b], f);
  const el = $("ghostDelta"); el.classList.remove("hidden");
  el.style.color = delta <= 0 ? "#4cd964" : "#ff6b60";
  el.textContent = `ベストラップ比 ${delta <= 0 ? "−" : "+"}${Math.abs(delta).toFixed(2)}`;
}

// ---------- シーズン（5戦のポイント制） ----------
const PTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
let SEASON = store.get("hgp_season", null), seasonRace = false;
function racePoints() {
  const ord = order(), res = {};
  ord.forEach((c, k) => { if (!c.dnf && k < 10) res[c.code] = PTS[k]; });
  if (fastest.car && !fastest.car.dnf && ord.indexOf(fastest.car) < 10) res[fastest.car.code] = (res[fastest.car.code] || 0) + 1;
  return res;
}
function standings(extra = {}) {
  const drv = cars.map((c) => ({ c, p: (SEASON.pts[c.code] || 0) + (extra[c.code] || 0) })).sort((a, b) => b.p - a.p);
  const team = TEAMS.map((T) => ({ T, p: (SEASON.team[T.key] || 0) + cars.filter((c) => c.T === T).reduce((s, c) => s + (extra[c.code] || 0), 0) })).sort((a, b) => b.p - a.p);
  return { drv, team };
}
function renderSeasonBox(final = false) {
  if (!SEASON) { $("seasonBox").innerHTML = ""; return; }
  const add = final ? {} : racePoints(), st = standings(add);
  const meIdx = st.drv.findIndex((x) => x.c === player);
  const rows = st.drv.map((x, k) => ({ x, k })).filter(({ k }) => k < 10 || k === meIdx);
  $("seasonBox").innerHTML = `<b>${final ? "シーズン最終順位" : `シーズン第${SEASON.round}戦／全${SEASON.total}戦（このレースの点を含む）`}</b>
    <div class="cols"><table>${rows.map(({ x, k }) => `<tr class="${x.c === player ? "me" : ""}"><td>${k + 1}</td><td><span style="display:inline-block;width:8px;height:8px;background:${x.c.color};margin-right:5px"></span>${x.c.code} ${x.c.driver}</td><td style="text-align:right">${x.p}点${add[x.c.code] ? ` <small style="opacity:.6">+${add[x.c.code]}</small>` : ""}</td></tr>`).join("")}</table>
    <table>${st.team.slice(0, 6).map((x, k) => `<tr><td>${k + 1}</td><td>${x.T.short}</td><td style="text-align:right">${x.p}点</td></tr>`).join("")}</table></div>`;
}
function commitSeasonRace() {
  if (!seasonRace || !SEASON || SEASON.committed === SEASON.round) return;
  const pm = racePoints();
  for (const c of cars) { SEASON.pts[c.code] = (SEASON.pts[c.code] || 0) + (pm[c.code] || 0); SEASON.team[c.T.key] = (SEASON.team[c.T.key] || 0) + (pm[c.code] || 0); }
  SEASON.hist.push({ r: SEASON.round, win: order()[0].code, me: order().indexOf(player) + 1, wx: WX.label });
  SEASON.committed = SEASON.round; SEASON.round++;
  store.set("hgp_season", SEASON);
}
function updateSeasonUI() {
  $("seasonBtn").textContent = SEASON ? `シーズン続き（第${SEASON.round}戦）` : "シーズン（全5戦）";
  $("seasonQuit").classList.toggle("hidden", !SEASON);
  renderStats();
}
$("seasonBtn").onclick = () => {
  if (!SEASON) { SEASON = { round: 1, total: 5, pts: {}, team: {}, hist: [] }; store.set("hgp_season", SEASON); }
  seasonRace = true; startGame();
};
$("seasonQuit").onclick = () => { SEASON = null; store.set("hgp_season", null); updateSeasonUI(); };
$("nextRaceBtn").onclick = () => {
  commitSeasonRace();
  if (SEASON.round > SEASON.total) return showSeasonFinal();
  $("result").classList.add("hidden"); clearInterval(resTimer);
  setupRace();
};
function showSeasonFinal() {
  clearInterval(resTimer);
  const st = standings(), champ = st.drv[0].c, myPos = st.drv.findIndex((x) => x.c === player) + 1;
  STATS.seasons++; if (champ === player) STATS.titles++; saveStats();
  $("resTitle").textContent = champ === player ? "ワールドチャンピオン！" : "シーズン終了";
  $("resSub").textContent = `チャンピオン：${champ.driver}（${champ.teamName}） ・ あなたは${myPos}位（${SEASON.pts[player.code] || 0}点）`;
  renderSeasonBox(true);
  $("resTable").innerHTML = SEASON.hist.map((h) => `<tr><td>第${h.r}戦</td><td>優勝 ${h.win}</td><td>あなた ${h.me}位</td><td style="opacity:.7">${h.wx}</td></tr>`).join("");
  ["againBtn", "nextRaceBtn"].forEach((id) => $(id).classList.add("hidden"));
  document.querySelectorAll("#result .replayBtn").forEach((b) => b.classList.add("hidden"));
  if (champ === player) { finishCheer = 4.5; fireConfetti(); }
  SEASON = null; store.set("hgp_season", null); seasonRace = false;
}

// ---------- リプレイ ----------
const REC = { dt: 0.1, next: 0, frames: [], times: [], sc: [] };
function recReset() { REC.frames = []; REC.times = []; REC.sc = []; REC.next = 0; tickerLog.length = 0; }
function recTick() {
  if (raceT < REC.next) return;
  REC.next = raceT + REC.dt;
  const f = new Float32Array(cars.length * 6);
  cars.forEach((c, k) => {
    const o = k * 6; f[o] = c.x; f[o + 1] = c.z; f[o + 2] = c.h; f[o + 3] = c.speed; f[o + 4] = c.dist;
    f[o + 5] = (c.obj.visible ? 1 : 0) + (c.dnf ? 2 : 0) + (c.pit ? 4 : 0);
  });
  REC.frames.push(f); REC.times.push(raceT);
  REC.sc.push(SC.obj.visible ? [SC.obj.position.x, SC.obj.position.z, SC.obj.rotation.y] : null);
}
let REPLAY = null;
function openReplay() {
  if (REC.frames.length < 20) return;
  const save = { MODE, state, focus, shot, speedMul, scVis: SC.obj.visible, res: !$("result").classList.contains("hidden"), wres: !$("wresult").classList.contains("hidden"),
    cars: cars.map((c) => ({ x: c.x, z: c.z, h: c.h, speed: c.speed, dist: c.dist, finished: c.finished, dnf: c.dnf, vis: c.obj.visible, s: c.s, lat: c.lat, idx: c.idx, vx: c.vx, vz: c.vz, pit: c.pit })) };
  const hud = ["tower", "wtop", "ticker", "fcard", "flagBanner", "tl", "times", "board", "help", "tyreHud", "tip", "ghostDelta", "draft"];
  save.hud = hud.filter((id) => !$(id).classList.contains("hidden"));
  hud.forEach((id) => $(id).classList.add("hidden"));
  $("result").classList.add("hidden"); $("wresult").classList.add("hidden");
  ["map", "speedo", "replayTag", "replayBar"].forEach((id) => $(id).classList.remove("hidden"));
  REPLAY = { t: REC.times[0], playing: true, speed: 1, save, me: save.MODE === "drive" ? player : BET.car };
  MODE = "watch"; state = "replay"; speedMul = 1; clearInterval(resTimer);
  finishCheer = 0; confetti = []; flagG.clearRect(0, 0, flagC.width, flagC.height);
  for (const c of cars) c.pit = null;
  if (ghostObj) ghostObj.visible = false;
  // 見どころ
  const ev = [`<option value="${REC.times[0]}">▶ 最初から</option>`];
  const fins = save.cars.map((s, k) => (s.finished ? cars[k].finishTime : Infinity)), ft = Math.min(...fins);
  if (isFinite(ft)) ev.push(`<option value="${Math.max(REC.times[0], ft - 12)}">🏁 ゴールの瞬間</option>`);
  for (const line of tickerLog) {
    const m = line.match(/^(-?[\d.]+) (.*)$/); if (!m) continue;
    if (!/クラッシュ|スピン|セーフティカー出動|赤旗！|1位に浮上|雨が降|ペナルティ|失格|抜いて [1-3]位/.test(m[2])) continue;
    const t = Math.max(REC.times[0], +m[1] - 5);
    ev.push(`<option value="${t}">${fmt(+m[1]).slice(0, -4)} ${m[2].replace(/<[^>]+>/g, "").slice(0, 34)}</option>`);
    if (ev.length > 60) break;
  }
  $("rpEvents").innerHTML = ev.join("");
  $("rpSeek").max = REC.times.length - 1;
  $("rpCam").value = "tv"; $("rpPlay").textContent = "❚❚";
  document.querySelectorAll(".rpSpd").forEach((b) => b.classList.toggle("on", b.dataset.s === "1"));
  replayApply(REPLAY.t); setShot("chase", order()[0]); updateCamera(0, true);
}
function replayApply(t) {
  const T = REC.times; let lo = 0, hi = T.length - 1;
  while (lo < hi - 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
  const A = REC.frames[lo], B = REC.frames[hi], f = clamp((t - T[lo]) / Math.max(T[hi] - T[lo], 1e-4), 0, 1);
  const jump = Math.hypot(B[0] - A[0], B[1] - A[1]) > 30;     // 赤旗の再スタートなどで瞬間移動した所は補間しない
  cars.forEach((c, k) => {
    const o = k * 6, g = jump || Math.hypot(B[o] - A[o], B[o + 1] - A[o + 1]) > 30 ? 0 : f;
    c.x = lerp(A[o], B[o], g); c.z = lerp(A[o + 1], B[o + 1], g);
    let dh = B[o + 2] - A[o + 2]; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    c.h = A[o + 2] + dh * g; c.speed = lerp(A[o + 3], B[o + 3], g); c.dist = lerp(A[o + 4], B[o + 4], g);
    const fl = A[o + 5]; c.obj.visible = !!(fl & 1); c.dnf = !!(fl & 2); c.finished = false;
    c.vx = Math.sin(c.h) * c.speed; c.vz = Math.cos(c.h) * c.speed;
    // 再生位置を飛ばした時は、コース上のどこにいるかを全体から探し直す（近くだけ探すと位置を間違えてカメラが壁に入る）
    let hint = c.idx; if (Math.hypot(TR.x[hint] - c.x, TR.z[hint] - c.z) > 15) hint = nearestIdx(c.x, c.z);
    const p = project(c.x, c.z, hint); c.s = p.s; c.lat = p.lat; c.idx = p.i;
  });
  const s = REC.sc[lo]; SC.obj.visible = !!s;
  if (s) { SC.obj.position.set(s[0], 0, s[1]); SC.obj.rotation.y = s[2]; }
  return lo;
}
function replayStep(dt) {
  const R = REPLAY, last = REC.times[REC.times.length - 1];
  if (R.playing) { R.t += dt * R.speed; if (R.t >= last) { R.t = last; R.playing = false; $("rpPlay").textContent = "▶"; } }
  // 再生位置を大きく飛ばした時は、カメラを一気に移す（途中の建物の中を通らないように）
  if (R.lastT !== undefined && Math.abs(R.t - R.lastT) > 1) { shotT = 0; shotNew = true; }
  R.lastT = R.t;
  const i = replayApply(R.t);
  const cam = $("rpCam").value;
  if (cam !== "tv") {
    const c = cam === "me" && R.me ? R.me : order().find((o) => !o.dnf);
    if (c && (focus !== c || shot !== "chase")) setShot("chase", c);
    shotT = 99;
  }
  if (document.activeElement !== $("rpSeek")) $("rpSeek").value = i;
  const lead = order().find((o) => !o.dnf), lap = lead ? clamp(Math.floor(lead.dist / L) + 1, 1, LAPS) : 1;
  $("rpTime").textContent = fmt(Math.max(R.t, 0)).slice(0, -4);
  $("rpInfo").textContent = `LAP ${lap}/${LAPS} ・ カメラ: ${focus ? `${focus.code} ${focus.driver}` : ""}`;
  // 速さメーター
  if (focus) { const g = gearOf(focus.speed); $("spd").textContent = Math.round(Math.abs(focus.speed) * 3.6); $("gear").textContent = g.g; }
  if (!mapBase) drawMapBase();
  mapG.clearRect(0, 0, 208, 208); mapG.drawImage(mapBase, 0, 0);
  for (const o of cars) { if (!o.obj.visible) continue; const [x, y] = toMap(o.x, o.z); mapG.fillStyle = o.color; mapG.strokeStyle = o === focus ? "#fff" : "rgba(0,0,0,.5)"; mapG.lineWidth = o === focus ? 2.5 : 1; mapG.beginPath(); mapG.arc(x, y, o === focus ? 5 : 3.2, 0, 7); mapG.fill(); mapG.stroke(); }
}
function closeReplay() {
  const S = REPLAY.save;
  cars.forEach((c, k) => { const s = S.cars[k]; Object.assign(c, { x: s.x, z: s.z, h: s.h, speed: s.speed, dist: s.dist, finished: s.finished, dnf: s.dnf, s: s.s, lat: s.lat, idx: s.idx, vx: s.vx, vz: s.vz, pit: s.pit }); c.obj.visible = s.vis; });
  SC.obj.visible = S.scVis; MODE = S.MODE; state = S.state; focus = S.focus; shot = S.shot; speedMul = S.speedMul;
  ["replayTag", "replayBar"].forEach((id) => $(id).classList.add("hidden"));
  if (MODE === "drive") $("map").classList.remove("hidden");
  S.hud.forEach((id) => $(id).classList.remove("hidden"));
  if (S.res) { $("result").classList.remove("hidden"); if (MODE === "drive" && !$("nextRaceBtn").textContent.includes("最終")) { renderResults(); resTimer = setInterval(renderResults, 1000); } }
  if (S.wres) $("wresult").classList.remove("hidden");
  REPLAY = null; syncCars(0); updateCamera(0, true);
}
document.querySelectorAll(".replayBtn").forEach((b) => (b.onclick = openReplay));
$("rpClose").onclick = closeReplay;
$("rpPlay").onclick = () => { if (!REPLAY) return; if (!REPLAY.playing && REPLAY.t >= REC.times[REC.times.length - 1] - 0.05) REPLAY.t = REC.times[0]; REPLAY.playing = !REPLAY.playing; $("rpPlay").textContent = REPLAY.playing ? "❚❚" : "▶"; };
$("rpSeek").oninput = () => { if (REPLAY) { REPLAY.t = REC.times[+$("rpSeek").value]; shotT = 0; } };
$("rpEvents").onchange = () => { if (REPLAY) { REPLAY.t = +$("rpEvents").value; REPLAY.playing = true; $("rpPlay").textContent = "❚❚"; shotT = 0; } };
document.querySelectorAll(".rpSpd").forEach((b) => (b.onclick = () => { if (!REPLAY) return; REPLAY.speed = +b.dataset.s; document.querySelectorAll(".rpSpd").forEach((x) => x.classList.toggle("on", x === b)); }));
$("rpCam").onchange = () => { shotT = 0; };

// ---------- 実況の声（ブラウザの読み上げ機能） ----------
const VOICE = { last: 0, jp: null };
function say(text, prio = 1) {
  try {
    if ($("voiceSel").value !== "on" || skipping || REPLAY || state === "title" || paused || !window.speechSynthesis || speedMul > 2) return;
    const now = performance.now();
    if (prio < 2 && now - VOICE.last < 4500) return;
    if (speechSynthesis.speaking) { if (prio >= 2) speechSynthesis.cancel(); else return; }
    const u = new SpeechSynthesisUtterance(text); u.lang = "ja-JP"; u.rate = 1.15; u.volume = 0.9;
    if (!VOICE.jp) VOICE.jp = speechSynthesis.getVoices().find((v) => v.lang && v.lang.startsWith("ja")) || null;
    if (VOICE.jp) u.voice = VOICE.jp;
    speechSynthesis.speak(u); VOICE.last = now;
  } catch (e) {}
}
const sname = (c) => c.driver.split("・")[1] || c.driver;
let leadCode = "", leadT = 0;
function watchLeader(dt) {
  if (state !== "race") return;
  leadT -= dt; if (leadT > 0) return; leadT = 0.5;
  const l = order().find((c) => !c.dnf && !c.finished); if (!l) return;
  if (leadCode && l.code !== leadCode && raceT > 8 && !l.pit) { say(`${sname(l)}がトップに立ちました`, 1); if (MODE === "drive") ticker(`👑 ${l.code} が1位に浮上`); }
  leadCode = l.code;
}

// ---------- 雨の水しぶき ----------
const SPRAY_N = 1600;
const sprayPos = new Float32Array(SPRAY_N * 3), sprayCol = new Float32Array(SPRAY_N * 3), sprayVel = new Float32Array(SPRAY_N * 3), sprayLife = new Float32Array(SPRAY_N);
for (let i = 0; i < SPRAY_N; i++) sprayPos[i * 3 + 1] = -100;
const sprayGeo = new THREE.BufferGeometry();
sprayGeo.setAttribute("position", new THREE.BufferAttribute(sprayPos, 3)); sprayGeo.setAttribute("color", new THREE.BufferAttribute(sprayCol, 3));
const sprayTex = canvasTex(64, 64, (g, w, h) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, false);
const sprayPts = new THREE.Points(sprayGeo, new THREE.PointsMaterial({ size: 1.2, map: sprayTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
sprayPts.frustumCulled = false; sprayPts.userData.noOcc = true; sprayPts.visible = false; scene.add(sprayPts);
let sprayHead = 0, sprayAlive = 0;
function updateSpray(dt) {
  const w = WX.wet, active = w > 0.2 && (state === "race" || state === "finished" || state === "replay") && !skipping;
  if (!active && !sprayAlive) { sprayPts.visible = false; return; }
  sprayPts.visible = true;
  if (active && dt > 0) for (const c of cars) {
    if (c.dnf || c.pit || !c.obj.visible || c.speed < 16) continue;
    if ((c.x - camera.position.x) ** 2 + (c.z - camera.position.z) ** 2 > 150 * 150) continue;
    const fx = Math.sin(c.h), fz = Math.cos(c.h), lx = fz, lz = -fx;
    const n = Math.min(5, Math.round((c.speed / 25) * w * 2.2 * Math.min(dt * 60, 3)) + (Math.random() < 0.5 ? 1 : 0));
    for (let k = 0; k < n; k++) {
      const i = sprayHead; sprayHead = (sprayHead + 1) % SPRAY_N;
      const sd = Math.random() < 0.5 ? -1 : 1, o = i * 3;
      sprayPos[o] = c.x - fx * 2.1 + lx * sd * 0.78; sprayPos[o + 1] = 0.25; sprayPos[o + 2] = c.z - fz * 2.1 + lz * sd * 0.78;
      const back = c.speed * (0.18 + Math.random() * 0.12);
      sprayVel[o] = c.vx * 0.55 - fx * back + lx * sd * (Math.random() * 2); sprayVel[o + 1] = 1.2 + Math.random() * 2.2; sprayVel[o + 2] = c.vz * 0.55 - fz * back + lz * sd * (Math.random() * 2);
      sprayLife[i] = 0.55 + Math.random() * 0.35;
    }
  }
  sprayAlive = 0;
  for (let i = 0; i < SPRAY_N; i++) {
    const o = i * 3;
    if (sprayLife[i] <= 0) { if (sprayPos[o + 1] > -50) { sprayPos[o + 1] = -100; sprayCol[o] = sprayCol[o + 1] = sprayCol[o + 2] = 0; } continue; }
    sprayAlive++;
    sprayLife[i] -= dt; sprayVel[o + 1] -= 3 * dt;
    sprayPos[o] += sprayVel[o] * dt; sprayPos[o + 1] = Math.max(0.05, sprayPos[o + 1] + sprayVel[o + 1] * dt); sprayPos[o + 2] += sprayVel[o + 2] * dt;
    const a = clamp(sprayLife[i] / 0.7, 0, 1) * 0.16 * (TOD.kind === "night" ? 0.6 : 1);
    sprayCol[o] = sprayCol[o + 1] = sprayCol[o + 2] = a;
  }
  sprayGeo.attributes.position.needsUpdate = true; sprayGeo.attributes.color.needsUpdate = true;
}

// ---------- 時間帯（昼・夕方・夜） ----------
const TOD = { kind: "day" };
const TOD_JP = { day: "昼", evening: "夕方", night: "夜" };
// 夜の照明（コース脇の照明塔）
const NIGHT_LIGHTS = (() => {
  const list = [];
  for (let i = 0; i < N; i += 26) { if (inTunnelIdx(i) || inPitZone(i)) continue; list.push(i); }
  const poleG = new THREE.CylinderGeometry(0.12, 0.16, 11, 6); poleG.translate(0, 5.5, 0);
  const headG = new THREE.BoxGeometry(1.8, 0.35, 0.6); headG.translate(0, 11, 0);
  const poles = new THREE.InstancedMesh(poleG, std({ color: 0x3a3d42, roughness: 0.6 }), list.length);
  const heads = new THREE.InstancedMesh(headG, new THREE.MeshBasicMaterial({ color: 0xfff6dd }), list.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  list.forEach((i, k) => {
    const sd = -PIT_SD, lt = sd * (WALL + 1.6);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(TR.tx[i], TR.tz[i]));
    m4.compose(new THREE.Vector3(TR.x[i] + TR.nx[i] * lt, 0, TR.z[i] + TR.nz[i] * lt), q, new THREE.Vector3(1, 1, 1));
    poles.setMatrixAt(k, m4); heads.setMatrixAt(k, m4);
  });
  poles.visible = heads.visible = false; poles.userData.noOcc = heads.userData.noOcc = true;
  // 照明が路面を照らす光だまり
  const poolTex = canvasTex(128, 128, (g, w, h) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, "rgba(255,246,225,1)"); gr.addColorStop(0.55, "rgba(255,240,210,0.45)"); gr.addColorStop(1, "rgba(255,240,210,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, false);
  const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(26, 26), new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }), list.length);
  list.forEach((i, k) => {
    const lt = -PIT_SD * (WALL - 4);
    m4.compose(new THREE.Vector3(TR.x[i] + TR.nx[i] * lt, 0.05, TR.z[i] + TR.nz[i] * lt), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), new THREE.Vector3(1, 1, 1));
    pools.setMatrixAt(k, m4);
  });
  pools.visible = false; pools.userData.noOcc = true; pools.renderOrder = 1;
  scene.add(poles, heads, pools);
  return [poles, heads, pools];
})();
function rollTOD(sel) {
  let k = sel;
  if (!TOD_JP[k]) { const r = Math.random(); k = r < 0.6 ? "day" : r < 0.82 ? "evening" : "night"; }
  TOD.kind = k;
  const el = k === "evening" ? 7 : k === "night" ? 72 : 38, az = k === "evening" ? 250 : 215;     // 夜は照明で真上から照らす
  sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - el), THREE.MathUtils.degToRad(az));
  su.sunPosition.value.copy(sunDir);
  NIGHT_LIGHTS.forEach((o) => (o.visible = k === "night"));
  if (BUILD_MAT) { BUILD_MAT.emissive.setHex(k === "night" ? 0x2a1d0e : 0x000000); }
  WX._last = -1; applyWeatherLook();
}
function applyTODLook(v) {
  if (TOD.kind === "evening") {
    sun.color.setHex(0xffa060); sun.intensity *= 0.9; WX.hemiMul *= 0.78;
    su.turbidity.value = 8; su.rayleigh.value = 3; su.mieCoefficient.value = 0.006;
    scene.fog.color.lerp(_c2.setHex(0xd9a37e), 0.45 * (1 - v));
    if (scene.background) scene.background.lerp(_c2.setHex(0x7a5a4a), 0.4);
  } else if (TOD.kind === "night") {
    // 夜: コースは照明で明るく、空と遠くは暗く
    sun.color.setHex(0xeef2ff); sun.intensity = 2.1 * (1 - 0.3 * v); WX.hemiMul *= 0.88; WX.envMul *= 0.55;
    sky.visible = false;
    const nc = _c1.setHex(0x060a14).lerp(_c2.setHex(0x1b2027), v * 0.6);
    scene.fog.color.copy(nc); scene.background = nc.clone();
    scene.fog.near = Math.min(scene.fog.near, 140); scene.fog.far = Math.min(scene.fog.far, 950);
  } else { sun.color.setHex(0xfff1dc); su.mieCoefficient.value = 0.004; }
}

// ======================= 設定の保存・運転アシスト =======================
const SET_IDS = ["track", "laps", "diff", "wx", "tod", "tyreSel", "assistSel", "ghostSel", "voiceSel", "quality", "wlaps"];
function saveSettings() {
  const o = { sound: audio.isOn(), betType, betAmt: betAmt === coins ? "all" : betAmt };
  for (const id of SET_IDS) o[id] = $(id).value;
  o.track = String(TRACK_ID);
  store.set("hgp_settings", o);
}
(function loadSettings() {
  for (const id of SET_IDS) {
    const v = SETTINGS[id]; if (v === undefined) continue;
    const el = $(id); if ([...el.options].some((op) => op.value === String(v))) el.value = String(v);
  }
  $("track").value = String(TRACK_ID);
  if (SETTINGS.sound === false) audio.setOn(false);
  if (SETTINGS.betType) betType = SETTINGS.betType;
  if (SETTINGS.betAmt) betAmt = SETTINGS.betAmt === "all" ? 1000 : +SETTINGS.betAmt || 100;
  WATCH_LAPS = +$("wlaps").value || 5;
})();
for (const id of SET_IDS) if (id !== "track") $(id).addEventListener("change", saveSettings);
document.querySelectorAll(".btype, .bamt").forEach((b) => b.addEventListener("click", saveSettings));
// コースを変えたら作り直す（ページを読み直す）
$("track").addEventListener("change", () => {
  const v = $("track").value; saveSettings();
  const o = store.get("hgp_settings", {}); o.track = v; store.set("hgp_settings", o);
  const u = new URL(location.href);
  if (u.searchParams.has("track")) { u.searchParams.set("track", v); location.href = u.toString(); } else location.reload();
});
// ---- ブレーキライン: 自分の車の先のレコードラインを、今の速さで間に合うか色分けして表示 ----
const GUIDE_K = 120, GUIDE_STEP = 2.2;
const guidePos = new Float32Array((GUIDE_K + 1) * 6), guideCol = new Float32Array((GUIDE_K + 1) * 6);
const guideGeo = new THREE.BufferGeometry();
guideGeo.setAttribute("position", new THREE.BufferAttribute(guidePos, 3)); guideGeo.setAttribute("color", new THREE.BufferAttribute(guideCol, 3));
{ const idx = []; for (let k = 0; k < GUIDE_K; k++) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } guideGeo.setIndex(idx); }
const guideMesh = new THREE.Mesh(guideGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
guideMesh.frustumCulled = false; guideMesh.visible = false; guideMesh.userData.noOcc = true; guideMesh.renderOrder = 2; scene.add(guideMesh);
// その地点で出してよい速さ（このマシンのグリップ・タイヤ・雨を考慮）
function guideSpeed(c, s) { return TR.vmax[idxAtS(s)] * 0.97 * Math.sqrt(c.gripF * wetGrip(c)); }
function updateGuide() {
  const c = player;
  const on = c && MODE === "drive" && !REPLAY && (state === "race" || state === "countdown") && $("assistSel").value !== "off" && !c.pit && !c.finished && !c.dnf;
  guideMesh.visible = !!on; if (!on) return;
  const v = Math.max(c.speed, 0);
  for (let k = 0; k <= GUIDE_K; k++) {
    const s = c.s + 4 + k * GUIDE_STEP, T = trackAt(s);
    const u = (((s % L) + L) % L) / DS, i0 = wrap(Math.floor(u)), f = u - Math.floor(u);
    const lt = lerp(TR.line[i0], TR.line[wrap(i0 + 1)], f);
    const w = 0.28 * (1 - (k / GUIDE_K) * 0.4), o = k * 6;
    guidePos[o] = T.x + T.nx * (lt - w); guidePos[o + 1] = 0.03; guidePos[o + 2] = T.z + T.nz * (lt - w);
    guidePos[o + 3] = T.x + T.nx * (lt + w); guidePos[o + 4] = 0.03; guidePos[o + 5] = T.z + T.nz * (lt + w);
    const vt = guideSpeed(c, s);
    let r, g, b;
    if (v > vt + 2.5) { r = 1; g = 0.12; b = 0.08; }            // ブレーキ
    else if (v > vt - 6) { r = 1; g = 0.8; b = 0.05; }          // アクセルを緩める
    else { r = 0.15; g = 0.95; b = 0.35; }                      // 全開
    const fade = 1 - (k / GUIDE_K) ** 2;
    for (const q of [0, 3]) { guideCol[o + q] = r * fade; guideCol[o + q + 1] = g * fade; guideCol[o + q + 2] = b * fade; }
  }
  guideGeo.attributes.position.needsUpdate = true; guideGeo.attributes.color.needsUpdate = true;
}
// ---- 自動ブレーキ: このままだと曲がりきれない時だけブレーキを足す ----
function assistBrake(c) {
  if (c.pit || c.speed < 8) return;
  const v = c.speed, maxDec = (22 + 0.0028 * v * v) * c.brkF * (1 - 0.15 * WX.wet);
  let need = 0;
  for (let d = 2; d <= 170; d += 4) {
    const vt = guideSpeed(c, c.s + d + v * 0.06);
    if (v > vt) need = Math.max(need, (v * v - vt * vt) / (2 * d));
  }
  const b = clamp((need / maxDec - 0.62) * 2.6, 0, 1);
  if (b > 0.04) { c.brk = Math.max(c.brk, b); c.thr = Math.min(c.thr, 0); c.assistOn = true; } else c.assistOn = false;
}


// ======================= 読み込み =======================
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const wheelPos = { FL: [-0.8, 0.36, -1.7], FR: [0.8, 0.36, -1.7], RL: [-0.76, 0.36, 1.7], RR: [0.76, 0.36, 1.7] };
loader.load("./assets/cars.glb", (gltf) => {
  const byName = {};
  gltf.scene.traverse((o) => { if (o.isMesh || o.isGroup || o.isObject3D) byName[o.name] = o; });
  const wf = byName.wheel_front, wr = byName.wheel_rear;
  for (const T of TEAMS) for (let k = 0; k < 2; k++) {
    const tn = T.key;
    const name = k === 0 ? tn : tn + "Mate";
    const body = byName[name + "_body"];
    const isP = name === "Hero";
    const car = new Car(name, T, k, isP);
    const grp = new THREE.Group();
    if (body) {
      // 位置はそのまま（軽量化したモデルは位置・大きさの情報で元の寸法に戻している）
      body.rotation.set(0, 0, 0); grp.add(body);
      body.traverse((m) => {
        if (!m.isMesh) return; m.castShadow = true; m.receiveShadow = true;
        // 雨の日などに点滅させるテールランプは車ごとの材質にする
        if (m.material && m.material.name === "RainLight") { car.rainMat = m.material = m.material.clone(); }
      });
    }
    car.wheels = [];
    for (const key of ["FL", "FR", "RL", "RR"]) {
      const src = key[0] === "F" ? wf : wr;
      const piv = new THREE.Group(); piv.position.set(...wheelPos[key]);
      const spin = new THREE.Group(); piv.add(spin);
      if (src) {
        const w = src.clone(); w.rotation.set(0, 0, 0);
        w.traverse((m) => {
          if (!m.isMesh) return; m.castShadow = true;
          // タイヤ側面の色帯は車ごとに色を変える（今はいているタイヤの種類）
          if (m.material && m.material.name === "TyreBand") { if (!car.bandMat) car.bandMat = m.material.clone(); m.material = car.bandMat; }
        });
        spin.add(w);
      }
      grp.add(piv); car.wheels.push({ piv, spin, front: key[0] === "F" });
    }
    scene.add(grp); car.obj = grp;
    cars.push(car);
    if (isP) player = car;
  }
  // 起動前の見た目のためにいったん並べる
  cars.forEach((c, k) => c.place(S_FIN - 12 - k * 8, k % 2 ? -2.4 : 2.4));
  syncCars(0);
  updateCamera(0, true);
  $("startBtn").disabled = false; $("startBtn").textContent = "ドライブ（自分で走る）";
  $("watchBtn").disabled = false; $("seasonBtn").disabled = false;
  makeGhost(); updateSeasonUI();
  $("loadbar").firstElementChild.style.width = "100%";
  if (Q.get("skip") === "1") startGame();
  if (Q.get("watch") === "1") { openBet(); startWatch(true); }
}, (e) => { if (e.total) $("loadbar").firstElementChild.style.width = `${(e.loaded / e.total) * 100}%`; }, (err) => { $("startBtn").textContent = "読み込みエラー"; console.error(err); });

if (Q.get("laps")) $("laps").value = Q.get("laps");
if (Q.get("diff")) $("diff").selectedIndex = +Q.get("diff");
function startGame() {
  MODE = "drive";
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  canvas.setAttribute("tabindex", "0"); canvas.focus({ preventScroll: true });
  for (const k in keys) keys[k] = false;
  audio.init(); audio.resume();
  applyQuality($("quality").value);
  $("title").classList.add("hidden");
  setupRace();
}
$("startBtn").onclick = () => { seasonRace = false; startGame(); };
$("watchBtn").onclick = () => openBet();

function syncCars(dt) {
  for (const c of cars) {
    c.obj.position.set(c.x, 0, c.z);
    c.obj.rotation.y = c.h + Math.PI;
    c.wheelRot -= (c.speed * dt) / WHEEL_R;
    const st = c.steer * steerMax(Math.max(c.speed, 0));
    for (const w of c.wheels) { w.spin.rotation.x = c.wheelRot; if (w.front) w.piv.rotation.y = st; }
    if (c.hitT > 0) c.hitT -= dt;
    // テールランプ: 雨・ピットレーン・スピン中に点滅
    if (c.rainMat) { const blink = (wetEff() > 0.2 || c.pit || c.spinT > 0 || c.losing > 0) && !c.dnf; c.rainMat.emissiveIntensity = blink ? (Math.floor(performance.now() / 125) % 2 ? 14 : 1.5) : 1.2; }
  }
}

// ======================= メインループ =======================
let lastT = performance.now(), fpsAcc = 0, fpsN = 0;
window.__cam = camera;
window.__occ = () => (focus ? isOccluded(focus) : false);
window.__game = { openReplay, closeReplay, rep: () => REPLAY, REC, STATS, season: () => SEASON, ghost: () => GHOST, TOD, rollTOD, setShot: (t, c) => setShot(t, c), lockShot: (t) => { shotT = t; }, WX, SC, FL, INC, PIT, rollWeather, redFlag, deploySC, startCrash, startSpin, retire, damageCar, TYRES, ticks: () => tickerLog, cars: () => cars, player: () => player, state: () => state, L, order, BET, DRS, get coins() { return coins; }, openBet, startWatch, grid: () => betGrid, mode: () => MODE, shot: () => shot + ":" + (focus && focus.code) };
// テスト用: 描画せずにレースを早送り
window.__repStep = (dt) => { if (REPLAY) { replayStep(dt); syncCars(dt); updateCamera(dt); } };
window.__bot = null;   // テスト用: プレイヤーをキーボード風に操作する関数
window.__drv = { aiDrive, TR, idxAtS, L, HALF, WALL, N, kS, TRACK_ID, TUN_A, TUN_B };
window.__simulate = (sec, h = 1 / 60) => {
  let wallHits = 0;
  for (let t = 0; t < sec; t += h) {
    const before = cars.map((c) => c.hitT);
    stepRace(h); syncCars(h); updateCamera(h); updateFlagUI(h); if (MODE === "watch") updateWatchHUD(h); else updateHUD(h); if (msgT > 0) { msgT -= h; if (msgT <= 0) $("msg").style.opacity = 0; }
    cars.forEach((c, k) => { if (c.hitT > 0.29 && before[k] <= 0.01) wallHits++; });
  }
  return { state, raceT, wallHits, ord: order().map((c) => `${c.name}:${c.finished ? "F" + c.finishTime.toFixed(1) : (c.dist / L).toFixed(2)}`), player: { dist: player.dist, best: player.best, finished: player.finished }, fastest: fastest.car && fastest.car.code + " " + fastest.t.toFixed(2) };
};
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min((now - lastT) / 1000, 1 / 20); lastT = now;
  dt *= TIME_SCALE * (MODE === "watch" && state !== "title" ? speedMul : 1);
  if (REPLAY) { replayStep(dt); syncCars(dt); updateCamera(dt); }
  else if (!paused && cars.length) {
    if (state !== "title") stepRace(dt);
    syncCars(dt);
    updateCamera(dt);
    if (MODE === "watch") { if (state !== "title") updateWatchHUD(dt); } else updateHUD(dt);
  }
  if (cars.length) { updateTips(paused ? 0 : dt); updateGhost(); updateSpray(paused ? 0 : dt); updateGuide(); }
  if (resumeT > 0) {
    if (!frame.resumeEnd) frame.resumeEnd = now + resumeT * 1000;
    const left = (frame.resumeEnd - now) / 1000;
    $("resumeCount").textContent = Math.ceil(Math.max(left, 0.01));
    if (left <= 0) { resumeT = 0; frame.resumeEnd = 0; paused = false; $("resumeCount").style.display = "none"; lastT = now; }
  } else frame.resumeEnd = 0;
  $("pauseBtn").classList.toggle("hidden", !(MODE === "drive" && (state === "race" || state === "countdown")));
  audio.update(dt);
  if (msgT > 0) { msgT -= dt; if (msgT <= 0) $("msg").style.opacity = 0; }
  drawFlagFx(dt, now / 1000);
  if (state !== "title" && cars.length && !REPLAY) { updateFlagUI(dt); placeMarshalFlags(now / 1000); }
  if (window.__camOverride) { const o = window.__camOverride; camera.position.set(...o.pos); camera.fov = o.fov || 40; camera.updateProjectionMatrix(); camera.lookAt(...o.look); }
  renderer.render(scene, camera);
  fpsAcc += dt; fpsN++; if (fpsAcc > 1) { window.__fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
}
requestAnimationFrame(frame);
document.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest(".chip"); if (b) b.blur(); });

// 順位表をクリックすると、その車を追うカメラになる（もう一度クリックで車載）
$("towerList").addEventListener("click", (e) => {
  const row = e.target.closest(".trow"); if (!row || !row.dataset.code || MODE !== "watch") return;
  const c = cars.find((o) => o.code === row.dataset.code); if (c) setWCam("car", c);
});
document.querySelectorAll(".wcam").forEach((b) => (b.onclick = () => { if (b.dataset.m === "car") { setWCam("car", WCAM_CAR || focus || order()[0]); } else setWCam(b.dataset.m); }));
