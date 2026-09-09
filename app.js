import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import './model.js';

const M = window.CommunityModel;
const $ = s => document.querySelector(s);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const cityCoords = [
  [-72, 0, -46], [72, 0, -52], [-78, 0, 48], [78, 0, 45], [0, 0, 2]
];
const scenarioIds = Object.keys(M.scenarios);
const labels = { hubShare: '거점 인구비중', service: '서비스 접근', mobility: '이동부담', energy: '에너지부담', choice: '청년 선택기회', visits: '교류 방문', opportunity: '지역 기회' };

let selectedScenario = 'network';
let inputs = { ...M.scenarios.network.inputs };
let year = 10, selectedCity = 4, selectedFamily = 0, selectedCar = 0;
let result = M.simulate(inputs, 20, 42);
let playTimer = null, custom = false, followFlight = false;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const state3d = {
  renderer: null, scene: null, camera: null, controls: null, clock: new THREE.Clock(),
  cities: [], routes: [], cars: [], terrain: null, mode: 'overview', lastSnapshot: null
};

function visualCity(c, i, p = inputs) {
  const hub = i === 4;
  const budget = hub ? p.hubBudget : (100 - p.hubBudget) / 4;
  const localBoost = c.opportunity + c.service + p.remote * (hub ? 0.25 : 0.8) - p.platform * (hub ? 0.1 : 0.45);
  const facilityNeed = 8 + c.population / 5200 + c.service / 9 + c.visits / 18 + budget / 8;
  const jobNeed = 3 + c.opportunity / 15 + (hub ? p.hubBudget / 7 : (100 - p.hubBudget) / 28);
  const housingNeed = 8 + c.population / (hub ? 4200 : 5000) + c.pressure / 14;
  const ownerShare = clamp(p.platform / 100 * (hub ? 0.75 : 0.55) + (hub ? p.hubBudget / 250 : 0), 0.05, 0.92);
  const externalOpen = clamp((p.cooperation + p.trade - p.travel * 0.35) / 140, 0, 1);
  const serviceIndex = clamp((c.visits + c.service + p.clean - p.travel * 0.4) / 220, 0.08, 1);
  const routeWeight = clamp((c.visits + c.opportunity + p.cooperation * 0.5 + p.trade * 0.35 - p.travel * 0.42) / 180, 0.04, 1);
  const peerWeight = clamp((localBoost + p.cooperation + p.remote - p.platform * 0.65) / 230, 0.02, 1);
  return { facilityNeed, jobNeed, housingNeed, ownerShare, externalOpen, serviceIndex, routeWeight, peerWeight };
}

function makeMat(color) {
  return new THREE.MeshStandardMaterial({ color });
}
const mats = {
  grass: makeMat(0x71b27c), island: makeMat(0x9ed39c), water: makeMat(0x9dd8ed),
  navy: makeMat(0x123653), white: makeMat(0xf7fbff), glass: makeMat(0xaed0df),
  clinic: makeMat(0xf0f7f8), school: makeMat(0xf4d36b), arena: makeMat(0x244f73),
  housing: makeMat(0xffffff), office: makeMat(0x9fc0d4), platform: makeMat(0x265782),
  car: makeMat(0xfff3a1), route: new THREE.LineBasicMaterial({ color: 0x316a85 }),
  peerRoute: new THREE.LineBasicMaterial({ color: 0x6aa17a }), externalRoute: new THREE.LineBasicMaterial({ color: 0x7ca7c9 })
};

function addMesh(parent, geometry, material, position, scale, name, userData = {}) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.name = name;
  mesh.userData = userData;
  parent.add(mesh);
  return mesh;
}

function init3d() {
  const wrap = $('#scene-wrap');
  try {
    state3d.scene = new THREE.Scene();
    state3d.scene.background = new THREE.Color(0xc8eef8);
    state3d.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    state3d.camera.userData.zoom = 0.8;
    state3d.renderer = new THREE.WebGLRenderer({ antialias: true });
    state3d.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
    wrap.appendChild(state3d.renderer.domElement);
    state3d.controls = new OrbitControls(state3d.camera, state3d.renderer.domElement);
  } catch (err) {
    $('#webgl-error').hidden = false;
    $('#webgl-error').textContent = 'WebGL을 사용할 수 없어 3D 장면을 표시하지 못했습니다. 이 프로토타입은 가짜 3D 대체 화면을 제공하지 않습니다.';
    throw err;
  }
  state3d.scene.add(new THREE.AmbientLight(0xffffff, 0.9), new THREE.DirectionalLight(0xffffff, 0.8));
  addMesh(state3d.scene, new THREE.BoxGeometry(1, 1, 1), mats.water, [0, -2.2, 0], [260, 0.2, 170], 'sunny-water');
  addMesh(state3d.scene, new THREE.BoxGeometry(1, 1, 1), mats.grass, [0, -1.6, 0], [210, 0.2, 120], 'landscape-island');
  buildPersistentWorld();
  resize();
  addEventListener('resize', resize);
  requestAnimationFrame(tick);
}

function routePoints(a, b, lift = 26) {
  const pa = cityCoords[a], pb = cityCoords[b], pts = [];
  for (let i = 0; i <= 32; i++) {
    const t = i / 32, arc = Math.sin(t * Math.PI);
    pts.push(new THREE.Vector3(
      pa[0] * (1 - t) + pb[0] * t,
      4 + arc * lift,
      pa[2] * (1 - t) + pb[2] * t
    ));
  }
  return pts;
}

function buildPersistentWorld() {
  cityCoords.forEach((pos, i) => {
    const group = new THREE.Group();
    group.position.set(...pos);
    group.name = `city-${i}`;
    const base = addMesh(group, new THREE.CylinderGeometry(18, 22, 2), mats.island, [0, 0, 0], [i === 4 ? 1.6 : 1.15, 1, i === 4 ? 1.35 : 1.05], 'island', { city: i });
    const vertiport = addMesh(group, new THREE.CylinderGeometry(3, 4, 1), mats.navy, [0, 2.5, 0], [1, 0.4, 1], 'vertiport', { city: i });
    const buildings = [];
    const count = i === 4 ? 32 : 24;
    for (let j = 0; j < count; j++) {
      const ring = j / count * Math.PI * 2, r = i === 4 ? 7 + (j % 4) * 3.1 : 5 + (j % 3) * 3.2;
      const x = Math.cos(ring) * r + ((j * 7) % 5 - 2) * 0.8;
      const z = Math.sin(ring) * r + ((j * 11) % 5 - 2) * 0.8;
      const type = i === 4 && j < 4 ? 'arena' : j % 7 === 0 ? 'clinic' : j % 5 === 0 ? 'school' : j % 3 === 0 ? 'office' : 'housing';
      const mat = type === 'arena' ? mats.arena : type === 'clinic' ? mats.clinic : type === 'school' ? mats.school : type === 'office' ? mats.office : mats.housing;
      const b = addMesh(group, new THREE.BoxGeometry(2, 1, 2), mat, [x, 2.4, z], [2.2, 1, 2.2], `building-${i}-${j}`, { city: i, plot: j, type, targetHeight: 1, owner: 0 });
      const overlay = addMesh(group, new THREE.BoxGeometry(1, 1, 1), mats.platform, [x + 0.1, 2.5, z + 0.1], [0.4, 0.4, 0.4], `owner-${i}-${j}`, { city: i, plot: j, ownerLayer: true });
      buildings.push({ mesh: b, overlay });
    }
    if (i === 4) {
      addMesh(group, new THREE.CylinderGeometry(8, 10, 3), mats.arena, [0, 4, 0], [1.5, 1.2, 1], 'central-sports-culture-arena', { city: i, landmark: true });
      addMesh(group, new THREE.BoxGeometry(12, 1, 4), mats.white, [0, 5.5, 8], [1, 1, 1], 'exchange-hall', { city: i, landmark: true });
    }
    state3d.scene.add(group);
    state3d.cities.push({ group, base, vertiport, buildings });
  });
  for (let i = 0; i < 4; i++) addRoute(i, 4, false);
  [[0, 1], [1, 3], [3, 2], [2, 0], [0, 3], [1, 2]].forEach(pair => addRoute(pair[0], pair[1], true));
  for (let i = 0; i < 36; i++) addCar(i);
}

function addRoute(from, to, peer) {
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(routePoints(from, to, peer ? 18 : 30)), peer ? mats.peerRoute : mats.route);
  line.userData = { from, to, peer, weight: 1, external: false };
  line.name = `route-${from}-${to}`;
  state3d.scene.add(line);
  state3d.routes.push(line);
}

function addCar(index) {
  const group = new THREE.Group();
  group.name = `flying-car-${index}`;
  addMesh(group, new THREE.BoxGeometry(1.6, 0.6, 3.2), mats.car, [0, 0, 0], [1, 1, 1], 'fuselage');
  addMesh(group, new THREE.BoxGeometry(1.2, 0.5, 1.0), mats.glass, [0, 0.45, -0.25], [1, 1, 1], 'cabin');
  addMesh(group, new THREE.CylinderGeometry(0.7, 0.7, 0.18), mats.navy, [-1.4, 0.18, 0.9], [1, 1, 1], 'left-rotor');
  addMesh(group, new THREE.CylinderGeometry(0.7, 0.7, 0.18), mats.navy, [1.4, 0.18, 0.9], [1, 1, 1], 'right-rotor');
  group.userData = { car: true, routeIndex: index % state3d.routes.length, phase: (index * 0.071) % 1, speed: 0.025 + (index % 6) * 0.004 };
  state3d.scene.add(group);
  state3d.cars.push(group);
}

function cityTargetForPlot(snapshot, i, j) {
  const c = snapshot.cities[i], v = visualCity(c, i, year === 0 ? M.defaults : inputs);
  const hub = i === 4;
  const type = state3d.cities[i].buildings[j].mesh.userData.type;
  const need = type === 'office' ? v.jobNeed : type === 'housing' ? v.housingNeed : type === 'arena' ? 4 : v.facilityNeed;
  const unlock = 3.5 + j * (hub ? 0.55 : 0.72) + ((j * 17 + i * 13) % 8) * 0.18;
  const progress = clamp((need - unlock) / 3.2, 0, 1);
  const closedRisk = 42 - c.service + 35 - c.visits + (type === 'office' ? 45 - c.opportunity : 0);
  const targetHeight = progress * (type === 'office' ? 14 + c.opportunity / 5 : type === 'housing' ? 7 + c.population / 8000 : type === 'arena' ? 10 : 5 + c.service / 12);
  const status = progress < 0.08 ? 'empty' : progress < 0.9 ? 'construction' : closedRisk > 26 && j % 5 === 1 ? 'closed' : 'active';
  const owner = j / state3d.cities[i].buildings.length < v.ownerShare ? v.ownerShare : 0;
  return { targetHeight, status, owner, serviceIndex: v.serviceIndex, routeWeight: v.routeWeight, peerWeight: v.peerWeight, externalOpen: v.externalOpen };
}

function applyYearSnapshot() {
  result = M.simulate(inputs, 20, 42);
  const snapshot = result.history[year];
  state3d.lastSnapshot = snapshot;
  state3d.cities.forEach((city, i) => {
    const c = snapshot.cities[i];
    const selected = i === selectedCity;
    city.base.scale.x = (i === 4 ? 1.6 : 1.15) * clamp(Math.sqrt(c.population / 40000), 0.82, 1.55);
    city.base.scale.z = (i === 4 ? 1.35 : 1.05) * clamp(Math.sqrt(c.population / 40000), 0.82, 1.55);
    city.vertiport.scale.y = 0.5 + c.visits / 75;
    city.buildings.forEach(({ mesh, overlay }, j) => {
      const t = cityTargetForPlot(snapshot, i, j);
      mesh.userData.targetHeight = t.targetHeight;
      mesh.userData.status = t.status;
      mesh.visible = t.status !== 'empty';
      mesh.material = t.status === 'closed' ? makeMat(0x3b4c5e) : t.status === 'construction' ? makeMat(0xe2a34f) : mesh.userData.type === 'office' ? mats.office : mesh.userData.type === 'housing' ? mats.housing : mesh.userData.type === 'clinic' ? mats.clinic : mesh.userData.type === 'school' ? mats.school : mats.arena;
      overlay.visible = t.owner > 0.18 && t.status !== 'empty';
      overlay.scale.set(1.1 + t.owner * 2.2, 0.8 + t.owner * 2.5, 1.1 + t.owner * 2.2);
      overlay.position.y = mesh.position.y + Math.max(1, mesh.scale.y) + 0.6;
      overlay.userData.owner = t.owner;
    });
    city.group.scale.setScalar(selected ? 1.08 : 1);
  });
  const visuals = snapshot.cities.map((c, i) => visualCity(c, i, year === 0 ? M.defaults : inputs));
  state3d.routes.forEach(route => {
    const a = visuals[route.userData.from], b = visuals[route.userData.to];
    const weight = route.userData.peer ? Math.min(a.peerWeight, b.peerWeight) : Math.min(a.routeWeight, b.routeWeight);
    route.userData.weight = weight;
    route.visible = weight > 0.08;
    route.material = route.userData.peer ? mats.peerRoute : mats.route;
  });
  state3d.cars.forEach((car, i) => {
    const route = state3d.routes[car.userData.routeIndex % state3d.routes.length];
    car.visible = !reduced && route.visible && i < Math.round(8 + snapshot.metrics.visits / 2.4);
    car.userData.speed = 0.012 + snapshot.metrics.visits / 3600 + (i % 5) * 0.003;
  });
  updateText(snapshot);
}

function updateText(snapshot) {
  $('#year-label').textContent = year;
  $('#year').value = year;
  $('#mode-badge').textContent = `${custom ? '사용자 정의' : M.scenarios[selectedScenario].name} · ${state3d.mode}`;
  $('#metrics').innerHTML = ['hubShare', 'service', 'opportunity', 'visits', 'mobility', 'energy'].map(k => `<div class="metric"><span>${labels[k]}</span><b>${snapshot.metrics[k].toFixed(1)}${k === 'hubShare' ? '%' : ''}</b></div>`).join('');
  const c = snapshot.cities[selectedCity], v = visualCity(c, selectedCity, year === 0 ? M.defaults : inputs);
  $('#city-select').value = selectedCity;
  $('#city-info').innerHTML = `<b>${c.name}</b><span>인구 ${(c.population / 10000).toFixed(2)}만 · 서비스 ${c.service.toFixed(1)} · 기회 ${c.opportunity.toFixed(1)} · 플랫폼 소유 레이어 ${(v.ownerShare * 100).toFixed(0)}%</span>`;
  $('#communities').innerHTML = M.communities(snapshot, year === 0 ? M.defaults : inputs).map(([n, f, value, text]) => `<article><h3>${n}=${f}</h3><div class="bar"><i style="width:${clamp(value, 0, 100)}%"></i></div><p>${text}</p></article>`).join('');
  const h = M.household(snapshot, year === 0 ? M.defaults : inputs, selectedFamily, selectedCity);
  $('#household-metrics').innerHTML = [['이동 부담', h.burden], ['서비스 접근', h.service], ['선택 여건', h.choice]].map(([n, val]) => `<div><span>${n}</span><b>${val.toFixed(1)}</b></div>`).join('');
  $('#story').textContent = h.story;
  $('#scenario-buttons').querySelectorAll('button').forEach(btn => btn.classList.toggle('active', btn.dataset.scenario === selectedScenario && !custom));
  document.querySelectorAll('[data-param]').forEach(input => { input.value = inputs[input.dataset.param]; $(`#out-${input.dataset.param}`).textContent = inputs[input.dataset.param]; });
  if (!$('#comparison').hidden) renderCompare();
}

function setMode(mode) {
  state3d.mode = mode;
  followFlight = mode === 'follow-flight';
  if (mode === 'overview') { state3d.controls.target.set(0,0,0); state3d.camera.position.set(160,160,200); }
  if (mode === 'city') { const p=cityCoords[selectedCity];state3d.controls.target.set(p[0],4,p[2]);state3d.camera.position.set(p[0]+45,48,p[2]+55); }
  if (mode === 'follow-flight') { state3d.camera.position.set(40,55,70); }
  state3d.controls.update();
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  updateText(state3d.lastSnapshot || result.history[year]);
}

function moveCars(dt) {
  state3d.cars.forEach((car, i) => {
    if (!car.visible) return;
    const route = state3d.routes[car.userData.routeIndex % state3d.routes.length];
    const attr=route.geometry.getAttribute('position'); const pts=Array.from({length:attr.count},(_,j)=>new THREE.Vector3().fromBufferAttribute(attr,j));
    car.userData.phase = (car.userData.phase + (reduced ? 0 : dt * car.userData.speed)) % 1;
    const f = car.userData.phase * (pts.length - 1), idx = Math.floor(f), mix = f - idx;
    const a = pts[idx], b = pts[Math.min(idx + 1, pts.length - 1)];
    car.position.set(a.x + (b.x - a.x) * mix, a.y + (b.y - a.y) * mix, a.z + (b.z - a.z) * mix);
    if (followFlight && i === selectedCar) {
      const delta=car.position.clone().sub(state3d.controls.target);state3d.camera.position.addScaledVector(delta,.06);state3d.controls.target.lerp(car.position, 0.06);
      state3d.controls.update();
    }
  });
}

function tick() {
  const dt = state3d.clock.getDelta();
  state3d.cities.forEach(city => city.buildings.forEach(({ mesh, overlay }) => {
    const target = Math.max(0.001, mesh.userData.targetHeight || 1);
    mesh.scale.y += (target - mesh.scale.y) * (reduced ? 1 : 0.09);
    overlay.position.y = mesh.position.y + mesh.scale.y + 0.8;
  }));
  moveCars(dt);
  state3d.renderer.render(state3d.scene, state3d.camera);
  requestAnimationFrame(tick);
}

function resize() {
  const r = $('#scene-wrap').getBoundingClientRect();
  state3d.camera.aspect = r.width / r.height;
  state3d.camera.updateProjectionMatrix();
  state3d.renderer.setSize(r.width, r.height);
}

function control(k, name) {
  return `<label class="control">${name}<output id="out-${k}">${inputs[k]}</output><input data-param="${k}" id="${k}" type="range" min="0" max="100" value="${inputs[k]}"></label>`;
}

function renderControls() {
  $('#scenario-buttons').innerHTML = Object.entries(M.scenarios).map(([id, s]) => `<button data-scenario="${id}">${s.name}</button>`).join('');
  $('#theme-controls').innerHTML = M.fields.map(([theme, fields, path]) => `<section><h3>${theme}</h3><p>${path}</p>${fields.map(([k, n]) => control(k, n)).join('')}</section>`).join('') + `<section><h3>거점 배분</h3><p>중앙 일자리/주거 밀도와 지역 시설 분포에 반영</p>${control('hubBudget', '거점 공공예산 배분')}</section>`;
  $('#city-select').innerHTML = M.simulate().final.cities.map((c, i) => `<option value="${i}">${c.name}</option>`).join('');
  $('#households').innerHTML = M.households.map((n, i) => `<button data-family="${i}" class="${i === 0 ? 'active' : ''}">${n}</button>`).join('');
}

function renderCompare() {
  $('#compare-grid').innerHTML = scenarioIds.map(id => {
    const s = M.simulate(M.scenarios[id].inputs, year, 42).final;
    const built = s.cities.map((c, i) => {
      const v = visualCity(c, i, M.scenarios[id].inputs);
      return Math.round(v.facilityNeed + v.jobNeed + v.housingNeed);
    });
    return `<article><h3>${M.scenarios[id].name}</h3><dl><dt>거점 인구</dt><dd>${s.metrics.hubShare.toFixed(1)}%</dd><dt>지역 시설 합</dt><dd>${built.slice(0, 4).reduce((a, b) => a + b, 0)}</dd><dt>방문</dt><dd>${s.metrics.visits.toFixed(1)}</dd><dt>에너지</dt><dd>${s.metrics.energy.toFixed(1)}</dd></dl><p>동일 ${year}년 후. 3D 장면은 선택 시나리오만 표시하며 이 표는 같은 수식의 요약입니다.</p></article>`;
  }).join('');
}

function bindEvents() {
  $('#scenario-buttons').addEventListener('click', e => {
    if (!e.target.dataset.scenario) return;
    stop();
    selectedScenario = e.target.dataset.scenario;
    inputs = { ...M.scenarios[selectedScenario].inputs };
    custom = false;
    applyYearSnapshot();
  });
  document.addEventListener('input', e => {
    if (!e.target.dataset.param) return;
    inputs[e.target.dataset.param] = Number(e.target.value);
    custom = true;
    applyYearSnapshot();
  });
  $('#year').addEventListener('input', e => { stop(); year = Number(e.target.value); applyYearSnapshot(); });
  $('#play').addEventListener('click', () => playTimer ? stop() : play());
  $('#reset').addEventListener('click', () => { stop(); year = 0; custom = false; inputs = { ...M.scenarios[selectedScenario].inputs }; applyYearSnapshot(); });
  $('#city-select').addEventListener('change', e => { selectedCity = Number(e.target.value); setMode('city'); applyYearSnapshot(); });
  $('#households').addEventListener('click', e => {
    if (e.target.dataset.family === undefined) return;
    selectedFamily = Number(e.target.dataset.family);
    $('#households').querySelectorAll('button').forEach(b => b.classList.toggle('active', Number(b.dataset.family) === selectedFamily));
    updateText(result.history[year]);
  });
  document.querySelectorAll('[data-mode]').forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.mode)));
  $('#compare-toggle').addEventListener('click', () => { $('#comparison').hidden = !$('#comparison').hidden; renderCompare(); });
}

function play() {
  if (year >= 20) year = 0;
  $('#play').textContent = '정지';
  playTimer = setInterval(() => {
    year = Math.min(20, year + 1);
    applyYearSnapshot();
    if (year >= 20) stop();
  }, 700);
}
function stop() { clearInterval(playTimer); playTimer = null; $('#play').textContent = '재생'; }

function sceneStats() {
  let meshes = 0, lines = 0, visibleCars = 0, visibleBuildings = 0;
  state3d.scene.traverse(obj => {
    if (obj instanceof THREE.Mesh) meshes++;
    if (obj instanceof THREE.Line) lines++;
    if (obj.userData.car && obj.visible) visibleCars++;
    if (obj.name.startsWith('building-') && obj.visible) visibleBuildings++;
  });
  return { meshes, lines, routes: state3d.routes.length, cars: state3d.cars.length, visibleCars, visibleBuildings, renderer: state3d.renderer instanceof THREE.WebGLRenderer, revision: THREE.REVISION };
}

window.sim3d = {
  getState: () => ({ year, selectedScenario, custom, cameraMode: state3d.mode, selectedCity, inputs: { ...inputs } }),
  setScenario: id => { selectedScenario = id; inputs = { ...M.scenarios[id].inputs }; custom = false; applyYearSnapshot(); },
  setYear: n => { year = Math.max(0, Math.min(20, Math.floor(n))); applyYearSnapshot(); },
  getSceneStats: sceneStats,
  getModelSnapshot: () => result.history[year],
  setCameraMode: setMode,
  isRendererGenuine: () => state3d.renderer instanceof THREE.WebGLRenderer,
  getCanvasPixels: () => {
    const gl = state3d.renderer.getContext(), out = new Uint8Array(4);
    gl.readPixels(Math.floor(gl.drawingBufferWidth / 2), Math.floor(gl.drawingBufferHeight / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return Array.from(out);
  }
};

renderControls();
init3d();
bindEvents();
applyYearSnapshot();
setMode('overview');
