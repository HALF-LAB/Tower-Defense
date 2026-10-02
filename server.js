// Fruit Siege server: serves the game files and hosts real-time multiplayer
// rooms over WebSockets. Each room runs the authoritative simulation and streams
// snapshots to everyone in it.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Game } from './public/js/sim.js';
import { TICK_RATE } from './public/js/data.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const THREE_DIR = path.join(ROOT, 'node_modules', 'three', 'build');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const SNAPSHOT_EVERY = 2; // ticks -> 15 snapshots per second
const EMPTY_ROOM_TTL = 10 * 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, multiplayer: true, rooms: rooms.size }));
    return;
  }
  let base = PUBLIC_DIR;
  let rel = pathname;
  if (pathname.startsWith('/vendor/three/')) {
    base = THREE_DIR;
    rel = pathname.slice('/vendor/three/'.length);
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(base, '.' + path.posix.normalize('/' + rel));
  if (!file.startsWith(base + path.sep)) {
    res.writeHead(403);
    res.end();
    return;
  }
  sendFile(res, file);
});

// ------------------------------------------------------------------- rooms
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function newCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
}

class Room {
  constructor(code) {
    this.code = code;
    this.game = new Game();
    this.clients = new Set();
    this.tokens = new Map(); // reconnect token -> player id
    this.cursors = new Map();
    this.cursorsDirty = false;
    this.ticks = 0;
    this.lastStatic = -1;
    this.emptySince = Date.now();
    this.timer = setInterval(() => this.tick(), 1000 / TICK_RATE);
  }

  tick() {
    const game = this.game;
    if (!game.connectedPlayers().length) {
      if (!game.paused) {
        game.paused = true;
        game.pausedBy = 'empty room';
      }
      if (Date.now() - this.emptySince > EMPTY_ROOM_TTL) this.close();
      return;
    }
    game.tick();
    this.ticks++;
    if (this.ticks % SNAPSHOT_EVERY === 0) this.broadcastSnapshot();
    if (this.ticks % 3 === 0 && this.cursorsDirty) {
      this.cursorsDirty = false;
      this.broadcast({ type: 'cursors', c: [...this.cursors].map(([id, [x, z]]) => [id, x, z]) });
    }
  }

  snapshotMessage(forceFull) {
    const full = forceFull || this.game.staticVersion !== this.lastStatic || this.ticks % (TICK_RATE * 2) === 0;
    if (!forceFull) this.lastStatic = this.game.staticVersion;
    const snap = this.game.snapshot(full);
    snap.type = 'snap';
    snap.t = Date.now();
    snap.ev = forceFull ? [] : this.game.drainEvents();
    return JSON.stringify(snap);
  }

  broadcastSnapshot() {
    const msg = this.snapshotMessage(false);
    for (const ws of this.clients) if (ws.readyState === 1) ws.send(msg);
  }

  broadcast(obj) {
    const msg = JSON.stringify(obj);
    for (const ws of this.clients) if (ws.readyState === 1) ws.send(msg);
  }

  join(ws, name, token) {
    let player = null;
    const reclaimId = token && this.tokens.get(token);
    if (reclaimId) {
      player = this.game.players.get(reclaimId);
      const inUse = [...this.clients].some((c) => c.playerId === reclaimId);
      if (player && !inUse) this.game.setConnected(player.id, true);
      else player = null;
    }
    if (!player) {
      player = this.game.addPlayer(name);
      if (!player) return send(ws, { type: 'error', msg: 'That room is full', fatal: true });
      token = crypto.randomBytes(12).toString('hex');
      this.tokens.set(token, player.id);
    }
    ws.room = this;
    ws.playerId = player.id;
    this.clients.add(ws);
    this.emptySince = 0;
    if (this.game.pausedBy === 'empty room') {
      this.game.paused = false;
      this.game.pausedBy = '';
    }
    send(ws, { type: 'welcome', code: this.code, playerId: player.id, token });
    ws.send(this.snapshotMessage(true));
  }

  leave(ws) {
    this.clients.delete(ws);
    this.cursors.delete(ws.playerId);
    this.cursorsDirty = true;
    const p = this.game.players.get(ws.playerId);
    if (p) this.game.setConnected(p.id, false);
    if (!this.clients.size) this.emptySince = Date.now();
  }

  close() {
    clearInterval(this.timer);
    rooms.delete(this.code);
    console.log(`room ${this.code} closed`);
  }
}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

const cleanName = (n) => String(n || '').replace(/[^\p{L}\p{N} _\-.!?']/gu, '').trim().slice(0, 16) || 'Chef';

// --------------------------------------------------------------- websocket
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024, perMessageDeflate: { threshold: 512 } });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.room = null;
  ws.playerId = 0;
  ws.budget = { t: Date.now(), n: 0 };
  ws.on('pong', () => (ws.isAlive = true));
  ws.on('close', () => ws.room && ws.room.leave(ws));
  ws.on('message', (data) => {
    // Simple flood protection: at most 80 messages per second per socket.
    const now = Date.now();
    if (now - ws.budget.t > 1000) ws.budget = { t: now, n: 0 };
    if (++ws.budget.n > 80) return;
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    handle(ws, msg);
  });
});

function handle(ws, msg) {
  const room = ws.room;
  switch (msg.type) {
    case 'create': {
      if (room) return;
      const r = new Room(newCode());
      rooms.set(r.code, r);
      console.log(`room ${r.code} created`);
      r.join(ws, cleanName(msg.name));
      break;
    }
    case 'join': {
      if (room) return;
      const r = rooms.get(String(msg.code || '').toUpperCase().trim());
      if (!r) return send(ws, { type: 'error', msg: 'No room with that code', fatal: true });
      r.join(ws, cleanName(msg.name), typeof msg.token === 'string' ? msg.token : null);
      break;
    }
    case 'cmd': {
      if (!room) return;
      const res = room.game.command(ws.playerId, msg.cmd);
      if (!res.ok) send(ws, { type: 'error', msg: res.reason });
      break;
    }
    case 'chat': {
      if (!room) return;
      const p = room.game.players.get(ws.playerId);
      const text = String(msg.text || '').slice(0, 200).trim();
      if (p && text) room.broadcast({ type: 'chat', name: p.name, color: p.color, text });
      break;
    }
    case 'cursor': {
      if (!room) return;
      const x = Number(msg.x), z = Number(msg.z);
      if (Number.isFinite(x) && Number.isFinite(z)) {
        room.cursors.set(ws.playerId, [Math.round(x * 100) / 100, Math.round(z * 100) / 100]);
        room.cursorsDirty = true;
      }
      break;
    }
    case 'ping':
      send(ws, { type: 'pong', t: msg.t });
      break;
  }
}

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

server.listen(PORT, HOST, () => {
  console.log(`\n  Fruit Siege is running!\n`);
  console.log(`  Play on this computer:   http://localhost:${PORT}`);
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets || []) {
      if (n.family === 'IPv4' && !n.internal) console.log(`  Friends on your network: http://${n.address}:${PORT}`);
    }
  }
  console.log('');
});
