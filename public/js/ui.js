// DOM user interface: HUD, build bar, selection panel, almanac, chat, toasts.
import { MAP, TOWERS, FRUITS, WALL_COST, SELL_RATIO, TARGET_MODES, FINAL_WAVE } from './data.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`);

export function statRows(def, s) {
  const rows = [];
  switch (def.kind) {
    case 'frost':
      rows.push(['Slow', `${Math.round(s.slow * 100)}% for ${s.slowTime}s`], ['Damage', s.damage], ['Pulse', `${s.rate}/s`]);
      break;
    case 'flame':
      rows.push(['Burn', `${s.burn}/s for ${s.burnTime}s`], ['Flame hit', `${s.damage} x ${s.rate}/s`]);
      break;
    case 'laser':
      rows.push(['Beam', `${s.damage}/s`], ['Heats up to', `x${s.ramp} in ${s.rampTime}s`]);
      break;
    case 'blender':
      rows.push(['Damage', `${s.damage} to all nearby`], ['Speed', `${s.rate} hits/s`]);
      break;
    default:
      rows.push(['Damage', s.damage], ['Fire rate', `${s.rate}/s`]);
  }
  rows.push(['Range', s.range]);
  if (s.splash) rows.push(['Splash', s.splash]);
  if (s.minRange) rows.push(['Min range', s.minRange]);
  if (s.peel) rows.push(['Peels armor', `-${s.peel} per hit`]);
  if (s.targets > 1) rows.push(['Targets', s.targets]);
  if (s.chains) rows.push(['Chains', `${s.chains} fruit`]);
  if (def.kind === 'sniper') rows.push(['Armor', 'Ignored']);
  if (def.kind === 'laser') rows.push(['Armor', 'Half ignored']);
  if (def.kind === 'flame') rows.push(['Burn vs armor', 'Ignored']);
  return rows;
}

const statGrid = (rows) => `<div class="statgrid">${rows.map(([k, v]) => `<span>${esc(k)}</span><span>${v}</span>`).join('')}</div>`;

export class UI {
  constructor(handlers) {
    this.h = handlers;
    this.thumbs = null;
    this.selSig = '';
    this.chatTimers = [];
    this.lastLives = null;
    document.addEventListener('click', (e) => {
      const open = e.target.closest('[data-open]');
      if (open) this.openModal(open.dataset.open);
      const close = e.target.closest('[data-close]');
      if (close) close.closest('.modal').classList.add('hidden');
    });
    document.querySelectorAll('.modal').forEach((m) => m.addEventListener('mousedown', (e) => {
      if (e.target === m && m.id !== 'modal-end') m.classList.add('hidden');
    }));
  }

  openModal(name) {
    $(`modal-${name}`).classList.remove('hidden');
  }

  closeModals() {
    document.querySelectorAll('.modal').forEach((m) => m.classList.add('hidden'));
  }

  anyModalOpen() {
    return [...document.querySelectorAll('.modal')].some((m) => !m.classList.contains('hidden'));
  }

  setThumbs(thumbs) {
    this.thumbs = thumbs;
    this.buildBar();
    this.buildAlmanac();
  }

  // ------------------------------------------------------------ build bar
  buildBar() {
    const bar = $('buildbar');
    bar.innerHTML = '';
    const items = [{ key: 'wall', name: 'Wall', hotkey: 'F', cost: WALL_COST, img: this.thumbs.wall }];
    TOWERS.forEach((t, i) => items.push({ key: t.key, name: t.name, hotkey: t.hotkey, cost: t.levels[0].cost, img: this.thumbs.towers[i], def: t }));
    for (const it of items) {
      const b = document.createElement('button');
      b.className = 'build-btn';
      b.dataset.key = it.key;
      b.dataset.cost = it.cost;
      b.innerHTML = `<span class="key">${it.hotkey}</span><img src="${it.img}" alt=""><span class="bname">${esc(it.name)}</span><span class="bcost">🪙${it.cost}</span>`;
      b.addEventListener('click', () => this.h.onPickBuild(it.key));
      b.addEventListener('mouseenter', () => this.showBuildTip(it, b));
      b.addEventListener('mouseleave', () => this.hideTip());
      bar.appendChild(b);
    }
  }

  showBuildTip(it, el) {
    const tip = $('tooltip');
    if (it.key === 'wall') {
      tip.innerHTML = `<h4>Wall</h4><p>A cheap crate that blocks the fruit. Use walls to build your own lanes and make the path long and twisty. Drag to paint many. Drop a tower on a wall to upgrade it (you get the wall's gold back).</p>${statGrid([['Cost', `🪙${WALL_COST}`], ['Sell', `🪙${WALL_COST} (full refund)`]])}`;
    } else {
      const s = it.def.levels[0];
      tip.innerHTML = `<h4>${esc(it.def.name)}</h4><p>${esc(it.def.desc)}</p>${statGrid([['Cost', `🪙${s.cost}`], ...statRows(it.def, s)])}`;
    }
    tip.classList.remove('hidden');
    const r = el.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = `${Math.max(8, Math.min(window.innerWidth - tw - 8, r.left + r.width / 2 - tw / 2))}px`;
    tip.style.top = `${r.top - th - 10}px`;
  }

  hideTip() {
    $('tooltip').classList.add('hidden');
  }

  setActiveBuild(key) {
    document.querySelectorAll('.build-btn').forEach((b) => b.classList.toggle('active', b.dataset.key === key));
  }

  // ------------------------------------------------------------------ HUD
  update(state, ctx) {
    const info = state.info;
    const me = state.myPlayer;
    const gold = me ? me.gold : 0;
    $('hud-lives').textContent = info.lives;
    if (this.lastLives !== null && info.lives < this.lastLives) {
      const el = $('hud-lives').parentElement;
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
    }
    this.lastLives = info.lives;
    $('hud-gold').textContent = gold;
    $('hud-wave').textContent = info.wave;
    $('hud-wave-of').textContent = info.endless ? ' endless' : `/${FINAL_WAVE}`;
    $('hud-path').textContent = ctx.pathText;

    let phase;
    const conn = [...state.players.values()].filter((p) => p.connected);
    const readyCount = conn.filter((p) => p.ready).length;
    if (info.ph === 'wave') phase = `Wave ${info.wave}: <b>${info.left}</b> fruit left`;
    else if (info.ph === 'build') phase = info.cd >= 0 ? `Next wave in <b>${info.cd}s</b>` : info.wave === 0 ? 'Build your maze!' : 'Build phase';
    else if (info.ph === 'lost') phase = 'The fruit escaped!';
    else phase = 'Victory!';
    $('hud-phase').innerHTML = phase;

    const rb = $('btn-ready');
    if (info.ph === 'build') {
      rb.disabled = false;
      if (ctx.online && conn.length > 1) {
        rb.textContent = me && me.ready ? `Ready ✓ (${readyCount}/${conn.length})` : `Ready? (${readyCount}/${conn.length})`;
        rb.classList.toggle('is-ready', !!(me && me.ready));
      } else {
        rb.textContent = info.wave === 0 ? 'Start Wave ▶' : 'Next Wave ▶';
        rb.classList.remove('is-ready');
      }
    } else {
      rb.disabled = true;
      rb.classList.remove('is-ready');
      rb.textContent = info.ph === 'wave' ? 'Wave in progress' : '—';
    }

    $('btn-speed').textContent = `${info.speed}x`;
    $('btn-pause').textContent = info.paused ? '▶' : '❚❚';
    const pb = $('pause-banner');
    pb.classList.toggle('hidden', !info.paused);
    if (info.paused) pb.innerHTML = `PAUSED${info.pb && ctx.online ? `<small>by ${esc(info.pb)}</small>` : ''}`;

    document.querySelectorAll('.build-btn').forEach((b) => b.classList.toggle('poor', gold < Number(b.dataset.cost)));

    // Players.
    const rows = [...state.players.values()].map((p) => {
      const status = !p.connected ? '💤' : info.ph === 'build' ? (p.ready ? '✅' : '⏳') : '';
      return `<div class="player-row ${p.id === state.me ? 'me' : ''} ${p.connected ? '' : 'offline'}">
        <span class="dot" style="background:${p.color}"></span>
        <span class="pname" title="${p.id === state.me ? 'You' : ''}">${esc(p.name)}</span>
        <span class="pgold">🪙${fmt(p.gold)}</span><span class="pkills">🍹${p.kills}</span>
        ${ctx.online ? `<span class="pready">${status}</span>` : ''}</div>`;
    }).join('');
    if (rows !== this.lastPlayersHtml) {
      $('players').innerHTML = rows;
      this.lastPlayersHtml = rows;
    }

    // Wave preview.
    const list = info.ph === 'wave' ? state.nextWave : state.nextWave;
    const title = info.ph === 'wave' ? `Next (wave ${info.wave + 1}):` : `Wave ${info.wave + 1}:`;
    const chips = list.map(([t, c]) => `<span class="chip"><i style="background:${FRUITS[t].color}"></i>${c}× ${esc(FRUITS[t].name)} <small>(hardness ${FRUITS[t].hardness})</small></span>`).join('');
    const wp = `<span>${title}</span>${chips}`;
    if (wp !== this.lastWaveHtml) {
      $('wave-preview').innerHTML = wp;
      this.lastWaveHtml = wp;
    }
    $('wave-preview').classList.toggle('hidden', !(info.ph === 'build' || info.ph === 'wave') || (!info.endless && info.wave >= FINAL_WAVE));

    this.updateSelection(state, ctx.selected, gold);
  }

  // ------------------------------------------------------------ selection
  updateSelection(state, sel, gold) {
    const panel = $('selection');
    if (!sel) {
      panel.classList.add('hidden');
      this.selSig = '';
      return;
    }
    if (sel.kind === 'tower') {
      const t = state.towers.get(sel.id);
      if (!t) {
        panel.classList.add('hidden');
        return;
      }
      const def = TOWERS[t.type];
      const owner = state.players.get(t.owner);
      const mine = t.owner === state.me;
      const s = def.levels[t.level - 1];
      const next = t.level < 3 ? def.levels[t.level] : null;
      const sig = JSON.stringify([t.id, t.level, t.mode, t.kills, t.dmg, mine, next && gold >= next.cost, owner && owner.name]);
      panel.classList.remove('hidden');
      if (sig === this.selSig) return;
      this.selSig = sig;
      const rows = statRows(def, s);
      const nextRows = next ? statRows(def, next) : null;
      const merged = rows.map(([k, v], i) => [k, nextRows && nextRows[i] && String(nextRows[i][1]) !== String(v) ? `${v} <span class="up">→ ${nextRows[i][1]}</span>` : v]);
      panel.innerHTML = `
        <h3><img src="${this.thumbs.towers[t.type]}" width="36" height="36" alt="">${esc(def.name)} <span class="lvl">Lv ${t.level}</span></h3>
        <div class="owner"><i style="background:${owner ? owner.color : '#999'}"></i>${owner ? esc(owner.name) : 'Unknown'}${mine ? ' (you)' : ''}</div>
        <p class="desc">${esc(def.desc)}</p>
        ${statGrid([...merged, ['Fruit squashed', t.kills], ['Damage dealt', fmt(t.dmg)]])}
        ${def.kind === 'frost' || def.kind === 'blender' ? '' : `<div class="modes">${TARGET_MODES.map((m) => `<button class="btn ${t.mode === m ? 'primary' : ''}" data-mode="${m}" ${mine ? '' : 'disabled'}>${m}</button>`).join('')}</div>`}
        ${mine ? `<div class="actions">
          ${next ? `<button class="btn good" data-act="upgrade" ${gold >= next.cost ? '' : 'disabled'}>Upgrade 🪙${next.cost}</button>` : '<button class="btn" disabled>Max level</button>'}
          <button class="btn danger" data-act="sell">Sell 🪙${Math.floor(t.invested * SELL_RATIO)}</button>
        </div>` : ''}`;
      panel.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => this.h.onMode(t.id, b.dataset.mode)));
      const up = panel.querySelector('[data-act="upgrade"]');
      if (up) up.addEventListener('click', () => this.h.onUpgrade(t.id));
      const sell = panel.querySelector('[data-act="sell"]');
      if (sell) sell.addEventListener('click', () => this.h.onSell(t.x, t.z));
    } else if (sel.kind === 'wall') {
      const ownerId = state.walls.get(sel.i);
      if (ownerId === undefined) {
        panel.classList.add('hidden');
        return;
      }
      const owner = state.players.get(ownerId);
      const mine = ownerId === state.me;
      const sig = JSON.stringify(['wall', sel.i, mine, owner && owner.name]);
      panel.classList.remove('hidden');
      if (sig === this.selSig) return;
      this.selSig = sig;
      panel.innerHTML = `
        <h3><img src="${this.thumbs.wall}" width="36" height="36" alt="">Wall</h3>
        <div class="owner"><i style="background:${owner ? owner.color : '#999'}"></i>${owner ? esc(owner.name) : 'Unknown'}${mine ? ' (you)' : ''}</div>
        <p class="desc">Tip: pick a tower and click this wall to turn it into a tower without changing the maze.</p>
        ${mine ? `<div class="actions"><button class="btn danger" data-act="sell">Remove 🪙${WALL_COST}</button></div>` : ''}`;
      const sell = panel.querySelector('[data-act="sell"]');
      if (sell) sell.addEventListener('click', () => this.h.onSell(sel.i % MAP.W, Math.floor(sel.i / MAP.W)));
    }
  }

  // -------------------------------------------------------------- almanac
  buildAlmanac() {
    const list = FRUITS.map((f, i) => ({ f, i })).sort((a, b) => (!!a.f.hidden - !!b.f.hidden) || a.f.hardness - b.f.hardness || a.f.hp - b.f.hp);
    $('almanac-list').innerHTML = list.map(({ f, i }) => {
      let special = '';
      if (f.special === 'regen') special = '(1.5% HP per second)';
      else if (f.special === 'split') special = `(${f.splitCount} ${FRUITS.find((x) => x.key === f.splitInto).name}s)`;
      const tag = f.key === 'seed' ? 'from Pomegranates' : f.key === 'slice' ? 'from Watermelons' : f.key === 'kingcoconut' ? 'final boss' : f.boss ? 'boss' : '';
      return `<div class="fruit-card">
        <img src="${this.thumbs.fruits[i]}" alt="">
        <div style="flex:1">
          <h4>${esc(f.name)} <small>${tag}</small></h4>
          <div class="hardbar" title="Skin hardness ${f.hardness}/10"><i style="width:${f.hardness * 10}%"></i></div>
          <p>Skin hardness <b>${f.hardness}</b>/10 · ${esc(f.skin)} ${special}</p>
          <div class="statgrid"><span>HP</span><span>${f.hp}</span><span>Armor</span><span>${f.armor}</span>
          <span>Speed</span><span>${f.speed}</span><span>Bounty</span><span>🪙${f.bounty}</span>
          <span>Lives</span><span>${f.lives}</span></div>
        </div></div>`;
    }).join('');
  }

  // -------------------------------------------------------- toasts & chat
  toast(msg, kind = '', ms = 2200) {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = msg;
    const box = $('toasts');
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 500);
  }

  chat(name, color, text) {
    const log = $('chat-log');
    const el = document.createElement('div');
    el.innerHTML = name ? `<b style="color:${color}">${esc(name)}:</b> ${esc(text)}` : `<i style="color:${color || '#b7aec2'}">${esc(text)}</i>`;
    log.appendChild(el);
    while (log.children.length > 12) log.firstChild.remove();
    setTimeout(() => el.classList.add('old'), 12000);
  }

  showChat(show) {
    $('chat').classList.toggle('hidden', !show);
    $('chat-log').innerHTML = '';
  }

  showRoom(code) {
    $('room-box').classList.toggle('hidden', !code);
    $('room-code').textContent = code || '';
  }

  // ------------------------------------------------------------ end screen
  showEnd(state, won, online) {
    $('end-title').textContent = won ? '🏆 Victory!' : '🍉 The fruit escaped!';
    $('end-text').textContent = won
      ? `You held the kitchen through all ${FINAL_WAVE} waves. The King Coconut has been cracked!`
      : `You survived until wave ${state.info.wave}. Build a longer maze and mix in Peelers and Skewers for the hard-skinned fruit!`;
    const players = [...state.players.values()].sort((a, b) => b.damage - a.damage);
    $('end-stats').innerHTML = `<table><tr><th>Chef</th><th>Fruit squashed</th><th>Damage</th></tr>${players.map((p) => `<tr><td><span style="color:${p.color}">●</span> ${esc(p.name)}</td><td>${p.kills}</td><td>${fmt(p.damage)}</td></tr>`).join('')}</table>`;
    $('btn-continue').classList.toggle('hidden', !won);
    $('modal-end').classList.remove('hidden');
  }

  hideEnd() {
    $('modal-end').classList.add('hidden');
  }
}
