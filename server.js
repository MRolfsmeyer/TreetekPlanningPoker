'use strict';
/*
 * Treetek Planning Poker – eigenständiger Server
 *
 * Liefert Startseite und App aus und gleicht jeden Tisch per WebSocket zwischen
 * allen verbundenen Browsern ab. Die Schnittstelle bildet die Datenablage nach,
 * die die App unter claude.ai nutzt (Dokumente, Sammlungen, Live-Updates),
 * deshalb läuft der App-Code unverändert.
 *
 *   /            Startseite: neuen Tisch starten oder mit Code beitreten
 *   /t/<CODE>    ein Tisch (6-stelliger Code)
 *
 * Start:  node server.js                     Port 3000, öffnet den Browser
 *
 * Einstellungen über Umgebungsvariablen:
 *   PORT=8080             anderer Port (auf Servern meist vom Anbieter gesetzt; dann öffnet sich kein Browser)
 *   ACCESS_PASSWORD=...   Zugang nur mit Passwort (Benutzername beliebig)
 *   DATA_FILE=/pfad.json  wo die Tische gespeichert werden
 *   NO_BROWSER=1          keinen Browser öffnen
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
// ws ist zusätzlich unter vendor/ws beigelegt, damit der Start ohne „npm install“ (und ohne Internet) klappt
let WebSocketServer;
try { ({ WebSocketServer } = require('ws')); } catch { ({ WebSocketServer } = require('./vendor/ws')); }

const PORT = Number(process.env.PORT) || 3000;
const OPEN_BROWSER = !process.env.NO_BROWSER && !process.env.PORT;
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || '';
const PUBLIC_DIR = path.join(__dirname, 'public');
// Daten neben der .exe bzw. im Projektordner ablegen, damit ein Neustart die Tische behält
const BASE_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;
const DATA_FILE = process.env.DATA_FILE || path.join(BASE_DIR, 'planning-poker-daten.json');

const MAX_DOC_BYTES = 256 * 1024;
const MAX_DOCS_PER_TABLE = 2000;
const MAX_TABLES = 1000;
const MAX_MODS = 20;
const TABLE_TTL_MS = 30 * 24 * 60 * 60 * 1000;    // Tische ohne Aktivität nach 30 Tagen löschen
const PATH_SEGMENT = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  // ohne leicht verwechselbare Zeichen (0/O, 1/I)
const CODE_RE = /^[A-Z2-9]{6}$/;
const SECRET_RE = /^[A-Za-z0-9]{32,64}$/;

// ---------------------------------------------------------------------------
// Datenablage (im Speicher, regelmäßig in eine JSON-Datei gesichert)
//   meta/<CODE>          { name, keyHash, created, active }   Tisch-Stammdaten (nie an Browser)
//   t/<CODE>/<pfad>      Dokumente der App für diesen Tisch
// ---------------------------------------------------------------------------
const store = new Map();

function loadStore() {
  let text;
  try { text = fs.readFileSync(DATA_FILE, 'utf8'); }
  catch { return; /* erster Start, noch keine Datei */ }
  try {
    const raw = JSON.parse(text);
    for (const [k, v] of Object.entries(raw)) if (k.startsWith('meta/') || k.startsWith('t/')) store.set(k, v);
    console.log(`Gespeicherte Tische geladen (${[...store.keys()].filter(k => k.startsWith('meta/')).length}).`);
  } catch (err) {
    // Kaputte Datei nicht stillschweigend überschreiben, sondern zur Rettung beiseitelegen
    const backup = DATA_FILE.replace(/\.json$/, '') + `.defekt-${Date.now()}.json`;
    try { fs.renameSync(DATA_FILE, backup); } catch { /* egal */ }
    console.warn(`Datendatei war beschädigt (${err.message}). Sie liegt jetzt unter ${backup}. Start mit leerem Stand.`);
  }
}

// Sicher speichern: erst in eine temporäre Datei schreiben, dann umbenennen.
// Bricht der Server mitten im Schreiben ab, bleibt die alte Datei vollständig erhalten.
const TMP_FILE = DATA_FILE + '.tmp';
let saveTimer = null, saving = false, saveAgain = false;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}
function saveNow() {
  if (saving) { saveAgain = true; return; }
  saving = true;
  fs.writeFile(TMP_FILE, JSON.stringify(Object.fromEntries(store)), err => {
    const done = e => {
      if (e) console.warn('Speichern fehlgeschlagen:', e.message);
      saving = false;
      if (saveAgain) { saveAgain = false; saveNow(); }
    };
    if (err) return done(err);
    fs.rename(TMP_FILE, DATA_FILE, done);
  });
}
function saveSync() {
  fs.writeFileSync(TMP_FILE, JSON.stringify(Object.fromEntries(store)));
  fs.renameSync(TMP_FILE, DATA_FILE);
}

const segments = p => String(p).split('/');
const full = (code, p) => `t/${code}/${p}`;
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');

function validPath(p, kind) {
  const s = segments(p);
  if (!s.length || s.length > 16 || !s.every(x => PATH_SEGMENT.test(x) && x !== '.' && x !== '..')) return false;
  return kind === 'doc' ? s.length % 2 === 0 : s.length % 2 === 1;
}

// ---------------------------------------------------------------------------
// Tische
// ---------------------------------------------------------------------------
const tableMeta = code => store.get('meta/' + code);
const tableState = code => store.get(full(code, 'table/state')) || {};
const isModerator = (code, uid) => Array.isArray(tableState(code).mods) && tableState(code).mods.includes(uid);

function newCode() {
  for (;;) {
    const bytes = crypto.randomBytes(6);
    const code = Array.from(bytes, b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    if (!tableMeta(code)) return code;
  }
}

function createTable(name) {
  const tables = [...store.keys()].filter(k => k.startsWith('meta/')).length;
  if (tables >= MAX_TABLES) return null;
  const code = newCode();
  const modKey = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  store.set('meta/' + code, { name: String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60), keyHash: sha256(modKey), created: now, active: now });
  store.set(full(code, 'table/state'), { round: 1, base: 1, revealed: false, story: '', history: [], lastAction: '', mods: [] });
  scheduleSave();
  return { code, modKey };
}

function touch(code) { const m = tableMeta(code); if (m) m.active = Date.now(); }

function deleteTable(code) {
  for (const k of [...store.keys()]) if (k === 'meta/' + code || k.startsWith(`t/${code}/`)) store.delete(k);
}

// ---------------------------------------------------------------------------
// Rechte
//  - data/users/<id>/…  privat, nur die Person selbst liest und schreibt (verdeckte Karte)
//  - players/<id>       alle lesen, nur die Person selbst schreibt ihren Platz
//  - table/state        alle lesen; die Story dürfen alle ändern,
//                       alles andere (Aufdecken, Runden, Verlauf, Moderation) nur Moderierende.
//                       Moderiert niemand, darf sich eine Person selbst zur Moderation machen.
// ---------------------------------------------------------------------------
function canRead(uid, p) {
  const s = segments(p);
  if (s[0] === 'data' && s[1] === 'users') return s[2] === uid;
  return true;
}

// liefert null, wenn erlaubt, sonst den Fehlercode
function writeDenied(client, op, p, data) {
  const s = segments(p);
  if (s[0] === 'data' && s[1] === 'users') return s[2] === client.uid ? null : 'invalid_argument';
  if (s[0] === 'players') return s[1] === client.uid ? null : 'invalid_argument';
  if (p === 'table/state') {
    if (isModerator(client.table, client.uid)) {
      if (op === 'delete') return 'permission_denied';
      if (data && 'mods' in data && (!Array.isArray(data.mods) || data.mods.length > MAX_MODS || !data.mods.every(m => typeof m === 'string'))) return 'invalid_argument';
      return null;
    }
    if (op !== 'update') return 'permission_denied';
    const keys = Object.keys(data || {});
    if (keys.length && keys.every(k => k === 'story')) return null;
    const current = tableState(client.table).mods || [];
    if (!current.length && keys.length === 1 && keys[0] === 'mods' && Array.isArray(data.mods) && data.mods.length === 1 && data.mods[0] === client.uid) return null;
    return 'permission_denied';
  }
  return 'permission_denied';   // andere Pfade nutzt die App nicht
}

function docSnapshot(client, p) {
  const key = full(client.table, p);
  const visible = canRead(client.uid, p) && store.has(key);
  return { id: segments(p).pop(), exists: visible, data: visible ? store.get(key) : undefined };
}
function colSnapshot(client, p) {
  const prefix = full(client.table, p) + '/';
  const depth = segments(p).length + 1;
  const docs = [];
  for (const [k, v] of store) {
    if (!k.startsWith(prefix)) continue;
    const rel = k.slice(`t/${client.table}/`.length);
    if (segments(rel).length === depth && canRead(client.uid, rel)) docs.push({ id: segments(rel).pop(), data: v });
  }
  docs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { docs };
}

// ---------------------------------------------------------------------------
// Zugangsschutz (nur wenn ACCESS_PASSWORD gesetzt ist)
// Der Browser fragt einmal nach dem Passwort; danach merkt sich ein Cookie den Zugang,
// damit auch der Datenabgleich (WebSocket) zuverlässig freigegeben ist.
// ---------------------------------------------------------------------------
const AUTH_TOKEN = ACCESS_PASSWORD ? sha256('treetek-pp:' + ACCESS_PASSWORD) : '';

function sameSecret(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function cookieToken(req) {
  const c = String(req.headers.cookie || '').split(/;\s*/).find(v => v.startsWith('pp_auth='));
  return c ? c.slice(8) : '';
}
function passwordFromHeader(req) {
  const hdr = String(req.headers.authorization || '');
  if (!hdr.startsWith('Basic ')) return null;
  const decoded = Buffer.from(hdr.slice(6), 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  return i < 0 ? null : decoded.slice(i + 1);
}
function authorized(req) {
  if (!ACCESS_PASSWORD) return true;
  if (sameSecret(cookieToken(req), AUTH_TOKEN)) return true;
  const pw = passwordFromHeader(req);
  return pw !== null && sameSecret(pw, ACCESS_PASSWORD);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };

function sendJson(res, status, obj, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
}

function sendFile(res, rel, headers = {}) {
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Nicht gefunden'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(data);
  });
}

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('zu groß')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); return res.end(); }
  if (pathname === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (!authorized(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Treetek Planning Poker", charset="UTF-8"', 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Bitte mit dem Passwort anmelden.');
  }
  const extra = {};
  if (ACCESS_PASSWORD && !sameSecret(cookieToken(req), AUTH_TOKEN)) {
    const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
    extra['Set-Cookie'] = `pp_auth=${AUTH_TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`;
  }

  // Netzwerkadressen für den QR-Code, wenn lokal (localhost) geöffnet
  if (pathname === '/info') return sendJson(res, 200, { lan: lanAddresses(), port: PORT }, extra);

  // Neuen Tisch anlegen
  if (pathname === '/api/tables' && req.method === 'POST') {
    let name = '';
    try { name = (JSON.parse((await readBody(req)) || '{}').name) || ''; } catch { return sendJson(res, 400, { error: 'Ungültige Anfrage' }); }
    const t = createTable(name);
    if (!t) return sendJson(res, 503, { error: 'Es gibt gerade zu viele Tische. Bitte später erneut versuchen.' });
    return sendJson(res, 201, { code: t.code, modKey: t.modKey, url: `/t/${t.code}?mod=${t.modKey}` }, extra);
  }

  // Name eines Tisches (für Kopfzeile und Startseite)
  const apiMatch = pathname.match(/^\/api\/tables\/([A-Za-z0-9]{6})$/);
  if (apiMatch) {
    const code = apiMatch[1].toUpperCase();
    const meta = tableMeta(code);
    return meta ? sendJson(res, 200, { code, name: meta.name }, extra) : sendJson(res, 404, { error: 'Tisch nicht gefunden' }, extra);
  }

  // Ein Tisch
  const tableMatch = pathname.match(/^\/t\/([A-Za-z0-9]{6})\/?$/);
  if (tableMatch) {
    const code = tableMatch[1].toUpperCase();
    if (!tableMeta(code)) { res.writeHead(302, { Location: `/?fehlt=${code}`, ...extra }); return res.end(); }
    return sendFile(res, '/index.html', extra);
  }

  if (pathname === '/' || pathname === '/index.html') return sendFile(res, '/landing.html', extra);
  if (pathname === '/landing.html') { res.writeHead(302, { Location: '/' }); return res.end(); }
  return sendFile(res, pathname, extra);
});

// ---------------------------------------------------------------------------
// WebSocket: Lesen, Schreiben, Live-Abos – immer im Rahmen eines Tisches
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server, path: '/sync', maxPayload: MAX_DOC_BYTES * 2, verifyClient: info => authorized(info.req) });
const clients = new Set();   // { ws, uid, table, subs: Map<subId, {kind, path}> }

function send(ws, msg) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); }

function pushSub(client, subId, sub) {
  const snap = sub.kind === 'doc' ? docSnapshot(client, sub.path) : colSnapshot(client, sub.path);
  send(client.ws, { sub: subId, kind: sub.kind, snap });
}

// Nach jeder Änderung die betroffenen Abos am selben Tisch benachrichtigen
function notify(code, p) {
  const parent = segments(p).slice(0, -1).join('/');
  for (const c of clients) {
    if (c.table !== code) continue;
    for (const [subId, sub] of c.subs) {
      if ((sub.kind === 'doc' && sub.path === p) || (sub.kind === 'col' && sub.path === parent)) pushSub(c, subId, sub);
    }
  }
}

const isPlainObject = v => v && typeof v === 'object' && !Array.isArray(v);
const tableDocCount = code => { let n = 0; for (const k of store.keys()) if (k.startsWith(`t/${code}/`)) n++; return n; };

function handle(client, msg) {
  const { op, path: p } = msg;
  const fail = code => ({ error: { code, message: code } });

  if (op === 'unsub') { client.subs.delete(msg.subId); return { ok: true }; }
  if (op === 'sub') {
    const kind = msg.kind === 'col' ? 'col' : 'doc';
    if (!validPath(p, kind)) return fail('invalid_argument');
    const sub = { kind, path: p };
    client.subs.set(msg.subId, sub);
    pushSub(client, msg.subId, sub);
    return { ok: true };
  }

  if (!validPath(p, 'doc')) return fail('invalid_argument');
  if (op === 'get') return { result: docSnapshot(client, p) };
  if (!['set', 'update', 'delete'].includes(op)) return fail('invalid_argument');
  if (op !== 'delete' && (!isPlainObject(msg.data) || JSON.stringify(msg.data).length > MAX_DOC_BYTES)) return fail('invalid_argument');

  const denied = writeDenied(client, op, p, msg.data);
  if (denied) return fail(denied);

  const key = full(client.table, p);
  if (op === 'delete') {
    if (store.delete(key)) { touch(client.table); scheduleSave(); notify(client.table, p); }
    return { ok: true };
  }
  if (op === 'set') {
    if (!store.has(key) && tableDocCount(client.table) >= MAX_DOCS_PER_TABLE) return fail('quota_exceeded');
    store.set(key, msg.data);
  } else {
    if (!store.has(key)) return fail('invalid_argument');   // wie im Original: update verlangt ein bestehendes Dokument
    store.set(key, { ...store.get(key), ...msg.data });
  }
  touch(client.table);
  scheduleSave();
  notify(client.table, p);
  return { ok: true };
}

// Mit gültigem Moderationsschlüssel wird diese Person (dieser Browser-Tab) Moderation
function grantModeration(client, modKey) {
  const meta = tableMeta(client.table);
  if (!meta || typeof modKey !== 'string' || !sameSecret(sha256(modKey), meta.keyHash)) return false;
  const key = full(client.table, 'table/state');
  const state = store.get(key) || {};
  const mods = Array.isArray(state.mods) ? state.mods : [];
  if (!mods.includes(client.uid)) {
    store.set(key, { ...state, mods: [...mods, client.uid].slice(-MAX_MODS) });
    scheduleSave();
    notify(client.table, 'table/state');
  }
  return true;
}

wss.on('connection', ws => {
  const client = { ws, uid: null, table: null, subs: new Map() };
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.op === 'hello') {
      if (client.uid) return send(ws, { id: msg.id, error: { code: 'invalid_argument', message: 'schon angemeldet' } });
      const code = String(msg.table || '').toUpperCase();
      if (!CODE_RE.test(code) || !tableMeta(code)) return send(ws, { id: msg.id, error: { code: 'not_found', message: 'Tisch nicht gefunden' } });
      // Die Kennung leitet der Server aus dem geheimen Schlüssel des Browser-Tabs ab.
      // Die Kennung selbst sehen alle am Tisch, den Schlüssel nur der Tab. Wer nur die
      // Kennung kennt, kann sich damit also nicht als diese Person anmelden.
      client.uid = typeof msg.secret === 'string' && SECRET_RE.test(msg.secret)
        ? 'u_' + sha256('treetek-pp-uid:' + msg.secret).slice(0, 32)
        : 'u_' + crypto.randomBytes(16).toString('hex');
      client.table = code;
      clients.add(client);
      const moderator = msg.modKey ? grantModeration(client, msg.modKey) : false;
      send(ws, { id: msg.id, result: { uid: client.uid, table: code, moderator } });
      return broadcastPresence(code);
    }
    if (!client.uid) return send(ws, { id: msg.id, error: { code: 'not_granted', message: 'not_granted' } });
    send(ws, { id: msg.id, ...handle(client, msg) });
  });
  ws.on('close', () => { clients.delete(client); if (client.table) broadcastPresence(client.table); });
});

// Wer gerade da ist: Wer das Fenster schließt, verschwindet vom Tisch (außer mit gelegter Karte)
function broadcastPresence(code) {
  const here = [...clients].filter(c => c.table === code);
  const presence = [...new Set(here.map(c => c.uid))];
  for (const c of here) send(c.ws, { presence });
}

// Verbindungen ohne Antwort aufräumen
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000).unref();

// Verlassene Tische nach 30 Tagen ohne Aktivität entfernen
setInterval(() => {
  const now = Date.now();
  let removed = 0;
  for (const k of [...store.keys()]) {
    if (!k.startsWith('meta/')) continue;
    const code = k.slice(5);
    if (now - (store.get(k).active || 0) > TABLE_TTL_MS && ![...clients].some(c => c.table === code)) { deleteTable(code); removed++; }
  }
  if (removed) scheduleSave();
}, 6 * 60 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
// Typische Heim- und Firmennetze zuerst (192.168.x, 10.x, 172.16–31.x), virtuelle Adapter danach
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  const rank = ip => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  return out.sort((x, y) => rank(x) - rank(y));
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => { /* kein Browser verfügbar: Link steht im Fenster */ });
}

loadStore();
server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} ist schon belegt. Läuft der Server vielleicht schon? Sonst mit anderem Port starten (PORT=3001).`);
  } else console.error(err);
  setTimeout(() => process.exit(1), 8000);
});
server.listen(PORT, () => {
  const local = `http://localhost:${PORT}`;
  console.log('\n  Treetek Planning Poker läuft.' + (ACCESS_PASSWORD ? ' Zugang mit Passwort.' : '') + '\n');
  console.log(`  Auf diesem Rechner:   ${local}`);
  for (const ip of lanAddresses()) console.log(`  Im selben Netzwerk:   http://${ip}:${PORT}`);
  console.log('\n  Auf der Startseite einen Tisch starten und den Link oder QR-Code teilen.');
  console.log('  Zum Beenden dieses Fenster schließen oder Strg+C drücken.\n');
  if (OPEN_BROWSER) openBrowser(local);
});

function shutdown() {
  clearTimeout(saveTimer);
  try { saveSync(); } catch (err) { console.warn('Speichern beim Beenden fehlgeschlagen:', err.message); }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
