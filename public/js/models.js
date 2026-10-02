// Procedural low-poly models for fruit and towers. Each model is merged into a
// single vertex-coloured geometry so hundreds of fruit stay cheap to draw.
import * as THREE from 'three';
import { FRUITS, TOWERS } from './data.js';

const tmpColor = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

export const MAT = {
  vc: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 }),
  metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.55 }),
  glass: new THREE.MeshStandardMaterial({ color: 0xd8f7ff, transparent: true, opacity: 0.25, roughness: 0.05, metalness: 0.1, depthWrite: false }),
  ice: new THREE.MeshStandardMaterial({ color: 0xbff1ff, emissive: 0x3fb7ff, emissiveIntensity: 0.7, roughness: 0.15, transparent: true, opacity: 0.92 }),
  zap: new THREE.MeshStandardMaterial({ color: 0xfff6b0, emissive: 0xffe14d, emissiveIntensity: 1.3 }),
  laser: new THREE.MeshStandardMaterial({ color: 0xf3d6ff, emissive: 0xc86bfa, emissiveIntensity: 1.6 }),
  pilot: new THREE.MeshStandardMaterial({ color: 0xffd08a, emissive: 0xff6a00, emissiveIntensity: 1.5 }),
};
const ownerMats = new Map();
export function ownerMaterial(color) {
  if (!ownerMats.has(color)) {
    ownerMats.set(color, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.4 }));
  }
  return ownerMats.get(color);
}

// ------------------------------------------------------------ geometry utils
const hash = (x, y, z) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
};
const qhash = (x, y, z, q = 40) => hash(Math.round(x * q), Math.round(y * q), Math.round(z * q));

function mix(a, b, t) {
  const ca = new THREE.Color(a), cb = new THREE.Color(b);
  return ca.lerp(cb, Math.max(0, Math.min(1, t)));
}

// Bake a primitive into a non-indexed, vertex-coloured, transformed geometry.
function part(geometry, color, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1], q = null } = {}) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  geometry.dispose();
  const pos = g.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = typeof color === 'function' ? color(pos.getX(i), pos.getY(i), pos.getZ(i)) : color;
    tmpColor.set(c);
    cols[i * 3] = tmpColor.r;
    cols[i * 3 + 1] = tmpColor.g;
    cols[i * 3 + 2] = tmpColor.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const quat = q || new THREE.Quaternion().setFromEuler(new THREE.Euler(...r));
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), quat, new THREE.Vector3(...s)));
  return g;
}

function merge(parts) {
  const list = parts.flat();
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

const sphere = (r, w = 16, h = 12) => new THREE.SphereGeometry(r, w, h);
const cyl = (rt, rb, h, seg = 12, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
const cone = (r, h, seg = 8) => new THREE.ConeGeometry(r, h, seg);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const lathe = (pts, seg = 18) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);

function fib(n) {
  const out = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    out.push(new THREE.Vector3(Math.cos(ga * i) * r, y, Math.sin(ga * i) * r));
  }
  return out;
}

// Googly eyes facing +x, placed on a sphere of radius R centred at height cy.
function eyes(R, cy = R, { el = 0.42, az = 0.42, size = 0.27, out = 1 } = {}) {
  const parts = [];
  const sz = R * size;
  for (const side of [-1, 1]) {
    const d = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az) * side);
    const c = d.clone().multiplyScalar(R * out * 0.97).add(new THREE.Vector3(0, cy, 0));
    parts.push(part(sphere(sz, 10, 8), '#ffffff', { p: c.toArray() }));
    const pc = c.clone().add(d.clone().multiplyScalar(sz * 0.62)).add(new THREE.Vector3(sz * 0.12, 0, 0));
    parts.push(part(sphere(sz * 0.52, 8, 6), '#15121a', { p: pc.toArray() }));
    const hl = pc.clone().add(new THREE.Vector3(sz * 0.22, sz * 0.22, -side * sz * 0.05));
    parts.push(part(sphere(sz * 0.14, 6, 4), '#ffffff', { p: hl.toArray() }));
  }
  return parts;
}

function leaf(len, color = '#3c9a3c', opts = {}) {
  return part(sphere(len * 0.5, 8, 6), color, { s: [1, 0.18, 0.45], ...opts });
}

// ------------------------------------------------------------------ fruit
const FRUIT_BUILDERS = {
  raspberry(R) {
    const parts = [];
    const cy = R * 1.05;
    for (const d of fib(38)) {
      if (d.y < -0.75) continue;
      const p = new THREE.Vector3(d.x * R * 0.82, d.y * R * 0.95 + cy, d.z * R * 0.82);
      parts.push(part(sphere(R * 0.3, 8, 6), hash(p.x, p.y, p.z) > 0.5 ? '#d81b4a' : '#b8123c', { p: p.toArray() }));
    }
    parts.push(part(cone(R * 0.45, R * 0.25, 6), '#4c8c2e', { p: [0, cy + R * 0.98, 0], r: [Math.PI, 0, 0] }));
    parts.push(eyes(R, cy, { out: 1.08 }));
    return parts;
  },
  seed(R) {
    return [
      part(new THREE.IcosahedronGeometry(R, 1), (x, y, z) => mix('#c2002f', '#ff4d6d', y / R + 0.3), { p: [0, R * 1.1, 0], s: [1, 1.25, 1] }),
      eyes(R, R * 1.1, { size: 0.32 }),
    ];
  },
  blueberry(R) {
    return [
      part(sphere(R, 16, 12), (x, y, z) => (qhash(x, y, z, 60) > 0.6 ? '#6c7fd6' : '#3b4fb8'), { p: [0, R, 0] }),
      part(new THREE.TorusGeometry(R * 0.28, R * 0.09, 5, 10), '#1d2659', { p: [0, R * 1.95, 0], r: [Math.PI / 2, 0, 0] }),
      eyes(R, R),
    ];
  },
  strawberry(R) {
    const body = lathe([[0, 0], [R * 0.45, R * 0.3], [R * 0.85, R * 0.85], [R, R * 1.3], [R * 0.85, R * 1.62], [R * 0.4, R * 1.78], [0, R * 1.8]], 18);
    const parts = [part(body, (x, y, z) => (qhash(x, y, z, 50) > 0.9 ? '#ffe066' : '#e8273b'))];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      parts.push(leaf(R * 0.8, '#3c9a3c', { p: [Math.cos(a) * R * 0.35, R * 1.8, Math.sin(a) * R * 0.35], r: [0, -a, 0.25] }));
    }
    parts.push(part(cyl(R * 0.06, R * 0.08, R * 0.35, 6), '#3c7a2c', { p: [0, R * 1.95, 0] }));
    parts.push(eyes(R, R * 1.2, { el: 0.3 }));
    return parts;
  },
  grape(R) {
    return [
      part(sphere(R, 16, 12), (x, y, z) => mix('#7d3c98', '#a35cc0', qhash(x, y, z, 30) * 0.6 + y / R * 0.2), { p: [0, R * 1.1, 0], s: [1, 1.12, 1] }),
      part(cyl(R * 0.07, R * 0.1, R * 0.35, 5), '#6b5a2a', { p: [0, R * 2.25, 0] }),
      eyes(R, R * 1.1),
    ];
  },
  banana(R) {
    const arc = Math.PI * 0.72;
    const tor = new THREE.TorusGeometry(R * 1.25, R * 0.36, 10, 22, arc);
    const parts = [part(tor, (x, y) => {
      const a = Math.atan2(y, x) / arc;
      if (a < 0.05 || a > 0.95) return '#5a4a1a';
      if (a < 0.14 || a > 0.86) return '#c9c43a';
      return qhash(x, y, 0, 25) > 0.93 ? '#a07d1c' : '#f7d038';
    }, { r: [0, 0, -(arc / 2 + Math.PI / 2)], p: [0, R * 1.25 + R * 0.36, 0] })];
    parts.push(eyes(R * 0.5, R * 0.62, { size: 0.42, el: 0.5, az: 0.55, out: 1.05 }).map((g) => {
      g.translate(R * 0.05, 0, 0);
      return g;
    }));
    return parts;
  },
  peach(R) {
    return [
      part(sphere(R, 18, 14), (x, y, z) => {
        if (Math.abs(z) < R * 0.07 && x > 0) return '#e0705a';
        return mix('#ffc98a', '#ff6b5e', (y / R) * 0.35 + (x / R) * 0.45 + 0.35);
      }, { p: [0, R * 0.98, 0], s: [1, 0.96, 1] }),
      leaf(R * 0.9, '#4f9a3a', { p: [-R * 0.25, R * 1.95, 0], r: [0, 0, 0.35] }),
      part(cyl(R * 0.05, R * 0.06, R * 0.25, 5), '#6b4a2a', { p: [0, R * 1.95, 0] }),
      eyes(R, R * 0.98, { az: 0.5 }),
    ];
  },
  slice(R) {
    // A watermelon wedge lying flat: rind arc in front, tip trailing behind.
    const W = R * 1.6;
    const th = Math.PI / 2.6;
    const t0 = Math.PI / 2 - th / 2;
    const flesh = part(new THREE.CylinderGeometry(W * 0.84, W * 0.84, R * 0.5, 12, 1, false, t0, th), '#ff4d6d', { p: [-W * 0.5, R * 0.25, 0] });
    const rind = part(new THREE.CylinderGeometry(W, W, R * 0.4, 12, 1, false, t0, th), (x, y, z) => (Math.hypot(x, z) > W * 0.95 ? '#1e6b2e' : '#f4f1d0'), { p: [-W * 0.5, R * 0.2, 0] });
    const parts = [flesh, rind];
    for (let i = 0; i < 4; i++) {
      const a = (i - 1.5) * 0.17;
      parts.push(part(sphere(R * 0.06, 5, 4), '#1a1a1a', { p: [-W * 0.5 + Math.cos(a) * W * 0.5, R * 0.5, Math.sin(a) * W * 0.5], s: [1.4, 0.5, 0.8] }));
    }
    parts.push(eyes(R * 0.32, R * 0.5, { size: 0.5, el: 0.55, az: 0.7, out: 1.0 }).map((g) => g.translate(W * 0.1, 0, 0)));
    return parts;
  },
  kiwi(R) {
    return [
      part(sphere(R, 18, 12), (x, y, z) => mix('#7a5a30', '#a8844e', qhash(x, y, z, 70)), { p: [0, R * 0.95, 0], s: [1.2, 0.95, 0.95] }),
      eyes(R, R * 0.95, { az: 0.38, out: 1.15 }),
    ];
  },
  apple(R) {
    const body = lathe([[0, R * 0.12], [R * 0.5, R * 0.02], [R * 0.92, R * 0.45], [R, R * 0.98], [R * 0.86, R * 1.55], [R * 0.45, R * 1.82], [R * 0.12, R * 1.72], [0, R * 1.62]], 20);
    return [
      part(body, (x, y, z) => mix('#e63946', '#b5161b', qhash(x, y * 0.3, z, 20) * 0.7) .lerp(new THREE.Color('#f6c445'), Math.max(0, -x / R) * 0.35)),
      part(cyl(R * 0.04, R * 0.05, R * 0.4, 5), '#5a3a1a', { p: [0, R * 1.85, 0], r: [0, 0, 0.15] }),
      leaf(R * 0.75, '#4caf50', { p: [-R * 0.2, R * 1.95, R * 0.1], r: [0.3, 0.4, 0.4] }),
      eyes(R, R * 1.0),
    ];
  },
  orange(R) {
    const g = sphere(R, 26, 18);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      v.multiplyScalar(1 + (qhash(v.x, v.y, v.z, 45) - 0.5) * 0.05);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return [
      part(g, (x, y, z) => mix('#ff9a2e', '#f07b0e', qhash(x, y, z, 45)), { p: [0, R, 0] }),
      part(cyl(R * 0.08, R * 0.1, R * 0.12, 6), '#4c7a2c', { p: [0, R * 2, 0] }),
      eyes(R, R),
    ];
  },
  avocado(R) {
    const body = lathe([[0, 0], [R * 0.7, R * 0.12], [R * 0.95, R * 0.55], [R * 0.85, R * 1.1], [R * 0.6, R * 1.6], [R * 0.38, R * 1.95], [0, R * 2.05]], 18);
    return [
      part(body, (x, y, z) => {
        const n = qhash(x, y, z, 80);
        return n > 0.75 ? '#4f6e28' : n < 0.25 ? '#253a12' : '#3d5a1e';
      }),
      part(cyl(R * 0.05, R * 0.07, R * 0.2, 5), '#4a3420', { p: [0, R * 2.1, 0] }),
      eyes(R * 0.9, R * 0.95, { az: 0.45 }),
    ];
  },
  pomegranate(R) {
    const parts = [part(sphere(R, 18, 14), (x, y, z) => mix('#b3191e', '#7d1013', qhash(x, y, z, 25) * 0.6 + (y < 0 ? 0.2 : 0)), { p: [0, R, 0] })];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      parts.push(part(cone(R * 0.12, R * 0.4, 4), '#7d1013', { p: [Math.cos(a) * R * 0.2, R * 2.05, Math.sin(a) * R * 0.2], r: [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5] }));
    }
    parts.push(part(cyl(R * 0.28, R * 0.22, R * 0.2, 10), '#8c1418', { p: [0, R * 1.92, 0] }));
    parts.push(eyes(R, R));
    return parts;
  },
  pineapple(R) {
    const parts = [part(sphere(R * 0.85, 18, 16), (x, y, z) => {
      const u = Math.atan2(z, x), v = y / R;
      const pat = Math.sin(u * 6 + v * 9) * Math.sin(u * 6 - v * 9);
      return pat > 0.15 ? '#e8b33a' : pat < -0.4 ? '#8a5a16' : '#c98f22';
    }, { p: [0, R * 1.15, 0], s: [1, 1.35, 1] })];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const tilt = i % 2 ? 0.45 : 0.25;
      const h = R * (i % 2 ? 0.9 : 1.2);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt));
      parts.push(part(cone(R * 0.13, h, 4), i % 2 ? '#3f8f3a' : '#2f7a2e', { p: [Math.cos(a) * R * 0.12, R * 2.2 + h / 2, Math.sin(a) * R * 0.12], q }));
    }
    parts.push(eyes(R * 0.85, R * 1.15, { az: 0.45, out: 1.05 }));
    return parts;
  },
  watermelon(R) {
    return [
      part(sphere(R, 30, 18), (x, y, z) => {
        const a = Math.atan2(y, z);
        return Math.sin(a * 7 + Math.sin(x * 5 / R) * 0.7) > 0.2 ? '#1c5a28' : '#3fa34d';
      }, { p: [0, R * 0.9, 0], s: [1.25, 0.9, 0.9] }),
      part(cyl(R * 0.05, R * 0.06, R * 0.18, 5), '#5a4a1a', { p: [-R * 1.24, R * 0.95, 0], r: [0, 0, Math.PI / 2] }),
      eyes(R * 0.9, R * 0.95, { az: 0.38, el: 0.35, size: 0.24, out: 1.4 }),
    ];
  },
  durian(R) {
    const parts = [part(sphere(R, 16, 12), '#a7b546', { p: [0, R, 0], s: [1, 1.05, 1] })];
    for (const d of fib(64)) {
      const q = new THREE.Quaternion().setFromUnitVectors(UP, d);
      const p = d.clone().multiplyScalar(R * 0.98).add(new THREE.Vector3(0, R, 0));
      parts.push(part(cone(R * 0.11, R * 0.34, 5), '#7e8b2a', { p: p.add(d.clone().multiplyScalar(R * 0.14)).toArray(), q }));
    }
    parts.push(part(cyl(R * 0.07, R * 0.1, R * 0.35, 6), '#5a4a2a', { p: [0, R * 2.15, 0] }));
    parts.push(eyes(R, R, { az: 0.36, out: 1.12 }));
    return parts;
  },
  coconut(R, king = false) {
    const parts = [part(sphere(R, 20, 14), (x, y, z) => {
      const n = qhash(x * 0.4, y * 3, z * 0.4, 30);
      return n > 0.7 ? '#86593a' : n < 0.3 ? '#4f301b' : '#6b4226';
    }, { p: [0, R * 0.98, 0], s: [1, 0.98, 1] })];
    parts.push(eyes(R, R * 0.98, { size: 0.24 }));
    // Angry brows - coconuts mean business.
    for (const side of [-1, 1]) {
      parts.push(part(box(R * 0.32, R * 0.07, R * 0.08), '#2a170c', { p: [R * 0.86, R * 1.66, side * R * 0.3], r: [side * 0.45, 0, 0], s: [1, 1, 1] }));
    }
    if (king) {
      parts.push(part(cyl(R * 0.42, R * 0.48, R * 0.28, 12, true), '#ffcc33', { p: [0, R * 2.02, 0] }));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        parts.push(part(cone(R * 0.09, R * 0.28, 4), '#ffcc33', { p: [Math.cos(a) * R * 0.44, R * 2.28, Math.sin(a) * R * 0.44] }));
        parts.push(part(sphere(R * 0.05, 6, 4), i % 2 ? '#e63946' : '#3fa7ff', { p: [Math.cos(a) * R * 0.47, R * 2.0, Math.sin(a) * R * 0.47] }));
      }
    }
    return parts;
  },
  kingcoconut(R) {
    return FRUIT_BUILDERS.coconut(R, true);
  },
};

const fruitGeoCache = new Map();
export function fruitGeometry(type) {
  if (!fruitGeoCache.has(type)) {
    const f = FRUITS[type];
    fruitGeoCache.set(type, merge(FRUIT_BUILDERS[f.key](f.radius)));
  }
  return fruitGeoCache.get(type);
}

export function makeFruitMesh(type) {
  const mesh = new THREE.Mesh(fruitGeometry(type), MAT.vc);
  mesh.castShadow = true;
  return mesh;
}

// ------------------------------------------------------------------ towers
// Each builder returns { body: parts[], head: parts[] | null, headY, extras: Object3D[] }.
const TOWER_BUILDERS = {
  toothpick(level) {
    const head = [
      part(box(0.3, 0.2, 0.3), '#e8b77d'),
      part(cyl(0.06, 0.06, 0.12, 8), '#a8743f', { p: [0.16, 0, 0], r: [0, 0, Math.PI / 2] }),
    ];
    const barrels = level >= 2 ? [-0.07, 0.07] : [0];
    for (const z of barrels) {
      head.push(part(cyl(0.032, 0.032, 0.55, 6), '#f3e2c4', { p: [0.42, 0.02, z], r: [0, 0, Math.PI / 2] }));
      head.push(part(cone(0.032, 0.1, 6), '#fff6e0', { p: [0.74, 0.02, z], r: [0, 0, -Math.PI / 2] }));
    }
    return {
      body: [part(cyl(0.25, 0.3, 0.36, 12), '#d9a066', { p: [0, 0.28, 0] }), part(cyl(0.265, 0.265, 0.05, 12), '#a8743f', { p: [0, 0.4, 0] })],
      head, headY: 0.55,
    };
  },
  cannon(level) {
    const head = [
      part(sphere(0.17, 12, 10), '#4a7330'),
      part(cyl(0.11, 0.14, 0.46, 12), '#2f3a2a', { p: [0.22, 0.07, 0], r: [0, 0, -Math.PI / 2 + 0.3] }),
      part(new THREE.TorusGeometry(0.115, 0.03, 6, 14), level >= 3 ? '#ffd34d' : '#5b8c3a', { p: [0.43, 0.14, 0], r: [0, Math.PI / 2, 0.3] }),
    ];
    return {
      body: [part(new THREE.SphereGeometry(0.32, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), (x, y, z) => (qhash(x, y, z, 12) > 0.6 ? '#6fa04a' : '#5b8c3a'), { p: [0, 0.1, 0] })],
      head, headY: 0.42,
    };
  },
  freezer(level) {
    const body = [
      part(box(0.56, 0.66, 0.5), '#eef8ff', { p: [0, 0.43, 0] }),
      part(box(0.02, 0.6, 0.46), '#c5dbe8', { p: [0.285, 0.43, 0] }),
      part(box(0.04, 0.22, 0.05), '#8fa3b3', { p: [0.3, 0.5, 0.15] }),
      part(box(0.58, 0.04, 0.52), '#bcd4e3', { p: [0, 0.6, 0] }),
      part(box(0.4, 0.05, 0.36), '#9fe7ff', { p: [0, 0.78, 0] }),
    ];
    if (level >= 3) body.push(part(box(0.6, 0.04, 0.54), '#ffd34d', { p: [0, 0.25, 0] }));
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.17 + level * 0.02, 0), MAT.ice);
    crystal.position.y = 1.0;
    crystal.scale.y = 1.4;
    crystal.castShadow = true;
    crystal.userData.spin = 1.5;
    crystal.userData.bob = 1.0;
    return { body, head: null, extras: [crystal] };
  },
  skewer(level) {
    const head = [
      part(box(0.18, 0.14, 0.22), '#5b6370'),
      part(cyl(0.022, 0.022, 1.0, 6), '#e3e8ee', { p: [0.42, 0.02, 0], r: [0, 0, Math.PI / 2] }),
      part(cone(0.03, 0.12, 6), '#ffffff', { p: [0.98, 0.02, 0], r: [0, 0, -Math.PI / 2] }),
      part(cyl(0.035, 0.035, 0.14, 8), '#2b2f36', { p: [0.0, 0.11, 0.0], r: [0, 0, Math.PI / 2] }),
    ];
    const body = [
      part(cyl(0.13, 0.22, 0.78, 10), '#8d96a3', { p: [0, 0.48, 0] }),
      part(new THREE.TorusGeometry(0.15, 0.03, 6, 14), level >= 3 ? '#ffd34d' : '#5b6370', { p: [0, 0.6, 0], r: [Math.PI / 2, 0, 0] }),
    ];
    return { body, head, headY: 0.95, headMat: 'metal' };
  },
  peeler(level) {
    const head = [
      part(box(0.34, 0.09, 0.1), '#2d2d2d', { p: [-0.05, 0, 0] }),
      part(new THREE.TorusGeometry(0.13, 0.022, 6, 16), '#cfd5dc', { p: [0.24, 0.0, 0], r: [Math.PI / 2, 0, 0] }),
      part(box(0.04, 0.02, 0.24), '#f0f3f6', { p: [0.3, 0.0, 0] }),
    ];
    const body = [
      part(cyl(0.24, 0.29, 0.42, 12), '#ff9f1c', { p: [0, 0.31, 0] }),
      part(cyl(0.12, 0.16, 0.14, 10), '#d9820f', { p: [0, 0.58, 0] }),
    ];
    if (level >= 3) body.push(part(cyl(0.255, 0.255, 0.05, 12), '#ffd34d', { p: [0, 0.48, 0] }));
    return { body, head, headY: 0.68, spinHead: false };
  },
  blowtorch(level) {
    const head = [
      part(box(0.16, 0.14, 0.16), '#c9a227'),
      part(cyl(0.05, 0.08, 0.42, 10), '#c9a227', { p: [0.25, 0.02, 0], r: [0, 0, Math.PI / 2] }),
      part(cyl(0.065, 0.065, 0.06, 10), '#333333', { p: [0.47, 0.02, 0], r: [0, 0, Math.PI / 2] }),
    ];
    const body = [
      part(cyl(0.22, 0.24, 0.5, 14), '#ff4d2e', { p: [0, 0.35, 0] }),
      part(new THREE.SphereGeometry(0.22, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#ff4d2e', { p: [0, 0.6, 0] }),
      part(cyl(0.235, 0.235, 0.06, 14), level >= 3 ? '#ffd34d' : '#b8321c', { p: [0, 0.3, 0] }),
    ];
    const pilot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), MAT.pilot);
    pilot.position.set(0.53, 0.02, 0);
    return { body, head, headY: 0.8, headExtras: [pilot] };
  },
  zapper(level) {
    const body = [
      part(cyl(0.3, 0.34, 0.14, 12), '#4a4a52', { p: [0, 0.17, 0] }),
      part(cyl(0.05, 0.07, 0.75, 8), '#8a5a2b', { p: [0, 0.55, 0] }),
    ];
    for (let i = 0; i < 4; i++) {
      body.push(part(new THREE.TorusGeometry(0.24 - i * 0.035, 0.035, 6, 16), i % 2 ? '#d38b45' : '#b87333', { p: [0, 0.32 + i * 0.13, 0], r: [Math.PI / 2, 0, 0] }));
    }
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.12 + level * 0.015, 14, 10), MAT.zap);
    orb.position.y = 1.0;
    orb.userData.pulse = true;
    return { body, head: null, extras: [orb] };
  },
  laser(level) {
    const head = [
      part(box(0.36, 0.22, 0.26), '#c86bfa'),
      part(cyl(0.08, 0.1, 0.24, 10), '#3a2850', { p: [0.27, 0, 0], r: [0, 0, Math.PI / 2] }),
      part(box(0.2, 0.04, 0.28), level >= 3 ? '#ffd34d' : '#7a3fa0', { p: [-0.02, 0.13, 0] }),
    ];
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), MAT.laser);
    lens.position.set(0.4, 0, 0);
    return {
      body: [part(cyl(0.3, 0.34, 0.36, 6), '#5e2f80', { p: [0, 0.28, 0] }), part(cyl(0.1, 0.14, 0.14, 8), '#3a2850', { p: [0, 0.52, 0] })],
      head, headY: 0.66, headExtras: [lens],
    };
  },
  mortar(level) {
    const head = [
      part(sphere(0.19, 12, 10), '#495057'),
      part(cyl(0.15, 0.18, 0.42, 12), '#343a40', { p: [0.1, 0.16, 0], r: [0, 0, -0.75] }),
      part(new THREE.TorusGeometry(0.155, 0.035, 6, 14), level >= 3 ? '#ffd34d' : '#6c757d', { p: [0.24, 0.3, 0], r: [Math.PI / 2, 0.75, 0] }),
    ];
    return {
      body: [part(cyl(0.36, 0.42, 0.24, 14), '#6c757d', { p: [0, 0.22, 0] }), part(new THREE.TorusGeometry(0.37, 0.04, 6, 18), '#495057', { p: [0, 0.34, 0], r: [Math.PI / 2, 0, 0] })],
      head, headY: 0.45,
    };
  },
  blender(level) {
    const body = [
      part(box(0.58, 0.32, 0.58), '#4dd2c2', { p: [0, 0.26, 0] }),
      part(sphere(0.04, 8, 6), '#ff5a5f', { p: [0.29, 0.28, -0.1] }),
      part(sphere(0.04, 8, 6), '#7bd389', { p: [0.29, 0.28, 0.1] }),
      part(cyl(0.24, 0.24, 0.06, 16), '#2d2d2d', { p: [0, 0.44, 0] }),
      part(cyl(0.26, 0.26, 0.07, 16), '#2d2d2d', { p: [0, 1.0, 0] }),
    ];
    if (level >= 3) body.push(part(box(0.6, 0.04, 0.6), '#ffd34d', { p: [0, 0.13, 0] }));
    const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.21, 0.56, 18, 1, true), MAT.glass);
    jar.position.y = 0.72;
    const bladeGeo = merge([
      part(box(0.4, 0.02, 0.07), '#e3e8ee', { r: [0.25, 0, 0] }),
      part(box(0.07, 0.02, 0.4), '#e3e8ee', { r: [0, 0, 0.25] }),
      part(cyl(0.03, 0.03, 0.1, 8), '#9aa4ae', { p: [0, -0.04, 0] }),
    ]);
    const blades = new THREE.Mesh(bladeGeo, MAT.metal);
    blades.position.y = 0.55;
    blades.userData.blades = true;
    return { body, head: null, extras: [jar, blades] };
  },
};

const towerGeoCache = new Map();

export function makeTowerModel(type, level, ownerColor) {
  const def = TOWERS[type];
  const key = `${type}:${level}`;
  let cached = towerGeoCache.get(key);
  const spec = TOWER_BUILDERS[def.key](level);
  if (!cached) {
    const pips = [];
    for (let i = 0; i < level; i++) pips.push(part(sphere(0.045, 8, 6), '#ffd34d', { p: [0.34, 0.13, -0.16 + i * 0.16] }));
    const body = merge([part(box(0.86, 0.1, 0.86), '#4a4453', { p: [0, 0.05, 0] }), pips, spec.body]);
    const head = spec.head ? merge(spec.head) : null;
    cached = { body, head };
    towerGeoCache.set(key, cached);
  }
  const group = new THREE.Group();
  const scale = 1 + (level - 1) * 0.06;
  const body = new THREE.Mesh(cached.body, MAT.vc);
  body.castShadow = true;
  body.receiveShadow = true;
  body.scale.setScalar(scale);
  group.add(body);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.035, 6, 32), ownerMaterial(ownerColor));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.105;
  group.add(ring);
  let head = null;
  if (cached.head) {
    head = new THREE.Group();
    const hm = new THREE.Mesh(cached.head, spec.headMat ? MAT[spec.headMat] : MAT.vc);
    hm.castShadow = true;
    head.add(hm);
    for (const e of spec.headExtras || []) head.add(e);
    head.position.y = spec.headY * scale;
    head.scale.setScalar(scale);
    group.add(head);
  }
  const extras = spec.extras || [];
  for (const e of extras) {
    e.position.y *= scale;
    e.scale.multiplyScalar(scale);
    group.add(e);
  }
  // Tip of the weapon in head-local space, used to spawn projectiles and beams.
  const muzzle = { toothpick: 0.75, cannon: 0.45, skewer: 0.9, peeler: 0.3, blowtorch: 0.55, laser: 0.42, mortar: 0.3 }[def.key] || 0;
  group.userData = { head, extras, muzzle, headY: spec.headY ? spec.headY * scale : 0.9 * scale, kind: def.kind };
  return group;
}

// Wall: a stack of wooden crates.
export function makeWallGeometry() {
  return merge([
    part(box(0.94, 0.62, 0.94), (x, y, z) => {
      const edge = Math.max(Math.abs(x), Math.abs(z)) > 0.42 || Math.abs(y) > 0.27;
      return edge ? '#8a5a32' : qhash(x, y, z, 8) > 0.5 ? '#c4935c' : '#b5834e';
    }, { p: [0, 0.31, 0] }),
    part(box(0.96, 0.06, 0.2), '#7a4e2a', { p: [0, 0.62, 0], r: [0, Math.PI / 4, 0] }),
    part(box(0.96, 0.06, 0.2), '#7a4e2a', { p: [0, 0.62, 0], r: [0, -Math.PI / 4, 0] }),
  ]);
}

// --------------------------------------------------------------- thumbnails
let thumbRenderer = null;
export function renderThumbnails() {
  const size = 128;
  thumbRenderer = thumbRenderer || new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  thumbRenderer.setSize(size, size);
  thumbRenderer.setPixelRatio(1);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x554466, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
  const shot = (obj, h, dist) => {
    scene.add(obj);
    cam.position.set(dist * 0.85, h + dist * 0.55, dist * 0.75);
    cam.lookAt(0, h, 0);
    thumbRenderer.render(scene, cam);
    scene.remove(obj);
    return thumbRenderer.domElement.toDataURL('image/png');
  };
  const towers = TOWERS.map((t, i) => {
    const m = makeTowerModel(i, 1, '#ffc93c');
    if (m.userData.head) m.userData.head.rotation.y = -0.6;
    return shot(m, 0.42, 1.75);
  });
  const wallMesh = new THREE.Mesh(makeWallGeometry(), MAT.vc);
  const wall = shot(wallMesh, 0.3, 1.6);
  const fruits = FRUITS.map((f, i) => {
    const m = makeFruitMesh(i);
    m.rotation.y = f.key === 'banana' ? 0.7 : -0.5;
    const s = 0.42 / f.radius;
    m.scale.setScalar(s);
    return shot(m, 0.42, 1.55);
  });
  return { towers, wall, fruits };
}
