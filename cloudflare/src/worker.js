/*!
 * Mahjong Scorebook API — Cloudflare Worker + D1 + KV
 *
 * Routes
 *   GET  /ping                      health
 *   POST /rpc                       text/plain body {fn, args, token}  (no CORS preflight)
 *   GET  /photo/<scanId>            the photo behind a scan (X-Admin-Key or ?k=)
 *   POST /admin/<fn>                info | export | scans | users | migrate   (X-Admin-Key)
 *
 * Bindings: DB (D1), PHOTOS (KV). Secrets: ANTHROPIC_API_KEY, PIN_PEPPER, ADMIN_KEY.
 * Vars: MODEL_DEFAULT, MODEL_CAREFUL, SCAN_DAILY_PER_USER, SCAN_DAILY_GLOBAL, MOCK_SCAN (dev only).
 */
import MJ from './engine.js';
import { SCHEMA_SQL } from './schema.js';

const VERSION = '1.0.0';
const NAME_MIN = 2, NAME_MAX = 24;
const PIN_RE = /^\d{4,8}$/;
const ID_RE = /^[A-Za-z0-9_-]{4,40}$/;
const MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_B64 = 7 * 1024 * 1024;   // ≈ 5 MB of JPEG, the API's own ceiling
const MAX_GAME_BYTES = 1500000;          // D1 rows hold 2 MB
const SESSION_MS = 180 * 86400 * 1000;
const PHOTO_TTL = 60 * 86400;            // photos are kept 60 days for accuracy review
const LOCK_AFTER = 5, LOCK_MS = 15 * 60 * 1000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
  'Access-Control-Max-Age': '86400',
};

const SCAN_SCHEMA = {
  type: 'object',
  properties: {
    hand: { type: 'array', items: { type: 'string' }, description: 'Tile codes in the main row, left to right, including the winning tile' },
    melds: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['chow', 'pung', 'kong'] },
          tiles: { type: 'array', items: { type: 'string' } },
          concealed: { type: 'boolean' },
        },
        required: ['type', 'tiles', 'concealed'],
        additionalProperties: false,
      },
    },
    bonus: { type: 'array', items: { type: 'string' }, description: 'Flower (F1-F4), season (S1-S4) and animal (A1-A4) tiles' },
    win: { type: ['string', 'null'], description: 'Code of the winning tile if it is set apart, else null' },
    redFives: { type: 'integer' },
    unsure: { type: 'array', items: { type: 'string' } },
    note: { type: 'string' },
  },
  required: ['hand', 'melds', 'bonus', 'win', 'redFives', 'unsure', 'note'],
  additionalProperties: false,
};
const SCAN_SYSTEM = 'You read mahjong tiles from photographs for a scorekeeping app. Be precise about numerals and suits. Answer only with the JSON asked for.';

class ApiError extends Error {
  constructor(code, message, status) { super(message || code); this.code = code; this.status = status || 400; }
}

/* ------------------------------------------------------------ helpers */
const enc = new TextEncoder();
async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}
function randomHex(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); }
function randomToken() {
  const a = new Uint8Array(32); crypto.getRandomValues(a);
  let s = ''; for (const b of a) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const now = () => Date.now();
const today = () => new Date().toISOString().slice(0, 10);
function json(obj, status, extra) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, CORS, extra || {}) });
}
function cleanName(raw) {
  const s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  if (s.length < NAME_MIN || s.length > NAME_MAX) throw new ApiError('bad_name', 'Use a name between 2 and 24 characters.');
  return s;
}
function cleanPin(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!PIN_RE.test(s)) throw new ApiError('bad_pin', 'The PIN must be 4 to 8 digits.');
  return s;
}
async function pinHash(env, salt, pin) {
  if (!env.PIN_PEPPER) throw new ApiError('not_configured', 'PIN_PEPPER is not set on the server.', 500);
  return sha256Hex(env.PIN_PEPPER + ':' + salt + ':' + pin);
}
const pubUser = (u) => ({ id: u.id, name: u.name, createdAt: u.created_at });

/* ------------------------------------------------------------ usage counters */
async function bump(env, key, limit) {
  // Atomic increment; returns the new count. Throws rate_limited when over the limit.
  const day = today();
  const row = await env.DB.prepare('INSERT INTO usage (day, key, n) VALUES (?, ?, 1) ON CONFLICT(day, key) DO UPDATE SET n = n + 1 RETURNING n').bind(day, key).first();
  const n = row ? row.n : 1;
  if (limit && n > limit) throw new ApiError('rate_limited', 'Daily limit reached. Try again tomorrow.', 429);
  return n;
}
async function countToday(env, key) {
  const row = await env.DB.prepare('SELECT n FROM usage WHERE day = ? AND key = ?').bind(today(), key).first();
  return row ? row.n : 0;
}

/* ------------------------------------------------------------ auth */
async function userFromToken(env, token) {
  if (!token || typeof token !== 'string' || token.length < 20) return null;
  const th = await sha256Hex(token);
  const s = await env.DB.prepare('SELECT s.token_hash, s.user_id, s.last_used, u.id, u.name, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').bind(th).first();
  if (!s) return null;
  if (now() - s.last_used > SESSION_MS) { await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(th).run(); return null; }
  if (now() - s.last_used > 3600 * 1000) await env.DB.prepare('UPDATE sessions SET last_used = ? WHERE token_hash = ?').bind(now(), th).run();
  return { id: s.id, name: s.name, created_at: s.created_at, token_hash: th };
}
async function requireUser(c) {
  if (c.user === undefined) c.user = await userFromToken(c.env, c.token);
  if (!c.user) throw new ApiError('signin_required', 'Sign in to do that.', 401);
  return c.user;
}
async function issueSession(env, userId, agent) {
  const token = randomToken();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_used, agent) VALUES (?, ?, ?, ?, ?)').bind(await sha256Hex(token), userId, now(), now(), (agent || '').slice(0, 200)).run();
  return token;
}

/* ------------------------------------------------------------ RPC functions */
const RPC = {
  async signup({ name, pin }, c) {
    name = cleanName(name); pin = cleanPin(pin);
    await bump(c.env, 'signup', +c.env.SIGNUP_DAILY || 50);
    const existing = await c.env.DB.prepare('SELECT id FROM users WHERE name_key = ?').bind(name.toLowerCase()).first();
    if (existing) throw new ApiError('name_taken', 'That name is already taken. Sign in instead, or pick another name.');
    const id = 'u' + randomHex(8), salt = randomHex(8);
    await c.env.DB.prepare('INSERT INTO users (id, name, name_key, pin_hash, salt, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, name, name.toLowerCase(), await pinHash(c.env, salt, pin), salt, now(), now()).run();
    const token = await issueSession(c.env, id, c.agent);
    return { token, user: { id, name, createdAt: now() } };
  },
  async signin({ name, pin }, c) {
    name = cleanName(name); pin = cleanPin(pin);
    const u = await c.env.DB.prepare('SELECT * FROM users WHERE name_key = ?').bind(name.toLowerCase()).first();
    if (!u) throw new ApiError('no_such_user', 'No account has that name yet.');
    if (u.locked_until > now()) throw new ApiError('locked', 'Too many wrong PINs. Try again in ' + Math.ceil((u.locked_until - now()) / 60000) + ' minutes.', 423);
    if ((await pinHash(c.env, u.salt, pin)) !== u.pin_hash) {
      const fails = (u.fails || 0) + 1;
      await c.env.DB.prepare('UPDATE users SET fails = ?, locked_until = ? WHERE id = ?').bind(fails >= LOCK_AFTER ? 0 : fails, fails >= LOCK_AFTER ? now() + LOCK_MS : 0, u.id).run();
      throw new ApiError('wrong_pin', fails >= LOCK_AFTER ? 'Wrong PIN. The account is locked for 15 minutes.' : 'Wrong PIN.');
    }
    await c.env.DB.prepare('UPDATE users SET fails = 0, locked_until = 0, last_seen = ? WHERE id = ?').bind(now(), u.id).run();
    const token = await issueSession(c.env, u.id, c.agent);
    return { token, user: pubUser(u) };
  },
  async signout(_, c) {
    const u = await requireUser(c);
    await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(u.token_hash).run();
    return { ok: true };
  },
  async me(_, c) {
    const u = await requireUser(c);
    const limit = +c.env.SCAN_DAILY_PER_USER || 60;
    return { user: pubUser(u), scans: { today: await countToday(c.env, 'scan:' + u.id), limit }, canScan: !!(c.env.ANTHROPIC_API_KEY || c.env.MOCK_SCAN), serverTime: now() };
  },
  async changePin({ pin, newPin }, c) {
    const u = await requireUser(c);
    pin = cleanPin(pin); newPin = cleanPin(newPin);
    const row = await c.env.DB.prepare('SELECT pin_hash, salt FROM users WHERE id = ?').bind(u.id).first();
    if ((await pinHash(c.env, row.salt, pin)) !== row.pin_hash) throw new ApiError('wrong_pin', 'The current PIN is wrong.');
    const salt = randomHex(8);
    await c.env.DB.prepare('UPDATE users SET pin_hash = ?, salt = ? WHERE id = ?').bind(await pinHash(c.env, salt, newPin), salt, u.id).run();
    return { ok: true };
  },

  async listGames({ since }, c) {
    const u = await requireUser(c);
    const s = Math.max(0, +since || 0);
    // `since` is the server clock at the previous sync (synced_at), so device clocks never hide a change.
    const rows = (await c.env.DB.prepare('SELECT id, deleted, synced_at, body FROM games WHERE user_id = ? AND synced_at > ? ORDER BY synced_at').bind(u.id, s).all()).results || [];
    const bodies = [], deleted = [];
    let latest = s;
    for (const r of rows) {
      if (r.synced_at > latest) latest = r.synced_at;
      if (r.deleted) deleted.push(r.id); else bodies.push(r.body);
    }
    // Bodies are stored as JSON text, so splice them in without re-parsing.
    const payload = '{"games":[' + bodies.join(',') + '],"deleted":' + JSON.stringify(deleted) + ',"until":' + latest + ',"serverTime":' + now() + '}';
    return { __raw: payload };
  },
  async saveGame({ game }, c) {
    const u = await requireUser(c);
    if (!game || typeof game !== 'object' || !ID_RE.test(String(game.id || ''))) throw new ApiError('bad_game', 'That game record is not valid.');
    if (!MJ.RULES[game.ruleset]) throw new ApiError('bad_game', 'Unknown rule system.');
    const updatedAt = +game.updatedAt || now();
    const body = JSON.stringify(game);
    if (body.length > MAX_GAME_BYTES) throw new ApiError('too_big', 'This game is too large to save. Export it and start a new one.', 413);
    const cur = await c.env.DB.prepare('SELECT user_id, updated_at, deleted, body FROM games WHERE id = ?').bind(game.id).first();
    if (cur && cur.user_id !== u.id) throw new ApiError('not_yours', 'That game belongs to another account.', 403);
    if (cur && !cur.deleted && cur.updated_at > updatedAt) return { ok: false, conflict: true, __raw: '{"ok":false,"conflict":true,"game":' + cur.body + '}' };
    await c.env.DB.prepare('INSERT INTO games (id, user_id, ruleset, finished, updated_at, deleted, synced_at, body) VALUES (?, ?, ?, ?, ?, 0, ?, ?) ON CONFLICT(id) DO UPDATE SET ruleset = excluded.ruleset, finished = excluded.finished, updated_at = excluded.updated_at, deleted = 0, synced_at = excluded.synced_at, body = excluded.body')
      .bind(game.id, u.id, String(game.ruleset), game.finished ? 1 : 0, updatedAt, now(), body).run();
    return { ok: true, updatedAt };
  },
  async deleteGame({ id }, c) {
    const u = await requireUser(c);
    if (!ID_RE.test(String(id || ''))) throw new ApiError('bad_game', 'Bad game id.');
    const cur = await c.env.DB.prepare('SELECT user_id FROM games WHERE id = ?').bind(id).first();
    if (cur && cur.user_id !== u.id) throw new ApiError('not_yours', 'That game belongs to another account.', 403);
    // Keep a tombstone so other devices learn about the deletion.
    await c.env.DB.prepare('INSERT INTO games (id, user_id, ruleset, finished, updated_at, deleted, synced_at, body) VALUES (?, ?, NULL, 0, ?, 1, ?, ?) ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, deleted = 1, synced_at = excluded.synced_at, body = excluded.body')
      .bind(id, u.id, now(), now(), '{"id":' + JSON.stringify(id) + '}').run();
    return { ok: true };
  },

  async scan({ image, mediaType, ruleset, tier, gameId }, c) {
    const u = await requireUser(c);
    const R = MJ.RULES[ruleset] || MJ.RULES.hk;
    if (typeof image !== 'string' || image.length < 100) throw new ApiError('image_rejected', 'No photo was received.');
    if (image.length > MAX_IMAGE_B64) throw new ApiError('image_rejected', 'That photo is too large. Try again; the app shrinks photos before sending.', 413);
    if (!MEDIA.includes(mediaType)) throw new ApiError('image_rejected', 'Use a JPEG, PNG or WebP photo.');
    if (!c.env.ANTHROPIC_API_KEY && !c.env.MOCK_SCAN) throw new ApiError('not_configured', 'Photo reading is not switched on for this server yet.', 503);
    await bump(c.env, 'scan:' + u.id, +c.env.SCAN_DAILY_PER_USER || 60);
    await bump(c.env, 'scan', +c.env.SCAN_DAILY_GLOBAL || 300);
    const careful = tier === 'complex' || tier === 'careful';
    const model = careful ? (c.env.MODEL_CAREFUL || 'claude-opus-5-5') : (c.env.MODEL_DEFAULT || 'claude-sonnet-5');
    const id = 's' + randomHex(8);
    const t0 = now();
    const imageBytes = Math.floor(image.length * 3 / 4);
    let raw = null, result = null, usage = {}, status = 'ok', error = '';
    try {
      const out = await callVision(c.env, { model, image, mediaType, prompt: MJ.scanPrompt(R) });
      raw = out.raw; result = out.result; usage = out.usage || {};
    } catch (e) {
      status = 'error'; error = (e && (e.code || e.message)) || 'failed';
      const ms = now() - t0;
      c.ctx.waitUntil(c.env.DB.prepare('INSERT INTO scans (id, user_id, game_id, ruleset, tier, model, status, error, ms, image_bytes, raw, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, u.id, gameId ? String(gameId).slice(0, 40) : null, R.id, careful ? 'careful' : 'default', model, status, String(e && e.message || error).slice(0, 500), ms, imageBytes, e && e.raw ? String(e.raw).slice(0, 4000) : null, t0).run());
      throw e instanceof ApiError ? e : new ApiError('upstream', 'The tiles could not be read just now. Try again.', 502);
    }
    const ms = now() - t0;
    const parsed = MJ.parseScan(result, R);
    const parsedText = MJ.handToText(parsed.tiles);
    c.ctx.waitUntil(Promise.all([
      c.env.DB.prepare('INSERT INTO scans (id, user_id, game_id, ruleset, tier, model, status, ms, in_tokens, out_tokens, image_bytes, raw, parsed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, u.id, gameId ? String(gameId).slice(0, 40) : null, R.id, careful ? 'careful' : 'default', model, status, ms, usage.input_tokens || 0, usage.output_tokens || 0, imageBytes, JSON.stringify(result).slice(0, 8000), parsedText, t0).run(),
      c.env.PHOTOS ? c.env.PHOTOS.put('scan:' + id, image, { expirationTtl: PHOTO_TTL, metadata: { mediaType, userId: u.id, at: t0 } }).catch(() => null) : null,
    ]));
    return { scanId: id, result, model, ms, tokens: { in: usage.input_tokens || 0, out: usage.output_tokens || 0 } };
  },
  async scanFinal({ scanId, tiles }, c) {
    const u = await requireUser(c);
    if (!/^s[0-9a-f]{16}$/.test(String(scanId || ''))) throw new ApiError('bad_scan', 'Unknown scan.');
    const text = tiles && typeof tiles === 'object' ? MJ.handToText({ hand: tiles.hand || [], melds: tiles.melds || [], bonus: tiles.bonus || [], win: tiles.win || null }) : String(tiles || '').slice(0, 400);
    await c.env.DB.prepare('UPDATE scans SET final = ?, corrected_at = ? WHERE id = ? AND user_id = ?').bind(text, now(), scanId, u.id).run();
    return { ok: true };
  },
};

/* ------------------------------------------------------------ vision call */
async function callVision(env, { model, image, mediaType, prompt }) {
  if (env.MOCK_SCAN) {
    // Local development: a fixed hand (mixed one suit + East pung, valid under every system), no API call.
    const mock = { hand: ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1z', '1z', '1z', '5z', '5z'], melds: [], bonus: ['F1'], win: '5z', redFives: 0, unsure: [], note: 'mock' };
    await new Promise((r) => setTimeout(r, 300));
    return { raw: JSON.stringify(mock), result: mock, usage: { input_tokens: 0, output_tokens: 0 } };
  }
  const body = {
    model, max_tokens: 900, system: SCAN_SYSTEM,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
      { type: 'text', text: prompt },
    ] }],
    output_config: { format: { type: 'json_schema', schema: SCAN_SCHEMA } },
  };
  let { res, text } = await post(env, body);
  if (res.status === 400 && /output_config|json_schema|structured|schema/i.test(text)) {
    // Model or account without structured outputs: ask for plain JSON and parse it ourselves.
    delete body.output_config;
    ({ res, text } = await post(env, body));
  }
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try { const j = JSON.parse(text); msg = (j.error && j.error.message) || msg; } catch (e) { /* keep text */ }
    if (res.status === 400 && /image|media/i.test(msg)) throw Object.assign(new ApiError('image_rejected', 'That photo could not be opened. Try a JPEG taken with the camera.'), { raw: msg });
    if (res.status === 401) throw Object.assign(new ApiError('not_configured', 'The photo reader key was refused. Ask the admin to check the API key.', 503), { raw: msg });
    if (res.status === 429 || res.status === 529) throw Object.assign(new ApiError('rate_limited', 'The photo reader is busy. Wait a moment and try again.', 429), { raw: msg });
    throw Object.assign(new ApiError('upstream', 'The photo reader returned an error (' + res.status + ').', 502), { raw: msg });
  }
  let j;
  try { j = JSON.parse(text); } catch (e) { throw Object.assign(new ApiError('invalid_json', 'Unreadable reply from the photo reader.', 502), { raw: text.slice(0, 500) }); }
  if (j.stop_reason === 'refusal') throw Object.assign(new ApiError('refused', 'The photo could not be read. Try a closer, straight-on shot of just the tiles.'), { raw: text.slice(0, 1000) });
  const block = (j.content || []).find((b) => b.type === 'text');
  if (!block || !block.text) throw Object.assign(new ApiError('empty_completion', 'The photo reader gave no answer. Try again.', 502), { raw: text.slice(0, 1000) });
  const result = extractJson(block.text);
  if (!result) throw Object.assign(new ApiError('invalid_json', 'The photo reader answered in an unexpected form. Try again.', 502), { raw: block.text.slice(0, 1000) });
  return { raw: block.text, result, usage: j.usage || {} };
}

async function post(env, body) {
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    });
  } catch (e) {
    throw new ApiError('upstream', 'Could not reach the photo reader. Check the connection and try again.', 502);
  }
  return { res, text: await res.text() };
}
function extractJson(text) {
  try { return JSON.parse(text); } catch (e) { /* maybe wrapped in prose or fences */ }
  const m = /\{[\s\S]*\}/.exec(text);
  if (m) { try { return JSON.parse(m[0]); } catch (e) { return null; } }
  return null;
}

/* ------------------------------------------------------------ admin */
const ADMIN = {
  async info(env) {
    const q = async (sql) => { const r = await env.DB.prepare(sql).first(); return r ? r.n : 0; };
    return {
      version: VERSION, serverTime: now(),
      users: await q('SELECT COUNT(*) n FROM users'),
      sessions: await q('SELECT COUNT(*) n FROM sessions'),
      games: await q('SELECT COUNT(*) n FROM games WHERE deleted = 0'),
      scans: await q('SELECT COUNT(*) n FROM scans'),
      scansToday: await countToday(env, 'scan'),
      models: { default: env.MODEL_DEFAULT || 'claude-sonnet-5', careful: env.MODEL_CAREFUL || 'claude-opus-5-5' },
      visionKey: !!env.ANTHROPIC_API_KEY, mock: !!env.MOCK_SCAN, photos: !!env.PHOTOS,
    };
  },
  async users(env) {
    return { users: (await env.DB.prepare('SELECT id, name, created_at, last_seen FROM users ORDER BY created_at').all()).results };
  },
  async export(env) {
    const users = (await env.DB.prepare('SELECT id, name, created_at, last_seen FROM users ORDER BY created_at').all()).results;
    const games = (await env.DB.prepare('SELECT id, user_id, updated_at, deleted, body FROM games ORDER BY updated_at').all()).results;
    const scans = (await env.DB.prepare('SELECT * FROM scans ORDER BY created_at').all()).results;
    const payload = '{"version":"' + VERSION + '","exportedAt":' + now() + ',"users":' + JSON.stringify(users) +
      ',"games":[' + games.map((g) => '{"userId":' + JSON.stringify(g.user_id) + ',"deleted":' + (g.deleted ? 'true' : 'false') + ',"updatedAt":' + g.updated_at + ',"game":' + g.body + '}').join(',') +
      '],"scans":' + JSON.stringify(scans) + '}';
    return { __raw: payload };
  },
  async scans(env, args) {
    const limit = Math.min(500, Math.max(1, +(args && args.limit) || 100));
    const rows = (await env.DB.prepare('SELECT s.*, u.name AS user_name FROM scans s LEFT JOIN users u ON u.id = s.user_id ORDER BY s.created_at DESC LIMIT ?').bind(limit).all()).results;
    // Tile-level accuracy: compare the parsed multiset with what the user finally saved.
    let compared = 0, exact = 0, tilesRight = 0, tilesTotal = 0;
    const per = {};
    for (const r of rows) {
      r.accuracy = null;
      if (!r.parsed || !r.final) continue;
      const a = tilesOfText(r.parsed), b = tilesOfText(r.final);
      compared++;
      const same = a.length === b.length && a.every((x, i) => x === b[i]);
      if (same) exact++;
      const cb = {}; b.forEach((t) => (cb[t] = (cb[t] || 0) + 1));
      let hit = 0;
      a.forEach((t) => { if (cb[t]) { cb[t]--; hit++; } });
      tilesRight += hit; tilesTotal += Math.max(a.length, b.length);
      r.accuracy = { exact: same, tilesRight: hit, tiles: Math.max(a.length, b.length) };
      b.forEach((t) => { per[t] = per[t] || { seen: 0, missed: 0 }; per[t].seen++; });
      const ca = {}; a.forEach((t) => (ca[t] = (ca[t] || 0) + 1));
      b.forEach((t) => { if (ca[t]) ca[t]--; else per[t].missed++; });
    }
    return { summary: { scans: rows.length, compared, exactHands: exact, tileAccuracy: tilesTotal ? Math.round((tilesRight / tilesTotal) * 1000) / 10 : null }, perTile: per, scans: rows };
  },
  async migrate(env) {
    const stmts = SCHEMA_SQL.replace(/--[^\n]*/g, '').split(';').map((s) => s.trim()).filter(Boolean);
    await env.DB.batch(stmts.map((s) => env.DB.prepare(s)));
    return { ok: true, statements: stmts.length };
  },
};
function tilesOfText(t) {
  // "123m 4p | pon:5z kan*:7z | F1 | win:3m" → sorted multiset of tile codes (melds expanded)
  const out = [];
  const parts = String(t).split('|').map((x) => x.trim());
  for (const p of parts) {
    if (!p || p.startsWith('win:')) continue;
    for (const tok of p.split(/\s+/)) {
      const m = /^(chi|pon|kan)\*?:(\S+)$/.exec(tok);
      if (m) {
        const i = MJ.ix(m[2]);
        if (m[1] === 'chi') out.push(MJ.cd(i), MJ.cd(i + 1), MJ.cd(i + 2));
        else for (let k = 0; k < (m[1] === 'kan' ? 4 : 3); k++) out.push(m[2]);
      } else if (MJ.isTile(tok) || MJ.isBonus(tok)) out.push(tok);
    }
  }
  return MJ.sortTiles(out);
}

/* ------------------------------------------------------------ router */
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      if (url.pathname === '/ping' || url.pathname === '/') return json({ ok: true, v: VERSION, t: now() });
      if (url.pathname === '/rpc' && req.method === 'POST') return await rpc(req, env, ctx);
      if (url.pathname.startsWith('/admin/') && req.method === 'POST') return await admin(req, env, url);
      if (url.pathname.startsWith('/photo/') && req.method === 'GET') return await photo(req, env, url);
      return json({ error: 'not_found', message: 'No such route.' }, 404);
    } catch (e) {
      if (e instanceof ApiError) return json({ error: e.code, message: e.message }, e.status);
      return json({ error: 'server_error', message: String(e && e.message || e).slice(0, 300) }, 500);
    }
  },
};
async function rpc(req, env, ctx) {
  let body;
  try { body = JSON.parse(await req.text()); } catch (e) { throw new ApiError('bad_request', 'The request was not JSON.'); }
  const fn = body && body.fn;
  if (!fn || !Object.prototype.hasOwnProperty.call(RPC, fn)) throw new ApiError('bad_fn', 'Unknown function.', 404);
  const c = { env, ctx, req, token: body.token, user: undefined, agent: req.headers.get('user-agent') || '' };
  let out;
  // Expected failures (wrong PIN, limits, bad input) come back as 200 + {error} so browsers don't log them as network errors.
  try { out = await RPC[fn](body.args || {}, c); }
  catch (e) { if (e instanceof ApiError) return json({ error: e.code, message: e.message, status: e.status }); throw e; }
  if (out && out.__raw) return new Response(out.__raw, { headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, CORS) });
  return json(out);
}
function adminOk(req, env, url) {
  const k = req.headers.get('x-admin-key') || url.searchParams.get('k') || '';
  return !!(env.ADMIN_KEY && k && k.length === env.ADMIN_KEY.length && k === env.ADMIN_KEY);
}
async function admin(req, env, url) {
  if (!adminOk(req, env, url)) throw new ApiError('forbidden', 'Bad admin key.', 403);
  const fn = url.pathname.slice('/admin/'.length);
  if (!Object.prototype.hasOwnProperty.call(ADMIN, fn)) throw new ApiError('bad_fn', 'Unknown admin function.', 404);
  let args = {};
  try { const t = await req.text(); if (t) args = JSON.parse(t); } catch (e) { args = {}; }
  const out = await ADMIN[fn](env, args);
  if (out && out.__raw) return new Response(out.__raw, { headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, CORS) });
  return json(out);
}
async function photo(req, env, url) {
  if (!adminOk(req, env, url)) throw new ApiError('forbidden', 'Bad admin key.', 403);
  if (!env.PHOTOS) throw new ApiError('not_found', 'Photo storage is not configured.', 404);
  const id = url.pathname.slice('/photo/'.length).replace(/\.\w+$/, '');
  const got = await env.PHOTOS.getWithMetadata('scan:' + id);
  if (!got || !got.value) throw new ApiError('not_found', 'No photo for that scan (photos are kept 60 days).', 404);
  const b64 = got.value, bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, { headers: { 'content-type': (got.metadata && got.metadata.mediaType) || 'image/jpeg', 'cache-control': 'private, max-age=3600' } });
}
