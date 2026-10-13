#!/usr/bin/env node
/**
 * A minimal Nostr relay for lolPing internet rooms: ephemeral fan-out only, nothing is stored.
 *
 * It speaks exactly what src/main/relayConnection.ts uses — REQ / EVENT / CLOSE in, EVENT / OK / EOSE out — and
 * nothing else (no AUTH, no PoW, no persistence). Grown from tests/main/fixtures/fakeRelay.ts, the reference server
 * the test suite runs against. Events are fanned out to every matching subscription, the author's included: the app
 * judges a relay healthy only by seeing its own events come back.
 *
 * Run:  npm install ws   (in this directory)   then   node relay.mjs
 * Env:  PORT (default 37979), HOST (default 0.0.0.0)
 * Check: curl http://127.0.0.1:37979/health   then the go/no-go probe:
 *        node tools/relay-probe/run.mjs --relays ws://127.0.0.1:37979 --soak-min 0
 */
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT ?? 37979);
const HOST = process.env.HOST ?? '0.0.0.0';
/** The app's ephemeral room kind (20000–29999 range): the only traffic worth forwarding. */
const ROOM_KIND = 24747;
/** The app retires a relay that sends anything bigger, so refuse it up front. */
const MAX_MESSAGE = 64 * 1024;
const MAX_SUBS = 16;
/** Per connection and second: the app's own etiquette is 5/s pings + presence, so this is pure headroom. */
const PER_SECOND = 20;
/** One machine should not fill the room server. */
const MAX_PER_IP = 20;

const isHex = (v, n) => typeof v === 'string' && v.length === n && /^[0-9a-f]+$/.test(v);

/** The same shape checks as the app's parseRelayMessage; the sealed room crypto is the real validation. */
function isEvent(e) {
  return (
    typeof e === 'object' && e !== null &&
    isHex(e.id, 64) && isHex(e.pubkey, 64) && isHex(e.sig, 128) &&
    Number.isSafeInteger(e.created_at) && e.created_at >= 0 &&
    Number.isSafeInteger(e.kind) &&
    typeof e.content === 'string' &&
    Array.isArray(e.tags) && e.tags.every((t) => Array.isArray(t) && t.every((v) => typeof v === 'string'))
  );
}

/** One subscription's filter: kinds and "#x" topics, NIP-01 style. `since`/`limit` are ignored — nothing is stored. */
const matches = (f, e) =>
  (f.kinds.length === 0 || f.kinds.includes(e.kind)) &&
  (f.topics.length === 0 || e.tags.some((t) => t[0] === 'x' && f.topics.includes(t[1])));

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  } else {
    res.writeHead(404);
    res.end();
  }
});

const wss = new WebSocketServer({ server: http, maxPayload: MAX_MESSAGE });
/** ws -> { subs: Map<subId, { kinds, topics }>, windowStart, windowCount } */
const clients = new Map();
const perIp = new Map();

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress ?? 'unknown';
  perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
  if (perIp.get(ip) > MAX_PER_IP) {
    perIp.set(ip, perIp.get(ip) - 1);
    ws.close(1008, 'too many connections');
    return;
  }
  const state = { subs: new Map(), windowStart: 0, windowCount: 0 };
  clients.set(ws, state);
  console.log(`[relay] open ${ip} (${clients.size} clients)`);

  ws.on('close', () => {
    clients.delete(ws);
    const n = (perIp.get(ip) ?? 1) - 1;
    if (n <= 0) perIp.delete(ip);
    else perIp.set(ip, n);
    console.log(`[relay] close ${ip} (${clients.size} clients)`);
  });

  ws.on('message', (raw) => {
    // The app retires a relay that shouts: keep every reply quiet and small.
    const now = Date.now();
    if (now - state.windowStart >= 1000) {
      state.windowStart = now;
      state.windowCount = 0;
    }
    if (++state.windowCount > PER_SECOND) return;

    let m;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!Array.isArray(m) || typeof m[0] !== 'string') return;

    if (m[0] === 'REQ') {
      const subId = typeof m[1] === 'string' ? m[1] : null;
      if (subId === null) return;
      if (state.subs.size >= MAX_SUBS && !state.subs.has(subId)) return;
      // Multiple filters in one REQ: any of them matching counts, as NIP-01 says.
      const filters = [];
      for (const raw2 of m.slice(2)) {
        const f = raw2 ?? {};
        filters.push({
          kinds: Array.isArray(f.kinds) ? f.kinds.filter((k) => Number.isSafeInteger(k)) : [],
          topics: Array.isArray(f['#x']) ? f['#x'].filter((t) => typeof t === 'string') : [],
        });
      }
      state.subs.set(subId, filters);
      ws.send(JSON.stringify(['EOSE', subId]));
    } else if (m[0] === 'CLOSE') {
      if (typeof m[1] === 'string') state.subs.delete(m[1]);
    } else if (m[0] === 'EVENT') {
      const e = m[1];
      if (!isEvent(e)) {
        if (typeof e === 'object' && e !== null && isHex(e.id, 64)) {
          ws.send(JSON.stringify(['OK', e.id, false, 'invalid: malformed event']));
        }
        return;
      }
      if (e.kind !== ROOM_KIND) {
        ws.send(JSON.stringify(['OK', e.id, false, 'restricted: only kind ' + ROOM_KIND]));
        return;
      }
      ws.send(JSON.stringify(['OK', e.id, true, '']));
      // Fan out to every matching subscription, the author's included (echo = the app's health signal).
      const frame = (subId) => JSON.stringify(['EVENT', subId, e]);
      for (const [peer, s] of clients) {
        for (const [subId, filters] of s.subs) {
          if (filters.some((f) => matches(f, e))) {
            peer.send(frame(subId));
          }
        }
      }
    }
  });
});

http.listen(PORT, HOST, () => {
  console.log(`[relay] lolPing relay listening on ws://${HOST}:${PORT} (health: /health)`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`[relay] ${sig}, shutting down`);
    for (const ws of clients.keys()) ws.terminate();
    wss.close(() => http.close(() => process.exit(0)));
  });
}
