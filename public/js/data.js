// Shared game data: map layout, fruit (enemy) and tower definitions, waves.
// Imported by both the browser client and the Node server.

export const MAP = {
  W: 28,
  H: 18,
  // Fruit enter on the left edge and try to escape off the right edge.
  spawn: { x0: 0, x1: 1, z0: 7, z1: 10 },
  exit: { x0: 26, x1: 27, z0: 7, z1: 10 },
};

export const TICK_RATE = 30;
export const STEP = 1 / TICK_RATE;
export const START_LIVES = 25;
export const START_GOLD = 250;
export const WALL_COST = 5;
export const SELL_RATIO = 0.7;
export const BUILD_TIME = 25; // seconds between waves
export const FINAL_WAVE = 30;
export const MAX_PLAYERS = 6;
export const MIN_DAMAGE_RATIO = 0.2; // armor can never block more than 80% of a hit

export const PLAYER_COLORS = ['#ff5a5f', '#3fa7ff', '#ffc93c', '#7bd389', '#c780fa', '#ff9f43'];

// Real-world fruit skin hardness on a 1-10 scale drives how tough each fruit is:
// HP grows with hardness^1.75 and armor (flat damage blocked per hit) with hardness^2.
export const hardnessHp = (h) => Math.round(10 * Math.pow(h, 1.75));
export const hardnessArmor = (h) => Math.round(0.12 * h * h * 10) / 10;

const fruit = (o) => ({
  hpMul: 1,
  lives: 1,
  boss: false,
  special: null,
  ...o,
  hp: Math.round(hardnessHp(o.hardness) * (o.hpMul || 1)),
  armor: hardnessArmor(o.hardness),
});

export const FRUITS = [
  fruit({ key: 'raspberry', name: 'Raspberry', hardness: 1.0, speed: 2.6, radius: 0.2, bounty: 3, color: '#d81b4a',
    skin: 'Paper-thin drupelets that burst if you look at them.' }),
  fruit({ key: 'seed', name: 'Pomegranate Seed', hardness: 1.0, speed: 2.8, radius: 0.11, bounty: 1, color: '#c2002f',
    skin: 'A juicy aril with a gel-thin membrane.', hidden: true }),
  fruit({ key: 'blueberry', name: 'Blueberry', hardness: 1.5, speed: 2.4, radius: 0.16, bounty: 2, color: '#3b4fb8',
    skin: 'Thin waxy skin. Rolls in big swarms.', special: 'swarm' }),
  fruit({ key: 'strawberry', name: 'Strawberry', hardness: 2.0, speed: 2.2, radius: 0.24, bounty: 4, color: '#e8273b',
    skin: 'No real skin at all - just a soft outer flesh.' }),
  fruit({ key: 'grape', name: 'Grape', hardness: 2.5, speed: 2.1, radius: 0.2, bounty: 4, color: '#7d3c98',
    skin: 'Thin, springy skin that pops under pressure.' }),
  fruit({ key: 'banana', name: 'Banana', hardness: 3.0, speed: 2.4, radius: 0.3, bounty: 5, color: '#f7d038',
    skin: 'A soft peel that bruises easily. Quick on its feet.' }),
  fruit({ key: 'peach', name: 'Peach', hardness: 3.5, speed: 1.9, radius: 0.27, bounty: 5, color: '#ffab76',
    skin: 'Fuzzy, delicate skin over soft flesh.' }),
  fruit({ key: 'slice', name: 'Melon Slice', hardness: 3.5, speed: 1.9, radius: 0.24, bounty: 3, color: '#ff4d6d',
    skin: 'Exposed flesh - the rind has been cracked open.', hidden: true }),
  fruit({ key: 'kiwi', name: 'Kiwi', hardness: 4.0, speed: 1.9, radius: 0.25, bounty: 6, color: '#8b6b3d',
    skin: 'Fibrous, fuzzy skin - tougher than it looks.' }),
  fruit({ key: 'apple', name: 'Apple', hardness: 5.0, speed: 1.7, radius: 0.29, bounty: 7, color: '#d62828',
    skin: 'Firm, waxy skin that resists a bite.' }),
  fruit({ key: 'orange', name: 'Orange', hardness: 5.5, speed: 1.6, radius: 0.3, bounty: 8, color: '#ff8c1a',
    skin: 'A thick, oily peel with a spongy pith underneath.' }),
  fruit({ key: 'avocado', name: 'Avocado', hardness: 6.5, speed: 1.5, radius: 0.3, bounty: 10, color: '#3d5a1e',
    skin: 'Leathery, pebbled skin built like armor.' }),
  fruit({ key: 'pomegranate', name: 'Pomegranate', hardness: 7.0, speed: 1.4, radius: 0.32, bounty: 10, color: '#a4161a',
    skin: 'A hard leathery rind. Bursts into seeds when broken.', special: 'split', splitInto: 'seed', splitCount: 5 }),
  fruit({ key: 'pineapple', name: 'Pineapple', hardness: 8.0, speed: 1.3, radius: 0.36, bounty: 13, color: '#e0a526',
    skin: 'Tough, spiky, scaled armor plating.' }),
  fruit({ key: 'watermelon', name: 'Watermelon', hardness: 8.5, speed: 0.9, radius: 0.5, bounty: 30, color: '#2d8a3e',
    hpMul: 3, lives: 4, boss: true,
    skin: 'A thick, hard rind. Cracks into slices when broken.', special: 'split', splitInto: 'slice', splitCount: 3 }),
  fruit({ key: 'durian', name: 'Durian', hardness: 9.5, speed: 1.1, radius: 0.42, bounty: 22, color: '#9fae3a',
    hpMul: 1.4, lives: 2,
    skin: 'A husk of sharp woody thorns. Slowly regrows damage.', special: 'regen' }),
  fruit({ key: 'coconut', name: 'Coconut', hardness: 10.0, speed: 0.85, radius: 0.4, bounty: 40, color: '#6b4226',
    hpMul: 2.5, lives: 5, boss: true,
    skin: 'A rock-hard woody shell. The toughest fruit there is.' }),
  fruit({ key: 'kingcoconut', name: 'King Coconut', hardness: 10.0, speed: 0.6, radius: 0.72, bounty: 300, color: '#4a2c17',
    hpMul: 20, lives: 25, boss: true,
    skin: 'A colossal coconut. Its shell has never been cracked.', hidden: true }),
];

export const FRUIT_INDEX = Object.fromEntries(FRUITS.map((f, i) => [f.key, i]));
export const fruitByKey = (k) => FRUITS[FRUIT_INDEX[k]];

// Tower definitions. `levels[0]` holds the build cost, later levels hold upgrade costs.
export const TOWERS = [
  {
    key: 'toothpick', name: 'Toothpick Turret', hotkey: '1', color: '#d9a066', kind: 'dart',
    desc: 'Cheap, rapid-fire single-target darts. Great early, weak against hard skins.',
    levels: [
      { cost: 40, damage: 9, range: 3.0, rate: 2.5 },
      { cost: 50, damage: 14, range: 3.3, rate: 3.0 },
      { cost: 90, damage: 22, range: 3.6, rate: 3.6 },
    ],
  },
  {
    key: 'cannon', name: 'Seed Cannon', hotkey: '2', color: '#5b8c3a', kind: 'cannon',
    desc: 'Lobs exploding seeds that splash every fruit near the impact.',
    levels: [
      { cost: 75, damage: 22, range: 3.2, rate: 0.8, splash: 1.1 },
      { cost: 80, damage: 38, range: 3.4, rate: 0.9, splash: 1.25 },
      { cost: 150, damage: 65, range: 3.6, rate: 1.0, splash: 1.4 },
    ],
  },
  {
    key: 'freezer', name: 'Freezer', hotkey: '3', color: '#9fe7ff', kind: 'frost',
    desc: 'Pulses icy air that slows every fruit in range.',
    levels: [
      { cost: 70, damage: 3, range: 2.2, rate: 0.8, slow: 0.35, slowTime: 1.6 },
      { cost: 70, damage: 6, range: 2.5, rate: 0.9, slow: 0.45, slowTime: 1.8 },
      { cost: 120, damage: 10, range: 2.8, rate: 1.0, slow: 0.55, slowTime: 2.0 },
    ],
  },
  {
    key: 'skewer', name: 'Skewer Sniper', hotkey: '4', color: '#b0b7c3', kind: 'sniper',
    desc: 'Long-range skewers that pierce straight through any skin (ignores armor).',
    levels: [
      { cost: 120, damage: 70, range: 6.0, rate: 0.45 },
      { cost: 120, damage: 130, range: 6.5, rate: 0.5 },
      { cost: 220, damage: 240, range: 7.5, rate: 0.55 },
    ],
  },
  {
    key: 'peeler', name: 'Peeler', hotkey: '5', color: '#ff9f1c', kind: 'peeler',
    desc: 'Flings peeler blades that permanently strip skin hardness (armor) off fruit.',
    levels: [
      { cost: 90, damage: 6, range: 2.8, rate: 1.5, peel: 1.5, targets: 2 },
      { cost: 90, damage: 9, range: 3.0, rate: 1.7, peel: 2.5, targets: 2 },
      { cost: 160, damage: 14, range: 3.3, rate: 2.0, peel: 4.0, targets: 3 },
    ],
  },
  {
    key: 'blowtorch', name: 'Blowtorch', hotkey: '6', color: '#ff4d2e', kind: 'flame',
    desc: 'Short-range flame cone. Burning ignores skin hardness entirely.',
    levels: [
      { cost: 100, damage: 3, range: 2.2, rate: 10, burn: 10, burnTime: 2.5, cone: 0.5 },
      { cost: 100, damage: 5, range: 2.4, rate: 10, burn: 18, burnTime: 2.5, cone: 0.55 },
      { cost: 170, damage: 8, range: 2.6, rate: 10, burn: 32, burnTime: 3.0, cone: 0.6 },
    ],
  },
  {
    key: 'zapper', name: 'Zapper', hotkey: '7', color: '#ffe14d', kind: 'tesla',
    desc: 'Lightning that chains between several nearby fruits.',
    levels: [
      { cost: 130, damage: 26, range: 3.0, rate: 0.9, chains: 3, chainRange: 1.8 },
      { cost: 120, damage: 40, range: 3.2, rate: 1.0, chains: 4, chainRange: 1.9 },
      { cost: 200, damage: 62, range: 3.4, rate: 1.1, chains: 6, chainRange: 2.1 },
    ],
  },
  {
    key: 'laser', name: 'Laser Slicer', hotkey: '8', color: '#c86bfa', kind: 'laser',
    desc: 'A continuous beam that heats up the longer it stays on one fruit. Half-ignores armor.',
    levels: [
      { cost: 150, damage: 30, range: 3.6, ramp: 3.0, rampTime: 3.0 },
      { cost: 140, damage: 50, range: 3.9, ramp: 3.0, rampTime: 2.8 },
      { cost: 240, damage: 85, range: 4.2, ramp: 4.0, rampTime: 2.6 },
    ],
  },
  {
    key: 'mortar', name: 'Melon Mortar', hotkey: '9', color: '#6c757d', kind: 'mortar',
    desc: 'Huge range artillery with a massive blast. Cannot hit fruit right next to it.',
    levels: [
      { cost: 140, damage: 60, range: 7.5, minRange: 1.5, rate: 0.33, splash: 1.6 },
      { cost: 140, damage: 110, range: 8.0, minRange: 1.5, rate: 0.36, splash: 1.8 },
      { cost: 240, damage: 190, range: 8.5, minRange: 1.5, rate: 0.4, splash: 2.0 },
    ],
  },
  {
    key: 'blender', name: 'Blender', hotkey: '0', color: '#4dd2c2', kind: 'blender',
    desc: 'Spinning blades shred every fruit right next to it. Put it where the path hugs it.',
    levels: [
      { cost: 110, damage: 7, range: 1.5, rate: 4 },
      { cost: 110, damage: 12, range: 1.6, rate: 4 },
      { cost: 190, damage: 20, range: 1.8, rate: 4.5 },
    ],
  },
];

export const TOWER_INDEX = Object.fromEntries(TOWERS.map((t, i) => [t.key, i]));
export const towerByKey = (k) => TOWERS[TOWER_INDEX[k]];

export const TARGET_MODES = ['first', 'last', 'strong', 'close'];

// Wave list. Each group: [fruitKey, count, secondsBetween, startDelay]
const WAVES = [
  /* 1 */ [['raspberry', 10, 0.9, 0]],
  /* 2 */ [['raspberry', 8, 0.6, 0], ['strawberry', 6, 1.0, 3]],
  /* 3 */ [['strawberry', 10, 0.8, 0], ['blueberry', 12, 0.25, 4]],
  /* 4 */ [['grape', 10, 0.8, 0], ['raspberry', 14, 0.4, 2]],
  /* 5 */ [['banana', 8, 0.9, 0], ['strawberry', 12, 0.5, 3]],
  /* 6 */ [['peach', 10, 0.9, 0], ['blueberry', 18, 0.2, 4]],
  /* 7 */ [['kiwi', 10, 1.0, 0], ['grape', 12, 0.5, 3]],
  /* 8 */ [['apple', 8, 1.2, 0], ['banana', 12, 0.5, 4]],
  /* 9 */ [['orange', 8, 1.2, 0], ['peach', 10, 0.7, 2], ['blueberry', 22, 0.18, 6]],
  /* 10 */ [['watermelon', 2, 5, 0], ['kiwi', 12, 0.7, 2]],
  /* 11 */ [['avocado', 8, 1.2, 0], ['apple', 10, 0.8, 3]],
  /* 12 */ [['orange', 12, 0.9, 0], ['banana', 18, 0.35, 2]],
  /* 13 */ [['pomegranate', 6, 1.6, 0], ['grape', 22, 0.3, 3]],
  /* 14 */ [['avocado', 12, 0.9, 0], ['blueberry', 32, 0.14, 3]],
  /* 15 */ [['pineapple', 6, 1.6, 0], ['apple', 16, 0.6, 3]],
  /* 16 */ [['pomegranate', 10, 1.1, 0], ['kiwi', 18, 0.45, 2]],
  /* 17 */ [['pineapple', 10, 1.2, 0], ['orange', 16, 0.55, 3]],
  /* 18 */ [['durian', 4, 2.0, 0], ['avocado', 16, 0.6, 2]],
  /* 19 */ [['watermelon', 4, 2.6, 0], ['raspberry', 40, 0.14, 2]],
  /* 20 */ [['coconut', 2, 4, 0], ['durian', 6, 1.5, 3], ['pomegranate', 8, 1.0, 6]],
  /* 21 */ [['pineapple', 16, 0.8, 0], ['banana', 30, 0.25, 2]],
  /* 22 */ [['durian', 10, 1.2, 0], ['peach', 24, 0.35, 2]],
  /* 23 */ [['avocado', 20, 0.6, 0], ['pomegranate', 12, 0.8, 3]],
  /* 24 */ [['watermelon', 6, 2.0, 0], ['blueberry', 50, 0.1, 3]],
  /* 25 */ [['coconut', 4, 2.6, 0], ['orange', 24, 0.35, 2]],
  /* 26 */ [['durian', 14, 0.9, 0], ['apple', 28, 0.3, 2]],
  /* 27 */ [['pineapple', 22, 0.55, 0], ['pomegranate', 16, 0.6, 3]],
  /* 28 */ [['watermelon', 10, 1.4, 0], ['kiwi', 34, 0.25, 2]],
  /* 29 */ [['coconut', 6, 2.0, 0], ['durian', 16, 0.7, 3]],
  /* 30 */ [['kingcoconut', 1, 1, 6], ['coconut', 6, 2.0, 0], ['watermelon', 6, 2.0, 4]],
];

// HP multiplier applied on top of a fruit's hardness-based HP as the waves go on.
export function waveHpScale(n) {
  const k = n - 1;
  return 1 + 0.08 * k + 0.0045 * k * k;
}

export function waveGroups(n) {
  if (n <= WAVES.length) return WAVES[n - 1];
  // Endless mode: remix the late-game waves with growing counts.
  const base = WAVES[20 + ((n - 31) % 10)];
  const extra = 1 + Math.floor((n - 31) / 10) * 0.25;
  return base.map(([k, c, iv, d]) => [k, Math.ceil(c * extra), iv / Math.min(extra, 1.6), d]);
}

export const waveBonus = (n) => 25 + 4 * n;
