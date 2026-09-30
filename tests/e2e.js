// End-to-end: the built app (docs/) against a local worker. Needs `wrangler dev --port 8787 --local` running.
//   python3 tools/build.py http://127.0.0.1:8787 && node tests/e2e.js
// Serves docs/ itself on 127.0.0.1:8080 (no service worker there, by design).
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const API = process.env.API_URL || 'http://127.0.0.1:8787';
const ADMIN = process.env.ADMIN_KEY || 'uji-lokal';
const SHOTS = path.join(process.env.SHOTS || path.join(ROOT, 'tests', 'shots'));
fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (l, c, extra) => { if (c) pass++; else { fail++; console.log('FAIL', l, extra === undefined ? '' : JSON.stringify(extra)); } };
const eq = (l, g, w) => ok(l, JSON.stringify(g) === JSON.stringify(w), { got: g, want: w });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(DOCS, p);
  if (!f.startsWith(DOCS) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nope'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
async function admin(fn, body) {
  const r = await fetch(API + '/admin/' + fn, { method: 'POST', headers: { 'x-admin-key': ADMIN }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}
// A small JPEG so the file input has something real to chew on (the mock reader ignores the pixels).
function makeJpeg() {
  const b64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
  return Buffer.from(b64, 'base64');
}

(async () => {
  await new Promise((r) => server.listen(8080, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|googleapis|net::ERR|favicon/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const stamp = Date.now().toString(36);
  const T = (s) => page.getByText(s, { exact: false });

  // 1. no sign-in wall: the home screen invites you to set up a table straight away
  await page.goto('http://127.0.0.1:8080/', { waitUntil: 'load' });
  await page.waitForSelector('h1:has-text("Mahjong Scorebook")');
  ok('try first: set up a table without an account', await page.locator('button:has-text("Set up your table")').count() === 1);
  eq('no sign-in wall', await page.locator('button:has-text("Continue as a guest")').count(), 0);
  ok('example table (free sample)', await page.locator('.table').count() === 1);
  await page.screenshot({ path: path.join(SHOTS, '00-home-fresh.png') });

  // 2. new table (Hong Kong, 4 names, Rp 1,000 per point) — progress starts above zero
  await page.click('button:has-text("Set up your table")');
  await page.waitForSelector('text=Rules');
  ok('head start: 1 of 4 already done', /1 of 4/.test(await page.locator('.steps').innerText()));
  for (let i = 0; i < 4; i++) await page.fill('#pn' + i, ['Ah Mei', 'Budi', 'Chris', 'Dewi'][i]);
  await page.fill('#per', '1000');
  ok('progress moves with names and stakes', /3 of 4/.test(await page.locator('.steps').innerText()));
  await page.click('button:has-text("Start the table")');
  await page.waitForSelector('button:has-text("Record hand")');
  ok('game view', await page.locator('.plate').count() === 4);
  eq('no keep-nudge before any hand', await page.locator('.banner.keep').count(), 0);
  await page.screenshot({ path: path.join(SHOTS, '02-game.png') });

  // 3. record a hand by tapping tiles: 111m 222p 333s 111z 55z (all pungs), Budi wins off Dewi
  await page.click('button:has-text("Record hand")');
  await page.waitForSelector('text=Who won');
  await page.click('.chip:has-text("Budi")');
  await page.locator('.flabel:has-text("Who discarded")').waitFor();
  await page.click('.sec:has(.flabel:has-text("Who discarded")) .chip:has-text("Dewi")');
  await page.waitForSelector('.board');
  eq('board shows all 34 tiles + 8 bonus', await page.locator('.board .tile').count(), 42);
  const tap = async (tab, label) => { await page.click('.board button[aria-label="' + label + '"]'); };
  for (let k = 0; k < 3; k++) await tap('萬', '1 Characters');
  for (let k = 0; k < 3; k++) await tap('筒', '2 Dots');
  for (let k = 0; k < 3; k++) await tap('索', '3 Bamboo');
  for (let k = 0; k < 3; k++) await tap('字', 'East');
  for (let k = 0; k < 2; k++) await tap('字', 'White dragon');
  await page.waitForSelector('.counter.ok');
  // one-tap removal: tap a hand tile → 13 of 14, then re-add it
  await page.click('.zone-tiles button[aria-label="Remove 1 Characters"]');
  ok('tile removed with one tap', /13 of 14/.test(await page.locator('.counter').innerText()));
  await tap('萬', '1 Characters');
  await page.waitForSelector('.counter.ok');
  // change winning tile: pick mode → tap a tile → it becomes the winning tile
  await page.click('button:has-text("Change winning tile")');
  await page.click('.zone-tiles button[aria-label="Make winning tile: 2 Dots"]');
  ok('winning tile changed', (await page.locator('.zone-tiles .tile.is-win').getAttribute('aria-label')).includes('2 Dots'));
  const total = await page.locator('.sumv b').first().innerText();
  ok('hand evaluated (' + total + ')', /faan/.test(total));
  await page.screenshot({ path: path.join(SHOTS, '03-record.png') });
  // add-pattern list shows example tiles; the explain switch adds descriptions
  await page.click('details.addlist summary');
  await page.waitForSelector('.addrow .phelp .exrow');
  ok('example tiles under patterns', (await page.locator('.addrow .phelp .exrow').count()) >= 5);
  eq('no descriptions yet', await page.locator('.pdesc').count(), 0);
  await page.click('.addbody .switch');
  ok('descriptions shown', (await page.locator('.pdesc').count()) >= 5);
  await page.click('.addbody .switch');
  await page.click('button:has-text("Save hand")');
  await page.waitForSelector('text=Hand saved');
  ok('ledger has 1 hand', (await page.locator('.lrow').count()) === 1);
  const scores = await page.locator('.plate .ps').allInnerTexts();
  ok('scores changed', scores.some((s) => s !== '0'), scores);
  // example hands are tidy sets, no winning tile singled out
  await page.click('button:has-text("Record hand")');
  await page.click('details.addlist summary');
  await page.waitForSelector('.addrow .exrow');
  ok('examples grouped into sets', (await page.locator('.addrow .exrow .exg').count()) >= 10);
  eq('no winning-tile highlight in examples', await page.locator('.addrow .exrow .is-win').count(), 0);
  await page.click('.sheet-head button[aria-label="Close"]');

  // 3b. IKEA effect: now that a hand is in, the nudge to keep the table appears (loss-aversion wording) → guest table
  await page.waitForSelector('.banner.keep');
  ok('keep nudge names the loss', /gone/.test(await page.locator('.banner.keep').innerText()));
  await page.screenshot({ path: path.join(SHOTS, '03b-keep-nudge.png') });
  await page.click('button:has-text("Keep this table")');
  await page.waitForSelector('#si-name');
  await page.click('.seg button:has-text("Guest")');
  await page.waitForSelector('button:has-text("New guest table")');
  await page.click('button:has-text("New guest table")');
  await page.waitForSelector('text=Your guest id is');
  const guestToast = await page.locator('.toast').innerText();
  const guestId = (guestToast.match(/guest id is ([A-Z2-9]{6})/) || [])[1];
  ok('guest id shown', !!guestId, guestToast);
  ok('still on the game after keeping it', await page.locator('button:has-text("Record hand")').count() === 1);
  eq('keep nudge gone once kept', await page.locator('.banner.keep').count(), 0);
  // smart defaults: a second table is pre-filled from the first
  await page.click('.backbtn');
  ok('home renders', await page.locator('button:has-text("New game")').count() === 1);
  await page.waitForFunction(() => /Guest table/.test(document.querySelector('.store-note').textContent), null, { timeout: 10000 });
  ok('store note names guest table', /Guest table/.test(await page.locator('.store-note').innerText()));
  await page.screenshot({ path: path.join(SHOTS, '01-home.png') });
  await page.click('button:has-text("New game")');
  await page.waitForSelector('#pn0');
  eq('smart defaults: names pre-filled', await page.inputValue('#pn1'), 'Budi');
  eq('smart defaults: stakes pre-filled', await page.inputValue('#per'), '1000');
  ok('head start with defaults: 3 of 4', /3 of 4/.test(await page.locator('.steps').innerText()));
  await page.click('.backbtn');
  await page.click('.gcard');
  await page.waitForSelector('button:has-text("Record hand")');

  // 4. the guest game is in the cloud; a second "phone" joins with the guest id; then create a real account
  await new Promise((r) => setTimeout(r, 1200));
  const exp1 = await admin('export');
  const mine = exp1.games.filter((g) => exp1.users.find((u) => u.id === g.userId && u.name === 'guest-' + guestId));
  eq('guest game uploaded', mine.length, 1);
  eq('uploaded hand count', mine[0].game.entries.length, 1);
  const gid = mine[0].game.id;
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await ctx2.newPage();
  await p2.goto('http://127.0.0.1:8080/', { waitUntil: 'load' });
  await p2.click('button:has-text("Sign in")');
  await p2.click('.seg button:has-text("Guest")');
  await p2.fill('#gj', guestId.toLowerCase());
  await p2.click('button:has-text("Join")');
  await p2.waitForSelector('.gcard', { timeout: 10000 });
  eq('second phone sees the guest game', await p2.locator('.gcard').count(), 1);
  await ctx2.close();
  // account sheet shows the guest id and the 7-day notice
  await page.click('.backbtn');
  await page.click('button:has-text("Guest ' + guestId + '")');
  await page.waitForSelector('.guestbox');
  ok('guest id in account sheet', (await page.locator('.guestbox b').innerText()) === guestId);
  ok('7-day notice', /7 days/.test(await page.locator('.sheet-body').innerText()));
  await page.screenshot({ path: path.join(SHOTS, '04-guest-account.png') });
  await page.click('.menu button:has-text("Sign out")');
  await page.click('.sec button:has-text("Sign out")');
  await page.waitForSelector('button:has-text("Set up your table")');
  await page.click('button:has-text("Sign in")');
  await page.waitForSelector('#si-name');
  await page.click('.seg button:has-text("New account")');
  await page.fill('#si-name', 'E2E ' + stamp);
  await page.fill('#si-pin', 'pass 2468');
  eq('password with space rejected client-side', await page.locator('.sheet-foot button:has-text("Create account")').isDisabled(), true);
  await page.fill('#si-pin', 'table2468');
  await page.click('.sheet-foot button:has-text("Create account")');
  await page.waitForSelector('text=Signed in as E2E');
  // import the guest game into this account by JSON later; for now this account has no games
  eq('fresh account has no games', await page.locator('.gcard').count(), 0);
  // import the exported guest game so the rest of the flow has a game
  const gpath = path.join(SHOTS, 'guest-game.json');
  fs.writeFileSync(gpath, JSON.stringify(mine[0].game));
  await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles(gpath);
  await page.waitForSelector('text=Imported 1 game');
  await page.waitForFunction(() => /saved to your account/.test(document.querySelector('.store-note').textContent), null, { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 800));
  const expA = await admin('export');
  const acctGames = expA.games.filter((g) => !g.deleted && expA.users.find((u) => u.id === g.userId && u.name === 'E2E ' + stamp));
  eq('imported game re-id’d into the new account', acctGames.length, 1);
  ok('and it kept its hand', acctGames[0].game.entries.length === 1 && acctGames[0].game.id !== gid);
  await page.screenshot({ path: path.join(SHOTS, '04-signed-in.png') });

  const gid2 = acctGames[0].game.id;
  // 5. photo scan (mock reader) → tiles filled → save → correction logged
  await page.click('.gcard');
  await page.waitForSelector('button:has-text("Record hand")');
  await page.click('button:has-text("Record hand")');
  await page.click('.chip:has-text("Chris")');
  await page.click('.sec:has(.flabel:has-text("Who discarded")) .chip:has-text("Ah Mei")');
  const jpg = path.join(SHOTS, 'hand.jpg');
  fs.writeFileSync(jpg, makeJpeg());
  const inputs = page.locator('input[type=file][accept="image/*"]');
  eq('two photo inputs (camera + library)', await inputs.count(), 2);
  eq('camera input captures', await inputs.first().getAttribute('capture'), 'environment');
  await inputs.nth(1).setInputFiles(jpg);
  await page.waitForSelector('text=Tiles filled in', { timeout: 20000 });
  await page.waitForSelector('.counter.ok');
  ok('scan filled 14 tiles', /14 of 14/.test(await page.locator('.counter').innerText()));
  ok('scan tag from the tiles', (await page.locator('.rname .tag').count()) >= 1);
  await page.screenshot({ path: path.join(SHOTS, '05-scan.png') });
  // fix one tile: remove the last tile and add a different one → the correction is logged
  await page.click('button:has-text("Save hand")');
  await page.waitForSelector('text=Hand saved');
  await new Promise((r) => setTimeout(r, 800));
  const scans = await admin('scans', { limit: 5 });
  const sc = scans.scans.find((x) => x.game_id === gid2);
  ok('scan row stored with parsed tiles', sc && sc.parsed && sc.status === 'ok', sc && sc.status);
  ok('correction (final) logged', sc && sc.final && sc.final.length > 10, sc && sc.final);
  ok('accuracy summary', scans.summary.compared >= 1 && scans.summary.tileAccuracy != null, scans.summary);

  // 6. standings: settle up + export
  await page.click('button[aria-label="Game menu"]');
  await page.click('.menu button:has-text("Standings")');
  await page.waitForSelector('text=Settle up');
  const trows = await page.locator('.trow').count();
  ok('settlement rows', trows >= 1 && trows <= 3, trows);
  ok('settlement in Rupiah', /Rp/.test(await page.locator('.trow .ta').first().innerText()));
  ok('export buttons', (await page.locator('button:has-text("Full backup (JSON)")').count()) === 1);
  const dlr = page.waitForEvent('download');
  await page.click('button:has-text("Save recap image")');
  const recap = await dlr; const recapPath = path.join(SHOTS, 'recap.png'); await recap.saveAs(recapPath);
  ok('recap png saved', fs.statSync(recapPath).size > 20000, fs.statSync(recapPath).size);
  const dl = page.waitForEvent('download');
  await page.click('button:has-text("Full backup (JSON)")');
  const d = await dl;
  const backupPath = path.join(SHOTS, 'backup.json');
  await d.saveAs(backupPath);
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  eq('backup is the game', [backup.id, backup.entries.length], [gid2, 2]);
  await page.screenshot({ path: path.join(SHOTS, '06-standings.png') });
  await page.click('.sheet-head button[aria-label="Close"]');

  // 7. undo
  await page.click('button:has-text("Undo last entry")');
  await page.click('.sheet-foot button:has-text("Undo")');
  await page.waitForSelector('text=Removed the last entry');
  eq('ledger back to 1', await page.locator('.lrow').count(), 1);

  // 8. reload keeps the session and the game, and the cloud copy matches
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('button:has-text("Record hand")');
  eq('ledger after reload', await page.locator('.lrow').count(), 1);
  await page.waitForFunction(() => !/Saving/.test(document.body.textContent), null, { timeout: 10000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));
  const exp2 = await admin('export');
  eq('cloud copy has 1 hand after undo', exp2.games.find((g) => g.game.id === gid2).game.entries.length, 1);

  // 9. sign out removes cloud copies here; sign in brings them back
  await page.click('.backbtn');
  await page.click('button:has-text("E2E ' + stamp + '")');
  await page.click('.menu button:has-text("Sign out")');
  await page.click('.sec button:has-text("Sign out")');
  await page.waitForSelector('button:has-text("Set up your table")');
  eq('cloud games leave this device after sign-out', await page.locator('.gcard').count(), 0);
  await page.click('button:has-text("Sign in")');
  await page.waitForSelector('#si-name');
  await page.fill('#si-name', 'E2E ' + stamp);
  await page.fill('#si-pin', 'table2468');
  await page.click('.sheet-foot button:has-text("Sign in")');
  await page.waitForSelector('text=Signed in as E2E');
  await page.waitForSelector('.gcard', { timeout: 10000 });
  eq('game back after sign-in', await page.locator('.gcard').count(), 1);

  // 10. import a backup (new id) → one more game
  backup.id = 'imp' + stamp; backup.updatedAt = Date.now();
  fs.writeFileSync(backupPath, JSON.stringify(backup));
  await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles(backupPath);
  await page.waitForSelector('text=Imported 1 game');
  eq('two game cards', await page.locator('.gcard').count(), 2);
  await new Promise((r) => setTimeout(r, 1500));
  const exp3 = await admin('export');
  ok('imported game uploaded', exp3.games.some((g) => g.game.id === 'imp' + stamp));

  // 10b. lite build: no photo buttons, board present
  await page.goto('http://127.0.0.1:8080/lite/', { waitUntil: 'load' });
  await page.waitForSelector('.hero, .topbar');
  ok('lite title', /Lite/.test(await page.title()));
  if (!(await page.locator('.backbtn').count())) await page.click('.gcard');   // same origin: it may reopen the last game
  await page.click('button:has-text("Record hand")');
  await page.waitForSelector('.board');
  eq('lite has no photo inputs', await page.locator('input[type=file][accept="image/*"]').count(), 0);
  eq('lite has no scan buttons', await page.locator('button:has-text("Take photo")').count(), 0);
  await page.click('.sheet-head button[aria-label="Close"]');
  await page.click('.backbtn');

  // 10c. branded copies
  for (const [folder, brand] of [['parlour', 'Mahjong Parlour'], ['kawa', 'Kawa Mahjong']]) {
    await page.goto('http://127.0.0.1:8080/' + folder + '/', { waitUntil: 'load' });
    await page.waitForSelector('.hero, .topbar');
    eq(folder + ' title', await page.title(), brand);
    if (await page.locator('.backbtn').count()) await page.click('.backbtn');
    ok(folder + ' h1', (await page.locator('h1').innerText()).startsWith(brand));
    eq(folder + ' no photo buttons', await page.locator('button:has-text("Take photo")').count(), 0);
    const man = await (await fetch('http://127.0.0.1:8080/' + folder + '/manifest.webmanifest')).json();
    eq(folder + ' manifest name', man.name, brand);
  }

  // 11. dark theme snapshot + manifest + sw present
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: path.join(SHOTS, '07-home-dark.png') });
  const man = await (await fetch('http://127.0.0.1:8080/manifest.webmanifest')).json();
  eq('manifest', man.display, 'standalone');
  eq('sw served', (await fetch('http://127.0.0.1:8080/sw.js')).status, 200);

  eq('no console errors', errors, []);
  await browser.close();
  server.close();
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
