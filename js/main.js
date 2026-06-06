import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

const CENTER = { lat: 52.0, lon: 19.5 };
const SCALE = 95000;
const PLANE_Y = 0;
const Y = {
  polska: 0,
  wojBase: 1,
  powBase: 2,
  gminBase: 3,
  lineGmin: 9,
  linePow: 10,
  lineWoj: 11,
  roadGmin: 350,
  roadPow: 351,
  roadWoj: 352,
  roadKraj: 353,
};
const ROAD_DROP_POW = 230;
const ROAD_DROP_GMIN = 300;
const ROAD_WIDTH_POW = 0.9;
const ROAD_WIDTH_GMIN = 0.6;
Y.hitWoj = Y.polska + 1;
Y.hitPow = Y.wojBase + 1;
Y.hitGmin = Y.powBase + 1;
Y.highlightWoj = Y.hitWoj + 1;
Y.highlightPow = Y.hitPow + 1;
Y.highlightGmin = Y.hitGmin + 1;

const RENDER = {
  fill: 0,
  highlight: 0,
  line: 10,
  road: 20,
  roadGmin: 20,
  roadPow: 20,
  roadWoj: 21,
  roadKraj: 22,
};

const CAM_ELEV = Math.PI / 5.5;
const VIEW_POLSKA_DIST = 700000;

const COLORS = {
  wojLine: 0x7ec8ff,
  wojLineHover: 0xb8ecff,
  wojFillHover: 0x2d6a8a,
  powLine: 0x4a9eff,
  powLineHover: 0x8ecaff,
  powFillHover: 0x2d6a8a,
  gminLine: 0x7ec8ff,
  gminLineHover: 0xb8ecff,
  gminFillHover: 0x3a7a96,
  roadKraj: 0xff2244,
  roadWoj: 0xff9f43,
  roadLocal: 0xffffff,
};

const container = document.getElementById("canvas-container");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060d18);
scene.fog = new THREE.Fog(0x060d18, 600000, 1800000);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 80, 3000000);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = "absolute";
labelRenderer.domElement.style.top = "0";
labelRenderer.domElement.style.pointerEvents = "none";
container.appendChild(labelRenderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;
controls.enableRotate = false;
controls.minPolarAngle = CAM_ELEV;
controls.maxPolarAngle = CAM_ELEV;
controls.minAzimuthAngle = 0;
controls.maxAzimuthAngle = 0;
controls.enableZoom = true;
controls.enablePan = true;
controls.zoomSpeed = 1.1;
controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
controls.screenSpacePanning = false;
controls.panSpeed = 1.15;

scene.add(new THREE.AmbientLight(0x6688bb, 0.65));
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.position.set(100000, 400000, 200000);
scene.add(sun);

const groups = {
  polska: new THREE.Group(),
  wojBase: new THREE.Group(),
  wojewodztwa: new THREE.Group(),
  wojHighlights: new THREE.Group(),
  wojHits: new THREE.Group(),
  powiaty: new THREE.Group(),
  powBase: new THREE.Group(),
  powHighlights: new THREE.Group(),
  powHits: new THREE.Group(),
  gminy: new THREE.Group(),
  gminMergedBorders: new THREE.Group(),
  gminBase: new THREE.Group(),
  gminHighlights: new THREE.Group(),
  gminHits: new THREE.Group(),
  drogi: new THREE.Group(),
  miasta: new THREE.Group(),
  labels: new THREE.Group(),
};
scene.add(groups.polska, groups.wojBase, groups.wojewodztwa, groups.wojHighlights, groups.wojHits,
  groups.powiaty, groups.powBase, groups.powHighlights, groups.powHits,
  groups.gminy, groups.gminMergedBorders, groups.gminBase, groups.gminHighlights, groups.gminHits,
  groups.drogi, groups.miasta, groups.labels);
groups.drogi.renderOrder = RENDER.road;

const preclipRoadCache = new Map();
let roadLoadToken = 0;

let wojGeo = null;
let powGeo = null;
let gminyGeo = null;
let roadsKrajowa = null;
let roadsWojewodzka = null;
let roadsPowiatowa = null;
let roadsGminna = null;
let roadLineMaterials = [];
let cityLineMaterials = [];
let gminLineMaterials = [];
const GMIN_LINE_WIDTH = 2;
let gminSeatsData = [];
const popByGmin = {};
const popByPow = {};
const popByWoj = {};
const powSeatByTeryt = {};
let wojHits = [];
let wojLinesByTeryt = {};
let wojHighlightByTeryt = {};
let hoveredWojTeryt = null;
let powHits = [];
let powLinesByTeryt = {};
let powHighlightByTeryt = {};
let hoveredPowTeryt = null;
let gminHits = [];
let gminLinesByKod = {};
let gminHighlightByKod = {};
let hoveredGminKod = null;

const nav = { level: "polska", woj: null, pow: null, gmin: null, snapDist: VIEW_POLSKA_DIST };
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function project(lon, lat) {
  const x = (lon - CENTER.lon) * SCALE * Math.cos(CENTER.lat * Math.PI / 180);
  const z = -(lat - CENTER.lat) * SCALE;
  return { x, z };
}

function normalizeAreaName(name) {
  return (name || "").trim().toLowerCase()
    .normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function isGminSameNameAsPow(gminNazwa) {
  if (!nav.pow) return false;
  return normalizeAreaName(gminNazwa) === normalizeAreaName(nav.pow.nazwa);
}

function getDistance() {
  return camera.position.distanceTo(controls.target);
}

function cameraOffset(dist) {
  const h = dist * Math.sin(CAM_ELEV);
  const south = dist * Math.cos(CAM_ELEV);
  return new THREE.Vector3(0, h, south);
}

function placeCamera(target, dist) {
  controls.target.copy(target);
  camera.position.copy(target).add(cameraOffset(dist));
}

function applySnapZoom(dist) {
  nav.snapDist = dist;
  let zoomInMul = 0.5;
  if (nav.level === "wojewodztwo") zoomInMul = 0.25;
  else if (nav.level === "powiat") zoomInMul = 0.32;
  else if (nav.level === "gmina") zoomInMul = 0.58;
  controls.minDistance = dist * zoomInMul;
  controls.maxDistance = dist * 1.8;
}

function setCameraView(tx, tz, dist) {
  const target = new THREE.Vector3(tx, PLANE_Y, tz);
  applySnapZoom(dist);
  placeCamera(target, dist);
  controls.update();
}

const MapFly = {
  active: null,
  duration: 800,

  ease(t) {
    return 1 - Math.pow(1 - t, 3);
  },

  isFlying() {
    return this.active !== null;
  },

  start(tx, tz, dist) {
    applySnapZoom(dist);
    controls.enabled = false;
    container.style.cursor = "wait";
    this.active = {
      t0: performance.now(),
      fromTarget: controls.target.clone(),
      toTarget: new THREE.Vector3(tx, PLANE_Y, tz),
      fromDist: getDistance(),
      toDist: dist,
    };
  },

  tick() {
    if (!this.active) return;

    const f = this.active;
    const t = Math.min(1, (performance.now() - f.t0) / this.duration);
    const e = this.ease(t);
    const target = new THREE.Vector3().lerpVectors(f.fromTarget, f.toTarget, e);
    const dist = Math.exp(
      THREE.MathUtils.lerp(Math.log(f.fromDist), Math.log(f.toDist), e)
    );

    controls.target.copy(target);
    camera.position.copy(target).add(cameraOffset(dist));
    controls.update();
    buildCities();

    if (t >= 1) {
      controls.target.copy(f.toTarget);
      camera.position.copy(f.toTarget).add(cameraOffset(f.toDist));
      controls.update();
      this.active = null;
      controls.enabled = true;
      container.style.cursor = "grab";
      updateInfoPanel();
    }
  },
};

function flyTo(tx, tz, dist) {
  MapFly.start(tx, tz, dist);
}

function formatUnitName(name) {
  return (name || "").replace(/(^|[\s-])(\S)/g, (_, sep, ch) => sep + ch.toUpperCase());
}

function buildPopIndex(exportGeo) {
  for (const f of exportGeo.features) {
    const kod = f.properties["teryt:terc"];
    if (!kod) continue;
    const pop = parseInt(String(f.properties.population ?? "0").replace(/\s/g, ""), 10) || 0;
    popByGmin[kod] = pop;
    const pow = kod.slice(0, 4);
    const woj = kod.slice(0, 2);
    popByPow[pow] = (popByPow[pow] || 0) + pop;
    popByWoj[woj] = (popByWoj[woj] || 0) + pop;
  }
}

function patchPopFromSeats(seats) {
  for (const s of seats) {
    if (!s.pop || !s.kod) continue;
    const prev = popByGmin[s.kod] || 0;
    if (prev >= s.pop) continue;
    const delta = s.pop - prev;
    popByGmin[s.kod] = s.pop;
    popByPow[s.kod.slice(0, 4)] = (popByPow[s.kod.slice(0, 4)] || 0) + delta;
    popByWoj[s.kod.slice(0, 2)] = (popByWoj[s.kod.slice(0, 2)] || 0) + delta;
  }
}

function findSeatInFeat(feat, seats) {
  let best = null;
  for (const s of seats) {
    if (!pointInFeature(s.lon, s.lat, feat) || !s.pop) continue;
    if (!best || s.pop > best.pop) best = s;
  }
  return best;
}

function buildPowSeatIndex(powiatSeats) {
  for (const e of powiatSeats.pozycje || []) {
    powSeatByTeryt[e.powiat_teryt] = e;
  }
}

function getPowiatSeat(pow) {
  const info = powSeatByTeryt[pow.teryt];
  if (info) {
    if (info.gmina_kod) {
      const byKod = gminSeatsData.find(s => s.kod === info.gmina_kod);
      if (byKod) return { seat: byKod, label: info.siedziba };
    }
    const sn = normalizeAreaName(info.siedziba);
    for (const s of gminSeatsData) {
      if (!pointInFeature(s.lon, s.lat, pow.feat)) continue;
      if (normalizeAreaName(s.name) === sn) return { seat: s, label: info.siedziba };
    }
    return { seat: null, label: info.siedziba };
  }
  const fallback = findSeatInFeat(pow.feat, gminSeatsData);
  return { seat: fallback, label: fallback ? fallback.name : "—" };
}

function getGminSeat(kod) {
  return gminSeatsData.find(s => s.kod === kod) || null;
}

function updateInfoPanel() {
  const titleEl = document.getElementById("unitTitle");
  const seatEl = document.getElementById("seatInfo");
  const popEl = document.getElementById("popInfo");

  if (nav.level === "polska") {
    titleEl.textContent = "Polska";
    const capital = gminSeatsData.find(s => s.name === "Warszawa" && s.isWojCapital)
      || gminSeatsData.find(s => s.name === "Warszawa");
    seatEl.textContent = capital ? capital.name : "Warszawa";
    const total = Object.values(popByGmin).reduce((a, b) => a + b, 0);
    popEl.textContent = formatCityPop(total);
  } else if (nav.level === "wojewodztwo" && nav.woj) {
    titleEl.textContent = `Województwo: ${formatUnitName(nav.woj.nazwa)}`;
    const seat = gminSeatsData.find(s => s.isWojCapital && pointInFeature(s.lon, s.lat, nav.woj.feat))
      || findSeatInFeat(nav.woj.feat, gminSeatsData);
    seatEl.textContent = seat ? seat.name : "—";
    popEl.textContent = formatCityPop(popByWoj[nav.woj.teryt] || 0);
  } else if (nav.level === "powiat" && nav.pow) {
    titleEl.textContent = `Powiat: ${formatUnitName(nav.pow.nazwa)}`;
    const { label } = getPowiatSeat(nav.pow);
    seatEl.textContent = label || "—";
    popEl.textContent = formatCityPop(popByPow[nav.pow.teryt] || 0);
  } else if (nav.level === "gmina" && nav.gmin) {
    titleEl.textContent = `Gmina: ${nav.gmin.nazwa}`;
    const seat = getGminSeat(nav.gmin.kod);
    seatEl.textContent = seat ? seat.name : "—";
    popEl.textContent = formatCityPop(popByGmin[nav.gmin.kod] || 0);
  }
}

function updateBackBtn() {
  const btn = document.getElementById("backBtn");
  if (nav.level === "polska") {
    btn.style.display = "none";
  } else {
    btn.style.display = "block";
    const labels = {
      gmina: "← Wróć do powiatu",
      powiat: "← Wróć do województwa",
      wojewodztwo: "← Wróć do Polski",
    };
    btn.textContent = labels[nav.level] || "← Wróć";
  }
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const hit = ((yi > lat) !== (yj > lat))
      && (lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
    if (hit) inside = !inside;
  }
  return inside;
}

function pointInFeature(lon, lat, feat) {
  const polys = feat.geometry.type === "Polygon"
    ? [feat.geometry.coordinates] : feat.geometry.coordinates;
  return polys.some(poly => pointInRing(lon, lat, poly[0]));
}

function gminKodPrefix(kod) {
  return String(kod || "").replace(/\D/g, "").slice(0, 6);
}

function seatInGmin(seat, gminData) {
  const seatKod = gminKodPrefix(seat.kod);
  const gminKod = gminKodPrefix(gminData.kod);
  if (seatKod && gminKod && seatKod === gminKod) return true;
  return pointInFeature(seat.lon, seat.lat, gminData.feat);
}

function findAdminSeats(geojson, seats) {
  const result = new Set();
  for (const feat of geojson.features) {
    let best = null;
    for (const s of seats) {
      if (!pointInFeature(s.lon, s.lat, feat) || !s.pop) continue;
      if (!best || s.pop > best.pop) best = s;
    }
    if (best) result.add(best);
  }
  return result;
}

function viewDistance(span, cover, min, max) {
  const vFov = (camera.fov * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const visible = 2 * Math.tan(Math.min(vFov, hFov) / 2) * Math.cos(CAM_ELEV);
  return THREE.MathUtils.clamp((span * cover) / visible, min, max);
}

const WOJ_ZOOM_OUT = 1.1;

function wojViewDistance(span) {
  return viewDistance(span, 0.85, 45000, 280000) * WOJ_ZOOM_OUT;
}

function powViewDistance(span) {
  return viewDistance(span, 0.78, 7000, 85000);
}

const GMIN_SMALL_SPAN = 10000;

function gminViewDistance(span) {
  const small = span < GMIN_SMALL_SPAN;
  const cover = small ? 0.55 : 0.74;
  const minDist = small ? 12000 : 6500;
  let dist = viewDistance(span, cover, minDist, 42000);
  if (small) dist *= 1.12;
  return dist;
}

function featureBounds(feat, distFn = wojViewDistance) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const polys = feat.geometry.type === "Polygon"
    ? [feat.geometry.coordinates] : feat.geometry.coordinates;
  for (const poly of polys) {
    for (const ring of poly) {
      for (const [lon, lat] of ring) {
        const p = project(lon, lat);
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      }
    }
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const spanZ = maxZ - minZ;
  const span = Math.max(maxX - minX, spanZ);
  return { cx, cz, dist: distFn(span) };
}

async function loadJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("Nie można załadować: " + url);
  return r.json();
}

function ringToShapePoints(ring) {
  let pts = ring.map(([lon, lat]) => {
    const p = project(lon, lat);
    return new THREE.Vector2(p.x, -p.z);
  });
  if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
  return pts;
}

function overlayMat(color, opacity) {
  return new THREE.MeshBasicMaterial({
    color, side: THREE.DoubleSide, transparent: true, opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}

function addFeatureFill(group, feat, mat, y = Y.polska) {
  const polys = feat.geometry.type === "Polygon"
    ? [feat.geometry.coordinates] : feat.geometry.coordinates;
  for (const poly of polys) {
    const outer = ringToShapePoints(poly[0]);
    const shape = new THREE.Shape(outer);
    for (let h = 1; h < poly.length; h++) {
      let hole = ringToShapePoints(poly[h]);
      if (!THREE.ShapeUtils.isClockWise(hole)) hole.reverse();
      shape.holes.push(new THREE.Path(hole));
    }
    const flat = new THREE.ShapeGeometry(shape);
    flat.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(flat, mat);
    mesh.position.y = y;
    mesh.renderOrder = RENDER.fill;
    group.add(mesh);
  }
}

function buildPolandBase(geojson) {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x1e4d6b, side: THREE.DoubleSide });
  for (const feat of geojson.features) addFeatureFill(group, feat, mat);
  return group;
}

function buildWojBase(feat) {
  groups.wojBase.clear();
  addFeatureFill(groups.wojBase, feat, overlayMat(COLORS.powFillHover, 0.55), Y.wojBase);
}

function buildPowBase(feat) {
  groups.powBase.clear();
  addFeatureFill(groups.powBase, feat, overlayMat(0x2d6a8a, 0.6), Y.powBase);
}

function setWojBaseDim(dimmed) {
  groups.wojBase.traverse(child => {
    if (!child.isMesh || !child.material) return;
    child.material.opacity = dimmed ? 0.22 : 0.55;
  });
}

function setPowBaseDim(dimmed) {
  groups.powBase.traverse(child => {
    if (!child.isMesh || !child.material) return;
    child.material.opacity = dimmed ? 0.2 : 0.6;
  });
}

function buildGminBase(feat) {
  groups.gminBase.clear();
  addFeatureFill(groups.gminBase, feat, overlayMat(COLORS.gminFillHover, 0.65), Y.gminBase);
}

function setPolskaDim(dimmed) {
  groups.polska.traverse(child => {
    if (!child.isMesh || !child.material) return;
    child.material.transparent = dimmed;
    child.material.opacity = dimmed ? 0.18 : 1;
    child.material.depthWrite = !dimmed;
  });
}

function setWojVisibility(activeTeryt) {
  for (const [t, lines] of Object.entries(wojLinesByTeryt)) {
    lines.visible = true;
    if (activeTeryt === null) {
      lines.material.color.setHex(t === hoveredWojTeryt ? COLORS.wojLineHover : COLORS.wojLine);
    } else {
      lines.material.color.setHex(COLORS.powLine);
    }
  }
  for (const [t, hl] of Object.entries(wojHighlightByTeryt)) {
    hl.visible = activeTeryt === null && t === hoveredWojTeryt;
  }
  groups.wojHits.visible = activeTeryt === null;
}

function setPowVisibility(activeTeryt) {
  for (const [t, lines] of Object.entries(powLinesByTeryt)) {
    lines.visible = true;
    if (activeTeryt === null) {
      lines.material.color.setHex(t === hoveredPowTeryt ? COLORS.powLineHover : COLORS.powLine);
    } else {
      lines.material.color.setHex(COLORS.wojLine);
    }
  }
  for (const [t, hl] of Object.entries(powHighlightByTeryt)) {
    hl.visible = activeTeryt === null && t === hoveredPowTeryt;
  }
  groups.powHits.visible = activeTeryt === null;
}

function setGminLineStyle(lines, color, opacity, yLift) {
  lines.material.color.setHex(color);
  lines.material.opacity = opacity;
  lines.material.transparent = opacity < 1;
  lines.position.y = yLift;
}

function setGminVisibility(activeKod) {
  for (const [k, lines] of Object.entries(gminLinesByKod)) {
    lines.visible = true;
    if (activeKod === null) {
      setGminLineStyle(
        lines,
        k === hoveredGminKod ? COLORS.gminLineHover : COLORS.gminLine,
        1,
        0,
      );
      lines.renderOrder = RENDER.line;
    } else if (k === activeKod) {
      setGminLineStyle(lines, COLORS.gminLine, 1, 0.3);
      lines.renderOrder = RENDER.line + 2;
    } else {
      setGminLineStyle(lines, COLORS.wojLine, 1, 0);
      lines.renderOrder = RENDER.line;
    }
  }
  for (const [k, hl] of Object.entries(gminHighlightByKod)) {
    hl.visible = activeKod === null && k === hoveredGminKod;
  }
  groups.gminHits.visible = activeKod === null;
}

function collectRoadPositions(geojson, y) {
  const positions = [];
  for (const feat of geojson.features) {
    const lines = feat.geometry.type === "LineString"
      ? [feat.geometry.coordinates] : feat.geometry.coordinates;
    for (const line of lines) {
      for (let i = 0; i < line.length - 1; i++) {
        const a = project(line[i][0], line[i][1]);
        const b = project(line[i + 1][0], line[i + 1][1]);
        positions.push(a.x, y, a.z, b.x, y, b.z);
      }
    }
  }
  return positions;
}

function getRoadWidth() {
  if (nav.level === "gmina") return 4;
  if (nav.level === "powiat") return 5;
  if (nav.level === "wojewodztwo") return 3.5;
  return 2.5;
}

function roadLayerY(y) {
  if (nav.level === "powiat") return y - ROAD_DROP_POW;
  if (nav.level === "gmina") return y - ROAD_DROP_GMIN;
  return y;
}

function buildRoadLines(geojson, color, y = Y.roadKraj, width = null, renderOrder = RENDER.roadKraj) {
  const positions = collectRoadPositions(geojson, roadLayerY(y));
  if (!positions.length) return null;
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);
  const material = new LineMaterial({
    color,
    linewidth: width ?? getRoadWidth(),
    resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
    depthTest: true,
    depthWrite: true,
  });
  roadLineMaterials.push(material);
  const lines = new LineSegments2(geometry, material);
  lines.renderOrder = renderOrder;
  return lines;
}

function featureLonLatBBox(feat) {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  const polys = feat.geometry.type === "Polygon"
    ? [feat.geometry.coordinates] : feat.geometry.coordinates;
  for (const poly of polys) {
    for (const ring of poly) {
      for (const [lon, lat] of ring) {
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      }
    }
  }
  return { minLon, maxLon, minLat, maxLat };
}

function roadIntersectsBBox(f, bbox) {
  const lines = f.geometry.type === "LineString"
    ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const line of lines) {
    for (const [lon, lat] of line) {
      if (lon >= bbox.minLon && lon <= bbox.maxLon
        && lat >= bbox.minLat && lat <= bbox.maxLat) return true;
    }
  }
  return false;
}

function filterRoadsInFeat(geojson, feat) {
  const bbox = featureLonLatBBox(feat);
  const features = geojson.features.filter(f => {
    if (!roadIntersectsBBox(f, bbox)) return false;
    const lines = f.geometry.type === "LineString"
      ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const line of lines) {
      for (const [lon, lat] of line) {
        if (pointInFeature(lon, lat, feat)) return true;
      }
    }
    return false;
  });
  return { type: "FeatureCollection", features };
}

function normalizeRoadKat(kat) {
  if (kat === "kraj" || kat === "krajowa") return "kraj";
  if (kat === "woj" || kat === "wojewodzka") return "woj";
  if (kat === "pow" || kat === "powiatowa") return "pow";
  if (kat === "gmin" || kat === "gminna") return "gmin";
  return null;
}

function splitRoadsByKat(geojson) {
  const buckets = { kraj: [], woj: [], pow: [], gmin: [] };
  for (const f of geojson.features) {
    const kat = normalizeRoadKat(f.properties.kat);
    if (kat) buckets[kat].push(f);
  }
  const fc = (features) => ({ type: "FeatureCollection", features });
  return {
    kraj: fc(buckets.kraj),
    woj: fc(buckets.woj),
    pow: fc(buckets.pow),
    gmin: fc(buckets.gmin),
  };
}

async function loadPreclipRoads(folder, id) {
  const key = `${folder}/${id}`;
  if (preclipRoadCache.has(key)) return preclipRoadCache.get(key);
  const geo = await loadJSON(`data/${folder}/${id}.geojson`);
  preclipRoadCache.set(key, geo);
  return geo;
}

function addPreclipRoadLayers(split) {
  addRoadLayer(split.gmin, COLORS.roadLocal, Y.roadGmin, ROAD_WIDTH_GMIN, RENDER.roadGmin);
  addRoadLayer(split.pow, COLORS.roadLocal, Y.roadPow, ROAD_WIDTH_POW, RENDER.roadPow);
  addRoadLayer(split.woj, COLORS.roadWoj, Y.roadWoj, null, RENDER.roadWoj);
  addRoadLayer(split.kraj, COLORS.roadKraj, Y.roadKraj, null, RENDER.roadKraj);
}

function addFilteredRoadLayers(area) {
  if (roadsGminna) {
    addRoadLayer(filterRoadsInFeat(roadsGminna, area), COLORS.roadLocal, Y.roadGmin, ROAD_WIDTH_GMIN, RENDER.roadGmin);
  }
  if (roadsPowiatowa) {
    addRoadLayer(filterRoadsInFeat(roadsPowiatowa, area), COLORS.roadLocal, Y.roadPow, ROAD_WIDTH_POW, RENDER.roadPow);
  }
  if (roadsWojewodzka) {
    addRoadLayer(filterRoadsInFeat(roadsWojewodzka, area), COLORS.roadWoj, Y.roadWoj, null, RENDER.roadWoj);
  }
  addRoadLayer(filterRoadsInFeat(roadsKrajowa, area), COLORS.roadKraj, Y.roadKraj, null, RENDER.roadKraj);
}

async function updateRoadsForArea(folder, id, area) {
  const token = ++roadLoadToken;
  groups.drogi.clear();
  roadLineMaterials = [];
  try {
    const preclip = await loadPreclipRoads(folder, id);
    if (token !== roadLoadToken) return;
    addPreclipRoadLayers(splitRoadsByKat(preclip));
  } catch {
    if (token !== roadLoadToken) return;
    addFilteredRoadLayers(area);
  }
}

function addRoadLayer(geojson, color, y, width = null, renderOrder = RENDER.roadKraj) {
  const m = buildRoadLines(geojson, color, y, width, renderOrder);
  if (m) groups.drogi.add(m);
}

function updateRoads() {
  groups.drogi.clear();
  roadLineMaterials = [];
  if (!roadsKrajowa) return;

  if (nav.level === "polska") {
    addRoadLayer(roadsKrajowa, COLORS.roadKraj, Y.roadKraj, null, RENDER.roadKraj);
  } else if (nav.level === "wojewodztwo" && nav.woj) {
    const area = nav.woj.feat;
    if (roadsWojewodzka) {
      addRoadLayer(filterRoadsInFeat(roadsWojewodzka, area), COLORS.roadWoj, Y.roadWoj, null, RENDER.roadWoj);
    }
    addRoadLayer(filterRoadsInFeat(roadsKrajowa, area), COLORS.roadKraj, Y.roadKraj, null, RENDER.roadKraj);
  } else if (nav.level === "powiat" && nav.pow) {
    updateRoadsForArea("drogi_powiat", nav.pow.teryt, nav.pow.feat);
    return;
  } else if (nav.level === "gmina" && nav.gmin) {
    updateRoadsForArea("drogi_gmina", nav.gmin.kod, nav.gmin.feat);
    return;
  }
}

function collectFeatureLinePositions(feat, y) {
  const positions = [];
  const polys = feat.geometry.type === "Polygon"
    ? [feat.geometry.coordinates] : feat.geometry.coordinates;
  for (const poly of polys) {
    const ring = poly[0];
    for (let i = 0; i < ring.length - 1; i++) {
      const a = project(ring[i][0], ring[i][1]);
      const b = project(ring[i + 1][0], ring[i + 1][1]);
      positions.push(a.x, y, a.z, b.x, y, b.z);
    }
  }
  return positions;
}

function buildWideLines(positions, color, linewidth) {
  if (!positions.length) return null;
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);
  const material = new LineMaterial({
    color,
    linewidth,
    resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
    depthTest: true,
    depthWrite: false,
  });
  gminLineMaterials.push(material);
  const lines = new LineSegments2(geometry, material);
  lines.renderOrder = RENDER.line;
  return lines;
}

function gminEdgeKey(ax, az, bx, bz) {
  const p1 = `${ax.toFixed(1)},${az.toFixed(1)}`;
  const p2 = `${bx.toFixed(1)},${bz.toFixed(1)}`;
  return p1 < p2 ? `${p1}|${p2}` : `${p2}|${p1}`;
}

function buildGminMergedBorders(powTeryt) {
  groups.gminMergedBorders.clear();
  if (!gminyGeo) return;
  const seen = new Set();
  const positions = [];
  const y = Y.lineGmin;
  for (const feat of gminyGeo.features) {
    if (!feat.properties.kod.startsWith(powTeryt)) continue;
    const polys = feat.geometry.type === "Polygon"
      ? [feat.geometry.coordinates] : feat.geometry.coordinates;
    for (const poly of polys) {
      const ring = poly[0];
      for (let i = 0; i < ring.length - 1; i++) {
        const a = project(ring[i][0], ring[i][1]);
        const b = project(ring[i + 1][0], ring[i + 1][1]);
        const key = gminEdgeKey(a.x, a.z, b.x, b.z);
        if (seen.has(key)) continue;
        seen.add(key);
        positions.push(a.x, y, a.z, b.x, y, b.z);
      }
    }
  }
  const lines = buildWideLines(positions, COLORS.gminLine, GMIN_LINE_WIDTH);
  if (lines) groups.gminMergedBorders.add(lines);
}

function buildFeatureLines(feat, color, y = Y.linePow, linewidth = null) {
  const positions = collectFeatureLinePositions(feat, y);
  if (!positions.length) return null;
  if (linewidth) {
    return buildWideLines(positions, color, linewidth);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color }));
  lines.renderOrder = RENDER.line;
  return lines;
}

function buildWojHighlight(feat) {
  const group = new THREE.Group();
  group.visible = false;
  const mat = new THREE.MeshBasicMaterial({
    color: COLORS.wojFillHover,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const polys = feat.geometry.type === "Polygon"
    ? [feat.geometry.coordinates] : feat.geometry.coordinates;
  for (const poly of polys) {
    const outer = ringToShapePoints(poly[0]);
    const shape = new THREE.Shape(outer);
    for (let h = 1; h < poly.length; h++) {
      let hole = ringToShapePoints(poly[h]);
      if (!THREE.ShapeUtils.isClockWise(hole)) hole.reverse();
      shape.holes.push(new THREE.Path(hole));
    }
    const flat = new THREE.ShapeGeometry(shape);
    flat.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(flat, mat);
    mesh.position.y = Y.highlightWoj;
    mesh.renderOrder = RENDER.highlight;
    group.add(mesh);
  }
  return group;
}

function buildWojLayer(geojson) {
  groups.wojewodztwa.clear();
  groups.wojHighlights.clear();
  groups.wojHits.clear();
  wojHits = [];
  wojLinesByTeryt = {};
  wojHighlightByTeryt = {};

  const hitMat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
  });

  for (const feat of geojson.features) {
    const props = feat.properties;
    const teryt = props.teryt;
    const nazwa = props.nazwa;
    const ud = { type: "woj", teryt, nazwa, feat };

    const lines = buildFeatureLines(feat, COLORS.wojLine, Y.lineWoj);
    lines.userData = ud;
    groups.wojewodztwa.add(lines);
    wojLinesByTeryt[teryt] = lines;

    const highlight = buildWojHighlight(feat);
    groups.wojHighlights.add(highlight);
    wojHighlightByTeryt[teryt] = highlight;

    const polys = feat.geometry.type === "Polygon"
      ? [feat.geometry.coordinates] : feat.geometry.coordinates;
    for (const poly of polys) {
      const outer = ringToShapePoints(poly[0]);
      const shape = new THREE.Shape(outer);
      for (let h = 1; h < poly.length; h++) {
        let hole = ringToShapePoints(poly[h]);
        if (!THREE.ShapeUtils.isClockWise(hole)) hole.reverse();
        shape.holes.push(new THREE.Path(hole));
      }
      const flat = new THREE.ShapeGeometry(shape);
      flat.rotateX(-Math.PI / 2);
      const hit = new THREE.Mesh(flat, hitMat.clone());
      hit.position.y = Y.hitWoj;
      hit.userData = ud;
      groups.wojHits.add(hit);
      wojHits.push(hit);
    }
  }
}

function buildAreaHighlight(feat, color, y) {
  const group = new THREE.Group();
  group.visible = false;
  const mat = new THREE.MeshBasicMaterial({
    color, side: THREE.DoubleSide, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const polys = feat.geometry.type === "Polygon"
    ? [feat.geometry.coordinates] : feat.geometry.coordinates;
  for (const poly of polys) {
    const outer = ringToShapePoints(poly[0]);
    const shape = new THREE.Shape(outer);
    for (let h = 1; h < poly.length; h++) {
      let hole = ringToShapePoints(poly[h]);
      if (!THREE.ShapeUtils.isClockWise(hole)) hole.reverse();
      shape.holes.push(new THREE.Path(hole));
    }
    const flat = new THREE.ShapeGeometry(shape);
    flat.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(flat, mat);
    mesh.position.y = y;
    mesh.renderOrder = RENDER.highlight;
    group.add(mesh);
  }
  return group;
}

function buildPowiatLayerForWoj(wojTeryt) {
  groups.powiaty.clear();
  groups.powHighlights.clear();
  groups.powHits.clear();
  powHits = [];
  powLinesByTeryt = {};
  powHighlightByTeryt = {};

  const hitMat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
  });

  for (const feat of powGeo.features) {
    if (!feat.properties.teryt.startsWith(wojTeryt)) continue;
    const props = feat.properties;
    const teryt = props.teryt;
    const nazwa = props.nazwa;
    const ud = { type: "pow", teryt, nazwa, feat };

    const lines = buildFeatureLines(feat, COLORS.powLine, Y.linePow);
    lines.userData = ud;
    groups.powiaty.add(lines);
    powLinesByTeryt[teryt] = lines;

    const highlight = buildAreaHighlight(feat, COLORS.powFillHover, Y.highlightPow);
    groups.powHighlights.add(highlight);
    powHighlightByTeryt[teryt] = highlight;

    const polys = feat.geometry.type === "Polygon"
      ? [feat.geometry.coordinates] : feat.geometry.coordinates;
    for (const poly of polys) {
      const outer = ringToShapePoints(poly[0]);
      const shape = new THREE.Shape(outer);
      for (let h = 1; h < poly.length; h++) {
        let hole = ringToShapePoints(poly[h]);
        if (!THREE.ShapeUtils.isClockWise(hole)) hole.reverse();
        shape.holes.push(new THREE.Path(hole));
      }
      const flat = new THREE.ShapeGeometry(shape);
      flat.rotateX(-Math.PI / 2);
      const hit = new THREE.Mesh(flat, hitMat.clone());
      hit.position.y = Y.hitPow;
      hit.userData = ud;
      groups.powHits.add(hit);
      powHits.push(hit);
    }
  }
}

function buildGminLayerForPow(powTeryt) {
  groups.gminy.clear();
  groups.gminMergedBorders.clear();
  groups.gminHighlights.clear();
  groups.gminHits.clear();
  gminHits = [];
  gminLinesByKod = {};
  gminHighlightByKod = {};
  gminLineMaterials = [];
  if (!gminyGeo) return;

  const hitMat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
  });

  for (const feat of gminyGeo.features) {
    if (!feat.properties.kod.startsWith(powTeryt)) continue;
    const props = feat.properties;
    const kod = props.kod;
    const nazwa = props.nazwa;
    const ud = { type: "gmin", kod, nazwa, feat };

    const lines = buildFeatureLines(feat, COLORS.gminLine, Y.lineGmin, GMIN_LINE_WIDTH);
    lines.userData = ud;
    groups.gminy.add(lines);
    gminLinesByKod[kod] = lines;

    if (isGminSameNameAsPow(nazwa)) continue;

    const highlight = buildAreaHighlight(feat, COLORS.gminFillHover, Y.highlightGmin);
    groups.gminHighlights.add(highlight);
    gminHighlightByKod[kod] = highlight;

    const polys = feat.geometry.type === "Polygon"
      ? [feat.geometry.coordinates] : feat.geometry.coordinates;
    for (const poly of polys) {
      const outer = ringToShapePoints(poly[0]);
      const shape = new THREE.Shape(outer);
      for (let h = 1; h < poly.length; h++) {
        let hole = ringToShapePoints(poly[h]);
        if (!THREE.ShapeUtils.isClockWise(hole)) hole.reverse();
        shape.holes.push(new THREE.Path(hole));
      }
      const flat = new THREE.ShapeGeometry(shape);
      flat.rotateX(-Math.PI / 2);
      const hit = new THREE.Mesh(flat, hitMat.clone());
      hit.position.y = Y.hitGmin;
      hit.userData = ud;
      groups.gminHits.add(hit);
      gminHits.push(hit);
    }
  }
  buildGminMergedBorders(powTeryt);
}

const CITY_LINE_H = {
  polska: 30000,
  wojewodztwo: 10000,
  powiat: 5000,
  gmina: 2000,
};

function getCityLineHeight() {
  return CITY_LINE_H[nav.level] ?? CITY_LINE_H.polska;
}

function isSeatMiastoNaPrawachPowiatu(seat) {
  if (!powGeo) return false;
  for (const feat of powGeo.features) {
    if (nav.woj && !feat.properties.teryt.startsWith(nav.woj.teryt)) continue;
    if (nav.pow && feat.properties.teryt !== nav.pow.teryt) continue;
    if (!pointInFeature(seat.lon, seat.lat, feat)) continue;
    return normalizeAreaName(seat.name) === normalizeAreaName(feat.properties.nazwa);
  }
  return false;
}

function getCityLineHeightFor(seat) {
  if (nav.level === "powiat" && isSeatMiastoNaPrawachPowiatu(seat)) {
    return CITY_LINE_H.gmina;
  }
  return getCityLineHeight();
}

function getCityPoleWidth() {
  if (nav.level === "gmina") return 2.5;
  if (nav.level === "powiat") return 3;
  if (nav.level === "wojewodztwo") return 3.5;
  return 4;
}

function formatCityPop(pop) {
  const n = Number(pop);
  if (!n) return "—";
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function buildCities() {
  groups.miasta.clear();
  groups.labels.clear();
  cityLineMaterials = [];
  const poleMat = new LineMaterial({
    color: 0xffffff,
    linewidth: getCityPoleWidth(),
    resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
    depthTest: true,
    depthWrite: true,
  });
  cityLineMaterials.push(poleMat);

  for (const s of gminSeatsData) {
    let show = false;
    if (nav.level === "polska") show = s.isWojCapital;
    else if (nav.level === "wojewodztwo" && nav.woj) {
      show = s.isPowiatSeat && pointInFeature(s.lon, s.lat, nav.woj.feat);
    } else if (nav.level === "powiat" && nav.pow) {
      show = pointInFeature(s.lon, s.lat, nav.pow.feat) && !s.ruralCityLinked;
    } else if (nav.level === "gmina" && nav.gmin) {
      show = seatInGmin(s, nav.gmin);
    }
    if (!show) continue;

    const lineH = getCityLineHeightFor(s);
    const p = project(s.lon, s.lat);
    const baseY = PLANE_Y + 12;
    const topY = baseY + lineH;

    const geo = new LineSegmentsGeometry();
    geo.setPositions([p.x, baseY, p.z, p.x, topY, p.z]);
    const line = new LineSegments2(geo, poleMat);
    line.renderOrder = RENDER.road + 2;
    groups.miasta.add(line);

    const div = document.createElement("div");
    div.className = "city-label" + (s.isWojCapital ? " major" : "");
    div.textContent = `${s.name}, ${formatCityPop(s.labelPop ?? s.pop)}`;
    const label = new CSS2DObject(div);
    label.position.set(p.x, topY + 600, p.z);
    groups.labels.add(label);
  }
}

function refreshView() {
  if (nav.level === "polska") {
    groups.polska.visible = true;
    setPolskaDim(false);
    groups.wojBase.clear();
    groups.wojBase.visible = false;
    groups.powBase.clear();
    groups.powBase.visible = false;
    groups.wojewodztwa.visible = true;
    groups.wojHighlights.visible = true;
    setWojVisibility(null);
    groups.powiaty.visible = false;
    groups.powHighlights.visible = false;
    groups.powHits.visible = false;
    groups.gminy.visible = false;
    groups.gminMergedBorders.visible = false;
    groups.gminHighlights.visible = false;
    groups.gminHits.visible = false;
    groups.gminBase.clear();
    groups.gminBase.visible = false;
  } else if (nav.level === "wojewodztwo" && nav.woj) {
    groups.polska.visible = true;
    setPolskaDim(true);
    buildWojBase(nav.woj.feat);
    groups.wojBase.visible = true;
    setWojBaseDim(false);
    groups.powBase.clear();
    groups.powBase.visible = false;
    groups.wojewodztwa.visible = true;
    groups.wojHighlights.visible = true;
    setWojVisibility(nav.woj.teryt);
    groups.powiaty.visible = true;
    groups.powHighlights.visible = true;
    setPowVisibility(null);
    groups.gminy.visible = false;
    groups.gminMergedBorders.visible = false;
    groups.gminHighlights.visible = false;
    groups.gminHits.visible = false;
    groups.gminBase.clear();
    groups.gminBase.visible = false;
  } else if (nav.level === "powiat" && nav.pow) {
    groups.polska.visible = true;
    setPolskaDim(true);
    groups.wojBase.visible = true;
    setWojBaseDim(true);
    groups.wojewodztwa.visible = true;
    groups.wojHighlights.visible = false;
    setWojVisibility(nav.woj.teryt);
    buildPowBase(nav.pow.feat);
    groups.powBase.visible = true;
    groups.powiaty.visible = true;
    groups.powHighlights.visible = true;
    setPowVisibility(nav.pow.teryt);
    setPowBaseDim(false);
    groups.gminy.visible = false;
    groups.gminMergedBorders.visible = true;
    groups.gminHighlights.visible = true;
    setGminVisibility(null);
    groups.gminBase.clear();
    groups.gminBase.visible = false;
  } else if (nav.level === "gmina" && nav.gmin) {
    groups.polska.visible = true;
    setPolskaDim(true);
    groups.wojBase.visible = true;
    setWojBaseDim(true);
    groups.wojewodztwa.visible = true;
    groups.wojHighlights.visible = false;
    setWojVisibility(nav.woj.teryt);
    groups.powBase.visible = true;
    setPowBaseDim(true);
    groups.powiaty.visible = true;
    groups.powHighlights.visible = false;
    setPowVisibility(nav.pow.teryt);
    buildGminBase(nav.gmin.feat);
    groups.gminBase.visible = true;
    groups.gminy.visible = true;
    groups.gminMergedBorders.visible = false;
    groups.gminHighlights.visible = true;
    setGminVisibility(nav.gmin.kod);
  }

  for (const g of [groups.wojewodztwa, groups.powiaty, groups.gminy, groups.gminMergedBorders]) {
    g.position.y = 0;
  }
  updateRoads();
  buildCities();
  updateInfoPanel();
  updateBackBtn();
}

function enterWoj(wojData) {
  if (MapFly.isFlying()) return;
  setWojHover(null);
  nav.level = "wojewodztwo";
  nav.woj = wojData;
  buildPowiatLayerForWoj(wojData.teryt);
  refreshView();
  const b = featureBounds(wojData.feat);
  flyTo(b.cx, b.cz, b.dist);
}

function enterPow(powData) {
  if (MapFly.isFlying()) return;
  setPowHover(null);
  nav.level = "powiat";
  nav.pow = powData;
  buildGminLayerForPow(powData.teryt);
  refreshView();
  const b = featureBounds(powData.feat, powViewDistance);
  flyTo(b.cx, b.cz, b.dist);
}

function enterGmin(gminData) {
  if (MapFly.isFlying()) return;
  setGminHover(null);
  nav.level = "gmina";
  nav.gmin = gminData;
  refreshView();
  const b = featureBounds(gminData.feat, gminViewDistance);
  flyTo(b.cx, b.cz, b.dist);
}

function backToPow() {
  if (MapFly.isFlying()) return;
  nav.level = "powiat";
  nav.gmin = null;
  groups.gminBase.clear();
  setGminHover(null);
  refreshView();
  const b = featureBounds(nav.pow.feat, powViewDistance);
  flyTo(b.cx, b.cz, b.dist);
}

function backToWoj() {
  if (MapFly.isFlying()) return;
  nav.level = "wojewodztwo";
  nav.pow = null;
  nav.gmin = null;
  groups.gminy.clear();
  groups.gminHighlights.clear();
  groups.gminHits.clear();
  groups.gminBase.clear();
  groups.powBase.clear();
  gminHits = [];
  gminLinesByKod = {};
  gminHighlightByKod = {};
  setPowHover(null);
  setGminHover(null);
  refreshView();
  const b = featureBounds(nav.woj.feat);
  flyTo(b.cx, b.cz, b.dist);
}

function backToPolska() {
  if (MapFly.isFlying()) return;
  nav.level = "polska";
  nav.woj = null;
  nav.pow = null;
  nav.gmin = null;
  groups.powiaty.clear();
  groups.powHighlights.clear();
  groups.powHits.clear();
  groups.gminy.clear();
  groups.gminHighlights.clear();
  groups.gminHits.clear();
  groups.gminBase.clear();
  groups.powBase.clear();
  powHits = [];
  powLinesByTeryt = {};
  powHighlightByTeryt = {};
  gminHits = [];
  gminLinesByKod = {};
  gminHighlightByKod = {};
  setWojHover(null);
  setPowHover(null);
  setGminHover(null);
  refreshView();
  flyTo(0, 0, VIEW_POLSKA_DIST);
}

function goBack() {
  if (nav.level === "gmina") backToPow();
  else if (nav.level === "powiat") backToWoj();
  else if (nav.level === "wojewodztwo") backToPolska();
}

function pickAt(clientX, clientY, objects) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(objects, false);
  return hits.length ? hits[0].object.userData : null;
}

function pickWoj(clientX, clientY) {
  if (nav.level !== "polska") return null;
  return pickAt(clientX, clientY, wojHits);
}

function pickPow(clientX, clientY) {
  if (nav.level !== "wojewodztwo") return null;
  return pickAt(clientX, clientY, powHits);
}

function pickGmin(clientX, clientY) {
  if (nav.level !== "powiat") return null;
  const hit = pickAt(clientX, clientY, gminHits);
  if (hit && isGminSameNameAsPow(hit.nazwa)) return null;
  return hit;
}

function setWojHover(hit) {
  const teryt = hit ? hit.teryt : null;
  if (hoveredWojTeryt === teryt) return;
  hoveredWojTeryt = teryt;
  container.style.cursor = teryt ? "pointer" : "grab";
  if (nav.level === "polska") setWojVisibility(null);
}

function setPowHover(hit) {
  const teryt = hit ? hit.teryt : null;
  if (hoveredPowTeryt === teryt) return;
  hoveredPowTeryt = teryt;
  container.style.cursor = teryt ? "pointer" : "grab";
  if (nav.level === "wojewodztwo") setPowVisibility(null);
}

function setGminHover(hit) {
  const kod = hit ? hit.kod : null;
  if (hoveredGminKod === kod) return;
  hoveredGminKod = kod;
  container.style.cursor = kod ? "pointer" : "grab";
  if (nav.level === "powiat") setGminVisibility(null);
}

const DRAG_THRESHOLD = 6;
const DRAG_THRESHOLD_TOUCH = 14;
let pointerDown = null;
let gesturePanned = false;
let touchTap = null;
let touchMoved = false;

function handleMapPick(clientX, clientY) {
  if (nav.level === "polska") {
    const hit = pickWoj(clientX, clientY);
    if (hit) enterWoj(hit);
  } else if (nav.level === "wojewodztwo") {
    const hit = pickPow(clientX, clientY);
    if (hit) enterPow(hit);
    else backToPolska();
  } else if (nav.level === "powiat") {
    const hit = pickGmin(clientX, clientY);
    if (hit) enterGmin(hit);
    else backToWoj();
  } else if (nav.level === "gmina") {
    backToPow();
  }
}

renderer.domElement.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "touch") return;
  if (e.button !== 0) return;
  pointerDown = { x: e.clientX, y: e.clientY };
  gesturePanned = false;
  container.classList.add("dragging");
});

controls.addEventListener("change", () => {
  if (pointerDown) gesturePanned = true;
});

function endPointer(e) {
  container.classList.remove("dragging");
  if (!pointerDown || MapFly.isFlying()) {
    pointerDown = null;
    gesturePanned = false;
    return;
  }
  const dx = e.clientX - pointerDown.x;
  const dy = e.clientY - pointerDown.y;
  const wasClick = !gesturePanned && dx * dx + dy * dy <= DRAG_THRESHOLD * DRAG_THRESHOLD;
  pointerDown = null;
  gesturePanned = false;
  if (wasClick) handleMapPick(e.clientX, e.clientY);
}

renderer.domElement.addEventListener("pointerup", endPointer);
window.addEventListener("pointerup", (e) => {
  if (pointerDown) endPointer(e);
});
renderer.domElement.addEventListener("pointercancel", () => {
  pointerDown = null;
  gesturePanned = false;
  container.classList.remove("dragging");
});

renderer.domElement.addEventListener("touchstart", (e) => {
  if (e.touches.length !== 1) {
    touchTap = null;
    return;
  }
  touchMoved = false;
  touchTap = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });

renderer.domElement.addEventListener("touchmove", (e) => {
  if (!touchTap || e.touches.length !== 1) return;
  const dx = e.touches[0].clientX - touchTap.x;
  const dy = e.touches[0].clientY - touchTap.y;
  if (dx * dx + dy * dy > DRAG_THRESHOLD_TOUCH * DRAG_THRESHOLD_TOUCH) {
    touchMoved = true;
  }
}, { passive: true });

renderer.domElement.addEventListener("touchend", (e) => {
  if (!touchTap || e.touches.length > 0) {
    touchTap = null;
    return;
  }
  const t = e.changedTouches[0];
  if (!touchMoved && !MapFly.isFlying()) {
    handleMapPick(t.clientX, t.clientY);
  }
  touchTap = null;
}, { passive: true });

renderer.domElement.addEventListener("mousemove", (e) => {
  if (MapFly.isFlying()) return;
  if (pointerDown) return;
  if (nav.level === "polska") setWojHover(pickWoj(e.clientX, e.clientY));
  else if (nav.level === "wojewodztwo") setPowHover(pickPow(e.clientX, e.clientY));
  else if (nav.level === "powiat") setGminHover(pickGmin(e.clientX, e.clientY));
  else container.style.cursor = "grab";
});

document.getElementById("backBtn").addEventListener("click", goBack);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && nav.level !== "polska") goBack();
});

async function init() {
  const loading = document.getElementById("loading");
  try {
    loading.textContent = "Ładowanie...";
    const [woj, pow, siedziby, krajDrogi, exportGeo, powiatSeats] = await Promise.all([
      loadJSON("data/wojewodztwa.geojson"),
      loadJSON("data/powiaty.geojson"),
      loadJSON("siedziby.geojson"),
      loadJSON("data/drogi_krajowa.geojson"),
      loadJSON("export.geojson"),
      loadJSON("data/powiat_siedziby.json"),
    ]);
    buildPopIndex(exportGeo);
    buildPowSeatIndex(powiatSeats);
    roadsKrajowa = krajDrogi;
    loadJSON("data/drogi_wojewodzka.geojson").then(d => {
      roadsWojewodzka = d;
      if (nav.level !== "polska") updateRoads();
    });
    loadJSON("data/drogi_powiatowa.geojson").then(d => {
      roadsPowiatowa = d;
      if (nav.level === "powiat" || nav.level === "gmina") updateRoads();
    });
    loadJSON("data/drogi_gminna.geojson").then(d => {
      roadsGminna = d;
      if (nav.level === "powiat" || nav.level === "gmina") updateRoads();
    });
    loadJSON("data/gminy.geojson").then(d => {
      gminyGeo = d;
      if (nav.level === "powiat" && nav.pow) buildGminLayerForPow(nav.pow.teryt);
    });

    wojGeo = woj;
    powGeo = pow;

    groups.polska.add(buildPolandBase(woj));
    buildWojLayer(woj);

    gminSeatsData = siedziby.features.map(f => {
      const p = f.properties;
      const [lon, lat] = f.geometry.coordinates;
      const kod = String(p.gmina_kod || p.kod || p.teryt || p["teryt:terc"] || "");
      const kind = kod.slice(-1);
      const ruralCityLinked = p.rural_city_linked === "1" || p.source === "city-gmina-linked";
      const cityGminaKod = String(p.city_gmina_kod || "");
      const gminPop = parseInt(String(p.gmina_population ?? popByGmin[kod] ?? p.population ?? "0").replace(/\s/g, ""), 10) || 0;
      const seatPop = parseInt(String(p.seat_population ?? "0").replace(/\s/g, ""), 10) || 0;
      const effectivePop = gminPop || seatPop;
      let labelPop = effectivePop;
      if (kind === "2" || kind === "3") {
        if (ruralCityLinked && cityGminaKod) {
          labelPop = popByGmin[cityGminaKod] || seatPop || gminPop;
        } else {
          labelPop = seatPop || gminPop;
        }
      }
      return {
        name: p.city_nazwa || (ruralCityLinked
          ? (p["name:pl"] || p.name)
          : (p.gmina_nazwa || p.nazwa || p["name:pl"] || p.name)) || "—",
        pop: effectivePop,
        labelPop,
        kod,
        lon, lat,
        ruralCityLinked,
        cityGminaKod,
        isWojCapital: false,
        isPowiatSeat: false,
      };
    });

    patchPopFromSeats(gminSeatsData);

    const wojSeats = findAdminSeats(woj, gminSeatsData);
    const powSeats = new Set();
    for (const feat of pow.features) {
      const { seat } = getPowiatSeat({
        teryt: feat.properties.teryt,
        feat,
        nazwa: feat.properties.nazwa,
      });
      if (seat) powSeats.add(seat);
    }
    for (const s of gminSeatsData) {
      s.isWojCapital = wojSeats.has(s);
      s.isPowiatSeat = powSeats.has(s);
    }

    setCameraView(0, 0, VIEW_POLSKA_DIST);
    loading.style.display = "none";
    refreshView();
    updateInfoPanel();

    controls.addEventListener("change", () => {
      if (MapFly.isFlying()) return;
      buildCities();
    });

  } catch (err) {
    loading.textContent = "Błąd: " + err.message;
    alert("Uruchom serwer: py -m http.server 8080\nPotem: http://localhost:8080/index.html\n\n" + err.message);
  }
}

function animate() {
  requestAnimationFrame(animate);
  if (MapFly.isFlying()) MapFly.tick();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  for (const mat of roadLineMaterials) {
    mat.resolution.set(window.innerWidth, window.innerHeight);
  }
  for (const mat of cityLineMaterials) {
    mat.resolution.set(window.innerWidth, window.innerHeight);
  }
  for (const mat of gminLineMaterials) {
    mat.resolution.set(window.innerWidth, window.innerHeight);
  }
});

init();
animate();
