// Settlement and scan-parsing checks (v1.0)
const MJ = require('./engine.js');
let pass = 0, fail = 0;
const eq = (l, g, w) => { const a = JSON.stringify(g), b = JSON.stringify(w); if (a === b) pass++; else { fail++; console.log('FAIL', l, '\n  got ', a, '\n  want', b); } };
const G = (r, s, money) => MJ.newGame({ ruleset: r, players: [{name:'A'},{name:'B'},{name:'C'},{name:'D'}], settings: s, money });
const H = (s, win, melds, bonus) => ({ hand: MJ.parse(s), melds: melds || [], win, bonus: bonus || [] });

// settle: exact pairs first
eq('settle pairs', MJ.settle([5, -5, 3, -3]), [{from:1,to:0,amount:5},{from:3,to:2,amount:3}]);
// settle: one creditor, two debtors
eq('settle 2→1', MJ.settle([6, -4, -2, 0]), [{from:1,to:0,amount:4},{from:2,to:0,amount:2}]);
// settle: chain, at most 3 transfers for 4 players
const t = MJ.settle([7, 1, -3, -5]);
eq('settle ≤3', t.length <= 3, true);
const chk = [0,0,0,0]; t.forEach((x) => { chk[x.from] -= x.amount; chk[x.to] += x.amount; });
eq('settle balances', chk, [-7, -1, 3, 5].map((x) => -x));
// settle: nothing owed
eq('settle zero', MJ.settle([0, 0, 0, 0]), []);
// settle: tiny rounding noise ignored
eq('settle eps', MJ.settle([0.001, -0.001, 0, 0]), []);
// money nets on a HK game with Rp 1,000 per point
const g = G('hk', null, { per: 1000, symbol: 'Rp' });
MJ.recordHand(g, { outcome:'win', winner:1, how:'discard', discarder:3, tiles: H('123456m77z', '7z', [{type:'pon',tile:'5z'},{type:'pon',tile:'6z'}], ['F2']) });
const nets = MJ.moneyNets(g);
eq('moneyNets sums to zero', Math.round(nets.reduce((a, b) => a + b, 0)), 0);
eq('moneyNets winner positive', nets[1] > 0 && nets[3] < 0, true);
eq('moneyNets = points × per', nets[1], MJ.totals(g)[1] * 1000);
// riichi money: final × per (per 1,000)
const r = G('riichi', null, { per: 10000, symbol: 'Rp' });
MJ.recordHand(r, { outcome:'win', winner:2, how:'discard', discarder:0, tiles:H('555666777z123m33p','3m') });
const rn = MJ.moneyNets(r);
eq('riichi money sums to zero', Math.round(rn.reduce((a, b) => a + b, 0)), 0);
eq('riichi money = final × per', rn[2], MJ.standings(r).find((x) => x.p === 2).final * 10000);
// settlement of that riichi game is at most 3 transfers and balances
const rt = MJ.settle(rn);
const rc = [0,0,0,0]; rt.forEach((x) => { rc[x.from] -= x.amount; rc[x.to] += x.amount; });
eq('riichi settle balances', rc.map((x) => Math.round(x)), rn.map((x) => Math.round(x)));

// parseScan: structured-output shape from the server (chow/pung/kong names, red five, unsure)
const R = MJ.RULES.riichi;
const j = { hand: ['1m','2m','3m','0p','5p','6p','7s','8s','9s','1z','1z','1z','3z','3z'], melds: [], bonus: [], win: '3z', redFives: 1, unsure: ['second row unclear'], note: '' };
const p = MJ.parseScan(j, R);
eq('parseScan red five → 5p', p.tiles.hand.filter((x) => x === '5p').length, 2);
eq('parseScan redFives', p.redFives, 1);
eq('parseScan win', p.tiles.win, '3z');
eq('parseScan hand count', MJ.checkHand(p.tiles, 13).ok, true);
const j2 = { hand: ['1m','2m','3m','4p','5p','6p','9s','9s'], melds: [{ type:'pung', tiles:['5z','5z','5z'], concealed:false }, { type:'kong', tiles:['7z','7z','7z','7z'], concealed:true }], bonus: ['F1','S2'], win: null, redFives: 0, unsure: [], note: '' };
const p2 = MJ.parseScan(j2, MJ.RULES.hk);
eq('parseScan melds', p2.tiles.melds, [{type:'pon',tile:'5z'},{type:'kan',tile:'7z',concealed:true}]);
eq('parseScan bonus', p2.tiles.bonus, ['F1','S2']);
eq('parseScan default win = last tile', p2.tiles.win, '9s');
eq('parseScan hk hand ok', MJ.checkHand(p2.tiles, 13).ok, true);
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
