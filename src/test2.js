const MJ = require('./engine.js');
let pass = 0, fail = 0;
const eq = (l, g, w) => { const a = JSON.stringify(g), b = JSON.stringify(w); if (a === b) pass++; else { fail++; console.log('FAIL', l, '\n  got ', a, '\n  want', b); } };
const H = (s, win, melds, bonus) => ({ hand: MJ.parse(s), melds: melds || [], win, bonus: bonus || [] });
const G = (r, s) => MJ.newGame({ ruleset: r, players: [{name:'A'},{name:'B'},{name:'C'},{name:'D'}], settings: s });
const keys = (r) => Object.keys(r.eff).sort();

const g = G('riichi');
// sanshoku + pinfu + riichi, non-dealer ron (winner 1)
let r = MJ.evaluate(g, { outcome:'win', winner:1, how:'discard', discarder:2, tiles:H('234m234p234s678m99s','8m'), riichi:{declared:[1]} });
eq('sanshoku', keys(r), ['pinfu','riichi','sanshoku']);
// ittsu closed
r = MJ.evaluate(g, { outcome:'win', winner:1, how:'discard', discarder:2, tiles:H('123456789m345p99s','9m'), riichi:{declared:[1]} });
eq('ittsu', keys(r).includes('ittsu'), true);
// iipeikou + pinfu + tanyao
r = MJ.evaluate(g, { outcome:'win', winner:1, how:'discard', discarder:2, tiles:H('223344m567p678s55p','8s'), riichi:{declared:[]} });
eq('iipeikou', keys(r), ['iipeikou','pinfu','tanyao']);
// ryanpeikou (should beat chiitoitsu reading)
r = MJ.evaluate(g, { outcome:'win', winner:1, how:'discard', discarder:2, tiles:H('223344m667788p55s','5s') });
eq('ryanpeikou', [keys(r), r.han], [['ryanpeikou','tanyao'], 4]);
// open honitsu + yakuhai
r = MJ.evaluate(g, { outcome:'win', winner:1, how:'discard', discarder:2, tiles:H('123456p789p11z','1z',[{type:'pon',tile:'7z'}]) });
eq('open honitsu', [keys(r), r.han], [['chun','honitsu','ittsu'], 4]);
// toitoi + sanankou (ron on shanpon makes one triplet open)
r = MJ.evaluate(g, { outcome:'win', winner:2, how:'discard', discarder:3, tiles:H('222m444p666s88m777p','7p') });
eq('toitoi sanankou', [keys(r)], [['sanankou','tanyao','toitoi']]);
// suuankou on tsumo
r = MJ.evaluate(g, { outcome:'win', winner:2, how:'self', tiles:H('222m444p666s88m777p','7p') });
eq('suuankou tsumo', r.eff.suuankou, 1);
// daisangen
r = MJ.evaluate(g, { outcome:'win', winner:2, how:'discard', discarder:0, tiles:H('555666777z123m33p','3m') });
eq('daisangen', [r.eff.daisangen, r.deltas[2]], [1, 32000]);
// wait choice: 3445m... hand 344556m + ... pick best (ryanmen pinfu over kanchan)
r = MJ.evaluate(g, { outcome:'win', winner:1, how:'discard', discarder:2, tiles:H('344556m234p567s88s','4m'), riichi:{declared:[1]} });
eq('best wait reading has pinfu', keys(r).includes('pinfu'), true);
// shousangen + yakuhai x2
r = MJ.evaluate(g, { outcome:'win', winner:1, how:'discard', discarder:2, tiles:H('555666z77z123m456m','6m') });
eq('shousangen', [keys(r), r.han], [['haku','hatsu','honitsu','shousangen'], 2+1+1+3]);

// HK big dragons (8) + mixed one suit (3) = 11 → capped at 10
const h = G('hk');
r = MJ.evaluate(h, { outcome:'win', winner:1, how:'discard', discarder:2, tiles:H('555666777z123m99m','9m') });
eq('hk big dragons', [keys(r), r.score], [['bigDragons','mixedSuit','noFlowers'], 10]);
// HK small winds 6 + mixed one suit 3 + no flowers 1 = 10
r = MJ.evaluate(h, { outcome:'win', winner:1, how:'discard', discarder:2, tiles:H('111222333z44z789s','7s') });
eq('hk small winds', [keys(r), r.score], [['mixedSuit','noFlowers','smallWinds'], 10]);

// TW all melded + discard (全求人), 17 tiles
const t = G('tw');
r = MJ.evaluate(t, { outcome:'win', winner:1, how:'discard', discarder:2, tiles:H('55p','5p',[{type:'chi',tile:'1m'},{type:'chi',tile:'4m'},{type:'pon',tile:'9s'},{type:'chi',tile:'2p'},{type:'pon',tile:'7z'}]) });
eq('tw all from others', keys(r), ['allFromOthers','dragonPung']);
// TW five concealed pungs self-drawn: concealed self-draw 3 + all pungs 4 + five concealed 8
r = MJ.evaluate(t, { outcome:'win', winner:1, how:'self', tiles:H('111m222m333p444p555s66s','6s') });
eq('tw five concealed', [keys(r), r.score], [['allPungs','concealedSelfDraw','fiveConcealed'], 3+4+8]);

// SG all pungs + dragon + seat wind (winner seat South = 2z)
const s = G('sg');
r = MJ.evaluate(s, { outcome:'win', winner:1, how:'discard', discarder:0, tiles:H('111m999p222z77z','7z',[{type:'pon',tile:'5z'}]) });
eq('sg pungs', [keys(r), r.score], [['allPungs','dragonPung','mixedTerminals','seatWind'], 5]);

// HK: adding a seat flower by hand cancels 'no flowers'
r = MJ.evaluate(h, { outcome:'win', winner:2, how:'self', tiles:H('234m555p123s555z77s','7s'), manual:{ seatFlower:1 } });
eq('hk seat flower cancels no flowers', [keys(r), r.score], [['dragonPung','seatFlower','selfDraw'], 3]);
console.log(pass + ' passed, ' + fail + ' failed');
