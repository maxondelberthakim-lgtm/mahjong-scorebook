// Engine tests: node test.js
const MJ = require('./engine.js');
let pass = 0, fail = 0;
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.log('FAIL', label, '\n   got ', g, '\n   want', w); }
}
function hand(str, win, melds, bonus) {
  return { hand: MJ.parse(str), melds: melds || [], win, bonus: bonus || [] };
}
function game(ruleset, settings, values) {
  return MJ.newGame({ ruleset, players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }], settings, values });
}
function effOf(r) { const o = {}; Object.keys(r.eff).sort().forEach((k) => (o[k] = r.eff[k])); return o; }

/* ---------------- Hong Kong ---------------- */
{
  const g = game('hk');
  // a) all chows + no flowers = 2 faan < 3 minimum
  let r = MJ.evaluate(g, { outcome: 'win', winner: 1, how: 'discard', discarder: 2, tiles: hand('234m567m345p678s22p', '8s') });
  eq('hk a patterns', effOf(r), { allChows: 1, noFlowers: 1 });
  eq('hk a valid', r.valid, false);

  // b) mixed one suit + white pung + self-draw + no flowers = 6 faan → 32 pts, each pays 16
  r = MJ.evaluate(g, { outcome: 'win', winner: 0, how: 'self', tiles: hand('123456777p555z11z', '1z') });
  eq('hk b patterns', effOf(r), { dragonPung: 1, mixedSuit: 1, noFlowers: 1, selfDraw: 1 });
  eq('hk b faan', r.score, 6);
  eq('hk b deltas', r.deltas, [48, -16, -16, -16]);

  // c) small three dragons (two exposed dragon pungs) + mixed one suit + no flowers = 9 faan, full-gun → discarder pays 96
  r = MJ.evaluate(g, { outcome: 'win', winner: 2, how: 'discard', discarder: 3, tiles: hand('123456m77z', '7z', [{ type: 'pon', tile: '5z' }, { type: 'pon', tile: '6z' }]) });
  eq('hk c patterns', effOf(r), { mixedSuit: 1, noFlowers: 1, smallDragons: 1 });
  eq('hk c faan', r.score, 9);
  eq('hk c deltas', r.deltas, [0, 0, 96, -96]);

  // c2) same hand, half-gun: discarder 48, others 24
  const g2 = game('hk', { pay: 'half' });
  r = MJ.evaluate(g2, { outcome: 'win', winner: 2, how: 'discard', discarder: 3, tiles: hand('123456m77z', '7z', [{ type: 'pon', tile: '5z' }, { type: 'pon', tile: '6z' }]) });
  eq('hk c2 half-gun', r.deltas, [-24, -24, 96, -48]);

  // d) thirteen orphans → limit (10 faan = 128)
  r = MJ.evaluate(g, { outcome: 'win', winner: 1, how: 'discard', discarder: 0, tiles: hand('19m19p19s1234567z1m', '1m') });
  eq('hk d orphans', [r.score, r.eff.thirteenOrphans, r.deltas[1]], [10, 1, 128]);

  // e) seven pairs is off by default, allowed with a value
  r = MJ.evaluate(g, { outcome: 'win', winner: 1, how: 'self', tiles: hand('1122m3344p5566s77z', '7z') });
  eq('hk e off', r.valid, false);
  const g3 = game('hk', {}, { sevenPairs: 4 });
  r = MJ.evaluate(g3, { outcome: 'win', winner: 1, how: 'self', tiles: hand('1122m3344p5566s77z', '7z') });
  eq('hk e on', [effOf(r), r.score], [{ noFlowers: 1, selfDraw: 1, sevenPairs: 1 }, 6]);

  // f) seat flower + flower set; seat South = player 1 when dealer is 0
  r = MJ.evaluate(g, { outcome: 'win', winner: 1, how: 'self', tiles: hand('123456777p555z11z', '1z', [], ['F1', 'F2', 'F3', 'F4', 'S2']) });
  eq('hk f flowers', [r.eff.flowerSet, r.eff.seatFlower, r.eff.noFlowers], [1, 1, undefined]);

  // g) half-spicy table
  eq('hk table', [0, 3, 4, 5, 6, 7, 8, 9, 10, 13].map((f) => MJ.hkPoints(f, 'half')), [1, 8, 16, 24, 32, 48, 64, 96, 128, 384]);

  // h) all concealed pungs, self-drawn → limit
  r = MJ.evaluate(g, { outcome: 'win', winner: 0, how: 'self', tiles: hand('111m333p555s777m99p', '9p') });
  eq('hk h fourConcealed', [r.eff.fourConcealed, r.score], [1, 10]);

  // i) seat + round wind pungs when East seat in East round → 2 faan
  r = MJ.evaluate(g, { outcome: 'win', winner: 0, how: 'discard', discarder: 1, tiles: hand('123m456p789s111z99s', '9s') });
  eq('hk i winds', [r.eff.seatWind, r.eff.roundWind], [1, 1]);

  // j) manual mode: tick patterns without tiles
  r = MJ.evaluate(g, { outcome: 'win', winner: 3, how: 'discard', discarder: 0, manual: { pureSuit: 1, noFlowers: 1 } });
  eq('hk j manual', [r.score, r.deltas], [8, [-64, 0, 0, 64]]);
}

/* ---------------- Singapore ---------------- */
{
  const g = game('sg');
  let r = MJ.evaluate(g, { outcome: 'win', winner: 1, how: 'discard', discarder: 2, tiles: hand('234m567m345p678s22p', '8s') });
  eq('sg ping hu', [effOf(r), r.score, r.deltas], [{ pingHu: 1 }, 4, [-8, 32, -16, -8]]);
  r = MJ.evaluate(g, { outcome: 'win', winner: 1, how: 'discard', discarder: 2, tiles: hand('234m567m345p678s22p', '8s', [], ['F2']) });
  eq('sg all chows + seat flower', [effOf(r), r.score], [{ allChows: 1, seatFlower: 1 }, 2]);
  r = MJ.evaluate(g, { outcome: 'win', winner: 1, how: 'discard', discarder: 2, tiles: hand('234m567m345p678s22p', '7s') });
  eq('sg closed wait breaks ping hu', effOf(r), { allChows: 1 });
  r = MJ.evaluate(g, { outcome: 'win', winner: 1, how: 'self', tiles: hand('234m567m345p678s22p', '7s', [], ['A1', 'A2']) });
  eq('sg animals self-draw', [effOf(r), r.score, r.deltas], [{ allChows: 1, animal: 2, concealedSelfDraw: 1, selfDraw: 1 }, 3, [-8, 24, -8, -8]]);
  r = MJ.evaluate(g, { outcome: 'win', winner: 1, how: 'discard', discarder: 0, tiles: hand('123456m77z', '7z', [{ type: 'pon', tile: '5z' }, { type: 'pon', tile: '6z' }]) });
  eq('sg small dragons', [effOf(r), r.score], [{ dragonPung: 2, mixedSuit: 1, smallDragons: 1 }, 5]);
  const g2 = game('sg', { pay: 'all' });
  r = MJ.evaluate(g2, { outcome: 'win', winner: 1, how: 'discard', discarder: 2, tiles: hand('234m567m345p678s22p', '8s') });
  eq('sg shooter pays all', r.deltas, [0, 32, -32, 0]);
}

/* ---------------- Riichi ---------------- */
{
  const g = game('riichi');
  // riichi pinfu tanyao, 3 han 30 fu, non-dealer ron = 3900
  let r = MJ.evaluate(g, { outcome: 'win', winner: 1, how: 'discard', discarder: 2, tiles: hand('234m567m345p678s22p', '8s'), riichi: { declared: [1], dora: 0 } });
  eq('riichi a yaku', effOf(r), { pinfu: 1, riichi: 1, tanyao: 1 });
  eq('riichi a hanfu', [r.han, r.fu, r.deltas], [3, 30, [0, 3900, -3900, 0]]);
  // + 1 dora = 7700
  r = MJ.evaluate(g, { outcome: 'win', winner: 1, how: 'discard', discarder: 2, tiles: hand('234m567m345p678s22p', '8s'), riichi: { declared: [1], dora: 1 } });
  eq('riichi b 4han30fu', r.deltas[1], 7700);
  // chiitoitsu riichi tsumo, non-dealer: 4 han 25 fu → 1600 / 3200 (+1000 stick back)
  r = MJ.evaluate(g, { outcome: 'win', winner: 1, how: 'self', tiles: hand('1122m3344p5566s77z', '7z'), riichi: { declared: [1] } });
  eq('riichi c chiitoi', [effOf(r), r.han, r.fu, r.deltas], [{ chiitoitsu: 1, menzenTsumo: 1, riichi: 1 }, 4, 25, [-3200, 6400, -1600, -1600]]);
  // open chun pon, tanki on 5s, 1 han 30 fu → 1000
  r = MJ.evaluate(g, { outcome: 'win', winner: 2, how: 'discard', discarder: 3, tiles: hand('234m567p888s55s', '5s', [{ type: 'pon', tile: '7z' }]) });
  eq('riichi d yakuhai', [effOf(r), r.han, r.fu, r.deltas[2]], [{ chun: 1 }, 1, 30, 1000]);
  // no yaku
  r = MJ.evaluate(g, { outcome: 'win', winner: 2, how: 'discard', discarder: 3, tiles: hand('234m567p888s55s', '5s', [{ type: 'pon', tile: '9m' }]), riichi: { dora: 3 } });
  eq('riichi e no yaku', r.valid, false);
  // kokushi, dealer ron = 48000
  r = MJ.evaluate(g, { outcome: 'win', winner: 0, how: 'discard', discarder: 1, tiles: hand('19m19p19s1234567z9s', '9s') });
  eq('riichi f kokushi dealer', [r.ym, r.deltas[0]], [1, 48000]);
  // honba 2 on a 3900 ron → 4500
  const g2 = game('riichi');
  g2.state.honba = 2; g2.state.pot = 2000;
  r = MJ.evaluate(g2, { outcome: 'win', winner: 1, how: 'discard', discarder: 2, tiles: hand('234m567m345p678s22p', '8s'), riichi: { declared: [1] } });
  eq('riichi g honba + pot', r.deltas, [0, 4500 - 1000 + 3000, -4500, 0]);
  // dealer tsumo mangan: chinitsu open? use menzen riichi tsumo pinfu tanyao + 2 dora = 6 han? → haneman 6000 all
  r = MJ.evaluate(g, { outcome: 'win', winner: 0, how: 'self', tiles: hand('234m567m345p678s22p', '8s'), riichi: { declared: [0], dora: 2 } });
  eq('riichi h haneman dealer tsumo', [r.han, r.deltas], [6, [18000 - 1000 + 1000, -6000, -6000, -6000]]);
  // exhaustive draw: 1 tenpai, riichi stick goes to pot
  r = MJ.evaluate(g, { outcome: 'draw', draw: { tenpai: [2] }, riichi: { declared: [2] } });
  eq('riichi i draw', [r.deltas, r.pot], [[-1000, -1000, 2000, -1000], 1000]);
  // kan fu: closed kan of 1z (seat/round East for dealer) + ...
  const k = MJ.evaluate(g, { outcome: 'win', winner: 0, how: 'discard', discarder: 1, tiles: hand('234m567p678s55s', '5s', [{ type: 'kan', tile: '1z', concealed: true }]), riichi: { declared: [0] } });
  // fu: 20 + 10 menzen ron + 32 closed honor kan + 2 tanki = 64 → 70; han: riichi 1 + seat 1 + round 1 = 3 → 70fu 3 han base 2240 → mangan 2000 → dealer ron 12000
  eq('riichi j kan fu', [k.fu, k.han, k.deltas[0]], [70, 3, 12000 - 1000 + 1000]);
  // manual: 2 han 40 fu, non-dealer ron = 2600
  r = MJ.evaluate(g, { outcome: 'win', winner: 3, how: 'discard', discarder: 1, manual: { yakuhaiSeat: 1, haku: 1 }, riichi: { fu: 40, closed: false } });
  eq('riichi k manual', [r.han, r.fu, r.deltas[3]], [2, 40, 2600]);
}

/* ---------------- Taiwanese ---------------- */
{
  const g = game('tw');
  // concealed + single wait on 9p (tanki), discard, non-dealer: 2 tai → 30 + 20 = 50
  let r = MJ.evaluate(g, { outcome: 'win', winner: 1, how: 'discard', discarder: 2, tiles: hand('123456789m234p567s99p', '9p') });
  eq('tw a', [effOf(r), r.score, r.deltas], [{ concealed: 1, singleWait: 1 }, 2, [0, 50, -50, 0]]);
  // dealer self-draw with streak 1 → dealer tai 3; concealed self-draw 3 + single wait 1 = 4 → each pays 30 + 10*(4+3) = 100
  g.state.streak = 1;
  r = MJ.evaluate(g, { outcome: 'win', winner: 0, how: 'self', tiles: hand('123456789m234p567s99p', '9p') });
  eq('tw b dealer streak', [effOf(r), r.deltas], [{ concealedSelfDraw: 1, singleWait: 1 }, [300, -100, -100, -100]]);
  // non-dealer self-draw: dealer pays extra
  g.state.streak = 0;
  r = MJ.evaluate(g, { outcome: 'win', winner: 2, how: 'self', tiles: hand('123456789m234p567s99p', '9p') });
  eq('tw c dealer pays more', r.deltas, [-80, -70, 220, -70]);
  // ping hu: two-sided wait, discard, no flowers/honours
  r = MJ.evaluate(g, { outcome: 'win', winner: 1, how: 'discard', discarder: 3, tiles: hand('123456789m234p567s88p', '7s') });
  eq('tw d ping hu', effOf(r), { concealed: 1, pingHu: 1 });
}

/* ---------------- Chinese Official ---------------- */
{
  const g = game('mcr');
  let r = MJ.evaluate(g, { outcome: 'win', winner: 2, how: 'self', manual: { fullFlush: 1, allPungs: 1 } });
  eq('mcr self', [r.score, r.deltas], [31, [-39, -39, 117, -39]]);
  r = MJ.evaluate(g, { outcome: 'win', winner: 2, how: 'self', manual: { fullyConcealed: 1, allPungs: 1 } });
  eq('mcr exclusion', [effOf(r), r.score], [{ allPungs: 1, fullyConcealed: 1 }, 10]);
  r = MJ.evaluate(g, { outcome: 'win', winner: 2, how: 'discard', discarder: 0, manual: { allPungs: 1, flowers: 3 } });
  eq('mcr below 8', r.valid, false);
  eq('mcr count', MJ.RULES.mcr.patterns.length, 81);
}

/* ---------------- Rotation & ledger ---------------- */
{
  const g = game('hk');
  MJ.recordHand(g, { outcome: 'win', winner: 0, how: 'self', manual: { pureSuit: 1 } });
  eq('rot dealer keeps', [g.state.dealer, g.state.streak, g.state.round], [0, 1, 0]);
  MJ.recordHand(g, { outcome: 'win', winner: 2, how: 'discard', discarder: 0, manual: { mixedSuit: 1 } });
  eq('rot passes', [g.state.dealer, g.state.streak], [1, 0]);
  MJ.recordHand(g, { outcome: 'draw' });
  eq('rot draw keeps', [g.state.dealer, g.state.streak], [1, 1]);
  for (const w of [2, 3, 0]) MJ.recordHand(g, { outcome: 'win', winner: (w + 1) % 4, how: 'discard', discarder: w, manual: { mixedSuit: 1 } });
  eq('rot round advances', [g.state.dealer, g.state.round, MJ.roundLabel(g)], [0, 1, 'South 1']);
  const t = MJ.totals(g);
  eq('ledger sums to zero', t.reduce((a, b) => a + b, 0), 0);
  MJ.undo(g);
  eq('undo restores state', [g.state.dealer, g.state.round], [3, 0]);
  const gr = game('riichi');
  MJ.recordHand(gr, { outcome: 'draw', draw: { tenpai: [1] }, riichi: { declared: [1] } });
  eq('riichi rot noten dealer passes', [gr.state.dealer, gr.state.honba, gr.state.pot], [1, 1, 1000]);
  MJ.recordHand(gr, { outcome: 'win', winner: 1, how: 'discard', discarder: 3, tiles: hand('234m567m345p678s22p', '8s'), riichi: { declared: [1] } });
  eq('riichi rot dealer wins', [gr.state.dealer, gr.state.honba, gr.state.pot], [1, 2, 0]);
  const st = MJ.standings(gr);
  eq('riichi standings first', st[0].p, 1);
}

/* ---------------- Scan parsing ---------------- */
{
  const R = MJ.RULES.hk;
  const s = MJ.parseScan({ hand: ['1m', '2m', '3m', '4P', '5p', '6p', '7s', '8s', '9s', 'f2', '1z', '1z'], melds: [{ type: 'pung', tiles: ['5z', '5z', '5z'] }], bonus: ['F1'], win: '9s', redFives: 1 }, R);
  eq('scan tiles', [s.tiles.hand.length, s.tiles.melds, s.tiles.bonus, s.tiles.win, s.redFives], [11, [{ type: 'pon', tile: '5z' }], ['F2', 'F1'], '9s', 1]);
  const s2 = MJ.parseScan({ hand: ['1m', '2m', '3m'], melds: [{ type: 'chow', tiles: ['4p', '3p', '2p'] }, { type: 'kong', tiles: ['7z', '7z', '7z', '7z'], concealed: true }] }, R);
  eq('scan melds', s2.tiles.melds, [{ type: 'chi', tile: '2p' }, { type: 'kan', tile: '7z', concealed: true }]);
  eq('scan default win', s2.tiles.win, '3m');
  eq('check hand', MJ.checkHand(hand('123m456p789s11z', '1z'), 13).problems, ['Add 3 tiles (11 of 14).']);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
