// Sessions feed snapshots into a ClientState. Solo play runs the simulation
// right here in the browser; online play receives snapshots over a WebSocket.
import { Game, makeBaseGrid, computeFlow, tracePath, T_WALL, T_TOWER } from './sim.js';
import { STEP, MAP, TARGET_MODES } from './data.js';

const { W } = MAP;

export class LocalSession {
  constructor(name) {
    this.online = false;
    this.game = new Game();
    this.playerId = this.game.addPlayer(name).id;
    this.game.drainEvents();
    this.acc = 0;
    this.clock = 0;
    this.lastStatic = -1;
    this.onSnapshot = () => {};
    this.onMessage = () => {};
  }

  start() {
    this.emit(true);
  }

  update(dt) {
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.clock += STEP * 1000;
      this.game.tick();
      this.emit(false);
    }
  }

  emit(force) {
    const g = this.game;
    const full = force || g.staticVersion !== this.lastStatic || g.tickCount % 15 === 0;
    this.lastStatic = g.staticVersion;
    const s = g.snapshot(full);
    s.t = this.clock;
    s.ev = g.drainEvents();
    this.onSnapshot(s);
  }

  renderTime() {
    return this.clock + this.acc * 1000 - STEP * 1000;
  }

  send(cmd) {
    const r = this.game.command(this.playerId, cmd);
    if (!r.ok) this.onMessage({ type: 'error', msg: r.reason });
    else this.emit(true);
    return r;
  }

  chat() {}
  cursor() {}
  close() {}
}

export class RemoteSession {
  constructor() {
    this.online = true;
    this.ws = null;
    this.playerId = 0;
    this.code = '';
    this.offsets = [];
    this.offset = 0;
    this.delay = 130;
    this.onSnapshot = () => {};
    this.onMessage = () => {};
    this.onClose = () => {};
  }

  static url() {
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
  }

  connect(hello) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(RemoteSession.url());
      this.ws = ws;
      let welcomed = false;
      const timer = setTimeout(() => !welcomed && reject(new Error('Could not reach the server')), 8000);
      ws.onopen = () => ws.send(JSON.stringify(hello));
      ws.onerror = () => !welcomed && reject(new Error('Could not reach the server'));
      ws.onclose = () => {
        clearTimeout(timer);
        if (!welcomed) reject(new Error('Connection closed'));
        else this.onClose();
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'welcome') {
          welcomed = true;
          clearTimeout(timer);
          this.playerId = msg.playerId;
          this.code = msg.code;
          try {
            sessionStorage.setItem('fs-token-' + msg.code, msg.token);
          } catch {}
          resolve(msg);
        } else if (msg.type === 'error' && msg.fatal && !welcomed) {
          clearTimeout(timer);
          reject(new Error(msg.msg));
        } else if (msg.type === 'snap') {
          this.trackClock(msg.t);
          this.onSnapshot(msg);
        } else {
          this.onMessage(msg);
        }
      };
    });
  }

  // Estimate server clock offset from snapshot timestamps (max of recent samples
  // approximates the lowest-latency delivery).
  trackClock(t) {
    this.offsets.push(t - performance.now());
    if (this.offsets.length > 40) this.offsets.shift();
    this.offset = Math.max(...this.offsets);
  }

  start() {}
  update() {}

  renderTime() {
    return performance.now() + this.offset - this.delay;
  }

  send(cmd) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type: 'cmd', cmd }));
    return { ok: true };
  }

  chat(text) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type: 'chat', text }));
  }

  cursor(x, z) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type: 'cursor', x, z }));
  }

  close() {
    this.onClose = () => {};
    if (this.ws) this.ws.close();
  }
}

// Everything the client knows about the game, rebuilt from snapshots.
export class ClientState {
  constructor(playerId) {
    this.me = playerId;
    this.snaps = [];
    this.events = [];
    this.info = { ph: 'build', wave: 0, cd: -1, lives: 0, speed: 1, paused: 0, left: 0 };
    this.players = new Map();
    this.towers = new Map();
    this.walls = new Map();
    this.targets = new Map();
    this.grid = makeBaseGrid();
    this.flow = computeFlow(this.grid);
    this.path = tracePath(this.grid, this.flow);
    this.staticVersion = -1;
    this.staticDirty = true;
    this.nextWave = [];
    this.curWave = [];
  }

  get myPlayer() {
    return this.players.get(this.me);
  }

  push(s) {
    this.info = s;
    this.players.clear();
    for (const [id, name, color, gold, kills, ready, connected, damage] of s.pl) {
      this.players.set(id, { id, name, color, gold, kills, ready: !!ready, connected: !!connected, damage });
    }
    if (s.towers) {
      if (s.next) this.nextWave = s.next;
      if (s.cur) this.curWave = s.cur;
      const changed = s.sv !== this.staticVersion;
      this.towers.clear();
      for (const [id, type, level, x, z, owner, mode, kills, dmg, invested] of s.towers) {
        this.towers.set(id, { id, type, level, x, z, owner, mode: TARGET_MODES[mode] || 'first', kills, dmg, invested });
      }
      this.walls.clear();
      for (let i = 0; i < s.walls.length; i += 2) this.walls.set(s.walls[i], s.walls[i + 1]);
      if (changed) {
        this.staticVersion = s.sv;
        this.grid = makeBaseGrid();
        for (const i of this.walls.keys()) this.grid[i] = T_WALL;
        for (const t of this.towers.values()) this.grid[t.x + t.z * W] = T_TOWER;
        this.flow = computeFlow(this.grid);
        this.path = tracePath(this.grid, this.flow);
      }
      this.staticDirty = true;
    }
    this.targets.clear();
    for (let i = 0; i < s.tt.length; i += 3) this.targets.set(s.tt[i], { target: s.tt[i + 1], aux: s.tt[i + 2] });

    const en = new Map();
    for (let i = 0; i < s.en.length; i += 8) {
      en.set(s.en[i], {
        id: s.en[i], type: s.en[i + 1], x: s.en[i + 2] / 100, z: s.en[i + 3] / 100,
        hp: s.en[i + 4], maxHp: s.en[i + 5], flags: s.en[i + 6], armor: s.en[i + 7] / 10,
      });
    }
    this.snaps.push({ t: s.t, en });
    if (this.snaps.length > 60) this.snaps.splice(0, this.snaps.length - 60);
    if (s.ev && s.ev.length) this.events.push({ t: s.t, ev: s.ev });
  }

  // Enemies interpolated to the given render time.
  sample(rt) {
    const snaps = this.snaps;
    if (!snaps.length) return [];
    let b = snaps.findIndex((s) => s.t >= rt);
    if (b === -1) b = snaps.length - 1;
    const a = Math.max(0, b - 1);
    const A = snaps[a], B = snaps[b];
    // Drop history we no longer need.
    if (a > 2) snaps.splice(0, a - 2);
    const span = B.t - A.t;
    const k = span > 0 ? Math.max(0, Math.min(1, (rt - A.t) / span)) : 1;
    const out = [];
    for (const e of B.en.values()) {
      const p = A.en.get(e.id);
      if (p) {
        out.push({ ...e, x: p.x + (e.x - p.x) * k, z: p.z + (e.z - p.z) * k, hp: p.hp + (e.hp - p.hp) * k, dx: e.x - p.x, dz: e.z - p.z });
      } else if (k > 0.5 || A === B) {
        out.push({ ...e, dx: 0, dz: 0 });
      }
    }
    return out;
  }

  takeEvents(rt) {
    const out = [];
    while (this.events.length && this.events[0].t <= rt + 40) out.push(...this.events.shift().ev);
    return out;
  }

  latestEnemies() {
    const s = this.snaps[this.snaps.length - 1];
    return s ? [...s.en.values()] : [];
  }
}
