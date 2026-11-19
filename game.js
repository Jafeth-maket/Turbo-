/* ============================================================
   TURBO RUSH 3D - lógica del juego (Three.js)
   Los números (dinero, velocidades, precios) están en config.js
   Unidades del mundo: 1 unidad = 1 metro. El auto va hacia -Z.
   ============================================================ */
(() => {
"use strict";
const T = THREE;

const LANES = CONFIG.carriles;
const RC = CONFIG.carrera;               // ajustes del modo carrera
const TRAF_BEHIND = 150;                 // en carrera el tráfico sigue existiendo hasta aquí atrás (para los bots)
const LANE_W = 3;
const ROAD_W = LANES * LANE_W, ROAD_HALF = ROAD_W / 2;
const SPAWN = 260;                       // a qué distancia aparece el tráfico
const DECOR_STEP = 20, DECOR_N = 16, DECOR_LEN = DECOR_STEP * DECOR_N;
const PL = 4.3, PW = 1.9;                // largo y ancho del auto del jugador
const TILE = 14;                         // metros que cubre la textura de la carretera

const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = (n) => Math.round(n).toLocaleString("es");
const laneX = (i) => (i - (LANES - 1) / 2) * LANE_W;
const stage = $("stage");

/* ---------------- Guardado ---------------- */
function defaultSave() {
  return {
    dinero: CONFIG.dineroInicial,
    autos: { [CONFIG.autos[0].id]: true },
    seleccionado: CONFIG.autos[0].id,
    mejoras: {},
    mejor: 0,
    sonido: CONFIG.sonido
  };
}
function loadSave() {
  try {
    const raw = localStorage.getItem(CONFIG.saveKey);
    if (raw) return Object.assign(defaultSave(), JSON.parse(raw));
  } catch (e) {}
  return defaultSave();
}
let save = loadSave();
function persist() { try { localStorage.setItem(CONFIG.saveKey, JSON.stringify(save)); } catch (e) {} }

function upgradesOf(id) {
  save.mejoras[id] = Object.assign({ motor: 0, nitro: 0, llantas: 0 }, save.mejoras[id]);
  return save.mejoras[id];
}
function carDef(id) { return CONFIG.autos.find((a) => a.id === id) || CONFIG.autos[0]; }
function carIndex(id) { return Math.max(0, CONFIG.autos.findIndex((a) => a.id === id)); }
function statsOf(id) {
  const c = carDef(id), u = upgradesOf(id), M = CONFIG.mejoras;
  return {
    vmax: c.velMax + u.motor * M.motor.velPorNivel,
    accel: c.aceleracion + u.motor * M.motor.accelPorNivel,
    nitroPower: CONFIG.nitroBase + u.nitro * M.nitro.potenciaPorNivel,
    nitroCap: CONFIG.nitroCapacidad + u.nitro * M.nitro.capacidadPorNivel,
    handling: c.agarre + u.llantas * M.llantas.agarrePorNivel
  };
}
function upgradeCost(key, level) {
  const m = CONFIG.mejoras[key];
  return Math.round(m.costoBase * Math.pow(m.crecimiento, level));
}

/* ---------------- Sonido (WebAudio, sin archivos) ---------------- */
const audio = { ctx: null, master: null, eng: null, engGain: null };
function audioInit() {
  if (audio.ctx) { if (audio.ctx.state === "suspended") audio.ctx.resume(); return; }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const a = audio.ctx = new AC();
    audio.master = a.createGain(); audio.master.gain.value = 0.5; audio.master.connect(a.destination);
    const o = a.createOscillator(); o.type = "sawtooth"; o.frequency.value = 50;
    const f = a.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 420;
    const g = a.createGain(); g.gain.value = 0;
    o.connect(f); f.connect(g); g.connect(audio.master); o.start();
    audio.eng = o; audio.engGain = g;
  } catch (e) {}
}
function beep(freq, dur, type = "square", vol = 0.12, to) {
  if (!audio.ctx || !save.sonido) return;
  const a = audio.ctx, t = a.currentTime;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(audio.master); o.start(t); o.stop(t + dur + 0.02);
}
function crashSound() {
  if (!audio.ctx || !save.sonido) return;
  const a = audio.ctx, len = a.sampleRate * 0.5;
  const buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const s = a.createBufferSource(), g = a.createGain();
  s.buffer = buf; g.gain.value = 0.5; s.connect(g); g.connect(audio.master); s.start();
}
function setEngine(frac, on) {
  if (!audio.ctx || !audio.eng) return;
  const t = audio.ctx.currentTime;
  audio.eng.frequency.setTargetAtTime(45 + frac * 120, t, 0.05);
  audio.engGain.gain.setTargetAtTime(on && save.sonido ? 0.05 : 0, t, 0.08);
}

/* ---------------- Motor 3D: escena, cámara, luces ---------------- */
const BIOMES = [
  { ground: 0x2e7d32, sky: 0x8ec9ff, light: 1.0, road: 1.0, deco: "pine" },     // campo
  { ground: 0xc9a15a, sky: 0xf2d49b, light: 1.0, road: 1.0, deco: "desert" },   // desierto
  { ground: 0xe3edf2, sky: 0xcfe3f0, light: 0.95, road: 0.95, deco: "snow" },   // nieve
  { ground: 0x12142a, sky: 0x060813, light: 0.38, road: 0.55, deco: "city" }    // ciudad de noche
];

let renderer;
try {
  renderer = new T.WebGLRenderer({ canvas: $("game"), antialias: true, powerPreference: "high-performance" });
} catch (e) {
  document.body.innerHTML = '<p style="color:#fff;padding:2em;font:18px sans-serif">Este dispositivo no puede mostrar gráficos 3D (WebGL).</p>';
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new T.Scene();
scene.background = new T.Color(BIOMES[0].sky);
scene.fog = new T.Fog(BIOMES[0].sky, 70, SPAWN + 20);
const camera = new T.PerspectiveCamera(60, 1, 0.5, 500);
const hemi = new T.HemisphereLight(0xffffff, 0x556655, 1.7);
const sun = new T.DirectionalLight(0xffffff, 2.0);
sun.position.set(6, 12, 8);
scene.add(hemi, sun);

const ground = new T.Mesh(new T.PlaneGeometry(700, 1700).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: BIOMES[0].ground }));
ground.position.set(0, -0.15, -420);
scene.add(ground);

// carretera: textura dibujada con canvas (líneas de carril y bordes)
function makeRoadTexture() {
  const c = document.createElement("canvas"); c.width = 256; c.height = 256;
  const x = c.getContext("2d");
  const total = ROAD_W + 2, pxm = 256 / total, pym = 256 / TILE;
  x.fillStyle = "#2b2d33"; x.fillRect(0, 0, 256, 256);
  x.fillStyle = "#383b43"; x.fillRect(0, 0, pxm, 256); x.fillRect(256 - pxm, 0, pxm, 256);
  x.fillStyle = "#ececec"; x.fillRect(pxm - 3, 0, 6, 256); x.fillRect(256 - pxm - 3, 0, 6, 256);
  x.fillStyle = "rgba(255,255,255,.9)";
  for (let l = 1; l < LANES; l++) {
    const xx = pxm + l * LANE_W * pxm;
    x.fillRect(xx - 3, 0, 6, 4 * pym); x.fillRect(xx - 3, 7 * pym, 6, 4 * pym);
  }
  const tex = new T.CanvasTexture(c);
  tex.wrapS = T.ClampToEdgeWrapping; tex.wrapT = T.RepeatWrapping;
  tex.colorSpace = T.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}
const ROAD_LEN = 720;
const roadTex = makeRoadTexture();
roadTex.repeat.set(1, ROAD_LEN / TILE);
const roadMat = new T.MeshBasicMaterial({ map: roadTex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });   // evita parpadeos entre carretera y suelo
const road = new T.Mesh(new T.PlaneGeometry(ROAD_W + 2, ROAD_LEN).rotateX(-Math.PI / 2), roadMat);
road.position.set(0, 0, 40 - ROAD_LEN / 2);
scene.add(road);

/* ---------------- Modelos de autos (cajas y cilindros) ---------------- */
const G = {
  body: new T.BoxGeometry(1.9, 0.55, 4.3),
  cabin: new T.BoxGeometry(1.55, 0.5, 2.0),
  wheel: new T.CylinderGeometry(0.38, 0.38, 0.32, 14).rotateZ(Math.PI / 2),
  head: new T.BoxGeometry(0.45, 0.18, 0.08),
  stripe: new T.BoxGeometry(0.28, 0.02, 4.0),
  spoilerTop: new T.BoxGeometry(1.8, 0.07, 0.45),
  spoilerLeg: new T.BoxGeometry(0.08, 0.35, 0.1),
  glow: new T.BoxGeometry(1.6, 0.04, 4.0),
  flame: new T.ConeGeometry(0.28, 1.8, 8).rotateX(Math.PI / 2),
  cab: new T.BoxGeometry(2.3, 1.9, 2.3),
  trailer: new T.BoxGeometry(2.3, 2.7, 6.4),
  coin: new T.CylinderGeometry(0.55, 0.55, 0.12, 20).rotateZ(Math.PI / 2)
};
const matCache = new Map();
function lam(color) {
  if (!matCache.has(color)) matCache.set(color, new T.MeshLambertMaterial({ color }));
  return matCache.get(color);
}
const M = {
  glass: new T.MeshLambertMaterial({ color: 0x0f2030 }),
  tire: new T.MeshLambertMaterial({ color: 0x151515 }),
  head: new T.MeshBasicMaterial({ color: 0xfff3b0 }),
  tail: new T.MeshBasicMaterial({ color: 0xff2030 }),
  stripe: new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }),
  glow: new T.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.55 }),
  flame: new T.MeshBasicMaterial({ color: 0xffa000 }),
  trailer: new T.MeshLambertMaterial({ color: 0xcfd8dc }),
  coin: new T.MeshBasicMaterial({ color: 0xffd600 })
};
function add(parent, geo, mat, x, y, z) {
  const m = new T.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m;
}
function carMesh(color, tier = 0) {
  const g = new T.Group(), mat = lam(color);
  add(g, G.body, mat, 0, 0.55, 0);
  add(g, G.cabin, M.glass, 0, 1.07, 0.25);
  for (const sx of [-1, 1]) for (const z of [-1.4, 1.4]) add(g, G.wheel, M.tire, sx * 0.95, 0.38, z);
  add(g, G.head, M.head, -0.55, 0.62, -2.17); add(g, G.head, M.head, 0.55, 0.62, -2.17);
  add(g, G.head, M.tail, -0.55, 0.7, 2.17); add(g, G.head, M.tail, 0.55, 0.7, 2.17);
  if (tier >= 1) {                                   // alerón
    add(g, G.spoilerTop, mat, 0, 1.3, 1.95);
    add(g, G.spoilerLeg, mat, -0.6, 1.1, 1.95); add(g, G.spoilerLeg, mat, 0.6, 1.1, 1.95);
  }
  if (tier >= 2) add(g, G.stripe, M.stripe, 0, 0.84, -0.1);   // franja
  if (tier >= 3) add(g, G.glow, M.glow, 0, 0.12, 0);          // luz neón abajo
  g.userData.flames = [-0.5, 0.5].map((x) => {
    const f = add(g, G.flame, M.flame, x, 0.55, 3.0); f.visible = false; return f;
  });
  return g;
}
function truckMesh(color) {
  const g = new T.Group();
  add(g, G.cab, lam(color), 0, 1.3, -3.4);
  add(g, new T.BoxGeometry(2.0, 0.6, 0.1), M.glass, 0, 1.85, -4.58);
  add(g, G.trailer, M.trailer, 0, 1.9, 1.0);
  for (const sx of [-1, 1]) for (const z of [-3.4, 0.2, 1.6, 2.9]) add(g, G.wheel, M.tire, sx * 1.0, 0.38, z);
  add(g, G.head, M.head, -0.7, 0.9, -4.58); add(g, G.head, M.head, 0.7, 0.9, -4.58);
  add(g, G.head, M.tail, -0.7, 0.9, 4.22); add(g, G.head, M.tail, 0.7, 0.9, 4.22);
  return g;
}

/* ---------------- Decoración a los lados ---------------- */
function windowTexture() {
  const c = document.createElement("canvas"); c.width = 64; c.height = 128;
  const x = c.getContext("2d");
  x.fillStyle = "#1a1e33"; x.fillRect(0, 0, 64, 128);
  for (let j = 0; j < 14; j++) for (let i = 0; i < 6; i++) {
    x.fillStyle = Math.random() < 0.45 ? "#ffd54a" : "#2a3150";
    x.fillRect(4 + i * 10, 4 + j * 9, 6, 5);
  }
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
}
const bldTex = windowTexture();
const D = {
  trunk: new T.CylinderGeometry(0.25, 0.35, 1.5, 6),
  cone: new T.ConeGeometry(1.6, 4.2, 7),
  cactus: new T.CylinderGeometry(0.35, 0.4, 3, 8),
  rock: new T.IcosahedronGeometry(1, 0),
  box: new T.BoxGeometry(1, 1, 1),
  mTrunk: new T.MeshLambertMaterial({ color: 0x5d4037 }),
  mLeaf: new T.MeshLambertMaterial({ color: 0x1b5e20 }),
  mSnow: new T.MeshLambertMaterial({ color: 0xeaf4f8 }),
  mCactus: new T.MeshLambertMaterial({ color: 0x2e7d32 }),
  mRock: new T.MeshLambertMaterial({ color: 0x8d6e63 }),
  mBld: new T.MeshLambertMaterial({ color: 0x80838f, map: bldTex, emissive: 0xffffff, emissiveMap: bldTex, emissiveIntensity: 0.9 })
};
function makeDecor() {
  const g = new T.Group();
  g.userData = {
    trunk: add(g, D.trunk, D.mTrunk, 0, 0.75, 0),
    cone: add(g, D.cone, D.mLeaf, 0, 3.4, 0),
    cactus: add(g, D.cactus, D.mCactus, 0, 1.5, 0),
    rock: add(g, D.rock, D.mRock, 0, 0.5, 0),
    bld: add(g, D.box, D.mBld, 0, 5, 0)
  };
  return g;
}
function setDecorType(item, biomeIdx) {
  const u = item.userData, kind = BIOMES[biomeIdx].deco;
  for (const k of ["trunk", "cone", "cactus", "rock", "bld"]) u[k].visible = false;
  const s = rand(0.8, 1.5);
  if (kind === "pine" || kind === "snow") {
    u.trunk.visible = u.cone.visible = true;
    u.cone.material = kind === "snow" ? D.mSnow : D.mLeaf;
    item.scale.set(s, s, s);
    item.userData.off = rand(2, 14);
  } else if (kind === "desert") {
    if (Math.random() < 0.55) { u.cactus.visible = true; item.scale.set(s, s, s); }
    else { u.rock.visible = true; u.rock.scale.set(1.3, 0.8, 1.1); item.scale.set(s, s, s); }
    item.userData.off = rand(2, 16);
  } else {
    u.bld.visible = true;
    const h = rand(8, 26);
    u.bld.scale.set(rand(6, 9), h, rand(6, 9)); u.bld.position.y = h / 2;
    item.scale.set(1, 1, 1);
    item.userData.off = rand(7, 16);
  }
}
const decor = [];
for (let side = -1; side <= 1; side += 2) {
  for (let i = 0; i < DECOR_N; i++) {
    const it = makeDecor();
    it.userData.side = side;
    it.userData.z = 30 - i * DECOR_STEP + rand(-5, 5);
    setDecorType(it, 0);
    it.position.set(side * (ROAD_HALF + 2 + it.userData.off), 0, it.userData.z);
    scene.add(it); decor.push(it);
  }
}

/* ---------------- Estado ---------------- */
let state = "menu";          // menu | garage | playing | crashing | paused | over
let run = null;
const keys = { l: false, r: false, n: false };
const pad = { l: false, r: false, n: false };
const trafficGroup = new T.Group(), coinGroup = new T.Group(), debrisGroup = new T.Group();
const botGroup = new T.Group();
scene.add(trafficGroup, coinGroup, debrisGroup, botGroup);
let lastMode = "free";

// línea de meta (cuadros) con arco
const finish = (() => {
  const c = document.createElement("canvas"); c.width = 128; c.height = 32;
  const x = c.getContext("2d");
  for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? "#111" : "#fff"; x.fillRect(i * 8, j * 8, 8, 8); }
  const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; tex.magFilter = T.NearestFilter;
  const g = new T.Group(), checker = new T.MeshBasicMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const line = new T.Mesh(new T.PlaneGeometry(ROAD_W, 2.4).rotateX(-Math.PI / 2), checker);
  line.position.y = 0.05; g.add(line);
  const post = new T.MeshLambertMaterial({ color: 0xeeeeee });
  for (const sx of [-1, 1]) add(g, new T.BoxGeometry(0.5, 7.5, 0.5), post, sx * (ROAD_HALF + 0.6), 3.75, 0);
  add(g, new T.BoxGeometry(ROAD_W + 1.7, 1.4, 0.5), checker, 0, 7.6, 0);
  g.visible = false; scene.add(g); return g;
})();
let playerMesh = null;
let camX = 0, shake = 0;
const tmpColor = new T.Color();

function clearGroup(g) { while (g.children.length) g.remove(g.children[0]); }

function makeRun(mode = "free") {
  clearGroup(trafficGroup); clearGroup(coinGroup); clearGroup(debrisGroup); clearGroup(botGroup);
  finish.visible = false;
  if (playerMesh) scene.remove(playerMesh);
  const st = statsOf(save.seleccionado), def = carDef(save.seleccionado);
  playerMesh = carMesh(def.color, carIndex(def.id));
  scene.add(playerMesh);
  const r = {
    st, car: def, speed: CONFIG.velocidadInicial, dist: 0, coins: 0, nitro: st.nitroCap,
    x: 0, xv: 0, traffic: [], coinsArr: [], spawnAcc: 0, nextGap: 40, t: 0, crashT: 0, nitroOn: false, nitroLocked: false,
    biome: 0, debris: [], mode, inv: 0, bots: [], goal: RC.metaMetros
  };
  playerMesh.position.set(0, 0, 0); playerMesh.rotation.set(0, 0, 0);
  camX = 0; shake = 0;
  return r;
}

/* ---------------- Tamaño de pantalla ---------------- */
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Horizontal: la interfaz se escala según el alto. Vertical (respaldo): según el ancho.
  const px = w >= h ? clamp(h / 24, 11, 26) : Math.max(11, 16 * Math.min(w, h * 0.5625) / 360);
  stage.style.fontSize = px + "px";
}
window.addEventListener("resize", resize);

/* ---------------- Mundo ---------------- */
function envUpdate(dt) {
  const b = BIOMES[run ? run.biome : 0];
  const k = Math.min(1, dt * 0.9);
  scene.background.lerp(tmpColor.set(b.sky), k);
  scene.fog.color.copy(scene.background);
  ground.material.color.lerp(tmpColor.set(b.ground), k);
  hemi.intensity += (1.7 * b.light - hemi.intensity) * k;
  sun.intensity += (2.0 * b.light - sun.intensity) * k;
  const rc = roadMat.color; rc.r += (b.road - rc.r) * k; rc.g = rc.b = rc.r;
}

function stepWorld(dt) {
  const r = run, v = r.speed / 3.6;
  r.t += dt;
  roadTex.offset.y = (roadTex.offset.y + v * dt / TILE) % 1;
  r.biome = Math.floor(r.dist / CONFIG.metrosPorAmbiente) % BIOMES.length;
  for (const d of decor) {
    const u = d.userData;
    u.z += v * dt;
    if (u.z > 30) {
      u.z -= DECOR_LEN;
      setDecorType(d, r.biome);
    }
    d.position.set(u.side * (ROAD_HALF + 2 + u.off), 0, u.z);
  }
  for (const t of r.traffic) {
    t.z += (r.speed - t.speed) / 3.6 * dt;
    t.mesh.position.z = t.z;
  }
  for (let i = r.traffic.length - 1; i >= 0; i--) {
    if (r.traffic[i].z > (r.mode === "race" ? TRAF_BEHIND : 30) || r.traffic[i].z < -SPAWN - 80) { trafficGroup.remove(r.traffic[i].mesh); r.traffic.splice(i, 1); }
  }
  for (const c of r.coinsArr) {
    c.z += v * dt; c.mesh.position.z = c.z; c.mesh.rotation.y = r.t * 4 + c.p;
  }
  for (let i = r.coinsArr.length - 1; i >= 0; i--) {
    if (r.coinsArr[i].z > 14 || r.coinsArr[i].dead) { coinGroup.remove(r.coinsArr[i].mesh); r.coinsArr.splice(i, 1); }
  }
}

function spawnRow(zStart = -SPAWN) {
  const Tf = CONFIG.trafico, r = run;
  const lanes = [...Array(LANES).keys()].sort(() => Math.random() - 0.5);
  const pDouble = Math.min(Tf.probDobleInicial + r.dist / 20000, Tf.probDobleMax);
  const n = Math.random() < pDouble ? 2 : 1;
  const colors = [0x43a047, 0xfb8c00, 0x00acc1, 0xd81b60, 0x6d4c41, 0x546e7a, 0xc0ca33, 0x7e57c2];
  for (let i = 0; i < n; i++) {
    const lane = lanes[i];
    const truck = Math.random() < Tf.probCamion;
    let sp = rand(Tf.velMin, Tf.velMax) * (truck ? 0.8 : 1);
    // un auto nuevo nunca alcanza al que va delante en su carril
    for (const o of r.traffic) if (o.lane === lane) sp = Math.max(sp, o.speed);
    const color = colors[(Math.random() * colors.length) | 0];
    const mesh = truck ? truckMesh(color) : carMesh(color, 0);
    mesh.position.set(laneX(lane), 0, zStart);
    trafficGroup.add(mesh);
    r.traffic.push({ lane, x: laneX(lane), z: zStart, speed: sp, len: truck ? 9.2 : PL, wid: truck ? 2.3 : PW, mesh });
  }
  // monedas en un carril libre de la fila
  if (Math.random() < 0.75 && LANES > n) {
    const lane = lanes[n + ((Math.random() * (LANES - n)) | 0)];
    const cnt = 3 + ((Math.random() * 3) | 0);
    for (let i = 0; i < cnt; i++) {
      const mesh = new T.Mesh(G.coin, M.coin);
      mesh.position.set(laneX(lane), 1.1, zStart - i * 5);
      coinGroup.add(mesh);
      r.coinsArr.push({ x: laneX(lane), z: zStart - i * 5, lane, p: Math.random() * 6, mesh });
    }
  }
  r.nextGap = Tf.separacionBase + r.speed * Tf.separacionPorVel + rand(0, 16);
}

function spawnTick(dt) {
  const r = run;
  r.spawnAcc += (r.speed / 3.6) * dt;
  if (r.spawnAcc >= r.nextGap) { r.spawnAcc = 0; spawnRow(); }
}

function updatePlay(dt) {
  const r = run, st = r.st;
  if (r.inv > 0) r.inv = Math.max(0, r.inv - dt);
  // Nitro: al vaciarse se BLOQUEA. Para volver a usarlo hay que soltar el botón
  // y esperar a que se recargue un mínimo (antes, al mantenerlo apretado se
  // recargaba un poquito y se volvía a encender solo, como si fuera infinito).
  const nitroPressed = pad.n || keys.n;
  if (r.nitroLocked && !nitroPressed && r.nitro >= st.nitroCap * CONFIG.nitroMinimo) r.nitroLocked = false;
  const nitroOn = nitroPressed && !r.nitroLocked && r.nitro > 0;
  r.nitroOn = nitroOn;
  if (nitroOn) {
    r.nitro = Math.max(0, r.nitro - CONFIG.nitroConsumo * dt);
    if (r.nitro <= 0) { r.nitroOn = false; r.nitroLocked = true; }
  } else r.nitro = Math.min(st.nitroCap, r.nitro + CONFIG.nitroRegen * dt);
  $("nitroBar").classList.toggle("empty", !!r.nitroLocked);
  $("btnNitro").classList.toggle("locked", !!r.nitroLocked);
  // velocidad
  const target = st.vmax * (r.nitroOn ? st.nitroPower : 1);
  const acc = st.accel * (r.nitroOn ? 2.2 : 1);
  if (r.speed < target) r.speed = Math.min(target, r.speed + acc * dt);
  else r.speed = Math.max(target, r.speed - 70 * dt);
  r.dist += (r.speed / 3.6) * dt;
  // giro lateral con las flechas
  const steer = ((pad.r || keys.r) ? 1 : 0) - ((pad.l || keys.l) ? 1 : 0);
  const maxLat = CONFIG.velocidadLateral * st.handling;
  r.xv += (steer * maxLat - r.xv) * Math.min(1, dt * 10);
  r.x += r.xv * dt;
  const lim = ROAD_HALF - 1.0;
  if (r.x > lim) { r.x = lim; r.xv = 0; } else if (r.x < -lim) { r.x = -lim; r.xv = 0; }

  stepWorld(dt);
  spawnTick(dt);
  if (r.mode === "race") updateBots(dt);

  // monedas
  for (const c of r.coinsArr) {
    for (const t of r.traffic) {
      if (t.lane === c.lane && Math.abs(t.z - c.z) < t.len / 2 + 1) { c.dead = true; break; }
    }
    if (!c.dead && Math.abs(c.x - r.x) < 1.5 && Math.abs(c.z) < 2.4) {
      c.dead = true; r.coins++;
      beep(900, 0.09, "square", 0.1, 1400);
    }
  }

  // colisiones (no hay mientras parpadeas tras reaparecer)
  if (r.inv <= 0) {
    for (const t of r.traffic) {
      if (Math.abs(t.x - r.x) < (t.wid + PW) / 2 * 0.86 && Math.abs(t.z) < (t.len + PL) / 2 * 0.92) { crash(); return; }
    }
  }
  if (r.mode === "race" && r.dist >= r.goal) { startFinish(); return; }

  setEngine(r.speed / (st.vmax * st.nitroPower), true);
  updateHud();
}

function burst(x, z, fixed) {
  const colors = [0xff9100, 0xffee58, 0xffffff, 0xff5252];
  for (let i = 0; i < 26; i++) {
    const m = new T.Mesh(G.head, new T.MeshBasicMaterial({ color: colors[(Math.random() * 4) | 0] }));
    m.scale.setScalar(rand(1, 3));
    m.position.set(x, 0.8, z);
    debrisGroup.add(m);
    run.debris.push({ m, vx: rand(-9, 9), vy: rand(3, 10), vz: rand(-14, 6), life: 1.6, fixed });
  }
}
function updateDebris(dt) {
  const r = run;
  for (let i = r.debris.length - 1; i >= 0; i--) {
    const d = r.debris[i];
    d.life -= dt; d.vy -= 22 * dt;
    d.m.position.x += d.vx * dt; d.m.position.y = Math.max(0.05, d.m.position.y + d.vy * dt);
    d.m.position.z += d.vz * dt + (d.fixed ? r.speed / 3.6 * dt : 0);   // fixed: se queda en la carretera
    if (d.life <= 0) { debrisGroup.remove(d.m); r.debris.splice(i, 1); }
  }
}

function crash() {
  state = "crashing";
  run.crashT = 1.1; run.nitroOn = false; shake = 1;
  pad.n = pad.l = pad.r = false;
  for (const id of ["btnNitro", "btnLeft", "btnRight"]) $(id).classList.remove("on", "locked");
  $("nitroBar").classList.remove("empty");
  burst(run.x, 0, false);
  crashSound(); setEngine(0, false);
  if (navigator.vibrate) try { navigator.vibrate(200); } catch (e) {}
}

function updateCrash(dt) {
  const r = run, race = r.mode === "race";
  r.crashT -= dt; shake = Math.max(0, shake - dt * 1.4);
  r.speed = Math.max(0, r.speed - (race ? 900 : 330) * dt);   // en carrera frena casi en seco: reapareces en el mismo lugar
  if (race) r.dist += (r.speed / 3.6) * dt;
  stepWorld(dt);
  if (race) { spawnTick(dt); updateBots(dt); updateHud(); }
  playerMesh.rotation.y += 9 * dt;
  playerMesh.position.y = Math.max(0, Math.sin((1.1 - r.crashT) * 5) * 1.2);
  if (r.crashT <= 0) { if (race) respawnPlayer(); else gameOver(); }
}

// saca los vehículos de tráfico que quedarían encima de alguien que reaparece
function clearAround(z, x) {
  const r = run;
  for (let i = r.traffic.length - 1; i >= 0; i--) {
    const t = r.traffic[i];
    if (Math.abs(t.x - x) < (t.wid + PW) / 2 + 0.8 && Math.abs(t.z - z) < (t.len + PL) / 2 + 6) {
      trafficGroup.remove(t.mesh); r.traffic.splice(i, 1);
    }
  }
}

function respawnPlayer() {
  const r = run;
  r.speed = RC.velSalida; r.xv = 0; r.inv = RC.invulnerable; r.nitroOn = false; shake = 0;
  playerMesh.rotation.set(0, 0, 0); playerMesh.position.y = 0;
  clearAround(0, r.x);                       // reapareces en el MISMO lugar y carril donde chocaste
  state = "playing";
}

/* ---------------- Modo carrera: bots ---------------- */
function setupRace(r) {
  const lanes = [...Array(LANES).keys()].sort(() => Math.random() - 0.5);
  r.x = laneX(lanes[0]);
  r.speed = 0; r.countdown = RC.cuentaRegresiva; r.go = false;
  RC.rivales.slice(0, LANES - 1).forEach((d, i) => {
    const lane = lanes[i + 1], f = d.nivel;
    const mesh = carMesh(d.color, (i + 1) % 4);
    botGroup.add(mesh);
    r.bots.push({
      name: d.nombre, color: d.color, err: d.error, mesh,
      vmax: r.st.vmax * f, accel: r.st.accel * (0.85 + 0.15 * f), power: r.st.nitroPower, cap: r.st.nitroCap,
      lat: CONFIG.velocidadLateral * Math.max(0.9, r.st.handling * 0.95),
      dist: 0, x: laneX(lane), xv: 0, lane, speed: 0, nitro: r.st.nitroCap, nitroLocked: false, nitroOn: false,
      state: "run", t: 0, inv: 0, threat: null, brake: 0, wander: rand(2, 5), finished: false
    });
  });
}

// Mira un carril: ¿qué tan libre está por delante? ¿hay un carro al lado (bloqueado)? ¿hay peligro?
function laneScan(b, lane, obs) {
  const x = laneX(lane);
  let free = Infinity, blocked = false, danger = null, dGap = Infinity;
  for (const o of obs) {
    if (o.self === b) continue;
    if (Math.abs(o.x - x) >= (o.wid + PW) / 2 + 0.3) continue;
    const half = (o.len + PL) / 2, d = o.s - b.dist;
    if (Math.abs(d) < half + 1.5) { blocked = true; free = 0; continue; }   // alguien justo al lado
    if (d < 0) continue;
    const gap = d - half, closing = (b.speed - o.v) / 3.6;
    free = Math.min(free, closing > 0 ? gap : gap + 80);
    if (closing > 0 && gap < closing + 14 && gap < dGap) { danger = o; dGap = gap; }   // ~1 s de reacción
  }
  return { free, blocked, danger };
}

function updateBots(dt) {
  const r = run, obs = [];
  for (const t of r.traffic) obs.push({ s: r.dist - t.z, x: t.x, v: t.speed, len: t.len, wid: t.wid });
  obs.push({ s: r.dist, x: r.x, v: r.speed, len: PL, wid: PW });   // los bots también esquivan al jugador
  for (const b of r.bots) if (b.state === "run") obs.push({ s: b.dist, x: b.x, v: b.speed, len: PL, wid: PW, self: b });
  for (const b of r.bots) botStep(b, dt, obs);
  syncBots();
}

function botStep(b, dt, obs) {
  const r = run;
  if (b.state === "crash") {
    b.t -= dt; b.speed = Math.max(0, b.speed - 900 * dt);
    b.dist += b.speed / 3.6 * dt;
    if (b.t <= 0) botRespawn(b);
    return;
  }
  if (b.inv > 0) b.inv -= dt;

  // --- decisión: esquivar, frenar o adelantar
  const cur = laneScan(b, b.lane, obs);
  b.brake = 0;
  if (cur.danger) {
    if (!b.threat || b.threat.o !== cur.danger) b.threat = { o: cur.danger, ignore: Math.random() < b.err };   // a veces no lo ve
    if (!b.threat.ignore) {
      let pick = -1;
      for (const k of [1, 2]) {
        let best = -1, bf = -1;
        for (const L of [b.lane - k, b.lane + k]) {
          if (L < 0 || L >= LANES) continue;
          const sc = laneScan(b, L, obs);
          if (sc.blocked || sc.danger) continue;
          if (k === 2 && laneScan(b, (L + b.lane) / 2, obs).blocked) continue;
          if (sc.free > bf) { bf = sc.free; best = L; }
        }
        if (best >= 0) { pick = best; break; }
      }
      if (pick >= 0) b.lane = pick;
      else b.brake = Math.max(30, cur.danger.v - 8);          // no hay carril libre: frena
    }
  } else {
    b.threat = null;
    b.wander -= dt;
    if (b.wander <= 0) {                                     // de vez en cuando busca un carril más libre
      b.wander = rand(2.5, 6);
      if (cur.free < 140) for (const L of [b.lane - 1, b.lane + 1]) {
        if (L < 0 || L >= LANES) continue;
        const sc = laneScan(b, L, obs);
        if (!sc.blocked && !sc.danger && sc.free > cur.free + 40) { b.lane = L; break; }
      }
    }
  }

  // --- nitro (con el mismo bloqueo al vaciarse que tú)
  if (b.nitroLocked && b.nitro >= b.cap * 0.5) b.nitroLocked = false;
  b.nitroOn = cur.free > 140 && !cur.danger && !b.nitroLocked && b.nitro > 0;
  if (b.nitroOn) {
    b.nitro = Math.max(0, b.nitro - CONFIG.nitroConsumo * dt);
    if (b.nitro <= 0) { b.nitroOn = false; b.nitroLocked = true; }
  } else b.nitro = Math.min(b.cap, b.nitro + CONFIG.nitroRegen * dt);

  // --- velocidad (con "banda elástica" para que siempre estén cerca de ti)
  let target = b.vmax * (b.nitroOn ? b.power : 1);
  if (b.brake) target = Math.min(target, b.brake);
  const ahead = b.dist - r.dist;
  if (ahead > RC.ventajaMax) target *= 0.8;
  else if (ahead > RC.ventajaMax * 0.65) target *= 0.94;
  else if (ahead < -RC.retrasoMax) target *= 1.15;
  const acc = b.accel * (b.nitroOn ? 2.2 : 1);
  if (b.speed < target) b.speed = Math.min(target, b.speed + acc * dt);
  else b.speed = Math.max(target, b.speed - 90 * dt);

  // --- movimiento
  b.xv += (clamp((laneX(b.lane) - b.x) * 6, -b.lat, b.lat) - b.xv) * Math.min(1, dt * 10);
  b.x += b.xv * dt;
  b.dist += b.speed / 3.6 * dt;
  if (!b.finished && b.dist >= r.goal) b.finished = true;

  // --- choque con el tráfico
  if (b.inv <= 0) {
    const bz = r.dist - b.dist;
    for (const t of r.traffic) {
      if (Math.abs(t.x - b.x) < (t.wid + PW) / 2 * 0.86 && Math.abs(t.z - bz) < (t.len + PL) / 2 * 0.92) { botCrash(b, bz); break; }
    }
  }
}

function botCrash(b, bz) {
  b.state = "crash"; b.t = 1.1; b.nitroOn = false; b.threat = null;
  burst(b.x, bz, true);
  toast(`<span style="color:${b.color}">●</span> ${b.name} chocó`, 1500);
}
function botRespawn(b) {
  const r = run, bz = r.dist - b.dist;
  b.state = "run"; b.speed = RC.velSalida; b.inv = RC.invulnerable; b.xv = 0;
  b.lane = clamp(Math.round(b.x / LANE_W + (LANES - 1) / 2), 0, LANES - 1);   // reaparece en el mismo lado donde chocó
  clearAround(bz, b.x);
}

function syncBots() {
  const r = run;
  for (const b of r.bots) {
    const m = b.mesh;
    m.position.x = b.x; m.position.z = r.dist - b.dist;
    if (b.state === "crash") {
      m.rotation.y = (1.1 - b.t) * 9; m.position.y = Math.max(0, Math.sin((1.1 - b.t) * 5) * 1.2);
    } else {
      m.rotation.y = -clamp(b.xv / 12, -1, 1) * 0.22; m.position.y = 0;
    }
    m.visible = b.inv > 0 ? Math.floor(r.t * 12) % 2 === 0 : true;      // parpadea mientras es invulnerable
    for (const f of m.userData.flames) { f.visible = b.nitroOn; if (b.nitroOn) f.scale.set(1, 1, 0.7 + Math.random() * 0.9); }
  }
}

/* ---------------- Modo carrera: cuenta regresiva y meta ---------------- */
function updateCountdown(dt) {
  const r = run, el = $("countdown");
  r.countdown -= dt;
  el.classList.remove("hidden");
  if (r.countdown > 0) {
    const n = Math.ceil(r.countdown);
    if (el.textContent !== String(n)) { el.textContent = n; beep(520, 0.12, "square", 0.12); }
  } else {
    el.textContent = "¡YA!"; beep(900, 0.3, "square", 0.14, 1500);
    setTimeout(() => el.classList.add("hidden"), 800);
    r.speed = RC.velSalida;
    for (const b of r.bots) b.speed = RC.velSalida;
    state = "playing";
  }
  syncBots();
}

function startFinish() {
  const r = run;
  r.place = 1 + r.bots.filter((b) => b.finished).length;        // los bots que ya cruzaron la meta llegaron antes
  r.fin = 1.6; r.nitroOn = false;
  pad.n = pad.l = pad.r = false;
  for (const id of ["btnNitro", "btnLeft", "btnRight"]) $(id).classList.remove("on", "locked");
  state = "finishing"; setEngine(0, false);
  toast("🏁 ¡META!", 1800); beep(700, 0.4, "triangle", 0.15, 1400);
}
function updateFinish(dt) {
  const r = run;
  r.fin -= dt;
  r.speed = Math.max(0, r.speed - 60 * dt);
  r.dist += (r.speed / 3.6) * dt; r.xv = 0;
  stepWorld(dt); spawnTick(dt); updateBots(dt); updateHud();
  if (r.fin <= 0) raceOver();
}
function raceOver() {
  const r = run, place = r.place;
  const prize = RC.premios[place - 1] || 0;
  const earned = r.coins * CONFIG.valorMoneda + Math.floor(r.goal / 100) * CONFIG.dineroPorBloque + prize;
  save.dinero += earned; persist();
  $("oTitle").textContent = place === 1 ? "🏆 ¡GANASTE!" : "🏁 META";
  $("oPlaceRow").classList.remove("hidden");
  $("oPlace").textContent = place + "º de " + (r.bots.length + 1);
  $("oDist").textContent = fmt(r.goal) + " m";
  $("oCoins").textContent = r.coins;
  $("oEarn").textContent = "+" + fmt(earned);
  $("oTotal").textContent = fmt(save.dinero);
  $("overRecord").classList.add("hidden");
  state = "over"; showScreen("over");
}

let toastTimer = 0;
function toast(html, ms = 1800) {
  const t = $("toast"); t.innerHTML = html; t.classList.remove("hidden");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add("hidden"), ms);
}

/* ---------------- Cámara ---------------- */
function updateCamera(dt) {
  const r = run, px = r ? r.x : 0;
  const vmaxRef = r ? r.st.vmax * r.st.nitroPower : 300;
  const kick = r ? clamp(r.speed / vmaxRef, 0, 1) : 0.3;
  const nit = r && r.nitroOn ? 5 : 0;
  const land = camera.aspect >= 1;
  if (land) {
    // horizontal: se fija el campo de visión vertical
    camera.fov = 50 + kick * 8 + nit;
  } else {
    const hf = (54 + kick * 10 + nit) * Math.PI / 180;
    camera.fov = clamp(2 * Math.atan(Math.tan(hf / 2) / camera.aspect) * 180 / Math.PI, 45, 100);
  }
  camera.updateProjectionMatrix();
  camX += (px * 0.55 - camX) * Math.min(1, dt * 6);
  const s = shake * 0.6 + (r && r.nitroOn ? 0.05 : 0);
  const camY = land ? 5.2 : 6.4, camZ = land ? 10.5 : 12.5;
  camera.position.set(camX + rand(-1, 1) * s, camY + rand(-1, 1) * s * 0.5, camZ);
  camera.lookAt(px * 0.45, land ? -0.2 : -1.2, land ? -11 : -8);
}

function updatePlayerMesh() {
  if (!run || !playerMesh) return;
  if (state === "playing" || state === "menu" || state === "garage" || state === "countdown" || state === "finishing") {
    playerMesh.position.x = run.x;
    playerMesh.rotation.y = -clamp(run.xv / 12, -1, 1) * 0.22;
    const on = state === "playing" && run.nitroOn;
    for (const f of playerMesh.userData.flames) {
      f.visible = on;
      if (on) f.scale.set(1, 1, 0.7 + Math.random() * 0.9);
    }
    playerMesh.visible = run.inv > 0 ? Math.floor(run.t * 12) % 2 === 0 : true;   // parpadea tras reaparecer
  }
}

/* ---------------- HUD ---------------- */
function updateHud() {
  const r = run;
  $("hudSpeed").textContent = Math.round(r.speed);
  $("hudDist").textContent = Math.floor(r.dist);
  $("hudCoins").textContent = r.coins;
  $("nitroBar").style.width = (r.nitro / r.st.nitroCap * 100) + "%";
  if (r.mode === "race" && r.dots) {
    $("hudPos").textContent = r.bots.filter((b) => b.dist > r.dist).length + 1;
    r.bots.forEach((b, i) => { r.dots[i].style.left = clamp(b.dist / r.goal, 0, 1) * 100 + "%"; });
    r.meDot.style.left = clamp(r.dist / r.goal, 0, 1) * 100 + "%";
  }
}
function setupRaceHud() {
  const r = run, on = r.mode === "race", tr = $("raceTrack");
  $("hudPosBox").classList.toggle("hidden", !on); tr.classList.toggle("hidden", !on);
  $("countdown").classList.add("hidden"); $("toast").classList.add("hidden");
  tr.innerHTML = "";
  if (!on) return;
  tr.innerHTML = '<i class="flag">🏁</i>';
  r.dots = r.bots.map((b) => { const d = document.createElement("i"); d.className = "dot"; d.style.background = b.color; tr.appendChild(d); return d; });
  r.meDot = document.createElement("i"); r.meDot.className = "dot me"; tr.appendChild(r.meDot);
  $("hudN").textContent = r.bots.length + 1;
}

/* ---------------- Pantallas ---------------- */
function showScreen(name) {
  for (const id of ["menu", "garage", "pause", "over"]) $(id).classList.toggle("hidden", id !== name);
  $("hud").classList.toggle("hidden", name !== "hud");
}
function soundLabel() {
  const t = save.sonido ? "🔊 Sonido: Sí" : "🔇 Sonido: No";
  $("btnSound").textContent = t; $("btnSound2").textContent = t;
}
function showMenu() {
  run = makeRun(); run.speed = 110;
  pad.n = pad.l = pad.r = false;
  state = "menu";
  $("mMoney").textContent = fmt(save.dinero);
  $("mBest").textContent = fmt(save.mejor);
  soundLabel(); showScreen("menu"); setEngine(0, false);
}
function startRun(mode = "free") {
  audioInit(); lastMode = mode;
  run = makeRun(mode);
  pad.n = pad.l = pad.r = false;
  if (mode === "race") setupRace(run);
  for (let z = mode === "race" ? -100 : -70; z > -SPAWN; z -= 55) spawnRow(z);   // tráfico ya presente al arrancar
  state = mode === "race" ? "countdown" : "playing";
  showScreen("hud"); setupRaceHud(); updateHud();
}
function gameOver() {
  const r = run;
  const earned = r.coins * CONFIG.valorMoneda + Math.floor(r.dist / 100) * CONFIG.dineroPorBloque;
  const dist = Math.floor(r.dist);
  const record = dist > save.mejor;
  save.dinero += earned;
  if (record) save.mejor = dist;
  persist();
  $("oTitle").textContent = "¡CHOCASTE!"; $("oPlaceRow").classList.add("hidden");
  $("oDist").textContent = fmt(dist) + " m";
  $("oCoins").textContent = r.coins;
  $("oEarn").textContent = "+" + fmt(earned);
  $("oTotal").textContent = fmt(save.dinero);
  $("overRecord").classList.toggle("hidden", !record);
  state = "over"; showScreen("over");
}
function pauseGame() {
  if (state !== "playing") return;
  state = "paused"; pad.n = pad.l = pad.r = false;
  for (const id of ["btnNitro", "btnLeft", "btnRight"]) $(id).classList.remove("on");
  setEngine(0, false); soundLabel(); showScreen("pause");
}
function resumeGame() { if (state === "paused") { state = "playing"; showScreen("hud"); } }

/* ---------------- Garaje (vista previa 3D) ---------------- */
let gIdx = 0;
const LIM = (() => {
  const Mj = CONFIG.mejoras, A = CONFIG.autos;
  return {
    v: Math.max(...A.map((a) => a.velMax)) + Mj.motor.max * Mj.motor.velPorNivel,
    a: Math.max(...A.map((a) => a.aceleracion)) + Mj.motor.max * Mj.motor.accelPorNivel,
    h: Math.max(...A.map((a) => a.agarre)) + Mj.llantas.max * Mj.llantas.agarrePorNivel,
    n: CONFIG.nitroBase + Mj.nitro.max * Mj.nitro.potenciaPorNivel
  };
})();
const prev = { r: null, scene: null, cam: null, car: null };
function initPreview() {
  try {
    const r = new T.WebGLRenderer({ canvas: $("preview"), alpha: true, antialias: true });
    r.setPixelRatio(2); r.setSize(120, 150, false);
    const sc = new T.Scene();
    sc.add(new T.HemisphereLight(0xffffff, 0x445566, 1.8));
    const dl = new T.DirectionalLight(0xffffff, 2.2); dl.position.set(4, 8, 6); sc.add(dl);
    const cam = new T.PerspectiveCamera(32, 120 / 150, 0.1, 50);
    cam.position.set(0, 4.6, 9.2); cam.lookAt(0, 0.6, 0);
    prev.r = r; prev.scene = sc; prev.cam = cam;
  } catch (e) { prev.r = null; }
}
function setPreviewCar(c) {
  if (!prev.r) return;
  if (prev.car) prev.scene.remove(prev.car);
  prev.car = carMesh(c.color, carIndex(c.id));
  prev.scene.add(prev.car);
}
function openGarage() {
  gIdx = carIndex(save.seleccionado);
  state = "garage"; showScreen("garage"); renderGarage();
}
function renderGarage() {
  const c = CONFIG.autos[gIdx], owned = !!save.autos[c.id];
  const u = upgradesOf(c.id), st = statsOf(c.id);
  $("gMoney").textContent = fmt(save.dinero);
  $("gName").textContent = c.nombre;
  $("sbV").style.width = (st.vmax / LIM.v * 100) + "%"; $("svV").textContent = Math.round(st.vmax);
  $("sbA").style.width = (st.accel / LIM.a * 100) + "%"; $("svA").textContent = Math.round(st.accel);
  $("sbH").style.width = (st.handling / LIM.h * 100) + "%"; $("svH").textContent = st.handling.toFixed(2);
  $("sbN").style.width = (st.nitroPower / LIM.n * 100) + "%"; $("svN").textContent = "x" + st.nitroPower.toFixed(2);
  setPreviewCar(c);

  const main = $("gMain");
  if (!owned) {
    main.textContent = "Comprar · 💰 " + fmt(c.precio);
    main.disabled = save.dinero < c.precio;
  } else if (save.seleccionado === c.id) {
    main.textContent = "✔ Seleccionado"; main.disabled = true;
  } else {
    main.textContent = "Seleccionar"; main.disabled = false;
  }

  let html = "";
  for (const key of Object.keys(CONFIG.mejoras)) {
    const m = CONFIG.mejoras[key], lvl = u[key];
    let btn;
    if (!owned) btn = `<button class="btn" disabled>🔒</button>`;
    else if (lvl >= m.max) btn = `<button class="btn" disabled>MAX</button>`;
    else {
      const cost = upgradeCost(key, lvl);
      btn = `<button class="btn" data-act="up" data-key="${key}" ${save.dinero < cost ? "disabled" : ""}>💰 ${fmt(cost)}</button>`;
    }
    let pips = "";
    for (let i = 0; i < m.max; i++) pips += `<i class="${i < lvl ? "f" : ""}"></i>`;
    html += `<div class="up"><div><div class="t">${m.icono} ${m.nombre} <small>Nv ${lvl}/${m.max}</small></div>` +
            `<div class="i">${m.info}</div><div class="pips">${pips}</div></div>${btn}</div>`;
  }
  $("gUps").innerHTML = html;
}
function garageMain() {
  const c = CONFIG.autos[gIdx];
  if (!save.autos[c.id]) {
    if (save.dinero < c.precio) return;
    save.dinero -= c.precio; save.autos[c.id] = true; save.seleccionado = c.id;
    beep(600, 0.15, "triangle", 0.15, 1200);
  } else save.seleccionado = c.id;
  persist(); renderGarage();
}
function garageUp(key) {
  const c = CONFIG.autos[gIdx];
  if (!save.autos[c.id]) return;
  const u = upgradesOf(c.id), m = CONFIG.mejoras[key];
  if (u[key] >= m.max) return;
  const cost = upgradeCost(key, u[key]);
  if (save.dinero < cost) return;
  save.dinero -= cost; u[key]++;
  beep(500, 0.12, "triangle", 0.15, 900);
  persist(); renderGarage();
}

/* ---------------- Controles ---------------- */
// Botones en pantalla: se mantienen presionados (admite varios dedos a la vez)
function hold(el, key) {
  const on = (e) => {
    pad[key] = true; el.classList.add("on"); audioInit();
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  };
  const off = () => { pad[key] = false; el.classList.remove("on"); };
  el.addEventListener("pointerdown", on);
  el.addEventListener("pointerup", off);
  el.addEventListener("pointercancel", off);
  el.addEventListener("lostpointercapture", off);
  el.addEventListener("contextmenu", (e) => e.preventDefault());
}
hold($("btnLeft"), "l"); hold($("btnRight"), "r"); hold($("btnNitro"), "n");
$("btnPause").addEventListener("click", pauseGame);

// Teclado (para probar en PC): ← → o A D para girar, Espacio = nitro, Esc = pausa
const KEYMAP = { ArrowLeft: "l", a: "l", A: "l", ArrowRight: "r", d: "r", D: "r", " ": "n", ArrowUp: "n", w: "n", W: "n", Shift: "n" };
window.addEventListener("keydown", (e) => {
  const k = KEYMAP[e.key];
  if (k) { keys[k] = true; e.preventDefault(); return; }
  if (e.key === "Escape" || e.key === "p" || e.key === "P") { state === "playing" ? pauseGame() : resumeGame(); }
});
window.addEventListener("keyup", (e) => { const k = KEYMAP[e.key]; if (k) keys[k] = false; });
document.addEventListener("visibilitychange", () => { if (document.hidden) pauseGame(); });

stage.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (!b || b.disabled) return;
  audioInit();
  switch (b.dataset.act) {
    case "play": startRun("free"); break;
    case "race": startRun("race"); break;
    case "again": startRun(lastMode); break;
    case "garage": openGarage(); break;
    case "back": case "menu": showMenu(); break;
    case "resume": resumeGame(); break;
    case "sound":
      save.sonido = !save.sonido; persist(); soundLabel();
      if (save.sonido) beep(700, 0.1, "square", 0.1);
      break;
    case "prev": gIdx = (gIdx + CONFIG.autos.length - 1) % CONFIG.autos.length; renderGarage(); break;
    case "next": gIdx = (gIdx + 1) % CONFIG.autos.length; renderGarage(); break;
    case "main": garageMain(); break;
    case "up": garageUp(b.dataset.key); break;
  }
});

/* ---------------- Bucle principal ---------------- */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (run) {
    if (state === "playing") updatePlay(dt);
    else if (state === "crashing") updateCrash(dt);
    else if (state === "countdown") updateCountdown(dt);
    else if (state === "finishing") updateFinish(dt);
    else if (state === "menu" || state === "garage") stepWorld(dt);
    if (state !== "paused") updateDebris(dt);   // los pedazos del choque desaparecen solos
    updatePlayerMesh();
    if (run.mode === "race") {                       // línea de meta
      const z = run.dist - run.goal;
      finish.visible = z > -SPAWN - 60 && z < 40; finish.position.z = z;
    }
    envUpdate(dt);
    updateCamera(dt);
  }
  renderer.render(scene, camera);
  if (state === "garage" && prev.r && prev.car) {
    prev.car.rotation.y += dt * 0.9;
    prev.r.render(prev.scene, prev.cam);
  }
  requestAnimationFrame(frame);
}

initPreview();
resize();
showMenu();
requestAnimationFrame(frame);

// Apoyo para pruebas/depuración desde la consola del navegador
window.TurboRush = {
  get state() { return state; }, get run() { return run; }, save: () => save,
  input: { pad, keys }, LANE_W, ROAD_HALF,
  dbg: { road, roadMat, roadTex, camera, ground, scene },
  dbg: { scene, camera, road, roadMat, roadTex, ground }
};
})();
