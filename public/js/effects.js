// Visual-only effects: particles, projectiles, lightning, rings and juice splats.
import * as THREE from 'three';

const dummy = new THREE.Object3D();
const tmpC = new THREE.Color();

export class Particles {
  constructor(scene, material, max = 2000) {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    this.mesh = new THREE.InstancedMesh(geo, material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.max = max;
    this.list = [];
    scene.add(this.mesh);
  }

  spawn(o) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({
      x: o.x, y: o.y, z: o.z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      life: o.life || 0.6, max: o.life || 0.6, size: o.size || 0.06, gravity: o.gravity ?? 9.8,
      drag: o.drag || 0, color: new THREE.Color(o.color || '#ffffff'), floor: o.floor ?? 0.02, grow: o.grow || 0,
    });
  }

  burst(x, y, z, color, n, { speed = 2.5, up = 2.5, size = 0.06, life = 0.7, gravity = 9.8, spread = 1 } = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.spawn({
        x: x + (Math.random() - 0.5) * 0.1 * spread, y, z: z + (Math.random() - 0.5) * 0.1 * spread,
        vx: Math.cos(a) * s, vy: up * (0.4 + Math.random() * 0.8), vz: Math.sin(a) * s,
        size: size * (0.6 + Math.random() * 0.8), life: life * (0.6 + Math.random() * 0.6), gravity, color,
      });
    }
  }

  update(dt) {
    const list = this.list;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= p.gravity * dt;
      if (p.drag) {
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k;
        p.vy *= k;
        p.vz *= k;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < p.floor) {
        p.y = p.floor;
        p.vy *= -0.25;
        p.vx *= 0.6;
        p.vz *= 0.6;
      }
      list[w++] = p;
    }
    list.length = w;
    for (let i = 0; i < w; i++) {
      const p = list[i];
      const k = p.life / p.max;
      dummy.position.set(p.x, p.y, p.z);
      dummy.scale.setScalar(p.size * (p.grow ? 1 + (1 - k) * p.grow : Math.min(1, k * 2.5)));
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
      this.mesh.setColorAt(i, p.color);
    }
    this.mesh.count = w;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// ----------------------------------------------------------------- projectiles
const PROJ_GEO = {
  dart: new THREE.CylinderGeometry(0.02, 0.02, 0.32, 5).rotateZ(Math.PI / 2),
  peel: new THREE.TorusGeometry(0.1, 0.03, 4, 10, Math.PI * 1.3),
  cannon: new THREE.SphereGeometry(0.085, 8, 6),
  mortar: new THREE.SphereGeometry(0.17, 12, 8),
  skewer: new THREE.CylinderGeometry(0.02, 0.02, 0.9, 5).rotateZ(Math.PI / 2),
};
const PROJ_MAT = {
  dart: new THREE.MeshStandardMaterial({ color: 0xf3e2c4, roughness: 0.6 }),
  peel: new THREE.MeshStandardMaterial({ color: 0xffb347, roughness: 0.5, side: THREE.DoubleSide }),
  cannon: new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.6 }),
  mortar: new THREE.MeshStandardMaterial({ color: 0x2d8a3e, roughness: 0.5 }),
  skewer: new THREE.MeshStandardMaterial({ color: 0xe3e8ee, roughness: 0.25, metalness: 0.7 }),
};
const ARC = { cannon: 0.9, mortar: 4.5 };

export class Projectiles {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.pool = {};
  }

  take(kind) {
    const pool = (this.pool[kind] ||= []);
    const m = pool.pop() || new THREE.Mesh(PROJ_GEO[kind], PROJ_MAT[kind]);
    m.castShadow = kind === 'mortar';
    this.scene.add(m);
    return m;
  }

  // from: Vector3, target: () => {x, y, z} | null, to: fallback {x, y, z}
  spawn(kind, from, target, to, dur) {
    const mesh = this.take(kind);
    mesh.position.copy(from);
    this.list.push({ kind, mesh, from: from.clone(), target, to: { ...to }, dur: Math.max(0.05, dur), t: 0, spin: Math.random() * 6 });
  }

  update(dt) {
    const keep = [];
    for (const p of this.list) {
      p.t += dt;
      const k = Math.min(1, p.t / p.dur);
      if (p.target) {
        const tp = p.target();
        if (tp) p.to = tp;
      }
      const prev = p.mesh.position.clone();
      const x = p.from.x + (p.to.x - p.from.x) * k;
      const z = p.from.z + (p.to.z - p.from.z) * k;
      let y = p.from.y + (p.to.y - p.from.y) * k;
      if (ARC[p.kind]) y += Math.sin(k * Math.PI) * ARC[p.kind] * Math.min(1, p.dur);
      p.mesh.position.set(x, y, z);
      if (p.kind === 'peel') {
        p.spin += dt * 25;
        p.mesh.rotation.set(Math.PI / 2, p.spin, 0);
      } else {
        const d = p.mesh.position.clone().sub(prev);
        if (d.lengthSq() > 1e-8) {
          p.mesh.rotation.set(0, Math.atan2(-d.z, d.x), Math.atan2(d.y, Math.hypot(d.x, d.z)));
        }
      }
      if (k >= 1) {
        this.scene.remove(p.mesh);
        this.pool[p.kind].push(p.mesh);
      } else keep.push(p);
    }
    this.list = keep;
  }
}

// -------------------------------------------------------------------- bolts
export class Bolts {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.material = new THREE.MeshBasicMaterial({ color: 0xfff27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  }

  spawn(points, color = 0xfff27a, width = 0.035, life = 0.18) {
    const jag = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const segs = Math.max(2, Math.round(a.distanceTo(b) / 0.25));
      for (let s = 0; s < segs; s++) {
        const p = a.clone().lerp(b, s / segs);
        if (s > 0) p.add(new THREE.Vector3((Math.random() - 0.5) * 0.22, (Math.random() - 0.5) * 0.22, (Math.random() - 0.5) * 0.22));
        jag.push(p);
      }
    }
    jag.push(points[points.length - 1].clone());
    if (jag.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(jag, false, 'catmullrom', 0.1);
    const geo = new THREE.TubeGeometry(curve, jag.length * 2, width, 4, false);
    const mat = this.material.clone();
    mat.color.set(color);
    const mesh = new THREE.Mesh(geo, mat);
    this.scene.add(mesh);
    this.list.push({ mesh, life, max: life });
  }

  update(dt) {
    this.list = this.list.filter((b) => {
      b.life -= dt;
      if (b.life <= 0) {
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mesh.material.dispose();
        return false;
      }
      b.mesh.material.opacity = b.life / b.max;
      return true;
    });
  }
}

// -------------------------------------------------------------------- rings
const RING_GEO = new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2);
const DISC_GEO = new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2);

export class Rings {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
  }

  // Expanding ring (shockwave / frost pulse) or sphere flash.
  spawn({ x, z, y = 0.05, r0 = 0.1, r1 = 1, life = 0.4, color = 0xffffff, opacity = 0.8, sphere = false }) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, blending: sphere ? THREE.AdditiveBlending : THREE.NormalBlending });
    const geo = sphere ? new THREE.SphereGeometry(1, 16, 10) : RING_GEO;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(r0);
    this.scene.add(mesh);
    this.list.push({ mesh, r0, r1, life, max: life, opacity, sphere });
  }

  update(dt) {
    this.list = this.list.filter((r) => {
      r.life -= dt;
      if (r.life <= 0) {
        this.scene.remove(r.mesh);
        r.mesh.material.dispose();
        if (r.sphere) r.mesh.geometry.dispose();
        return false;
      }
      const k = 1 - r.life / r.max;
      const e = 1 - (1 - k) * (1 - k);
      r.mesh.scale.setScalar(r.r0 + (r.r1 - r.r0) * e);
      r.mesh.material.opacity = r.opacity * (1 - k);
      return true;
    });
  }
}

// ----------------------------------------------------------- juice splats
export class Splats {
  constructor(scene, max = 160) {
    this.scene = scene;
    this.max = max;
    this.list = [];
  }

  spawn(x, z, color, size) {
    if (this.list.length >= this.max) {
      const old = this.list.shift();
      this.scene.remove(old.mesh);
      old.mesh.material.dispose();
    }
    const mat = new THREE.MeshLambertMaterial({
      color: tmpC.set(color).clone(), transparent: true, opacity: 0.85, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const group = new THREE.Group();
    const main = new THREE.Mesh(DISC_GEO, mat);
    main.scale.set(size, 1, size * (0.7 + Math.random() * 0.5));
    group.add(main);
    for (let i = 0; i < 5; i++) {
      const d = new THREE.Mesh(DISC_GEO, mat);
      const a = Math.random() * Math.PI * 2;
      const r = size * (0.9 + Math.random() * 0.8);
      d.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      d.scale.setScalar(size * (0.1 + Math.random() * 0.25));
      group.add(d);
    }
    group.position.set(x, 0.012 + Math.random() * 0.004, z);
    group.rotation.y = Math.random() * Math.PI * 2;
    this.scene.add(group);
    this.list.push({ mesh: group, mat, life: 14, max: 14 });
    group.material = mat;
  }

  update(dt) {
    this.list = this.list.filter((s) => {
      s.life -= dt;
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        s.mat.dispose();
        return false;
      }
      s.mat.opacity = 0.85 * Math.min(1, s.life / 4);
      return true;
    });
  }

  clear() {
    for (const s of this.list) {
      this.scene.remove(s.mesh);
      s.mat.dispose();
    }
    this.list = [];
  }
}
