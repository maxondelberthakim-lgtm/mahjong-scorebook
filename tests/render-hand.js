// Renders a known winning hand with the app's own tile faces and saves it as a JPEG "photo" for scan-pipeline checks.
//   python3 tools/build.py http://127.0.0.1:8787 && node tests/render-hand.js [out.jpg]
// Ground truth: 234m 567p 789s 111z 55z + F1 S2, won on 5z (custom-points game so any hand is accepted).
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const MJ = require('../src/engine.js');
const ROOT = path.resolve(__dirname, '..'), DOCS = path.join(ROOT, 'docs');
const OUT = process.argv[2] || path.join(ROOT, 'tests', 'shots', 'synthetic-hand.jpg');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(DOCS, p);
  if (!f.startsWith(DOCS) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
(async () => {
  await new Promise((r) => server.listen(8081, '127.0.0.1', r));
  const g = MJ.newGame({ ruleset: 'custom', players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }] });
  const tiles = { hand: MJ.parse('234m567p789s111z55z'), melds: [], win: '5z', bonus: ['F1', 'S2'] };
  MJ.recordHand(g, { outcome: 'win', winner: 1, how: 'discard', discarder: 3, tiles, value: 8, label: 'test' });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 700, height: 400 }, deviceScaleFactor: 3 });
  await page.goto('http://127.0.0.1:8081/');
  await page.evaluate((game) => { localStorage.setItem('mjsb.games.v1', JSON.stringify([game])); localStorage.setItem('mjsb.last', game.id); }, g);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.lrow .lsum');
  await page.click('.lrow .lsum');
  const el = await page.waitForSelector('.ldetail .ltiles');
  const png = await el.screenshot({ type: 'jpeg', quality: 90 });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, png);
  console.log('wrote', OUT, png.length, 'bytes; truth:', MJ.handToText(tiles));
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
