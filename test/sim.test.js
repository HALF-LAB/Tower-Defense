// Headless checks for the shared simulation: pathing, placement rules and a
// scripted playthrough with a simple maze to make sure waves resolve.
import assert from 'node:assert/strict';
import { Game, computeFlow, tracePath, makeBaseGrid, checkBlock, idx, T_WALL } from '../public/js/sim.js';
import { MAP, FRUITS, TOWERS, FINAL_WAVE, hardnessHp, hardnessArmor } from '../public/js/data.js';

const { W, H } = MAP;
let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
};

test('ten tower types with three levels each', () => {
  assert.equal(TOWERS.length, 10);
  for (const t of TOWERS) assert.equal(t.levels.length, 3);
});

test('fruit toughness follows real skin hardness', () => {
  const visible = FRUITS.filter((f) => !f.hidden && !f.boss);
  for (let i = 1; i < visible.length; i++) {
    assert.ok(visible[i].hardness >= visible[i - 1].hardness, 'list sorted by hardness');
    assert.ok(hardnessHp(visible[i].hardness) >= hardnessHp(visible[i - 1].hardness));
    assert.ok(hardnessArmor(visible[i].hardness) >= hardnessArmor(visible[i - 1].hardness));
  }
  const coconut = FRUITS.find((f) => f.key === 'coconut');
  const raspberry = FRUITS.find((f) => f.key === 'raspberry');
  assert.ok(coconut.hp > raspberry.hp * 50 && coconut.armor > raspberry.armor * 50);
});

test('open board has a straight path', () => {
  const g = makeBaseGrid();
  const flow = computeFlow(g);
  const path = tracePath(g, flow);
  assert.equal(path.length, W);
});

test('cannot fully block the path', () => {
  const g = makeBaseGrid();
  for (let z = 0; z < H - 1; z++) g[idx(10, z)] = T_WALL;
  const r = checkBlock(g, 10, H - 1, []);
  assert.equal(r.ok, false);
  const r2 = checkBlock(g, 12, 5, []);
  assert.equal(r2.ok, true);
});

test('cannot build on the entrance or exit', () => {
  const g = makeBaseGrid();
  assert.equal(checkBlock(g, 0, 8, []).ok, false);
  assert.equal(checkBlock(g, W - 1, 8, []).ok, false);
});

test('walls lengthen the path (mazing)', () => {
  const game = new Game();
  const p = game.addPlayer('Tester');
  p.gold = 100000;
  const before = game.flow[idx(0, 8)];
  for (let z = 0; z < H - 2; z++) assert.ok(game.command(p.id, { c: 'build', k: 'wall', x: 8, z }).ok);
  for (let z = 2; z < H; z++) assert.ok(game.command(p.id, { c: 'build', k: 'wall', x: 14, z }).ok);
  const after = game.flow[idx(0, 8)];
  assert.ok(after > before + 15, `path grew from ${before} to ${after}`);
  // Tower on top of a wall keeps the maze and refunds the wall.
  const gold = p.gold;
  assert.ok(game.command(p.id, { c: 'build', k: 'toothpick', x: 8, z: 3 }).ok);
  assert.equal(p.gold, gold - TOWERS[0].levels[0].cost + 5);
});

// Scripted bot: builds a serpentine maze one full wall column at a time, drops
// towers into the columns (on top of walls) and upgrades. Used as a balance check.
export function playBot(playerCount = 1, maxTicks = 30 * 60 * 90, log = false) {
  const game = new Game();
  const players = [];
  for (let i = 0; i < playerCount; i++) players.push(game.addPlayer(`Bot${i + 1}`));
  const cost = (k) => TOWERS.find((t) => t.key === k).levels[0].cost;
  const columns = [5, 9, 13, 17, 21].map((x, n) => {
    const tiles = [];
    for (let z = 0; z < H; z++) if (n % 2 === 0 ? z < H - 2 : z >= 2) tiles.push([x, z]);
    return tiles;
  });
  const pool = ['toothpick', 'cannon', 'peeler', 'skewer', 'freezer', 'laser', 'zapper', 'mortar', 'blowtorch', 'blender'];
  let lastWave = -1, colDone = 0, si = 0;
  for (let tick = 0; tick < maxTicks && game.phase !== 'lost' && game.phase !== 'won'; tick++) {
    if (game.phase === 'build' && game.wave !== lastWave) {
      lastWave = game.wave;
      for (const p of players) {
        const mine = () => [...game.towers.values()].filter((t) => t.owner === p.id);
        // New towers wherever they cover the most of the current path, then upgrades.
        for (let guard = 0; guard < 3 && mine().length < 3 + game.wave; guard++) {
          const k = si < 3 ? 'toothpick' : pool[(si * 7 + 3) % Math.min(pool.length, 3 + Math.floor(game.wave / 2))];
          if (p.gold < cost(k)) break;
          const range = TOWERS.find((t) => t.key === k).levels[0].range;
          const path = tracePath(game.grid, game.flow).map((i) => [(i % W) + 0.5, Math.floor(i / W) + 0.5]);
          let best = null, bestScore = 0;
          for (let z = 0; z < H; z++) for (let x = 2; x < W - 2; x++) {
            const v = game.grid[idx(x, z)];
            if (v !== T_WALL && (v !== 0 || !checkBlock(game.grid, x, z, game.enemies).ok)) continue;
            let sc = v === T_WALL ? 2 : 0;
            for (const [px, pz] of path) if ((px - x - 0.5) ** 2 + (pz - z - 0.5) ** 2 <= range * range) sc++;
            if (sc > bestScore) { bestScore = sc; best = [x, z]; }
          }
          if (!best || !game.command(p.id, { c: 'build', k, x: best[0], z: best[1] }).ok) break;
          si++;
        }
        // Finish the next maze column when affordable.
        if (colDone < columns.length) {
          const col = columns[colDone];
          const need = col.filter(([x, z]) => game.grid[idx(x, z)] === 0).length * 5;
          if (p.gold >= need) {
            for (const [x, z] of col) game.command(p.id, { c: 'build', k: 'wall', x, z });
            colDone++;
          }
        }
        for (const t of mine().sort((a, b) => a.level - b.level)) game.command(p.id, { c: 'upgrade', id: t.id });
        game.command(p.id, { c: 'ready', v: true });
      }
      if (log) {
        const p = players[0];
        console.log(`    wave ${game.wave}: lives ${game.lives} gold ${p.gold} towers ${game.towers.size} path ${game.flow[idx(0, 9)].toFixed(0)}`);
      }
    }
    game.tick();
    game.drainEvents();
  }
  return game;
}

test('scripted bot survives the opening waves', () => {
  for (const n of [1, 2]) {
    const game = playBot(n, undefined, !!process.env.BOT_LOG);
    console.log(`    ${n} player(s): reached wave ${game.wave}, lives ${game.lives}, towers ${game.towers.size}, phase ${game.phase}`);
    assert.ok(game.wave >= 10, 'bot should clear the opening waves');
    const snap = game.snapshot(true);
    assert.ok(Array.isArray(snap.towers) && Array.isArray(snap.walls));
    JSON.stringify(snap);
  }
});

test('every wave up to the final one is defined', () => {
  const game = new Game();
  for (let n = 1; n <= FINAL_WAVE + 5; n++) assert.ok(game.wavePreview(n).length > 0);
});

console.log(`${passed} tests passed`);
