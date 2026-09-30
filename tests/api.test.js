// Backend checks against a running `wrangler dev --local` (MOCK_SCAN=1, ADMIN_KEY=uji-lokal in cloudflare/.dev.vars).
//   cd cloudflare && npx wrangler dev --port 8787 --local   (in another shell)
//   node tests/api.test.js
const BASE = process.env.API_URL || 'http://127.0.0.1:8787';
const ADMIN = process.env.ADMIN_KEY || 'uji-lokal';
let pass = 0, fail = 0;
const eq = (l, g, w) => { const a = JSON.stringify(g), b = JSON.stringify(w); if (a === b) pass++; else { fail++; console.log('FAIL', l, '\n  got ', a, '\n  want', b); } };
const ok = (l, c) => eq(l, !!c, true);
async function rpc(fn, args, token) {
  const r = await fetch(BASE + '/rpc', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ fn, args, token }) });
  const j = await r.json();
  return Object.assign({ __status: r.status }, j);
}
async function admin(fn, body) {
  const r = await fetch(BASE + '/admin/' + fn, { method: 'POST', headers: { 'x-admin-key': ADMIN }, body: body ? JSON.stringify(body) : undefined });
  return Object.assign({ __status: r.status }, await r.json());
}
const tinyJpeg = 'x'.repeat(2000); // the mock never looks at the bytes
const game = (id, upd) => ({ id, v: 1, ruleset: 'hk', settings: {}, money: { per: 0, symbol: '' }, values: {}, players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }], start: { dealer: 0 }, state: { round: 0, dealer: 0, streak: 0, honba: 0, pot: 0, handNo: 0 }, entries: [], finished: false, createdAt: 1, updatedAt: upd });

(async () => {
  const stamp = Date.now().toString(36);
  const name = 'Tester ' + stamp;
  // ping
  const ping = await (await fetch(BASE + '/ping')).json();
  ok('ping', ping.ok && ping.v);
  // bad input
  eq('bad fn', (await rpc('nope', {})).error, 'bad_fn');
  eq('short name', (await rpc('signup', { name: 'x', pin: '1234' })).error, 'bad_name');
  eq('bad pin', (await rpc('signup', { name: 'Valid Name', pin: '12' })).error, 'bad_pin');
  eq('password with space', (await rpc('signup', { name: 'Valid Name', pin: 'has space' })).error, 'bad_pin');
  // guest tables: the id is the credential; a second phone joins with it
  const g1 = await rpc('guestStart', {});
  ok('guest created', g1.token && /^guest-[A-Z2-9]{6}$/.test(g1.guestId) && g1.user.guest === true);
  const g2 = await rpc('signin', { name: g1.guestId.toLowerCase(), pin: g1.guestId });
  ok('guest join with id', g2.token && g2.user.id === g1.user.id);
  const gm = await rpc('me', {}, g1.token);
  ok('guest me has expiry', gm.user.guest && gm.expiresAt > Date.now() + 6 * 86400000 && gm.inactiveDays === 7);
  await rpc('saveGame', { game: game('gg' + stamp, 100) }, g1.token);
  eq('guest game visible to joiner', (await rpc('listGames', {}, g2.token)).games.length, 1);
  eq('unknown user', (await rpc('signin', { name, pin: '1234' })).error, 'no_such_user');
  // signup + duplicate
  const su = await rpc('signup', { name, pin: '2468' });
  ok('signup token', su.token && su.user && su.user.name === name);
  eq('name taken (case-insensitive)', (await rpc('signup', { name: name.toUpperCase(), pin: '1111' })).error, 'name_taken');
  // wrong pin ×5 → locked
  for (let i = 0; i < 4; i++) eq('wrong pin ' + i, (await rpc('signin', { name, pin: '0000' })).error, 'wrong_pin');
  eq('5th wrong pin locks', (await rpc('signin', { name, pin: '0000' })).error, 'wrong_pin');
  eq('locked', (await rpc('signin', { name, pin: '2468' })).error, 'locked');
  // unlock directly in D1 through the admin migrate path is not available; use a fresh account for the rest
  const name2 = 'Player ' + stamp;
  const su2 = await rpc('signup', { name: name2, pin: '1357' });
  const tok = su2.token;
  const si = await rpc('signin', { name: name2.toLowerCase(), pin: '1357' });
  ok('signin ok, name case-insensitive', si.token && si.user.id === su2.user.id);
  // me
  const me = await rpc('me', {}, tok);
  eq('me', [me.user.name, me.scans.today, me.canScan], [name2, 0, true]);
  eq('me without token', (await rpc('me', {})).error, 'signin_required');
  // games: save, list, since, conflict, delete tombstone
  eq('list empty', (await rpc('listGames', {}, tok)).games, []);
  const s1 = await rpc('saveGame', { game: game('g1' + stamp, 1000) }, tok);
  eq('save g1', [s1.ok, s1.updatedAt], [true, 1000]);
  eq('bad game', (await rpc('saveGame', { game: { id: 'x', ruleset: 'hk' } }, tok)).error, 'bad_game');
  eq('bad ruleset', (await rpc('saveGame', { game: game('gx' + stamp, 1) }, tok)).error, undefined);
  eq('unknown ruleset', (await rpc('saveGame', { game: Object.assign(game('gy' + stamp, 1), { ruleset: 'zzz' }) }, tok)).error, 'bad_game');
  const l1 = await rpc('listGames', {}, tok);
  eq('list has g1, gx', l1.games.map((g) => g.id).sort(), ['g1' + stamp, 'gx' + stamp].sort());
  ok('until is server time', l1.until > 1700000000000);
  eq('incremental empty', (await rpc('listGames', { since: l1.until }, tok)).games, []);
  // older write is rejected with the newer copy
  await rpc('saveGame', { game: game('g1' + stamp, 2000) }, tok);
  const c = await rpc('saveGame', { game: game('g1' + stamp, 1500) }, tok);
  eq('conflict', [c.ok, c.conflict, c.game.updatedAt], [false, true, 2000]);
  // other account cannot touch it
  const su3 = await rpc('signup', { name: 'Other ' + stamp, pin: '9999' });
  eq('not yours', (await rpc('saveGame', { game: game('g1' + stamp, 9000) }, su3.token)).error, 'not_yours');
  eq('not yours delete', (await rpc('deleteGame', { id: 'g1' + stamp }, su3.token)).error, 'not_yours');
  eq('other list empty', (await rpc('listGames', {}, su3.token)).games, []);
  // delete → tombstone visible in incremental sync
  const before = (await rpc('listGames', {}, tok)).until;
  eq('delete', (await rpc('deleteGame', { id: 'gx' + stamp }, tok)).ok, true);
  const inc = await rpc('listGames', { since: before }, tok);
  eq('tombstone', [inc.games.length, inc.deleted], [0, ['gx' + stamp]]);
  // re-saving a deleted id revives it
  await rpc('saveGame', { game: game('gx' + stamp, 5000) }, tok);
  eq('revived', (await rpc('listGames', {}, tok)).games.map((g) => g.id).sort(), ['g1' + stamp, 'gx' + stamp].sort());
  // scan (mock) + final
  eq('scan needs signin', (await rpc('scan', { image: tinyJpeg, mediaType: 'image/jpeg', ruleset: 'hk' })).error, 'signin_required');
  eq('scan bad media', (await rpc('scan', { image: tinyJpeg, mediaType: 'image/heic', ruleset: 'hk' }, tok)).error, 'image_rejected');
  eq('scan no image', (await rpc('scan', { image: '', mediaType: 'image/jpeg', ruleset: 'hk' }, tok)).error, 'image_rejected');
  const sc = await rpc('scan', { image: tinyJpeg, mediaType: 'image/jpeg', ruleset: 'hk', tier: 'default', gameId: 'g1' + stamp }, tok);
  ok('scan ok', sc.scanId && sc.result && sc.result.hand.length === 14);
  ok('scan ms', typeof sc.ms === 'number');
  eq('scan counted', (await rpc('me', {}, tok)).scans.today, 1);
  eq('scanFinal', (await rpc('scanFinal', { scanId: sc.scanId, tiles: { hand: ['1m', '2m', '3m'], melds: [], bonus: [], win: '3m' } }, tok)).ok, true);
  eq('scanFinal bad id', (await rpc('scanFinal', { scanId: 'nope', tiles: {} }, tok)).error, 'bad_scan');
  // admin
  eq('admin forbidden', (await (await fetch(BASE + '/admin/info', { method: 'POST' })).json()).error, 'forbidden');
  const info = await admin('info');
  ok('admin info', info.users >= 3 && info.scans >= 1 && info.mock === true);
  const scans = await admin('scans', { limit: 5 });
  ok('admin scans', scans.summary.scans >= 1 && scans.scans[0].parsed);
  const mine = scans.scans.find((x) => x.id === sc.scanId);
  eq('accuracy computed (14 tiles + 1 flower)', mine && mine.accuracy && mine.accuracy.tiles, 15);
  const exp = await admin('export');
  ok('admin export', Array.isArray(exp.games) && exp.games.some((g) => g.game.id === 'g1' + stamp));
  eq('admin migrate idempotent', (await admin('migrate')).ok, true);
  // cleanup deletes only inactive accounts: age the guest, keep the others
  await admin('cleanup');
  ok('cleanup keeps active accounts', (await rpc('me', {}, g1.token)).user);

  // photo (KV) behind the admin key
  await new Promise((r) => setTimeout(r, 300));
  const ph = await fetch(BASE + '/photo/' + sc.scanId + '.jpg?k=' + ADMIN);
  eq('photo served', [ph.status, ph.headers.get('content-type')], [200, 'image/jpeg']);
  eq('photo forbidden', (await fetch(BASE + '/photo/' + sc.scanId)).status, 403);
  // change pin, signout
  eq('changePin wrong', (await rpc('changePin', { pin: '0000', newPin: '4321' }, tok)).error, 'wrong_pin');
  eq('changePin', (await rpc('changePin', { pin: '1357', newPin: '4321' }, tok)).ok, true);
  ok('signin with new pin', (await rpc('signin', { name: name2, pin: '4321' })).token);
  eq('changePin word password ok', (await rpc('changePin', { pin: '4321', newPin: 'mahjong!Night' }, tok)).ok, true);
  ok('signin with word password', (await rpc('signin', { name: name2, pin: 'mahjong!Night' })).token);
  eq('signout', (await rpc('signout', {}, tok)).ok, true);
  eq('token dead', (await rpc('me', {}, tok)).error, 'signin_required');
  // CORS preflight
  const pre = await fetch(BASE + '/rpc', { method: 'OPTIONS', headers: { origin: 'https://example.github.io', 'access-control-request-method': 'POST' } });
  eq('preflight', [pre.status, pre.headers.get('access-control-allow-origin')], [204, '*']);
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
