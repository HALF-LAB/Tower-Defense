// Three.js scene: the cutting-board map, camera, towers, fruit and effects.
import * as THREE from 'three';
import { MAP, FRUITS, TOWERS, FRUIT_INDEX } from './data.js';
import { makeFruitMesh, makeTowerModel, makeWallGeometry, MAT } from './models.js';
import { Particles, Projectiles, Bolts, Rings, Splats } from './effects.js';

const { W, H } = MAP;
const tmpV = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpC = new THREE.Color();
const dummy = new THREE.Object3D();

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function boardTexture() {
  const S = 48;
  const c = document.createElement('canvas');
  c.width = W * S;
  c.height = H * S;
  const g = c.getContext('2d');
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const light = (x + z) % 2 === 0;
      g.fillStyle = light ? '#ecc994' : '#e3bc84';
      g.fillRect(x * S, z * S, S, S);
      // Wood grain.
      g.strokeStyle = 'rgba(150, 100, 50, 0.13)';
      g.lineWidth = 1;
      for (let k = 0; k < 4; k++) {
        const yy = z * S + rnd() * S;
        g.beginPath();
        g.moveTo(x * S, yy);
        g.bezierCurveTo(x * S + S * 0.3, yy + (rnd() - 0.5) * 6, x * S + S * 0.7, yy + (rnd() - 0.5) * 6, x * S + S, yy + (rnd() - 0.5) * 4);
        g.stroke();
      }
    }
  }
  const zone = (z0, z1, x0, x1, col) => {
    g.fillStyle = col;
    g.fillRect(x0 * S, z0 * S, (x1 - x0 + 1) * S, (z1 - z0 + 1) * S);
  };
  zone(MAP.spawn.z0, MAP.spawn.z1, MAP.spawn.x0, MAP.spawn.x1, 'rgba(255, 90, 95, 0.28)');
  zone(MAP.exit.z0, MAP.exit.z1, MAP.exit.x0, MAP.exit.x1, 'rgba(90, 200, 120, 0.3)');
  // Arrows in the zones.
  g.fillStyle = 'rgba(255, 255, 255, 0.55)';
  for (const zx of [MAP.spawn.x0 + 1, MAP.exit.x0 + 1]) {
    const cx = zx * S, cy = ((MAP.spawn.z0 + MAP.spawn.z1 + 1) / 2) * S;
    g.beginPath();
    g.moveTo(cx - S * 0.6, cy - S * 0.7);
    g.lineTo(cx + S * 0.7, cy);
    g.lineTo(cx - S * 0.6, cy + S * 0.7);
    g.closePath();
    g.fill();
  }
  // Grid lines.
  g.strokeStyle = 'rgba(120, 80, 40, 0.22)';
  g.lineWidth = 2;
  for (let x = 0; x <= W; x++) {
    g.beginPath();
    g.moveTo(x * S, 0);
    g.lineTo(x * S, H * S);
    g.stroke();
  }
  for (let z = 0; z <= H; z++) {
    g.beginPath();
    g.moveTo(0, z * S);
    g.lineTo(W * S, z * S);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function counterTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#3a3344';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = `rgba(${Math.random() > 0.5 ? '255,255,255' : '0,0,0'}, ${Math.random() * 0.08})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(12, 12);
  return tex;
}

export class GameScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#231e2b');
    this.scene.fog = new THREE.Fog('#231e2b', 45, 90);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    this.cam = { tx: W / 2, tz: H / 2 + 1.3, dist: 26, yaw: 0, pitch: 0.98 };
    this.time = 0;

    this.buildLights();
    this.buildBoard();

    this.towerMeshes = new Map();
    this.enemyMeshes = new Map();
    this.wallMesh = new THREE.InstancedMesh(makeWallGeometry(), MAT.vc, W * H);
    this.wallMesh.castShadow = true;
    this.wallMesh.receiveShadow = true;
    this.wallMesh.count = 0;
    this.scene.add(this.wallMesh);
    this.wallTiles = [];

    this.juice = new Particles(this.scene, new THREE.MeshLambertMaterial(), 2500);
    this.glow = new Particles(this.scene, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 2000);
    this.projectiles = new Projectiles(this.scene);
    this.bolts = new Bolts(this.scene);
    this.rings = new Rings(this.scene);
    this.splats = new Splats(this.scene);

    this.buildPathMarkers();
    this.buildHelpers();
    this.resize();
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight('#fff3e0', '#4a3f5c', 1.25));
    const sun = new THREE.DirectionalLight('#fff0d8', 2.4);
    sun.position.set(W / 2 - 9, 22, H / 2 + 10);
    sun.target.position.set(W / 2, 0, H / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -20;
    sc.right = 20;
    sc.top = 16;
    sc.bottom = -16;
    sc.near = 1;
    sc.far = 60;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight('#9fc7ff', 0.45);
    fill.position.set(W / 2 + 12, 10, H / 2 - 14);
    this.scene.add(fill);
  }

  buildBoard() {
    const counter = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), new THREE.MeshStandardMaterial({ map: counterTexture(), roughness: 0.85 }));
    counter.rotation.x = -Math.PI / 2;
    counter.position.set(W / 2, -0.42, H / 2);
    counter.receiveShadow = true;
    this.scene.add(counter);

    const slab = new THREE.Mesh(new THREE.BoxGeometry(W + 1.2, 0.4, H + 1.2), new THREE.MeshStandardMaterial({ color: '#b98a55', roughness: 0.7 }));
    slab.position.set(W / 2, -0.2, H / 2);
    slab.receiveShadow = true;
    this.scene.add(slab);

    const top = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ map: boardTexture(), roughness: 0.75 }));
    top.rotation.x = -Math.PI / 2;
    top.position.set(W / 2, 0.001, H / 2);
    top.receiveShadow = true;
    this.scene.add(top);
    this.boardTop = top;

    // Fruit basket at the entrance, garden gate at the exit.
    const zMid = (MAP.spawn.z0 + MAP.spawn.z1 + 1) / 2;
    const basket = new THREE.Group();
    const bowl = new THREE.Mesh(
      new THREE.LatheGeometry([[0.2, 0], [1.4, 0.1], [1.9, 0.7], [2.0, 0.9]].map(([x, y]) => new THREE.Vector2(x, y)), 24),
      new THREE.MeshStandardMaterial({ color: '#a8743f', roughness: 0.9, side: THREE.DoubleSide }),
    );
    bowl.castShadow = true;
    basket.add(bowl);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.09, 6, 24, Math.PI), new THREE.MeshStandardMaterial({ color: '#8a5a32', roughness: 0.9 }));
    handle.position.y = 0.85;
    handle.rotation.y = Math.PI / 2;
    basket.add(handle);
    [['strawberry', 0.4, 0.5], ['apple', -0.5, -0.3], ['orange', 0.2, -0.7], ['pineapple', -0.3, 0.6], ['banana', 0.6, -0.1], ['grape', -0.8, 0.2]].forEach(([key, x, z]) => {
      const type = FRUIT_INDEX[key];
      const f = makeFruitMesh(type);
      const s = 0.45 / FRUITS[type].radius;
      f.scale.setScalar(s);
      f.position.set(x, 0.35, z);
      f.rotation.y = Math.PI + Math.random();
      basket.add(f);
    });
    basket.position.set(-2.6, -0.42, zMid);
    this.scene.add(basket);

    const gate = new THREE.Group();
    const postMat = new THREE.MeshStandardMaterial({ color: '#5d9b4a', roughness: 0.6 });
    for (const dz of [-2.3, 2.3]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 2.4, 10), postMat);
      post.position.set(0, 0.8, dz);
      post.castShadow = true;
      gate.add(post);
    }
    const arch = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.14, 8, 28, Math.PI), postMat);
    arch.position.y = 2.0;
    arch.rotation.y = Math.PI / 2;
    gate.add(arch);
    for (let i = 0; i < 9; i++) {
      const a = (i / 8) * Math.PI;
      const leafM = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), new THREE.MeshStandardMaterial({ color: i % 2 ? '#3f8f3a' : '#69b84f' }));
      leafM.position.set(0, 2.0 + Math.sin(a) * 2.3, Math.cos(a) * 2.3);
      gate.add(leafM);
    }
    gate.position.set(W + 0.9, -0.42, zMid);
    this.scene.add(gate);
  }

  buildPathMarkers() {
    const shape = new THREE.Shape();
    shape.moveTo(0.22, 0);
    shape.lineTo(-0.14, 0.17);
    shape.lineTo(-0.06, 0);
    shape.lineTo(-0.14, -0.17);
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
    const mk = (color) => {
      const m = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, depthWrite: false }), W * H);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(W * H * 3), 3);
      m.count = 0;
      m.frustumCulled = false;
      m.userData.base = new THREE.Color(color);
      m.renderOrder = 2;
      this.scene.add(m);
      return m;
    };
    this.pathMarkers = mk('#ffffff');
    this.previewMarkers = mk('#ffd34d');
  }

  setPathMarkers(mesh, path) {
    let n = 0;
    for (let i = 0; i < path.length; i++) {
      const a = path[i];
      const b = path[i + 1];
      const ax = (a % W) + 0.5, az = Math.floor(a / W) + 0.5;
      let dx = 1, dz = 0;
      if (b !== undefined) {
        dx = (b % W) + 0.5 - ax;
        dz = Math.floor(b / W) + 0.5 - az;
      }
      dummy.position.set(ax, 0.03, az);
      dummy.rotation.set(0, Math.atan2(-dz, dx), 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      mesh.setMatrixAt(n++, dummy.matrix);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.len = n;
  }

  animatePathMarkers(mesh) {
    const n = mesh.count;
    if (!n) return;
    const base = mesh.userData.base;
    for (let i = 0; i < n; i++) {
      const k = 0.35 + 0.65 * Math.max(0, Math.sin(i * 0.55 - this.time * 5));
      tmpC.copy(base).multiplyScalar(k);
      mesh.setColorAt(i, tmpC);
    }
    mesh.instanceColor.needsUpdate = true;
  }

  buildHelpers() {
    this.hover = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.18, depthWrite: false }));
    this.hover.position.y = 0.02;
    this.hover.visible = false;
    this.scene.add(this.hover);

    this.rangeGroup = new THREE.Group();
    this.rangeFill = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.08, depthWrite: false }));
    this.rangeRing = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, depthWrite: false }));
    this.rangeGroup.add(this.rangeFill, this.rangeRing);
    this.rangeGroup.position.y = 0.025;
    this.rangeGroup.visible = false;
    this.scene.add(this.rangeGroup);

    this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.58, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd34d', transparent: true, opacity: 0.9, depthWrite: false }));
    this.selRing.position.y = 0.03;
    this.selRing.visible = false;
    this.scene.add(this.selRing);

    this.ghostMatOk = new THREE.MeshBasicMaterial({ color: '#7bff9a', transparent: true, opacity: 0.5, depthWrite: false });
    this.ghostMatBad = new THREE.MeshBasicMaterial({ color: '#ff5a5f', transparent: true, opacity: 0.5, depthWrite: false });
    this.ghost = null;
    this.ghostKey = null;
    this.cursors = new Map();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fitDist = this.computeFitDistance();
    if (!this.userZoomed) this.cam.dist = this.fitDist;
  }

  computeFitDistance() {
    const vf = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const tanV = Math.tan(vf);
    const tanH = tanV * this.camera.aspect;
    const needW = (W + 3) / 2 / tanH;
    const needH = ((H + 2) * Math.sin(this.cam.pitch)) / 2 / tanV;
    return Math.max(12, Math.min(48, Math.max(needW, needH) * 1.17));
  }

  updateCamera() {
    const c = this.cam;
    c.tx = Math.max(-2, Math.min(W + 2, c.tx));
    c.tz = Math.max(-2, Math.min(H + 2, c.tz));
    c.dist = Math.max(7, Math.min(55, c.dist));
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    this.camera.position.set(c.tx + c.dist * cp * Math.sin(c.yaw), c.dist * sp, c.tz + c.dist * cp * Math.cos(c.yaw));
    this.camera.lookAt(c.tx, 0, c.tz);
  }

  pan(right, fwd) {
    const c = this.cam;
    const k = c.dist / 25;
    c.tx += (Math.cos(c.yaw) * right - Math.sin(c.yaw) * fwd) * k;
    c.tz += (-Math.sin(c.yaw) * right - Math.cos(c.yaw) * fwd) * k;
  }

  // World point on the board plane under a screen position.
  pick(clientX, clientY) {
    const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const t = -ray.ray.origin.y / ray.ray.direction.y;
    if (!(t > 0)) return null;
    const p = ray.ray.origin.clone().add(ray.ray.direction.clone().multiplyScalar(t));
    return { x: p.x, z: p.z };
  }

  toScreen(x, y, z) {
    tmpV.set(x, y, z).project(this.camera);
    return { x: (tmpV.x * 0.5 + 0.5) * window.innerWidth, y: (-tmpV.y * 0.5 + 0.5) * window.innerHeight, visible: tmpV.z < 1 };
  }

  // ------------------------------------------------------------- statics
  syncStatic(state) {
    const tiles = [...state.walls.keys()];
    this.wallTiles = tiles;
    tiles.forEach((i, n) => {
      dummy.position.set((i % W) + 0.5, 0, Math.floor(i / W) + 0.5);
      dummy.rotation.set(0, ((i * 7) % 4) * (Math.PI / 2), 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      this.wallMesh.setMatrixAt(n, dummy.matrix);
    });
    this.wallMesh.count = tiles.length;
    this.wallMesh.instanceMatrix.needsUpdate = true;
    this.wallMesh.computeBoundingSphere();

    for (const [id, tm] of this.towerMeshes) {
      if (!state.towers.has(id)) {
        this.scene.remove(tm.group);
        if (tm.beam) this.scene.remove(tm.beam);
        this.towerMeshes.delete(id);
      }
    }
    for (const t of state.towers.values()) {
      const owner = state.players.get(t.owner);
      const color = owner ? owner.color : '#999999';
      let tm = this.towerMeshes.get(t.id);
      if (tm && (tm.level !== t.level || tm.color !== color)) {
        this.scene.remove(tm.group);
        if (tm.beam) this.scene.remove(tm.beam);
        const yaw = tm.yaw;
        tm = null;
        this.towerMeshes.delete(t.id);
        this.buildTowerMesh(t, color, yaw, true);
      } else if (!tm) {
        this.buildTowerMesh(t, color, 0, false);
      }
    }
    this.setPathMarkers(this.pathMarkers, state.path);
  }

  buildTowerMesh(t, color, yaw, upgraded) {
    const group = makeTowerModel(t.type, t.level, color);
    group.position.set(t.x + 0.5, 0, t.z + 0.5);
    this.scene.add(group);
    const tm = { group, level: t.level, color, type: t.type, yaw, pop: upgraded ? 0.35 : 0.5, firing: 0, spin: 0 };
    if (group.userData.head) group.userData.head.rotation.y = yaw;
    if (TOWERS[t.type].kind === 'laser') {
      const beam = new THREE.Group();
      const outer = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).rotateZ(Math.PI / 2).translate(0.5, 0, 0),
        new THREE.MeshBasicMaterial({ color: '#c86bfa', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      const inner = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).rotateZ(Math.PI / 2).translate(0.5, 0, 0),
        new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      beam.add(outer, inner);
      beam.userData = { outer, inner };
      beam.visible = false;
      this.scene.add(beam);
      tm.beam = beam;
    }
    this.towerMeshes.set(t.id, tm);
    this.juice.burst(t.x + 0.5, 0.2, t.z + 0.5, '#c8b8a0', 10, { speed: 1.8, up: 1.5, size: 0.05 });
    return tm;
  }

  muzzlePos(towerId, out = new THREE.Vector3()) {
    const tm = this.towerMeshes.get(towerId);
    if (!tm) return null;
    const ud = tm.group.userData;
    const head = ud.head;
    const yaw = head ? head.rotation.y : 0;
    const r = ud.muzzle * (1 + (tm.level - 1) * 0.06);
    return out.set(tm.group.position.x + Math.cos(yaw) * r, ud.headY + 0.03, tm.group.position.z - Math.sin(yaw) * r);
  }

  enemyPos(id) {
    const em = this.enemyMeshes.get(id);
    if (!em) return null;
    return { x: em.mesh.position.x, y: em.height * 0.5, z: em.mesh.position.z };
  }

  // ------------------------------------------------------------- dynamic
  syncEnemies(list, dt) {
    const seen = new Set();
    for (const e of list) {
      seen.add(e.id);
      let em = this.enemyMeshes.get(e.id);
      const f = FRUITS[e.type];
      if (!em) {
        const mesh = makeFruitMesh(e.type);
        mesh.position.set(e.x, 0, e.z);
        this.scene.add(mesh);
        em = { mesh, type: e.type, yaw: 0, hp: e.hp, squash: 0, phase: Math.random() * 10, height: f.radius * 2, tick: 0 };
        if (Math.abs(e.dx) + Math.abs(e.dz) > 0) em.yaw = Math.atan2(-e.dz, e.dx);
        this.enemyMeshes.set(e.id, em);
      }
      const moving = Math.abs(e.dx) + Math.abs(e.dz) > 0.0005;
      if (moving) em.yaw = lerpAngle(em.yaw, Math.atan2(-e.dz, e.dx), Math.min(1, dt * 10));
      if (e.hp < em.hp - 0.01) em.squash = 1;
      em.hp = e.hp;
      em.squash = Math.max(0, em.squash - dt * 6);
      const t = this.time * (f.speed * 3.2) + em.phase;
      const hop = moving ? Math.abs(Math.sin(t)) * f.radius * 0.35 : 0;
      const sq = em.squash * 0.25;
      em.mesh.position.set(e.x, hop, e.z);
      em.mesh.rotation.set(0, em.yaw, moving ? Math.sin(t * 2) * 0.08 : 0);
      em.mesh.scale.set(1 + sq, 1 - sq + (moving ? Math.cos(t * 2) * 0.04 : 0), 1 + sq);
      // Status effects.
      em.tick -= dt;
      if (em.tick <= 0) {
        em.tick = 0.09;
        if (e.flags & 1) {
          this.glow.spawn({ x: e.x + (Math.random() - 0.5) * f.radius * 2, y: f.radius * 2 * Math.random(), z: e.z + (Math.random() - 0.5) * f.radius * 2, vy: 0.3, gravity: -0.2, size: 0.035, life: 0.5, color: '#9fe7ff' });
        }
        if (e.flags & 2) {
          this.glow.spawn({ x: e.x + (Math.random() - 0.5) * f.radius, y: f.radius * 1.6, z: e.z + (Math.random() - 0.5) * f.radius, vy: 1.2, gravity: -1, size: 0.06, life: 0.4, color: Math.random() > 0.5 ? '#ff7a1a' : '#ffcc33' });
        }
      }
      em.data = e;
    }
    for (const [id, em] of this.enemyMeshes) {
      if (!seen.has(id)) {
        this.scene.remove(em.mesh);
        this.enemyMeshes.delete(id);
      }
    }
  }

  animateTowers(state, dt) {
    for (const [id, tm] of this.towerMeshes) {
      const ud = tm.group.userData;
      const tgt = state.targets.get(id);
      const kind = ud.kind;
      if (tm.pop > 0) {
        tm.pop = Math.max(0, tm.pop - dt);
        const k = tm.pop / 0.5;
        tm.group.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.18);
      }
      let ep = null;
      if (tgt && tgt.target) ep = this.enemyPos(tgt.target);
      if (ud.head && ep) {
        const want = Math.atan2(-(ep.z - tm.group.position.z), ep.x - tm.group.position.x);
        tm.yaw = lerpAngle(ud.head.rotation.y, want, Math.min(1, dt * 14));
        ud.head.rotation.y = tm.yaw;
      }
      for (const ex of ud.extras) {
        if (ex.userData.spin) {
          ex.rotation.y += dt * ex.userData.spin;
          ex.position.y = 1.0 * (1 + (tm.level - 1) * 0.06) + Math.sin(this.time * 2 + id) * 0.05;
        }
        if (ex.userData.pulse) ex.scale.setScalar((1 + (tm.level - 1) * 0.06) * (1 + Math.sin(this.time * 8 + id) * 0.08));
        if (ex.userData.blades) {
          const fast = tgt && tgt.aux;
          tm.spin = THREE.MathUtils.lerp(tm.spin, fast ? 30 : 2, Math.min(1, dt * 4));
          ex.rotation.y += tm.spin * dt;
        }
      }
      if (kind === 'flame' && tgt && tgt.aux && ep) {
        const m = this.muzzlePos(id, tmpV);
        const dx = ep.x - m.x, dz = ep.z - m.z;
        const d = Math.hypot(dx, dz) || 1;
        for (let k = 0; k < 3; k++) {
          const s = 3.5 + Math.random() * 2;
          const spread = (Math.random() - 0.5) * 0.7;
          const c = Math.cos(spread), sn = Math.sin(spread);
          const vx = ((dx * c - dz * sn) / d) * s, vz = ((dx * sn + dz * c) / d) * s;
          this.glow.spawn({ x: m.x, y: m.y, z: m.z, vx, vy: 0.4 + Math.random() * 0.6, vz, gravity: -0.5, drag: 1.5, size: 0.07, grow: 2.2, life: 0.38, color: Math.random() > 0.4 ? '#ff7a1a' : '#ffd23f' });
        }
      }
      if (tm.beam) {
        if (tgt && tgt.target && ep) {
          const m = this.muzzlePos(id, tmpV);
          const dx = ep.x - m.x, dy = ep.y - m.y, dz = ep.z - m.z;
          const len = Math.hypot(dx, dy, dz);
          const heat = (tgt.aux || 10) / 10;
          tm.beam.visible = true;
          tm.beam.position.copy(m);
          tm.beam.rotation.set(0, Math.atan2(-dz, dx), Math.atan2(dy, Math.hypot(dx, dz)));
          const w = 0.03 + heat * 0.025 + Math.sin(this.time * 40) * 0.006;
          tm.beam.userData.outer.scale.set(len, w * 1.8, w * 1.8);
          tm.beam.userData.inner.scale.set(len, w * 0.5, w * 0.5);
          if (Math.random() < 0.5) this.glow.spawn({ x: ep.x, y: ep.y, z: ep.z, vx: (Math.random() - 0.5) * 2, vy: Math.random() * 2, vz: (Math.random() - 0.5) * 2, size: 0.04, life: 0.25, color: '#e3a6ff' });
        } else tm.beam.visible = false;
      }
    }
  }

  // ------------------------------------------------------------- events
  handleEvents(events, state, onFloat) {
    for (const ev of events) {
      switch (ev.e) {
        case 'shot': {
          const from = this.muzzlePos(ev.tw, new THREE.Vector3());
          if (!from) break;
          if (ev.k === 'dart' || ev.k === 'peel' || ev.k === 'skewer') {
            const ep = this.enemyPos(ev.tid);
            if (!ep) break;
            this.projectiles.spawn(ev.k, from, () => this.enemyPos(ev.tid), ep, ev.d);
          } else {
            this.projectiles.spawn(ev.k, from, null, { x: ev.tx, y: 0.1, z: ev.tz }, ev.d);
            this.glow.burst(from.x, from.y, from.z, '#fff1c4', 5, { speed: 1, up: 1, size: 0.05, life: 0.25, gravity: 0 });
          }
          break;
        }
        case 'boom': {
          this.rings.spawn({ x: ev.x, z: ev.z, r0: 0.2, r1: ev.r, life: 0.45, color: 0xffb347, opacity: 0.7 });
          this.rings.spawn({ x: ev.x, z: ev.z, y: 0.2, r0: 0.1, r1: ev.r * 0.55, life: 0.3, color: 0xffd27a, opacity: 0.8, sphere: true });
          this.glow.burst(ev.x, 0.2, ev.z, '#ffb347', 14, { speed: ev.r * 3, up: 3, size: 0.07, life: 0.45 });
          this.juice.burst(ev.x, 0.1, ev.z, '#6b4a2a', 8, { speed: ev.r * 2, up: 3.5, size: 0.05 });
          break;
        }
        case 'zap': {
          const pts = ev.pts.map(([x, z], i) => {
            if (i === 0) {
              const tm = this.towerMeshes.get(ev.tw);
              return new THREE.Vector3(x, tm ? 1.0 * (1 + (tm.level - 1) * 0.06) : 1, z);
            }
            return new THREE.Vector3(x, 0.3, z);
          });
          this.bolts.spawn(pts, 0xfff27a, 0.035, 0.18);
          this.bolts.spawn(pts, 0xffffff, 0.015, 0.12);
          for (const p of pts.slice(1)) this.glow.burst(p.x, p.y, p.z, '#fff27a', 4, { speed: 1.5, up: 1.5, size: 0.04, life: 0.25 });
          break;
        }
        case 'pulse': {
          const tm = this.towerMeshes.get(ev.tw);
          if (!tm) break;
          const p = tm.group.position;
          this.rings.spawn({ x: p.x, z: p.z, y: 0.06, r0: 0.3, r1: ev.r, life: 0.6, color: 0x9fe7ff, opacity: 0.55 });
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            this.glow.spawn({ x: p.x, y: 0.3, z: p.z, vx: Math.cos(a) * ev.r * 1.6, vz: Math.sin(a) * ev.r * 1.6, drag: 2, gravity: 0, size: 0.05, life: 0.5, color: '#dff7ff' });
          }
          break;
        }
        case 'die': {
          const f = FRUITS[ev.f];
          const r = f.radius;
          this.juice.burst(ev.x, r, ev.z, f.color, Math.round(10 + r * 30), { speed: 1.5 + r * 3, up: 2.5 + r * 2, size: 0.04 + r * 0.08, life: 0.8 });
          this.juice.burst(ev.x, r, ev.z, '#ffffff', 3, { speed: 1, up: 2, size: 0.03, life: 0.5 });
          this.splats.spawn(ev.x, ev.z, f.color, 0.18 + r * 0.7);
          if (onFloat) onFloat(ev.x, r * 2, ev.z, `+${ev.g}`, '#ffd34d');
          break;
        }
        case 'leak': {
          const em = this.enemyMeshes.get(ev.id);
          if (em) this.glow.burst(em.mesh.position.x, 0.3, em.mesh.position.z, '#ff5a5f', 10, { speed: 2, up: 2, size: 0.06, life: 0.5 });
          break;
        }
        case 'upgraded': {
          const tm = this.towerMeshes.get(ev.id);
          if (tm) this.glow.burst(tm.group.position.x, 0.5, tm.group.position.z, '#ffd34d', 18, { speed: 1.5, up: 3, size: 0.05, life: 0.7, gravity: 3 });
          break;
        }
        case 'sold': {
          this.juice.burst(ev.x + 0.5, 0.3, ev.z + 0.5, '#c8b8a0', 14, { speed: 2, up: 2, size: 0.06 });
          break;
        }
      }
    }
  }

  // --------------------------------------------------------- build helpers
  setGhost(key, x, z, ok, range) {
    if (key === null) {
      if (this.ghost) this.ghost.visible = false;
      this.rangeGroup.visible = false;
      return;
    }
    if (this.ghostKey !== key) {
      if (this.ghost) this.scene.remove(this.ghost);
      if (key === 'wall') {
        this.ghost = new THREE.Mesh(makeWallGeometry(), this.ghostMatOk);
      } else {
        const type = TOWERS.findIndex((t) => t.key === key);
        this.ghost = makeTowerModel(type, 1, '#ffffff');
      }
      this.ghost.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = false;
          o.renderOrder = 3;
        }
      });
      this.ghostKey = key;
      this.scene.add(this.ghost);
    }
    const mat = ok ? this.ghostMatOk : this.ghostMatBad;
    this.ghost.traverse((o) => {
      if (o.isMesh) o.material = mat;
    });
    this.ghost.visible = true;
    this.ghost.position.set(x + 0.5, 0.01, z + 0.5);
    if (range) this.showRange(x + 0.5, z + 0.5, range, ok ? '#7bff9a' : '#ff5a5f');
    else this.rangeGroup.visible = false;
  }

  showRange(x, z, r, color = '#ffffff') {
    this.rangeGroup.visible = true;
    this.rangeGroup.position.set(x, 0.025, z);
    this.rangeGroup.scale.set(r, 1, r);
    this.rangeFill.material.color.set(color);
    this.rangeRing.material.color.set(color);
  }

  setCursors(list, state) {
    const seen = new Set();
    for (const [pid, x, z] of list) {
      if (pid === state.me) continue;
      const p = state.players.get(pid);
      if (!p) continue;
      seen.add(pid);
      let c = this.cursors.get(pid);
      if (!c) {
        c = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.4, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.85, depthWrite: false }));
        c.position.y = 0.04;
        this.scene.add(c);
        this.cursors.set(pid, c);
      }
      c.userData.tx = x;
      c.userData.tz = z;
      c.userData.name = p.name;
      c.userData.color = p.color;
    }
    for (const [pid, c] of this.cursors) {
      if (!seen.has(pid)) {
        this.scene.remove(c);
        this.cursors.delete(pid);
      }
    }
  }

  update(dt) {
    this.time += dt;
    for (const c of this.cursors.values()) {
      if (c.userData.tx === undefined) continue;
      c.position.x += (c.userData.tx - c.position.x) * Math.min(1, dt * 12);
      c.position.z += (c.userData.tz - c.position.z) * Math.min(1, dt * 12);
      c.rotation.y += dt * 2;
    }
    this.selRing.rotation.y += dt;
    this.juice.update(dt);
    this.glow.update(dt);
    this.projectiles.update(dt);
    this.bolts.update(dt);
    this.rings.update(dt);
    this.splats.update(dt);
    this.animatePathMarkers(this.previewMarkers.count ? this.previewMarkers : this.pathMarkers);
    this.pathMarkers.visible = !this.previewMarkers.count;
    this.updateCamera();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  reset() {
    for (const tm of this.towerMeshes.values()) {
      this.scene.remove(tm.group);
      if (tm.beam) this.scene.remove(tm.beam);
    }
    this.towerMeshes.clear();
    for (const em of this.enemyMeshes.values()) this.scene.remove(em.mesh);
    this.enemyMeshes.clear();
    this.splats.clear();
    this.wallMesh.count = 0;
    for (const c of this.cursors.values()) this.scene.remove(c);
    this.cursors.clear();
  }
}
