# 🍉 Fruit Siege: 3D Tower Defense

A top-down **3D** tower defense game that runs in your browser, with **online co-op multiplayer**.

Rogue fruit are rolling across your kitchen's cutting board and trying to escape out the garden gate. There is no fixed road: **you build the lanes yourself** out of walls and towers, and the fruit always take the shortest open route through your maze. Every fruit's toughness comes from **how hard its skin is in real life**. Raspberries pop in one hit, while coconuts shrug off almost everything.

## Quick start

You need [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm start
```

Then open **http://localhost:3000** in your browser and press **Play Solo** or **Host a Game**.

## Multiplayer (co-op)

1. One player clicks **Host a Game**. A 4-letter room code appears in the top-right corner.
2. Friends open the game, type the code and press **Join**. You can also click **Copy invite link** and send them the link.
3. Everyone defends the same kitchen:
   - Lives are shared.
   - Each chef has their own gold, and **every chef earns gold from every squashed fruit**.
   - Towers show their owner's color.
   - You can see your friends' cursors, and you can chat with <kbd>Enter</kbd>.
   - A wave starts when all chefs press **Ready** (or when the build timer runs out).
4. Up to 6 chefs per room. Fruit HP scales with the number of chefs. If you refresh or drop, rejoining with the same code puts you back in your old seat with your towers and gold.

**Who can join?**

- **Same computer or same Wi-Fi:** `npm start` prints a "Friends on your network" address (for example `http://192.168.1.20:3000`). Friends open that address.
- **Over the internet:** run the server somewhere public (any Node host such as Render, Railway or Fly.io works; it reads the `PORT` environment variable), or expose your local server with a tunnel like `cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`.

## How to play

| Action | Control |
| --- | --- |
| Wall (drag to paint many) | <kbd>F</kbd> |
| Pick a tower | <kbd>1</kbd> … <kbd>0</kbd> |
| Build / select | Left click |
| Cancel | Right click / <kbd>Esc</kbd> |
| Upgrade / sell selected | <kbd>U</kbd> / <kbd>Del</kbd> |
| Cycle targeting (first, last, strong, close) | <kbd>T</kbd> |
| Ready / start wave | <kbd>Space</kbd> |
| Move camera | <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / arrow keys / right-drag |
| Rotate camera | <kbd>Q</kbd> <kbd>E</kbd> / middle-drag |
| Zoom | Mouse wheel |
| Pause / mute | <kbd>P</kbd> / <kbd>M</kbd> |

**Mazing tips**

- **Walls cost only 5 gold.** Use them to make the path long and twisty, then put towers where the path passes by several times.
- While you hover a spot, **yellow arrows preview the new route** and the 🧭 counter shows the new path length before you commit.
- You can never completely block the path or trap a fruit, and the game tells you when a placement would.
- **Drop a tower on top of a wall** to convert it. The maze doesn't change, and the wall's builder gets the wall's gold back.
- You can build while the game is paused.

## The 10 towers

| # | Tower | Role |
| --- | --- | --- |
| 1 | **Toothpick Turret** | Cheap rapid-fire darts. Great early, weak against hard skins. |
| 2 | **Seed Cannon** | Exploding seeds with splash damage. |
| 3 | **Freezer** | Icy pulses that slow every fruit in range (bosses resist half). |
| 4 | **Skewer Sniper** | Long range, huge hits that **ignore armor completely**. |
| 5 | **Peeler** | Flings blades that **permanently strip armor** (skin hardness) off fruit. |
| 6 | **Blowtorch** | Short-range flame cone. **Burning ignores armor.** |
| 7 | **Zapper** | Chain lightning that jumps between several fruit. |
| 8 | **Laser Slicer** | Continuous beam that heats up the longer it holds a target. Half-ignores armor. |
| 9 | **Melon Mortar** | Enormous range and blast radius, but can't hit fruit right next to it. |
| 0 | **Blender** | Shreds every fruit right next to it. Place it where the path hugs it. |

Every tower has 3 levels. Selling refunds 70% of what you invested.

## The fruit: skin hardness = toughness

Each fruit has a real-world **skin hardness** on a 1–10 scale.

- **HP** grows with hardness^1.75.
- **Armor** grows with hardness². Armor is subtracted from every hit, but a hit always deals at least 20%.

That's why soft fruit melt under fast low-damage towers, while hard-shelled fruit need Peelers, Skewers, Lasers or fire.

| Fruit | Skin hardness | Notes |
| --- | --- | --- |
| Raspberry | 1 | Fast, fragile |
| Blueberry | 1.5 | Comes in swarms |
| Strawberry | 2 | |
| Grape | 2.5 | |
| Banana | 3 | Quick |
| Peach | 3.5 | |
| Kiwi | 4 | |
| Apple | 5 | |
| Orange | 5.5 | |
| Avocado | 6.5 | |
| Pomegranate | 7 | Bursts into 5 seeds |
| Pineapple | 8 | |
| Watermelon | 8.5 | Boss. Cracks into 3 slices |
| Durian | 9.5 | Regenerates |
| Coconut | 10 | Boss |
| King Coconut | 10 | Final boss (wave 30) |

Hover any fruit in game to see its hardness, HP and current armor. The **Fruit Almanac** (📖) lists them all. Survive 30 waves to win, then keep going in endless mode.

## Project layout

```
server.js            Node server: static files + WebSocket rooms (authoritative simulation)
public/
  index.html         Page layout and HUD markup
  css/style.css      Styles
  js/data.js         Towers, fruit, waves, balance numbers (shared with the server)
  js/sim.js          Game simulation: pathfinding, maze rules, combat (shared with the server)
  js/session.js      Solo session (runs the sim in the browser) and online session (WebSocket)
  js/scene.js        Three.js scene, camera, board, entity syncing
  js/models.js       Procedural 3D models for every fruit and tower
  js/effects.js      Particles, projectiles, lightning, juice splats
  js/ui.js           HUD, build bar, tower panel, almanac
  js/audio.js        Synthesized sound effects (no audio files)
  js/main.js         Menu, input, game loop
test/sim.test.js     Headless simulation tests, including a bot that plays full games
```

Run the tests with `npm test`.
