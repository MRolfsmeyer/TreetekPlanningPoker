/*
 * Verbindet die App mit dem eigenen Server statt mit claude.ai.
 * Stellt dieselbe Schnittstelle bereit, die die App unter claude.ai nutzt:
 *   claude.use('db')   Dokumente, Sammlungen, Live-Updates
 *   claude.use('user') eigene Kennung
 *   claude.use('room') wer gerade da ist
 * Jeder Browser-Tab ist eine eigene Person (Kennung im sessionStorage).
 */
(() => {
  'use strict';

  // ---- Kennung pro Tab ----------------------------------------------------
  const UID_KEY = 'pp.uid';
  function newUid() {
    const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const buf = new Uint8Array(22);
    crypto.getRandomValues(buf);
    return 'u_' + Array.from(buf, b => abc[b % abc.length]).join('');
  }
  let uid = null;
  try { uid = sessionStorage.getItem(UID_KEY); } catch { /* egal */ }
  if (!uid) { uid = newUid(); try { sessionStorage.setItem(UID_KEY, uid); } catch { /* egal */ } }

  // ---- Tisch aus der Adresse (/t/ABC123) und Moderationsschlüssel ------------
  const tableMatch = location.pathname.match(/^\/t\/([A-Za-z0-9]{6})/);
  const TABLE = tableMatch ? tableMatch[1].toUpperCase() : null;
  const MOD_KEY = 'pp.mod.' + TABLE;
  let modKey = null;
  try { modKey = localStorage.getItem(MOD_KEY); } catch { /* egal */ }
  const params = new URLSearchParams(location.search);
  if (params.get('mod')) {
    // Moderationslink: Schlüssel merken und aus der sichtbaren Adresse entfernen
    modKey = params.get('mod');
    try { localStorage.setItem(MOD_KEY, modKey); } catch { /* egal */ }
    params.delete('mod');
    history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash);
  }

  // ---- Verbindung -----------------------------------------------------------
  let ws = null, ready = false, seq = 0, retry = 0;
  const pending = new Map();      // id -> { resolve, reject, msg }
  const outbox = [];              // Nachrichten, die auf die Verbindung warten
  const subs = new Map();         // subId -> { kind, path, cb }
  const peerListeners = new Set();
  let peers = [];

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/sync`);
    ws.onopen = () => {
      retry = 0;
      const id = ++seq;
      pending.set(id, {
        resolve: () => {
          ready = true;
          // Abos nach einem Verbindungsabbruch erneuern
          for (const [subId, s] of subs) raw({ op: 'sub', subId, kind: s.kind, path: s.path });
          while (outbox.length) raw(outbox.shift());
        },
        reject: err => {
          // Tisch gibt es nicht (mehr): zurück zur Startseite mit Hinweis
          if (err && err.code === 'not_found') location.replace('/?fehlt=' + encodeURIComponent(TABLE || ''));
        },
      });
      ws.send(JSON.stringify({ id, op: 'hello', uid, table: TABLE, modKey }));
    };
    ws.onmessage = e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.presence) {
        peers = msg.presence.map(by => ({ peer: by, by, isMe: by === uid, sameTab: by === uid, kind: 'viewer', guest: false, presence: {}, updatedAt: Date.now() }));
        for (const fn of peerListeners) fn({ peers, joined: [], left: [], updated: [] });
        return;
      }
      if (msg.sub !== undefined) {
        const s = subs.get(msg.sub);
        if (s) s.cb(msg.kind === 'doc' ? docSnap(msg.snap) : colSnap(msg.snap));
        return;
      }
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      msg.error ? p.reject(msg.error) : p.resolve(msg.result);
    };
    ws.onclose = () => {
      ready = false;
      // offene Anfragen scheitern lassen, damit die App einen Hinweis zeigt
      for (const [id, p] of pending) { p.reject({ code: 'unavailable', message: 'Verbindung unterbrochen' }); pending.delete(id); }
      setTimeout(connect, Math.min(5000, 300 * 2 ** retry++));
    };
  }

  function raw(msg) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }

  function request(msg) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const full = { ...msg, id };
      pending.set(id, { resolve, reject });
      ready ? raw(full) : outbox.push(full);
    });
  }

  // ---- Schnappschüsse im Format der App -------------------------------------
  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const meta = { fromCache: false, hasPendingWrites: false };
  function docSnap(s) {
    const data = s.exists ? Object.freeze(clone(s.data)) : undefined;
    return { id: s.id, exists: !!s.exists, data: () => data, metadata: meta };
  }
  function colSnap(s) {
    const docs = s.docs.map(d => docSnap({ id: d.id, exists: true, data: d.data }));
    return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: meta };
  }

  // ---- db ---------------------------------------------------------------------
  let subSeq = 0;
  function subscribe(kind, path, cb) {
    const subId = ++subSeq;
    subs.set(subId, { kind, path, cb });
    if (ready) raw({ op: 'sub', subId, kind, path });
    return () => { subs.delete(subId); raw({ op: 'unsub', subId }); };
  }

  function docRef(path) {
    return {
      id: path.split('/').pop(), path,
      get: () => request({ op: 'get', path }).then(docSnap),
      set: data => request({ op: 'set', path, data }).then(() => undefined),
      update: data => request({ op: 'update', path, data }).then(() => undefined),
      delete: () => request({ op: 'delete', path }).then(() => undefined),
      onSnapshot: next => subscribe('doc', path, next),
      collection: sub => colRef(path + '/' + sub),
    };
  }
  function colRef(path) {
    return {
      path,
      doc: id => docRef(path + '/' + (id || newUid().slice(2))),
      add: async data => { const ref = docRef(path + '/' + newUid().slice(2)); await ref.set(data); return ref; },
      onSnapshot: next => subscribe('col', path, next),
    };
  }
  const db = { doc: docRef, collection: colRef };

  // ---- user -------------------------------------------------------------------
  const user = {
    id: async () => uid,
    me: async () => ({ id: uid, name: '', avatarUrl: '', color: '#3748a4', email: null, isOwner: false, canEdit: true }),
    isOwner: async () => false,
    canEdit: async () => true,
    can: async () => true,
    name: async () => '',
    profiles: async ids => Object.fromEntries([].concat(ids).map(id => [id, { id, name: '', avatarUrl: '', color: '#3748a4', email: null, isMe: id === uid, guest: false }])),
  };

  // ---- room (nur Anwesenheit) -------------------------------------------------
  const room = {
    peers: () => peers,
    onPeers: fn => { peerListeners.add(fn); if (peers.length) setTimeout(() => fn({ peers, joined: peers, left: [], updated: [] }), 0); return () => peerListeners.delete(fn); },
    presence: async () => {},
    emit: async () => {},
    on: () => () => {},
  };

  // Basisadresse für geteilte Links: lokal geöffnet → Netzwerkadresse dieses Rechners, sonst die aktuelle Adresse
  async function baseUrl() {
    const isLocal = /^(localhost|127\.|\[?::1\]?$)/.test(location.hostname);
    if (isLocal) {
      try {
        const info = await (await fetch('/info', { cache: 'no-store' })).json();
        if (info.lan && info.lan.length) return `http://${info.lan[0]}:${location.port || info.port}`;
      } catch { /* aktuelle Adresse nehmen */ }
    }
    return location.origin;
  }
  // Link für QR-Code und „Link kopieren“
  const shareUrl = async () => `${await baseUrl()}/t/${TABLE}`;
  // Moderationslink: nur wer den Schlüssel hat (z. B. wer den Tisch gestartet hat)
  const moderationUrl = async () => (modKey ? `${await baseUrl()}/t/${TABLE}?mod=${modKey}` : null);
  // Name und Code des Tisches
  async function tableInfo() {
    try { const r = await fetch('/api/tables/' + TABLE, { cache: 'no-store' }); return r.ok ? await r.json() : null; }
    catch { return null; }
  }

  connect();
  window.claude = { use: async name => ({ db, user, room })[name] || null, shareUrl, moderationUrl, tableInfo };
})();
