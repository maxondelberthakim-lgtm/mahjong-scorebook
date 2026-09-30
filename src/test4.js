// Chinese Official (MCR): every fan read from the tiles. node test4.js
const MJ = require('./engine.js');
let pass = 0, fail = 0;
const eq = (l, g, w) => { const a = JSON.stringify(g), b = JSON.stringify(w); if (a === b) pass++; else { fail++; console.log('FAIL', l, '\n   got ', a, '\n   want', b); } };
const ok = (l, c, x) => { if (c) pass++; else { fail++; console.log('FAIL', l, x === undefined ? '' : JSON.stringify(x)); } };
const game = (settings) => MJ.newGame({ ruleset: 'mcr', players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }], settings: settings || {} });
const hand = (s, win, melds, bonus) => ({ hand: MJ.parse(s), win, melds: melds || [], bonus: bonus || [] });
const effOf = (r) => { const o = {}; Object.keys(r.eff).sort().forEach((k) => (o[k] = r.eff[k])); return o; };
// winner 1 (South seat, dealer 0 → seat 1), round 0 (East prevalent)
const ev = (tiles, how, extra) => MJ.evaluate(game(), Object.assign({ outcome: 'win', winner: 1, how: how || 'discard', discarder: 3, tiles }, extra || {}));

let r;
// 88: big four winds (winds pungs ×4 + pair) — implies big three winds, all pungs, seat/prevalent, 幺九刻
r = ev(hand('111z222z333z444z55m', '5m'));
eq('bigFourWinds (won on the pair: all four pungs concealed)', effOf(r), { bigFourWinds: 1, fourConcealedPungs: 1, halfFlush: 1, singleWait: 1 });
eq('bigFourWinds fan', r.score, 88 + 64 + 6 + 1);
r = ev(hand('111z222z333z444z55m', '4z'));
eq('bigFourWinds won on a pung (still 门前清: no melds)', effOf(r), { bigFourWinds: 1, concealedHand: 1, halfFlush: 1, threeConcealedPungs: 1 });
// 88: big three dragons
r = ev(hand('555z666z777z123m55p', '7z'));
eq('bigThreeDragons', effOf(r), { bigThreeDragons: 1, concealedHand: 1, oneVoidedSuit: 1, twoConcealedPungs: 1 });
// 88: all green
r = ev(hand('234s234s666s888s66z', '6z'));
ok('allGreen', r.eff.allGreen === 1 && r.eff.halfFlush === 1 && r.eff.pureDoubleChow === 1, effOf(r));
// 88: nine gates (win on 5)
r = ev(hand('11123456789995m', '5m'));
ok('nineGates', r.eff.nineGates === 1 && !r.eff.fullFlush && !r.eff.concealedHand, effOf(r));
// 88: seven shifted pairs
r = ev(hand('11223344556677m', '7m'));
eq('sevenShiftedPairs', effOf(r), { sevenShiftedPairs: 1 });
// 88: thirteen orphans
r = ev(hand('19m19p19s12345677z', '7z'));
eq('thirteenOrphans', effOf(r), { thirteenOrphans: 1 });
// 64: all terminals
r = ev(hand('111m999m111p999p99s', '9p'));
eq('allTerminals', effOf(r), { allTerminals: 1, concealedHand: 1, threeConcealedPungs: 1 });
// 64: little four winds + all honours? no: winds + pair wind + one suited pung
r = ev(hand('111z222z333z44z555m', '5m'));
ok('littleFourWinds', r.eff.littleFourWinds === 1 && r.eff.allPungs === 1 && r.eff.halfFlush === 1 && !r.eff.bigThreeWinds, effOf(r));
// 64: all honours
r = ev(hand('111z222z555z666z77z', '7z'));
ok('allHonors', r.eff.allHonors === 1 && r.eff.prevalentWind === 1 && r.eff.seatWind === 1 && r.eff.littleThreeDragons === 1 && !r.eff.allPungs && !r.eff.twoDragonPungs, effOf(r));
// 64: four concealed pungs (self-draw so the last pung stays concealed)
r = ev(hand('111m222p333s444m55z', '5z'), 'self');
ok('fourConcealedPungs', r.eff.fourConcealedPungs === 1 && !r.eff.allPungs && !r.eff.concealedHand && r.eff.fullyConcealed === 1 && !r.eff.selfDrawn && r.eff.singleWait === 1 && r.eff.mixedShiftedPungs === 1, effOf(r));
// 64: pure terminal chows
r = ev(hand('112233778899m55m', '5m'));
ok('pureTerminalChows', r.eff.pureTerminalChows === 1 && !r.eff.fullFlush && !r.eff.allChows, effOf(r));
// 48: quadruple chow
r = ev(hand('123m123m123m123m55z', '5z'));
ok('quadrupleChow', r.eff.quadrupleChow === 1 && !r.eff.pureTripleChow && !r.eff.tileHog, effOf(r));
// 48: four pure shifted pungs
r = ev(hand('111m222m333m444m55p', '5p'));
ok('fourPureShiftedPungs', r.eff.fourPureShiftedPungs === 1 && !r.eff.allPungs && r.eff.oneVoidedSuit === 1, effOf(r));
// 32: four pure shifted chows (step 2)
r = ev(hand('123m345m567m789m11p', '1p'));
ok('fourPureShiftedChows', r.eff.fourPureShiftedChows === 1 && !r.eff.shortStraight && !r.eff.twoTerminalChows, effOf(r));
// 32: three kongs
r = ev(hand('55z', '5z', [{ type: 'kan', tile: '1m' }, { type: 'kan', tile: '2p' }, { type: 'kan', tile: '3s', concealed: true }, { type: 'pon', tile: '7z' }]));
ok('threeKongs', r.eff.threeKongs === 1 && r.eff.allPungs === 1 && !r.eff.concealedKong && !r.eff.meldedKong && r.eff.dragonPung === 1, effOf(r));
// 32: all terminals and honours
r = ev(hand('111m999p111s111z99s', '9s'));
ok('allTerminalsHonors', r.eff.allTerminalsHonors === 1 && !r.eff.allPungs && !r.eff.outsideHand && r.eff.prevalentWind === 1, effOf(r));
// 24: seven pairs (+ all simples)
r = ev(hand('22m33p44s55m66p77s88m', '8m'));
eq('sevenPairs', effOf(r), { allSimples: 1, sevenPairs: 1 });
// 24: greater honours and knitted
r = ev(hand('147m258p9s1234567z', '7z'));
eq('greaterHonorsKnitted', effOf(r), { greaterHonorsKnitted: 1 });
// 12: lesser honours and knitted (with 5 honours)
r = ev(hand('147m258p369s12356z', '6z'));
eq('lesserHonorsKnitted', effOf(r), { lesserHonorsKnitted: 1 });
// 24: all even pungs
r = ev(hand('222m444p666s888m22p', '2p'));
ok('allEvenPungs', r.eff.allEvenPungs === 1 && !r.eff.allPungs && !r.eff.allSimples && r.eff.fourConcealedPungs === 1, effOf(r));
// 24: full flush + pure straight
r = ev(hand('123456789m234m55m', '5m'));
ok('fullFlush + pureStraight', r.eff.fullFlush === 1 && r.eff.pureStraight === 1 && !r.eff.noHonors && r.eff.allChows === 1, effOf(r));
// 24: pure triple chow
r = ev(hand('123m123m123m789p55z', '5z'));
ok('pureTripleChow read as the higher-scoring shifted pungs', (r.eff.pureTripleChow === 1 || r.eff.pureShiftedPungs === 1) && !r.eff.pureDoubleChow && r.score >= 24, effOf(r));
r = ev(hand('123m123m123m789p55z', '2m'));
ok('pureTripleChow (won on 2, pung reading is open so chows score more)', r.eff.pureTripleChow === 1 || r.eff.pureShiftedPungs === 1, effOf(r));
// 24: pure shifted pungs
r = ev(hand('222m333m444m789p55z', '5z'));
ok('pureShiftedPungs', r.eff.pureShiftedPungs === 1 && r.eff.allPungs === undefined, effOf(r));
// 24: upper / middle / lower tiles
r = ev(hand('789m789p789s777m99s', '9s'));
ok('upperTiles', r.eff.upperTiles === 1 && r.eff.mixedTripleChow === 1 && !r.eff.upperFour, effOf(r));
r = ev(hand('456m456p456s444m55s', '5s'));
ok('middleTiles', r.eff.middleTiles === 1 && !r.eff.allSimples, effOf(r));
// 16: three-suited terminal chows
r = ev(hand('123m789m123p789p55s', '5s'));
ok('threeSuitedTerminalChows', r.eff.threeSuitedTerminalChows === 1 && !r.eff.allChows && !r.eff.mixedDoubleChow, effOf(r));
// 16: pure shifted chows (step 1)
r = ev(hand('123m234m345m789p55z', '5z'));
ok('pureShiftedChows', r.eff.pureShiftedChows === 1, effOf(r));
// 16: all fives
r = ev(hand('345m456p567s555m55p', '5p'));
ok('allFives', r.eff.allFives === 1 && !r.eff.allSimples, effOf(r));
// 16: triple pung
r = ev(hand('333m333p333s123m55z', '5z'));
ok('triplePung', r.eff.triplePung === 1 && !r.eff.doublePung, effOf(r));
// 16: three concealed pungs (self-draw)
r = ev(hand('111m222p333s456m55z', '5z'), 'self');
ok('threeConcealedPungs', r.eff.threeConcealedPungs === 1 && !r.eff.twoConcealedPungs, effOf(r));
// 12: knitted straight + a pung + pair
r = ev(hand('147m258p369s111z55m', '5m'));
ok('knittedStraight', r.eff.knittedStraight === 1 && r.eff.prevalentWind === 1 && r.eff.allTypes === undefined, effOf(r));
// 12: big three winds
r = ev(hand('111z222z333z123m55p', '5p'));
ok('bigThreeWinds', r.eff.bigThreeWinds === 1 && r.eff.prevalentWind === 1 && r.eff.seatWind === 1, effOf(r));
// 8: mixed straight
r = ev(hand('123m456p789s111z55m', '5m'));
ok('mixedStraight', r.eff.mixedStraight === 1 && r.eff.prevalentWind === 1, effOf(r));
// 8: reversible tiles
r = ev(hand('123p234p888p555z99p', '9p'));
ok('reversibleTiles', r.eff.reversibleTiles === 1 && r.eff.halfFlush === 1 && !r.eff.oneVoidedSuit, effOf(r));
// 8: mixed shifted pungs
r = ev(hand('222m333p444s678m55z', '5z'));
ok('mixedShiftedPungs', r.eff.mixedShiftedPungs === 1, effOf(r));
// 8: chicken hand — no fan at all, won on a discard
r = ev(hand('234m567p678s345m22p', '2p', [], []), 'discard');
ok('chickenHand? no: it has allSimples/allChows', r.eff.chickenHand === undefined && r.eff.allChows === 1 && r.eff.allSimples === 1, effOf(r));
const CHICKEN = () => hand('678s55z', '8s', [{ type: 'chi', tile: '2m' }, { type: 'pon', tile: '8p' }, { type: 'chi', tile: '4s' }]);
r = ev(CHICKEN());
ok('chickenHand', r.eff.chickenHand === 1 && r.score === 8, effOf(r));
// 6: all pungs, half flush, all types, melded hand, two concealed kongs, two dragon pungs
r = ev(hand('55m', '5m', [{ type: 'pon', tile: '1m' }, { type: 'chi', tile: '2p' }, { type: 'pon', tile: '3s' }, { type: 'pon', tile: '2z' }]));
ok('meldedHand', r.eff.meldedHand === 1 && !r.eff.singleWait && r.eff.seatWind === 1, effOf(r));
r = ev(hand('123m456p789s555z11z', '1z'));
ok('allTypes', r.eff.allTypes === 1 && r.eff.dragonPung === 1 && r.eff.mixedStraight === 1, effOf(r));
r = ev(hand('55z', '5z', [{ type: 'kan', tile: '1m', concealed: true }, { type: 'kan', tile: '2p', concealed: true }, { type: 'chi', tile: '3s' }, { type: 'chi', tile: '6s' }]));
ok('twoConcealedKongs', r.eff.twoConcealedKongs === 1 && !r.eff.concealedKong && !r.eff.twoConcealedPungs, effOf(r));
// 4: outside hand, fully concealed (self-draw), two melded kongs
r = ev(hand('123m789p999s111z99m', '9m'));
ok('outsideHand', r.eff.outsideHand === 1 && r.eff.prevalentWind === 1, effOf(r));
r = ev(hand('234m567p678s345m44p', '4p'), 'self');
ok('fullyConcealed', r.eff.fullyConcealed === 1 && !r.eff.selfDrawn && !r.eff.concealedHand, effOf(r));
// 2: dragon pung, prevalent + seat wind, concealed hand, all chows, tile hog, double pung, two concealed pungs, concealed kong, all simples
r = ev(hand('222m222p345s678s55z', '5z'));
ok('doublePung', r.eff.doublePung === 1, effOf(r));
r = ev(hand('1111m23m456p789s55z', '5z'));
ok('tileHog', r.eff.tileHog === 1, effOf(r));
// 1: pure double chow, mixed double chow, short straight, two terminal chows, pung of terminals, melded kong, one voided suit, no honours, waits
r = ev(hand('123m123m456p789p55s', '5s'));
ok('pureDoubleChow + shortStraight (allChows implies noHonors)', r.eff.pureDoubleChow === 1 && r.eff.shortStraight === 1 && !r.eff.noHonors && r.eff.allChows === 1, effOf(r));
r = ev(hand('123m123p456s789s55z', '5z'));
ok('mixedDoubleChow', r.eff.mixedDoubleChow === 1 && r.eff.shortStraight === 1, effOf(r));
r = ev(hand('123m789m456p999s55z', '5z'));
ok('twoTerminalChows + pungTerminals', r.eff.twoTerminalChows === 1 && r.eff.pungTerminalsHonors === 1, effOf(r));
r = ev(hand('123m456p55z', '5z', [{ type: 'kan', tile: '1s' }, { type: 'pon', tile: '2z' }]));
ok('meldedKong + seatWind (pung not counted as 幺九刻)', r.eff.meldedKong === 1 && r.eff.seatWind === 1 && r.eff.pungTerminalsHonors === 1 && !r.eff.concealedHand, effOf(r));
// waits: edge wait 3 on 12, closed wait 5 on 46, single wait — only when no other wait exists
r = ev(hand('123m456p789s678m55z', '3m'));
ok('edgeWait', r.eff.edgeWait === 1 && !r.eff.closedWait, effOf(r));
r = ev(hand('456m456p789s678m55z', '5m'));
ok('closedWait', r.eff.closedWait === 1, effOf(r));
r = ev(hand('123m456p789s678m55z', '5z'));
ok('singleWait', r.eff.singleWait === 1, effOf(r));
r = ev(hand('123m456p789s678m55z', '6m'));
ok('ryanmen: no wait fan', !r.eff.edgeWait && !r.eff.closedWait && !r.eff.singleWait, effOf(r));
// flowers count 1 each but not towards the 8-fan minimum
r = MJ.evaluate(game(), { outcome: 'win', winner: 1, how: 'discard', discarder: 3, tiles: Object.assign(CHICKEN(), { bonus: ['F1', 'F2'] }) });
ok('flowers', r.eff.flowers === 2 && r.eff.chickenHand === 1 && r.valid && r.score === 10, effOf(r));
r = MJ.evaluate(game(), { outcome: 'win', winner: 1, how: 'discard', discarder: 3, tiles: hand('234m567p678s345m22p', '2p', [], ['F1', 'F2', 'F3', 'F4', 'S1', 'S2']) });
ok('flowers alone do not reach 8', !r.valid && /8 fan/.test(r.reason), r.reason);
// flags stay manual: tap "last tile claim" on a chicken hand
r = MJ.evaluate(game(), { outcome: 'win', winner: 1, how: 'discard', discarder: 3, tiles: CHICKEN(), manual: { lastTileClaim: 1 } });
ok('manual flag adds', r.eff.lastTileClaim === 1 && !r.eff.chickenHand && r.score === 8, effOf(r));
// sanity: the fan list has 81 entries and every id is unique
const ids = MJ.RULES.mcr.patterns.map((p) => p.id);
eq('81 fan', [ids.length, new Set(ids).size], [81, 81]);
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
