// Authoritative game simulation. Runs in the browser for solo play and on the
// Node server for multiplayer rooms. No DOM / rendering code in here.
import {
  MAP, STEP, START_LIVES, START_GOLD, WALL_COST, SELL_RATIO, BUILD_TIME, FINAL_WAVE,
  MAX_PLAYERS, MIN_DAMAGE_RATIO, PLAYER_COLORS, FRUITS, FRUIT_INDEX, TOWERS, TOWER_INDEX,
  TARGET_MODES, waveGroups, waveHpScale, waveBonus,
} from './data.js';

const { W, H } = MAP;
export const T_EMPTY = 0, T_WALL = 1, T_TOWER = 2, T_SPAWN = 3, T_EXIT = 4;
const SQ2 = Math.SQRT2;
// Orthogonal directions first so ties prefer straight moves.
const DIRS = [[1, 0, 1], [0, 1, 1], [0, -1, 1], [-1, 0, 1], [1, 1, SQ2], [1, -1, SQ2], [-1, 1, SQ2], [-1, -1, SQ2]];

export const idx = (x, z) => x + z * W;
export const inBounds = (x, z) => x >= 0 && z >= 0 && x < W && z < H;
export const isWalkable = (v) => v !== T_WALL && v !== T_TOWER;

export function makeBaseGrid() {
  const g = new Uint8Array(W * H);
  const { spawn, exit } = MAP;
  for (let z = spawn.z0; z <= spawn.z1; z++) for (let x = spawn.x0; x <= spawn.x1; x++) g[idx(x, z)] = T_SPAWN;
  for (let z = exit.z0; z <= exit.z1; z++) for (let x = exit.x0; x <= exit.x1; x++) g[idx(x, z)] = T_EXIT;
  return g;
}

function canStep(grid, x, z, dx, dz) {
  const nx = x + dx, nz = z + dz;
  if (!inBounds(nx, nz) || !isWalkable(grid[idx(nx, nz)])) return false;
  if (dx !== 0 && dz !== 0) {
    // No cutting diagonally past a blocked corner.
    if (!isWalkable(grid[idx(x + dx, z)]) || !isWalkable(grid[idx(x, z + dz)])) return false;
  }
  return true;
}

// Dijkstra distance-to-exit for every tile (Infinity = cannot reach the exit).
export function computeFlow(grid) {
  const dist = new Float64Array(W * H).fill(Infinity);
  const heap = []; // [dist, index] binary min-heap
  const push = (d, i) => {
    heap.push([d, i]);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heap[p][0] <= heap[c][0]) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let p = 0;
      for (;;) {
        const l = 2 * p + 1, r = l + 1;
        let m = p;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === p) break;
        [heap[p], heap[m]] = [heap[m], heap[p]];
        p = m;
      }
    }
    return top;
  };
  for (let z = MAP.exit.z0; z <= MAP.exit.z1; z++) {
    const i = idx(W - 1, z);
    dist[i] = 0;
    push(0, i);
  }
  while (heap.length) {
    const [d, i] = pop();
    if (d > dist[i]) continue;
    const x = i % W, z = (i / W) | 0;
    for (const [dx, dz, c] of DIRS) {
      // Movement is symmetric, so stepping from neighbour to here costs the same.
      if (!canStep(grid, x, z, dx, dz)) continue;
      const n = idx(x + dx, z + dz);
      const nd = d + c;
      if (nd < dist[n]) {
        dist[n] = nd;
        push(nd, n);
      }
    }
  }
  return dist;
}

export function nextTile(grid, dist, i) {
  const x = i % W, z = (i / W) | 0;
  let best = -1, bestV = Infinity;
  for (const [dx, dz, c] of DIRS) {
    if (!canStep(grid, x, z, dx, dz)) continue;
    const n = idx(x + dx, z + dz);
    if (dist[n] >= dist[i]) continue;
    const v = dist[n] + c;
    if (v < bestV - 1e-9) {
      bestV = v;
      best = n;
    }
  }
  return best;
}

// Tile path from a spawn tile to the exit (used for the on-board path preview).
export function tracePath(grid, dist, startZ = Math.floor((MAP.spawn.z0 + MAP.spawn.z1 + 1) / 2)) {
  const path = [];
  let i = idx(0, startZ);
  if (!isFinite(dist[i])) return path;
  for (let n = 0; n < W * H && i >= 0; n++) {
    path.push(i);
    if (dist[i] === 0) break;
    i = nextTile(grid, dist, i);
  }
  return path;
}

export function spawnReachable(dist) {
  for (let z = MAP.spawn.z0; z <= MAP.spawn.z1; z++) if (isFinite(dist[idx(0, z)])) return true;
  return false;
}

// Tile an enemy is "in" for pathing purposes (enemies start just off the left edge).
export function enemyTile(x, z) {
  const tz = Math.min(H - 1, Math.max(0, Math.floor(z)));
  if (x < 0) return idx(0, tz);
  return idx(Math.min(W - 1, Math.floor(x)), tz);
}

// Shared placement check for client ghost previews and the authoritative server.
// `enemies` is a list of {x, z, radius, exiting}. Returns {ok, reason, flow}.
export function checkBlock(grid, x, z, enemies) {
  if (!inBounds(x, z)) return { ok: false, reason: 'Out of bounds' };
  const i = idx(x, z);
  const v = grid[i];
  if (v === T_SPAWN || v === T_EXIT) return { ok: false, reason: 'Keep the entrance and exit clear' };
  if (v !== T_EMPTY) return { ok: false, reason: 'Tile is occupied' };
  for (const e of enemies) {
    if (Math.abs(e.x - (x + 0.5)) < 0.62 && Math.abs(e.z - (z + 0.5)) < 0.62) {
      return { ok: false, reason: 'A fruit is in the way' };
    }
  }
  grid[i] = T_WALL;
  const flow = computeFlow(grid);
  grid[i] = T_EMPTY;
  if (!spawnReachable(flow)) return { ok: false, reason: 'You can\'t fully block the path!' };
  for (const e of enemies) {
    if (e.exiting) continue;
    if (!isFinite(flow[enemyTile(e.x, e.z)])) return { ok: false, reason: 'That would trap a fruit' };
  }
  return { ok: true, flow };
}

export const towerStats = (type, level) => TOWERS[type].levels[level - 1];

export class Game {
  constructor() {
    this.players = new Map();
    this.nextPlayerId = 1;
    this.reset();
  }

  reset() {
    this.grid = makeBaseGrid();
    this.wallOwner = new Int32Array(W * H);
    this.towerAt = new Int32Array(W * H);
    this.towers = new Map();
    this.enemies = [];
    this.enemyMap = new Map();
    this.pending = [];
    this.spawnQueue = [];
    this.events = [];
    this.nextId = 1;
    this.lives = START_LIVES;
    this.wave = 0;
    this.phase = 'build';
    this.countdown = -1; // -1 = waiting for players to ready up
    this.time = 0;
    this.tickCount = 0;
    this.speed = 1;
    this.paused = false;
    this.pausedBy = '';
    this.endless = false;
    this.hpScale = 1;
    this.leaked = 0;
    this.staticVersion = (this.staticVersion || 0) + 1;
    this.flow = computeFlow(this.grid);
    for (const p of this.players.values()) {
      p.gold = START_GOLD;
      p.kills = 0;
      p.damage = 0;
      p.ready = false;
    }
  }

  // ---------------------------------------------------------------- players
  addPlayer(name) {
    if (this.players.size >= MAX_PLAYERS) return null;
    const used = new Set([...this.players.values()].map((p) => p.color));
    const color = PLAYER_COLORS.find((c) => !used.has(c)) || PLAYER_COLORS[0];
    const p = {
      id: this.nextPlayerId++,
      name: String(name || 'Player').slice(0, 16),
      color,
      gold: START_GOLD + 30 * this.wave,
      kills: 0,
      damage: 0,
      ready: false,
      connected: true,
    };
    this.players.set(p.id, p);
    this.event({ e: 'msg', text: `${p.name} joined the kitchen`, color: p.color });
    return p;
  }

  setConnected(id, connected) {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = connected;
    p.ready = false;
    this.event({ e: 'msg', text: `${p.name} ${connected ? 'reconnected' : 'left'}`, color: p.color });
  }

  removePlayer(id) {
    this.players.delete(id);
  }

  connectedPlayers() {
    return [...this.players.values()].filter((p) => p.connected);
  }

  event(ev) {
    this.events.push(ev);
  }

  drainEvents() {
    const ev = this.events;
    this.events = [];
    return ev;
  }

  // --------------------------------------------------------------- commands
  command(pid, cmd) {
    const p = this.players.get(pid);
    if (!p || !cmd) return { ok: false, reason: 'Unknown player' };
    const playing = this.phase === 'build' || this.phase === 'wave';
    switch (cmd.c) {
      case 'build':
        if (!playing) return { ok: false, reason: 'The game is over' };
        return this.build(p, String(cmd.k), cmd.x | 0, cmd.z | 0);
      case 'upgrade':
        if (!playing) return { ok: false, reason: 'The game is over' };
        return this.upgrade(p, cmd.id | 0);
      case 'sell':
        if (!playing) return { ok: false, reason: 'The game is over' };
        return this.sell(p, cmd.x | 0, cmd.z | 0);
      case 'mode': {
        const t = this.towers.get(cmd.id | 0);
        if (!t) return { ok: false, reason: 'No tower' };
        if (t.owner !== p.id) return { ok: false, reason: 'That is not your tower' };
        if (!TARGET_MODES.includes(cmd.m)) return { ok: false, reason: 'Bad mode' };
        t.mode = cmd.m;
        this.staticVersion++;
        return { ok: true };
      }
      case 'ready':
        p.ready = !!cmd.v;
        return { ok: true };
      case 'speed':
        this.speed = Math.max(1, Math.min(3, cmd.v | 0));
        return { ok: true };
      case 'pause':
        this.paused = !!cmd.v;
        this.pausedBy = this.paused ? p.name : '';
        return { ok: true };
      case 'continue':
        if (this.phase !== 'won') return { ok: false, reason: 'Not now' };
        this.endless = true;
        this.phase = 'build';
        this.countdown = BUILD_TIME;
        this.event({ e: 'msg', text: 'Endless mode! How long can you last?' });
        return { ok: true };
      case 'restart':
        if (this.phase !== 'lost' && this.phase !== 'won') return { ok: false, reason: 'Game still running' };
        this.reset();
        this.event({ e: 'msg', text: `${p.name} restarted the game` });
        return { ok: true };
      default:
        return { ok: false, reason: 'Unknown command' };
    }
  }

  build(p, key, x, z) {
    if (!inBounds(x, z)) return { ok: false, reason: 'Out of bounds' };
    const i = idx(x, z);
    if (key === 'wall') {
      if (p.gold < WALL_COST) return { ok: false, reason: 'Not enough gold' };
      const check = checkBlock(this.grid, x, z, this.enemies);
      if (!check.ok) return check;
      p.gold -= WALL_COST;
      this.grid[i] = T_WALL;
      this.wallOwner[i] = p.id;
      this.setFlow(check.flow);
      return { ok: true };
    }
    const type = TOWER_INDEX[key];
    if (type === undefined) return { ok: false, reason: 'Unknown tower' };
    const cost = TOWERS[type].levels[0].cost;
    const onWall = this.grid[i] === T_WALL;
    if (p.gold < cost) return { ok: false, reason: 'Not enough gold' };
    let check = null;
    if (!onWall) {
      check = checkBlock(this.grid, x, z, this.enemies);
      if (!check.ok) return check;
    } else {
      // Towers can be dropped onto any wall; the wall's builder gets their gold back.
      const wo = this.players.get(this.wallOwner[i]);
      if (wo) wo.gold += WALL_COST;
    }
    p.gold -= cost;
    const t = {
      id: this.nextId++, type, level: 1, x, z, owner: p.id, mode: 'first',
      cd: 0, target: 0, aux: 0, rampT: 0, kills: 0, dmg: 0, invested: cost,
    };
    this.towers.set(t.id, t);
    this.towerAt[i] = t.id;
    this.wallOwner[i] = 0;
    this.grid[i] = T_TOWER;
    if (check) this.setFlow(check.flow);
    else this.staticVersion++;
    this.event({ e: 'built', id: t.id });
    return { ok: true, id: t.id };
  }

  upgrade(p, id) {
    const t = this.towers.get(id);
    if (!t) return { ok: false, reason: 'No tower' };
    if (t.owner !== p.id) return { ok: false, reason: 'You can only upgrade your own towers' };
    if (t.level >= 3) return { ok: false, reason: 'Already max level' };
    const cost = TOWERS[t.type].levels[t.level].cost;
    if (p.gold < cost) return { ok: false, reason: 'Not enough gold' };
    p.gold -= cost;
    t.level++;
    t.invested += cost;
    this.staticVersion++;
    this.event({ e: 'upgraded', id: t.id });
    return { ok: true };
  }

  sell(p, x, z) {
    if (!inBounds(x, z)) return { ok: false, reason: 'Out of bounds' };
    const i = idx(x, z);
    if (this.grid[i] === T_TOWER) {
      const t = this.towers.get(this.towerAt[i]);
      if (!t) return { ok: false, reason: 'No tower' };
      if (t.owner !== p.id) return { ok: false, reason: 'You can only sell your own towers' };
      p.gold += Math.floor(t.invested * SELL_RATIO);
      this.towers.delete(t.id);
      this.towerAt[i] = 0;
    } else if (this.grid[i] === T_WALL) {
      if (this.wallOwner[i] !== p.id) return { ok: false, reason: 'You can only remove your own walls' };
      p.gold += WALL_COST;
      this.wallOwner[i] = 0;
    } else {
      return { ok: false, reason: 'Nothing to sell' };
    }
    this.grid[i] = T_EMPTY;
    this.setFlow(computeFlow(this.grid));
    this.event({ e: 'sold', x, z });
    return { ok: true };
  }

  setFlow(flow) {
    this.flow = flow;
    this.staticVersion++;
    for (const e of this.enemies) this.repath(e);
  }

  repath(e) {
    if (e.exiting) return;
    const ct = enemyTile(e.x, e.z);
    e.cur = ct;
    if (e.x < 0) {
      e.next = ct;
      return;
    }
    if (this.flow[ct] === 0) {
      e.exiting = true;
      return;
    }
    const n = nextTile(this.grid, this.flow, ct);
    if (n >= 0) e.next = n;
  }

  // ------------------------------------------------------------------ waves
  startWave() {
    this.wave++;
    this.phase = 'wave';
    this.countdown = -1;
    for (const p of this.players.values()) p.ready = false;
    const n = Math.max(1, this.connectedPlayers().length);
    this.hpScale = waveHpScale(this.wave) * (1 + 1.0 * (n - 1));
    for (const [key, count, interval, delay] of waveGroups(this.wave)) {
      for (let k = 0; k < count; k++) this.spawnQueue.push({ key, t: this.time + delay + k * interval });
    }
    this.spawnQueue.sort((a, b) => a.t - b.t);
    this.event({ e: 'wave', n: this.wave });
  }

  wavePreview(n) {
    return waveGroups(n).map(([k, c]) => [FRUIT_INDEX[k], c]);
  }

  spawnEnemy(key, x, z, inherit) {
    const type = FRUIT_INDEX[key];
    const f = FRUITS[type];
    const hp = f.hp * this.hpScale;
    const e = {
      id: this.nextId++, type, x, z, hp, maxHp: hp, armor: f.armor, peel: 0,
      speed: f.speed, radius: f.radius, slowMul: 1, slowT: 0, burnDps: 0, burnT: 0, burnBy: null,
      vx: 0, vz: 0, rem: 999, cur: -1, next: -1, exiting: false, alive: true,
    };
    if (inherit) {
      e.next = inherit.next;
      e.cur = inherit.cur;
      e.exiting = inherit.exiting;
    } else {
      this.repath(e);
    }
    this.enemies.push(e);
    this.enemyMap.set(e.id, e);
    return e;
  }

  // ------------------------------------------------------------- main loop
  // Called TICK_RATE times per real second; runs `speed` simulation steps.
  tick() {
    this.tickCount++;
    if (this.paused) return;
    for (let s = 0; s < this.speed; s++) this.step(STEP);
  }

  step(dt) {
    if (this.phase === 'lost' || this.phase === 'won') return;
    this.time += dt;

    if (this.phase === 'build') {
      const conn = this.connectedPlayers();
      if (conn.length && conn.every((p) => p.ready)) this.startWave();
      else if (this.countdown >= 0) {
        this.countdown -= dt;
        if (this.countdown <= 0) this.startWave();
      }
    }

    while (this.spawnQueue.length && this.spawnQueue[0].t <= this.time) {
      const { key } = this.spawnQueue.shift();
      const { z0, z1 } = MAP.spawn;
      this.spawnEnemy(key, -0.5, z0 + 0.25 + Math.random() * (z1 - z0 + 0.5));
    }

    for (const e of this.enemies) if (e.alive) this.updateEnemy(e, dt);
    for (const t of this.towers.values()) this.updateTower(t, dt);

    if (this.pending.length) {
      const keep = [];
      for (const h of this.pending) {
        if (this.time >= h.at) this.resolveHit(h);
        else keep.push(h);
      }
      this.pending = keep;
    }

    if (this.enemies.some((e) => !e.alive)) {
      this.enemies = this.enemies.filter((e) => {
        if (!e.alive) this.enemyMap.delete(e.id);
        return e.alive;
      });
    }

    if (this.phase === 'wave' && !this.spawnQueue.length && !this.enemies.length) this.endWave();
    if (this.lives <= 0 && this.phase !== 'lost') {
      this.lives = 0;
      this.phase = 'lost';
      this.event({ e: 'lost', wave: this.wave });
    }
  }

  endWave() {
    const bonus = waveBonus(this.wave);
    for (const p of this.players.values()) p.gold += bonus;
    this.event({ e: 'cleared', n: this.wave, bonus });
    if (this.wave >= FINAL_WAVE && !this.endless) {
      this.phase = 'won';
      this.event({ e: 'won' });
      return;
    }
    this.phase = 'build';
    this.countdown = BUILD_TIME;
  }

  updateEnemy(e, dt) {
    const f = FRUITS[e.type];
    if (e.slowT > 0) {
      e.slowT -= dt;
      if (e.slowT <= 0) e.slowMul = 1;
    }
    if (e.burnT > 0) {
      e.burnT -= dt;
      this.damage(e, e.burnDps * dt, e.burnBy, 1);
      if (!e.alive) return;
    }
    if (f.special === 'regen' && e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.015 * dt);

    const ox = e.x, oz = e.z;
    let move = e.speed * e.slowMul * dt;
    for (let iter = 0; iter < 4 && move > 0; iter++) {
      let tx, tz;
      if (e.exiting) {
        tx = W + 0.6;
        tz = e.z;
      } else {
        if (e.next < 0) break;
        tx = (e.next % W) + 0.5;
        tz = ((e.next / W) | 0) + 0.5;
      }
      const dx = tx - e.x, dz = tz - e.z;
      const d = Math.hypot(dx, dz);
      if (d <= move) {
        e.x = tx;
        e.z = tz;
        move -= d;
      } else {
        e.x += (dx / d) * move;
        e.z += (dz / d) * move;
        move = 0;
      }
      if (e.exiting) {
        if (e.x >= W + 0.5) return this.leak(e);
        continue;
      }
      const ct = enemyTile(e.x, e.z);
      if (ct !== e.cur && e.x >= 0) {
        e.cur = ct;
        if (this.flow[ct] === 0) e.exiting = true;
        else if (isWalkable(this.grid[ct])) {
          const n = nextTile(this.grid, this.flow, ct);
          if (n >= 0) e.next = n;
        }
      } else if (d <= 0.0001 && !e.exiting) {
        // Reached the centre of the target tile without leaving it: pick onward.
        const n = nextTile(this.grid, this.flow, e.next);
        if (n >= 0 && n !== e.next) e.next = n;
        else if (this.flow[e.next] === 0) e.exiting = true;
      }
    }
    e.vx = (e.x - ox) / dt;
    e.vz = (e.z - oz) / dt;
    if (e.exiting) e.rem = Math.max(0, W - e.x);
    else if (e.next >= 0) {
      const nx = (e.next % W) + 0.5, nz = ((e.next / W) | 0) + 0.5;
      e.rem = this.flow[e.next] + Math.hypot(nx - e.x, nz - e.z);
    }
  }

  leak(e) {
    e.alive = false;
    const f = FRUITS[e.type];
    this.lives -= f.lives;
    this.leaked++;
    this.event({ e: 'leak', id: e.id, f: e.type, lives: f.lives });
  }

  damage(e, amount, tw, pierce = 0, armorScale = 1) {
    if (!e.alive || amount <= 0) return 0;
    const armor = Math.max(0, e.armor - e.peel) * (1 - pierce) * armorScale;
    const dealt = Math.max(amount * MIN_DAMAGE_RATIO, amount - armor);
    const real = Math.min(dealt, e.hp);
    e.hp -= dealt;
    if (tw) {
      tw.dmg += real;
      const owner = this.players.get(tw.owner);
      if (owner) owner.damage += real;
    }
    if (e.hp <= 0.001) this.kill(e, tw);
    return real;
  }

  kill(e, tw) {
    if (!e.alive) return;
    e.alive = false;
    e.hp = 0;
    const f = FRUITS[e.type];
    for (const p of this.players.values()) p.gold += f.bounty;
    if (tw) {
      tw.kills++;
      const owner = this.players.get(tw.owner);
      if (owner) owner.kills++;
    }
    this.event({ e: 'die', id: e.id, f: e.type, x: +e.x.toFixed(2), z: +e.z.toFixed(2), g: f.bounty });
    if (f.special === 'split') {
      const tx = Math.floor(e.x), tz = Math.floor(e.z);
      for (let k = 0; k < f.splitCount; k++) {
        const a = (k / f.splitCount) * Math.PI * 2;
        let cx = e.x + Math.cos(a) * 0.2, cz = e.z + Math.sin(a) * 0.2;
        if (e.x >= 0) {
          cx = Math.min(tx + 0.95, Math.max(tx + 0.05, cx));
          cz = Math.min(tz + 0.95, Math.max(tz + 0.05, cz));
        }
        this.spawnEnemy(f.splitInto, cx, cz, e);
      }
    }
  }

  // ----------------------------------------------------------------- towers
  acquire(t, range, minRange = 0) {
    const cx = t.x + 0.5, cz = t.z + 0.5;
    let best = null, bestScore = -Infinity;
    for (const e of this.enemies) {
      if (!e.alive || e.x < 0) continue;
      const dx = e.x - cx, dz = e.z - cz;
      const d2 = dx * dx + dz * dz;
      const r = range + e.radius * 0.5;
      if (d2 > r * r || d2 < minRange * minRange) continue;
      let score;
      switch (t.mode) {
        case 'last': score = e.rem; break;
        case 'strong': score = e.hp; break;
        case 'close': score = -d2; break;
        default: score = -e.rem;
      }
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  inRange(t, e, range) {
    const dx = e.x - (t.x + 0.5), dz = e.z - (t.z + 0.5);
    const r = range + e.radius * 0.5;
    return dx * dx + dz * dz <= r * r;
  }

  enemiesNear(x, z, r) {
    const out = [];
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const rr = r + e.radius * 0.5;
      const dx = e.x - x, dz = e.z - z;
      if (dx * dx + dz * dz <= rr * rr) out.push(e);
    }
    return out;
  }

  updateTower(t, dt) {
    const def = TOWERS[t.type];
    const s = def.levels[t.level - 1];
    const cx = t.x + 0.5, cz = t.z + 0.5;
    // Small negative carry keeps fire rates exact without letting idle towers bank shots.
    t.cd = Math.max(t.cd - dt, -dt);
    switch (def.kind) {
      case 'dart': {
        const tgt = this.acquire(t, s.range);
        t.target = tgt ? tgt.id : 0;
        if (tgt && t.cd <= 0) {
          t.cd += 1 / s.rate;
          const d = Math.hypot(tgt.x - cx, tgt.z - cz) / 14;
          this.pending.push({ at: this.time + d, tid: tgt.id, tw: t, dmg: s.damage });
          this.event({ e: 'shot', k: 'dart', tw: t.id, tid: tgt.id, d: +d.toFixed(3) });
        }
        break;
      }
      case 'peeler': {
        const tgt = this.acquire(t, s.range);
        t.target = tgt ? tgt.id : 0;
        if (tgt && t.cd <= 0) {
          t.cd += 1 / s.rate;
          const targets = [tgt];
          if (s.targets > 1) {
            const others = this.enemies
              .filter((e) => e !== tgt && e.alive && e.x >= 0 && this.inRange(t, e, s.range))
              .sort((a, b) => a.rem - b.rem);
            targets.push(...others.slice(0, s.targets - 1));
          }
          for (const e of targets) {
            const d = Math.hypot(e.x - cx, e.z - cz) / 10;
            this.pending.push({ at: this.time + d, tid: e.id, tw: t, dmg: s.damage, peel: s.peel });
            this.event({ e: 'shot', k: 'peel', tw: t.id, tid: e.id, d: +d.toFixed(3) });
          }
        }
        break;
      }
      case 'sniper': {
        const tgt = this.acquire(t, s.range);
        t.target = tgt ? tgt.id : 0;
        if (tgt && t.cd <= 0) {
          t.cd += 1 / s.rate;
          this.event({ e: 'shot', k: 'skewer', tw: t.id, tid: tgt.id, d: 0.08 });
          this.damage(tgt, s.damage, t, 1);
        }
        break;
      }
      case 'cannon':
      case 'mortar': {
        const tgt = this.acquire(t, s.range, s.minRange || 0);
        t.target = tgt ? tgt.id : 0;
        if (tgt && t.cd <= 0) {
          t.cd += 1 / s.rate;
          const dist = Math.hypot(tgt.x - cx, tgt.z - cz);
          const flight = def.kind === 'mortar' ? 0.9 + dist * 0.06 : 0.15 + dist / 8;
          const px = tgt.x + tgt.vx * flight * 0.9, pz = tgt.z + tgt.vz * flight * 0.9;
          this.pending.push({ at: this.time + flight, x: px, z: pz, r: s.splash, tw: t, dmg: s.damage });
          this.event({ e: 'shot', k: def.kind, tw: t.id, tx: +px.toFixed(2), tz: +pz.toFixed(2), d: +flight.toFixed(3) });
        }
        break;
      }
      case 'frost': {
        t.target = 0;
        if (t.cd <= 0) {
          const hit = this.enemiesNear(cx, cz, s.range).filter((e) => e.x >= 0);
          if (hit.length) {
            t.cd += 1 / s.rate;
            for (const e of hit) {
              const boss = FRUITS[e.type].boss;
              const mul = 1 - s.slow * (boss ? 0.5 : 1);
              if (mul < e.slowMul || e.slowT <= 0) e.slowMul = mul;
              e.slowT = Math.max(e.slowT, s.slowTime);
              this.damage(e, s.damage, t);
            }
            this.event({ e: 'pulse', tw: t.id, r: s.range });
          } else t.cd = 0;
        }
        break;
      }
      case 'flame': {
        const tgt = this.acquire(t, s.range);
        t.target = tgt ? tgt.id : 0;
        t.aux = tgt ? 1 : 0;
        if (tgt && t.cd <= 0) {
          t.cd += 1 / s.rate;
          const ax = tgt.x - cx, az = tgt.z - cz;
          const al = Math.hypot(ax, az) || 1;
          for (const e of this.enemiesNear(cx, cz, s.range)) {
            const bx = e.x - cx, bz = e.z - cz;
            const bl = Math.hypot(bx, bz) || 1;
            const cos = (ax * bx + az * bz) / (al * bl);
            if (e !== tgt && cos < Math.cos(s.cone)) continue;
            this.damage(e, s.damage, t);
            if (!e.alive) continue;
            if (s.burn >= e.burnDps || e.burnT <= 0) {
              e.burnDps = s.burn;
              e.burnBy = t;
            }
            e.burnT = s.burnTime;
          }
        } else if (!tgt) t.cd = Math.max(t.cd, 0);
        break;
      }
      case 'tesla': {
        const tgt = this.acquire(t, s.range);
        t.target = tgt ? tgt.id : 0;
        if (tgt && t.cd <= 0) {
          t.cd += 1 / s.rate;
          const chain = [tgt];
          const hit = new Set([tgt.id]);
          let last = tgt;
          while (chain.length < s.chains) {
            let best = null, bd = s.chainRange * s.chainRange;
            for (const e of this.enemies) {
              if (!e.alive || hit.has(e.id) || e.x < 0) continue;
              const d2 = (e.x - last.x) ** 2 + (e.z - last.z) ** 2;
              if (d2 <= bd) {
                bd = d2;
                best = e;
              }
            }
            if (!best) break;
            chain.push(best);
            hit.add(best.id);
            last = best;
          }
          const pts = [[+cx.toFixed(2), +cz.toFixed(2)]];
          chain.forEach((e, k) => {
            pts.push([+e.x.toFixed(2), +e.z.toFixed(2)]);
            this.damage(e, s.damage * Math.pow(0.85, k), t);
          });
          this.event({ e: 'zap', tw: t.id, pts });
        }
        break;
      }
      case 'laser': {
        let tgt = t.target ? this.enemyMap.get(t.target) : null;
        if (!tgt || !tgt.alive || !this.inRange(t, tgt, s.range)) {
          tgt = this.acquire(t, s.range);
          t.rampT = 0;
        }
        t.target = tgt ? tgt.id : 0;
        if (tgt) {
          t.rampT = Math.min(s.rampTime, t.rampT + dt);
          const mult = 1 + (s.ramp - 1) * (t.rampT / s.rampTime);
          t.aux = Math.round(mult * 10);
          // Armor counts as if the beam landed 4 hits per second, at half strength.
          this.damage(tgt, s.damage * mult * dt, t, 0.5, 4 * dt);
        } else t.aux = 0;
        break;
      }
      case 'blender': {
        const hit = this.enemiesNear(cx, cz, s.range).filter((e) => e.x >= 0);
        t.aux = hit.length ? 1 : 0;
        t.target = 0;
        if (t.cd <= 0) {
          if (hit.length) {
            t.cd += 1 / s.rate;
            for (const e of hit) this.damage(e, s.damage, t);
          } else t.cd = 0;
        }
        break;
      }
    }
  }

  resolveHit(h) {
    if (h.r) {
      const any = this.enemiesNear(h.x, h.z, h.r);
      for (const e of any) {
        const d = Math.hypot(e.x - h.x, e.z - h.z);
        this.damage(e, h.dmg * (1 - 0.5 * Math.min(1, d / h.r)), h.tw);
      }
      this.event({ e: 'boom', x: +h.x.toFixed(2), z: +h.z.toFixed(2), r: h.r });
      return;
    }
    const e = this.enemyMap.get(h.tid);
    if (!e || !e.alive) return;
    if (h.peel) e.peel = Math.min(e.armor, e.peel + h.peel);
    this.damage(e, h.dmg, h.tw);
  }

  // --------------------------------------------------------------- snapshot
  snapshot(full) {
    const en = [];
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const flags = (e.slowT > 0 ? 1 : 0) | (e.burnT > 0 ? 2 : 0) | (e.peel > 0 ? 4 : 0);
      en.push(e.id, e.type, Math.round(e.x * 100), Math.round(e.z * 100), Math.ceil(e.hp), Math.ceil(e.maxHp),
        flags, Math.round(Math.max(0, e.armor - e.peel) * 10));
    }
    const tt = [];
    for (const t of this.towers.values()) if (t.target || t.aux) tt.push(t.id, t.target, t.aux);
    let left = this.spawnQueue.length;
    for (const e of this.enemies) if (e.alive) left++;
    const s = {
      tick: this.tickCount,
      ph: this.phase,
      wave: this.wave,
      cd: this.countdown < 0 ? -1 : Math.ceil(this.countdown),
      lives: this.lives,
      speed: this.speed,
      paused: this.paused ? 1 : 0,
      pb: this.pausedBy,
      endless: this.endless ? 1 : 0,
      left,
      pl: [...this.players.values()].map((p) => [p.id, p.name, p.color, Math.floor(p.gold), p.kills,
        p.ready ? 1 : 0, p.connected ? 1 : 0, Math.round(p.damage)]),
      en,
      tt,
      sv: this.staticVersion,
    };
    if (full) {
      s.next = this.wavePreview(this.wave + 1);
      s.cur = this.wave > 0 ? this.wavePreview(this.wave) : [];
      const walls = [];
      for (let i = 0; i < W * H; i++) if (this.grid[i] === T_WALL) walls.push(i, this.wallOwner[i]);
      s.walls = walls;
      s.towers = [...this.towers.values()].map((t) => [t.id, t.type, t.level, t.x, t.z, t.owner,
        TARGET_MODES.indexOf(t.mode), t.kills, Math.round(t.dmg), t.invested]);
    }
    return s;
  }
}
