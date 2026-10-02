// Entry point: menu, game loop, input and glue between session, scene and UI.
import { MAP, TOWERS, FRUITS, WALL_COST, TOWER_INDEX, TARGET_MODES } from './data.js';
import { checkBlock, tracePath, idx, inBounds, T_WALL, T_TOWER } from './sim.js';
import { GameScene } from './scene.js';
import { renderThumbnails } from './models.js';
import { LocalSession, RemoteSession, ClientState } from './session.js';
import { UI } from './ui.js';
import { sfx, unlockAudio, isMuted, setMuted } from './audio.js';

const { W, H } = MAP;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SPAWN_MID = idx(0, Math.floor((MAP.spawn.z0 + MAP.spawn.z1 + 1) / 2));

const canvas = $('game');
const overlay = $('overlay');
const octx = overlay.getContext('2d');
const scene = new GameScene(canvas);

let session = null;
let state = null;
let buildKey = null;
let selected = null;
let hover = null;
let previewLen = null;
let lastPhase = null;
let uiTimer = 0;
let mpAvailable = false;
let lastCursorSend = 0;
const ghost = { sig: '', t: 0, res: null, reason: '' };
const floats = [];
const keys = new Set();
const mouse = { x: -1, y: -1, down: false, button: -1, startX: 0, startY: 0, lastX: 0, lastY: 0, dragged: false, paintLast: -1, onCanvas: false };

const ui = new UI({
  onPickBuild: (k) => setBuild(buildKey === k ? null : k),
  onMode: (id, m) => send({ c: 'mode', id, m }),
  onUpgrade: (id) => upgrade(id),
  onSell: (x, z) => sell(x, z),
});

// ------------------------------------------------------------------ helpers
function send(cmd) {
  if (session) session.send(cmd);
}

function playerName() {
  const n = $('name-input').value.trim() || 'Chef';
  try {
    localStorage.setItem('fs-name', n);
  } catch {}
  return n;
}

function setBuild(key) {
  buildKey = key;
  ui.setActiveBuild(key);
  ghost.sig = '';
  if (key) selected = null;
  if (!key) {
    scene.setGhost(null);
    scene.previewMarkers.count = 0;
    previewLen = null;
  }
}

function upgrade(id) {
  send({ c: 'upgrade', id });
}

function sell(x, z) {
  send({ c: 'sell', x, z });
  selected = null;
}

function towerAt(x, z) {
  for (const t of state.towers.values()) if (t.x === x && t.z === z) return t;
  return null;
}

function addFloat(x, y, z, text, color) {
  floats.push({ x, y, z, text, color, life: 1.1 });
  if (floats.length > 60) floats.shift();
}

// ------------------------------------------------------------- game start
function begin(s, code) {
  session = s;
  state = new ClientState(s.playerId);
  s.onSnapshot = (snap) => state.push(snap);
  s.onMessage = onMessage;
  s.onClose = () => {
    ui.toast('Disconnected from the server', 'error', 4000);
    quitToMenu();
  };
  scene.reset();
  scene.cam = { tx: W / 2, tz: H / 2 + 1.3, dist: scene.fitDist, yaw: 0, pitch: 0.98 };
  scene.userZoomed = false;
  scene.resize();
  s.start();
  lastPhase = null;
  selected = null;
  setBuild(null);
  ui.hideEnd();
  $('menu').classList.add('hidden');
  $('hud').classList.remove('hidden');
  ui.showRoom(code);
  ui.showChat(s.online);
  if (code) history.replaceState(null, '', `?room=${code}`);
  ui.toast(code ? `Room <b>${code}</b> - share the code or invite link with friends!` : 'Build a maze with walls and towers, then press <b>Start Wave</b>!', '', 4500);
}

function startSolo() {
  unlockAudio();
  begin(new LocalSession(playerName()), null);
}

async function startOnline(hello) {
  unlockAudio();
  const s = new RemoteSession();
  setMenuBusy(true);
  try {
    await s.connect(hello);
    begin(s, s.code);
  } catch (err) {
    $('mp-note').textContent = err.message;
    $('mp-note').classList.add('warn');
    s.close();
  } finally {
    setMenuBusy(false);
  }
}

function setMenuBusy(busy) {
  for (const id of ['btn-solo', 'btn-host', 'btn-join']) $(id).disabled = busy || (id !== 'btn-solo' && !mpAvailable);
}

function quitToMenu() {
  if (session) session.close();
  session = null;
  state = null;
  setBuild(null);
  selected = null;
  scene.reset();
  scene.selRing.visible = false;
  scene.rangeGroup.visible = false;
  ui.hideEnd();
  $('hud').classList.add('hidden');
  $('menu').classList.remove('hidden');
  history.replaceState(null, '', location.pathname);
}

function onMessage(m) {
  if (m.type === 'error') {
    ui.toast(esc(m.msg), 'error');
    sfx.error();
  } else if (m.type === 'chat') {
    ui.chat(m.name, m.color, m.text);
  } else if (m.type === 'cursors' && state) {
    scene.setCursors(m.c, state);
  }
}

function handleEventFeedback(events) {
  for (const ev of events) {
    switch (ev.e) {
      case 'shot':
        if (ev.k === 'dart' || ev.k === 'peel') sfx.shoot();
        else if (ev.k === 'skewer') sfx.skewer();
        else sfx.cannon();
        break;
      case 'boom': sfx.boom(); break;
      case 'zap': sfx.zap(); break;
      case 'pulse': sfx.pulse(); break;
      case 'die': sfx.splat(FRUITS[ev.f].radius); break;
      case 'leak':
        sfx.leak();
        if (ev.lives > 1) ui.toast(`${esc(FRUITS[ev.f].name)} escaped! -${ev.lives} lives`, 'error');
        break;
      case 'wave':
        ui.toast(`Wave ${ev.n}`, 'big', 1800);
        sfx.wave();
        break;
      case 'cleared':
        ui.toast(`Wave ${ev.n} cleared! Everyone gets +${ev.bonus} gold`);
        sfx.cleared();
        break;
      case 'built': sfx.build(); break;
      case 'upgraded': sfx.upgrade(); break;
      case 'sold': sfx.sell(); break;
      case 'won': sfx.win(); break;
      case 'lost': sfx.lose(); break;
      case 'msg':
        if (session && session.online) ui.chat(null, ev.color, ev.text);
        break;
    }
  }
}

// ---------------------------------------------------------------- the loop
let lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  cameraKeys(dt);

  if (session && state) {
    session.update(dt);
    const rt = session.renderTime();
    if (state.staticDirty) {
      scene.syncStatic(state);
      state.staticDirty = false;
      ghost.sig = '';
    }
    scene.syncEnemies(state.sample(rt), dt);
    const events = state.takeEvents(rt);
    if (events.length) {
      scene.handleEvents(events, state, addFloat);
      handleEventFeedback(events);
    }
    scene.animateTowers(state, dt);
    updateGhost();
    updateSelectionVisuals();

    const ph = state.info.ph;
    if (ph !== lastPhase) {
      if ((ph === 'lost' || ph === 'won') && lastPhase !== null) ui.showEnd(state, ph === 'won', session.online);
      else if (ph === 'lost' || ph === 'won') ui.showEnd(state, ph === 'won', session.online);
      if ((lastPhase === 'lost' || lastPhase === 'won') && ph === 'build') {
        ui.hideEnd();
        scene.splats.clear();
      }
      lastPhase = ph;
    }

    uiTimer -= dt;
    if (uiTimer <= 0) {
      uiTimer = 0.1;
      const cur = Math.round(state.flow[SPAWN_MID]);
      const pathText = previewLen !== null && Math.round(previewLen) !== cur ? `${cur} → ${Math.round(previewLen)}` : `${cur}`;
      ui.update(state, { online: session.online, selected, pathText });
    }
  } else {
    scene.cam.yaw += dt * 0.05;
  }
  scene.update(dt);
  scene.render();
  drawOverlay(dt);
}

function cameraKeys(dt) {
  if (!session) return;
  const sp = 14 * dt;
  let r = 0, f = 0;
  if (keys.has('a') || keys.has('arrowleft')) r -= sp;
  if (keys.has('d') || keys.has('arrowright')) r += sp;
  if (keys.has('w') || keys.has('arrowup')) f += sp;
  if (keys.has('s') || keys.has('arrowdown')) f -= sp;
  if (r || f) scene.pan(r, f);
  if (keys.has('q')) scene.cam.yaw -= dt * 1.6;
  if (keys.has('e')) scene.cam.yaw += dt * 1.6;
}

// ------------------------------------------------------- ghost & selection
function updateGhost() {
  const valid = buildKey && hover && mouse.onCanvas && inBounds(hover.x, hover.z);
  if (!valid) {
    scene.setGhost(null);
    scene.previewMarkers.count = 0;
    previewLen = null;
    return;
  }
  const i = idx(hover.x, hover.z);
  const now = performance.now();
  const sig = `${buildKey}:${i}:${state.staticVersion}`;
  if (sig !== ghost.sig || now - ghost.t > 250) {
    ghost.sig = sig;
    ghost.t = now;
    const onWall = buildKey !== 'wall' && state.grid[i] === T_WALL;
    const res = onWall ? { ok: true, onWall } : checkBlock(state.grid, hover.x, hover.z, state.latestEnemies());
    ghost.res = res;
    if (res.ok && res.flow) {
      const prev = state.grid[i];
      state.grid[i] = T_WALL;
      scene.setPathMarkers(scene.previewMarkers, tracePath(state.grid, res.flow));
      state.grid[i] = prev;
      previewLen = res.flow[SPAWN_MID];
    } else {
      scene.previewMarkers.count = 0;
      previewLen = null;
    }
  }
  const me = state.myPlayer;
  const gold = me ? me.gold : 0;
  const def = buildKey === 'wall' ? null : TOWERS[TOWER_INDEX[buildKey]];
  const cost = def ? def.levels[0].cost : WALL_COST;
  ghost.reason = !ghost.res.ok ? ghost.res.reason : gold < cost ? 'Not enough gold' : '';
  scene.setGhost(buildKey, hover.x, hover.z, !ghost.reason, def ? def.levels[0].range : 0);
}

function updateSelectionVisuals() {
  scene.selRing.visible = false;
  if (!selected) return;
  if (selected.kind === 'tower') {
    const t = state.towers.get(selected.id);
    if (!t) {
      selected = null;
      return;
    }
    scene.selRing.visible = true;
    scene.selRing.position.set(t.x + 0.5, 0.03, t.z + 0.5);
    if (!buildKey) scene.showRange(t.x + 0.5, t.z + 0.5, TOWERS[t.type].levels[t.level - 1].range, '#ffd34d');
  } else if (selected.kind === 'wall') {
    if (!state.walls.has(selected.i)) {
      selected = null;
      return;
    }
    scene.selRing.visible = true;
    scene.selRing.position.set((selected.i % W) + 0.5, 0.66, Math.floor(selected.i / W) + 0.5);
  }
}

function tryBuild(painting) {
  if (!hover || !inBounds(hover.x, hover.z) || !state) return;
  const i = idx(hover.x, hover.z);
  if (state.grid[i] === T_TOWER && !painting) {
    const t = towerAt(hover.x, hover.z);
    if (t) {
      setBuild(null);
      selected = { kind: 'tower', id: t.id };
      sfx.click();
    }
    return;
  }
  ghost.sig = '';
  updateGhost();
  if (ghost.reason) {
    if (!painting) {
      ui.toast(esc(ghost.reason), 'error');
      sfx.error();
    }
    return;
  }
  send({ c: 'build', k: buildKey, x: hover.x, z: hover.z });
  if (buildKey === 'wall') sfx.wall();
  ghost.sig = '';
}

function selectAt() {
  if (!hover || !inBounds(hover.x, hover.z)) {
    selected = null;
    return;
  }
  const i = idx(hover.x, hover.z);
  if (state.grid[i] === T_TOWER) {
    const t = towerAt(hover.x, hover.z);
    selected = t ? { kind: 'tower', id: t.id } : null;
  } else if (state.grid[i] === T_WALL) {
    selected = { kind: 'wall', i };
  } else {
    selected = null;
  }
  if (selected) sfx.click();
}

function updateHover() {
  const p = scene.pick(mouse.x, mouse.y);
  if (!p) {
    hover = null;
    return;
  }
  hover = { x: Math.floor(p.x), z: Math.floor(p.z), wx: p.x, wz: p.z };
  const inside = inBounds(hover.x, hover.z);
  scene.hover.visible = inside && mouse.onCanvas && !!session;
  if (inside) scene.hover.position.set(hover.x + 0.5, 0.02, hover.z + 0.5);
  if (session && session.online && performance.now() - lastCursorSend > 100) {
    lastCursorSend = performance.now();
    session.cursor(p.x, p.z);
  }
}

// ------------------------------------------------------------------- input
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerenter', () => (mouse.onCanvas = true));
canvas.addEventListener('pointerleave', () => {
  mouse.onCanvas = false;
  scene.hover.visible = false;
});
canvas.addEventListener('pointerdown', (e) => {
  unlockAudio();
  mouse.down = true;
  mouse.button = e.button;
  mouse.startX = mouse.lastX = e.clientX;
  mouse.startY = mouse.lastY = e.clientY;
  mouse.dragged = false;
  mouse.onCanvas = true;
  canvas.setPointerCapture(e.pointerId);
  if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur();
  if (e.button === 0 && session && buildKey) {
    tryBuild(false);
    mouse.paintLast = hover ? idx(hover.x, hover.z) : -1;
  }
});
canvas.addEventListener('pointermove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  const dx = e.clientX - mouse.lastX, dy = e.clientY - mouse.lastY;
  mouse.lastX = e.clientX;
  mouse.lastY = e.clientY;
  if (mouse.down && Math.hypot(e.clientX - mouse.startX, e.clientY - mouse.startY) > 6) mouse.dragged = true;
  if (mouse.down && mouse.button === 2) scene.pan(-dx * 0.045, dy * 0.045);
  if (mouse.down && mouse.button === 1) scene.cam.yaw -= dx * 0.008;
  updateHover();
  if (mouse.down && mouse.button === 0 && buildKey === 'wall' && hover && session) {
    const i = idx(hover.x, hover.z);
    if (i !== mouse.paintLast) {
      mouse.paintLast = i;
      tryBuild(true);
    }
  }
});
canvas.addEventListener('pointerup', (e) => {
  if (session && state) {
    if (mouse.button === 0 && !buildKey && !mouse.dragged) selectAt();
    if (mouse.button === 2 && !mouse.dragged) {
      if (buildKey) setBuild(null);
      else selected = null;
    }
  }
  mouse.down = false;
  try {
    canvas.releasePointerCapture(e.pointerId);
  } catch {}
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  scene.cam.dist *= Math.pow(1.0013, e.deltaY);
  scene.userZoomed = true;
}, { passive: false });

window.addEventListener('resize', () => scene.resize());
window.addEventListener('blur', () => keys.clear());

window.addEventListener('keydown', (e) => {
  const active = document.activeElement;
  if (active && active.tagName === 'INPUT') {
    if (active.id === 'chat-input') {
      if (e.key === 'Enter') {
        const text = active.value.trim();
        if (text && session) session.chat(text);
        active.value = '';
        active.blur();
      } else if (e.key === 'Escape') active.blur();
    } else if (e.key === 'Enter') {
      if (active.id === 'code-input') $('btn-join').click();
      else if (active.id === 'name-input') $('btn-solo').click();
    }
    return;
  }
  const k = e.key.toLowerCase();
  if (k === 'escape') {
    if (ui.anyModalOpen() && $('modal-end').classList.contains('hidden')) ui.closeModals();
    else if (buildKey) setBuild(null);
    else selected = null;
    return;
  }
  if (!session || !state) return;
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  keys.add(k);
  if (e.repeat) return;
  const tower = TOWERS.find((t) => t.hotkey === e.key);
  if (tower) setBuild(buildKey === tower.key ? null : tower.key);
  else if (k === 'f') setBuild(buildKey === 'wall' ? null : 'wall');
  else if (k === 'u' && selected && selected.kind === 'tower') upgrade(selected.id);
  else if ((k === 'delete' || k === 'backspace' || k === 'x') && selected) {
    if (selected.kind === 'tower') {
      const t = state.towers.get(selected.id);
      if (t) sell(t.x, t.z);
    } else sell(selected.i % W, Math.floor(selected.i / W));
  } else if (k === 't' && selected && selected.kind === 'tower') {
    const t = state.towers.get(selected.id);
    if (t) send({ c: 'mode', id: t.id, m: TARGET_MODES[(TARGET_MODES.indexOf(t.mode) + 1) % TARGET_MODES.length] });
  } else if (k === ' ') readyUp();
  else if (k === 'p') send({ c: 'pause', v: !state.info.paused });
  else if (k === 'm') toggleSound();
  else if (k === 'h' || k === '?') ui.openModal('help');
  else if (k === 'enter' && session.online) {
    e.preventDefault();
    $('chat-input').focus();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

function readyUp() {
  if (!state || state.info.ph !== 'build') return;
  const me = state.myPlayer;
  send({ c: 'ready', v: !(me && me.ready) });
  sfx.click();
}

function toggleSound() {
  setMuted(!isMuted());
  $('btn-sound').textContent = isMuted() ? '🔇' : '🔊';
}

// ------------------------------------------------------------- HUD buttons
$('btn-ready').addEventListener('click', readyUp);
$('btn-speed').addEventListener('click', () => state && send({ c: 'speed', v: (state.info.speed % 3) + 1 }));
$('btn-pause').addEventListener('click', () => state && send({ c: 'pause', v: !state.info.paused }));
$('btn-sound').addEventListener('click', toggleSound);
$('btn-quit').addEventListener('click', () => {
  if (!session || confirm('Leave this game and go back to the menu?')) quitToMenu();
});
$('btn-invite').addEventListener('click', async () => {
  const link = `${location.origin}${location.pathname}?room=${session.code}`;
  try {
    await navigator.clipboard.writeText(link);
    ui.toast('Invite link copied!');
  } catch {
    prompt('Share this link with your friends:', link);
  }
});
$('btn-restart').addEventListener('click', () => send({ c: 'restart' }));
$('btn-continue').addEventListener('click', () => {
  send({ c: 'continue' });
  ui.hideEnd();
});
$('btn-end-menu').addEventListener('click', quitToMenu);

// -------------------------------------------------------------------- menu
$('btn-solo').addEventListener('click', startSolo);
$('btn-host').addEventListener('click', () => startOnline({ type: 'create', name: playerName() }));
$('btn-join').addEventListener('click', () => {
  const code = $('code-input').value.trim().toUpperCase();
  if (code.length !== 4) {
    $('mp-note').textContent = 'Enter the 4-letter room code from your friend.';
    $('mp-note').classList.add('warn');
    return;
  }
  let token = null;
  try {
    token = sessionStorage.getItem('fs-token-' + code);
  } catch {}
  startOnline({ type: 'join', code, name: playerName(), token });
});

// ----------------------------------------------------------------- overlay
function drawOverlay(dt) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth, h = window.innerHeight;
  if (overlay.width !== Math.round(w * dpr) || overlay.height !== Math.round(h * dpr)) {
    overlay.width = Math.round(w * dpr);
    overlay.height = Math.round(h * dpr);
  }
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  octx.clearRect(0, 0, w, h);
  if (!state) return;
  const zoom = Math.max(0.6, Math.min(1.7, scene.fitDist / scene.cam.dist));
  let hovered = null, hoveredD = 28;

  for (const em of scene.enemyMeshes.values()) {
    const e = em.data;
    if (!e) continue;
    const f = FRUITS[e.type];
    const p = scene.toScreen(em.mesh.position.x, em.height + 0.25, em.mesh.position.z);
    if (!p.visible) continue;
    const c = scene.toScreen(em.mesh.position.x, em.height * 0.5, em.mesh.position.z);
    const md = Math.hypot(c.x - mouse.x, c.y - mouse.y);
    if (md < hoveredD && mouse.onCanvas) {
      hoveredD = md;
      hovered = { e, f, p };
    }
    const frac = Math.max(0, Math.min(1, e.hp / e.maxHp));
    if (frac >= 0.999 && !f.boss) continue;
    const bw = (18 + f.radius * 46) * zoom, bh = (f.boss ? 6 : 4) * Math.min(zoom, 1.2);
    const x = p.x - bw / 2, y = p.y - bh;
    octx.fillStyle = 'rgba(15, 10, 20, 0.7)';
    octx.fillRect(x - 1, y - 1, bw + 2, bh + 2);
    octx.fillStyle = `hsl(${Math.round(frac * 115)}, 85%, 52%)`;
    octx.fillRect(x, y, bw * frac, bh);
    if (e.armor > 0.05) {
      // Armor (effective skin hardness) as a steel strip under the HP bar.
      const aw = bw * Math.min(1, e.armor / 12);
      octx.fillStyle = 'rgba(15, 10, 20, 0.7)';
      octx.fillRect(x - 1, y + bh + 1, bw + 2, 3);
      octx.fillStyle = e.flags & 4 ? '#ff9f1c' : '#b9c6d6';
      octx.fillRect(x, y + bh + 1.5, aw, 2);
    }
  }

  // Floating gold.
  octx.textAlign = 'center';
  for (let i = floats.length - 1; i >= 0; i--) {
    const fl = floats[i];
    fl.life -= dt;
    if (fl.life <= 0) {
      floats.splice(i, 1);
      continue;
    }
    const p = scene.toScreen(fl.x, fl.y + (1.1 - fl.life) * 0.8, fl.z);
    octx.globalAlpha = Math.min(1, fl.life * 2);
    octx.font = `600 ${Math.round(13 * zoom)}px Fredoka, sans-serif`;
    octx.lineWidth = 3;
    octx.strokeStyle = 'rgba(30, 20, 10, 0.8)';
    octx.strokeText(fl.text, p.x, p.y);
    octx.fillStyle = fl.color;
    octx.fillText(fl.text, p.x, p.y);
  }
  octx.globalAlpha = 1;

  // Other chefs' cursors.
  octx.font = '600 12px Fredoka, sans-serif';
  for (const c of scene.cursors.values()) {
    const p = scene.toScreen(c.position.x, 0.1, c.position.z);
    if (!p.visible) continue;
    octx.lineWidth = 3;
    octx.strokeStyle = 'rgba(0,0,0,0.7)';
    octx.strokeText(c.userData.name, p.x, p.y - 16);
    octx.fillStyle = c.userData.color;
    octx.fillText(c.userData.name, p.x, p.y - 16);
  }

  // Fruit info on hover.
  if (hovered && !mouse.down) {
    const { e, f } = hovered;
    const lines = [
      [f.name, '#ffffff', '600 15px'],
      [`Skin hardness ${f.hardness}/10`, '#ffc93c', '500 12px'],
      [`HP ${Math.ceil(e.hp)} / ${e.maxHp}`, '#7bd389', '500 12px'],
      [`Armor ${e.armor.toFixed(1)}${e.flags & 4 ? ' (peeled!)' : ''}`, e.flags & 4 ? '#ff9f1c' : '#b9c6d6', '500 12px'],
    ];
    if (e.flags & 1) lines.push(['Frozen (slowed)', '#9fe7ff', '500 12px']);
    if (e.flags & 2) lines.push(['Burning', '#ff7a1a', '500 12px']);
    const bx = Math.min(w - 170, mouse.x + 18), by = Math.max(10, mouse.y - 20);
    const bhh = 12 + lines.length * 17;
    octx.fillStyle = 'rgba(28, 24, 34, 0.92)';
    octx.strokeStyle = 'rgba(255,255,255,0.15)';
    octx.lineWidth = 1;
    octx.beginPath();
    octx.roundRect(bx, by, 160, bhh, 10);
    octx.fill();
    octx.stroke();
    octx.textAlign = 'left';
    lines.forEach(([t, col, font], i) => {
      octx.font = `${font} Fredoka, sans-serif`;
      octx.fillStyle = col;
      octx.fillText(t, bx + 10, by + 20 + i * 17);
    });
  }
}

// Debug/automation handle (commands are still validated by the simulation).
window.fruitSiege = {
  scene,
  get state() {
    return state;
  },
  get session() {
    return session;
  },
  send,
  tileToScreen: (x, z) => scene.toScreen(x + 0.5, 0, z + 0.5),
};

// -------------------------------------------------------------------- boot
async function boot() {
  // Web font is optional; load it without blocking the page.
  const font = document.createElement('link');
  font.rel = 'stylesheet';
  font.href = 'https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&display=swap';
  document.head.appendChild(font);
  try {
    $('name-input').value = localStorage.getItem('fs-name') || '';
  } catch {}
  $('btn-sound').textContent = isMuted() ? '🔇' : '🔊';
  const room = new URLSearchParams(location.search).get('room');
  if (room) $('code-input').value = room.toUpperCase().slice(0, 4);

  let thumbs;
  try {
    thumbs = renderThumbnails();
  } catch (err) {
    console.error('thumbnail render failed', err);
    const blank = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    thumbs = { towers: TOWERS.map(() => blank), wall: blank, fruits: FRUITS.map(() => blank) };
  }
  ui.setThumbs(thumbs);

  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    mpAvailable = res.ok && (await res.json()).multiplayer;
  } catch {
    mpAvailable = false;
  }
  setMenuBusy(false);
  const note = $('mp-note');
  if (!mpAvailable) {
    note.textContent = 'Multiplayer needs the game server: run "npm start" and open the address it prints.';
    note.classList.add('warn');
  } else if (room) {
    note.textContent = `Invited to room ${room.toUpperCase()} - enter your name and press Join!`;
  } else {
    note.textContent = 'Host a game, then share the 4-letter code with friends.';
  }
  $('loading').classList.add('hidden');
  requestAnimationFrame(frame);
}

boot();
