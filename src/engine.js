/*!
 * Mahjong Scorebook — scoring engine (MVP v0.1)
 * Pure functions, no DOM. Browser: window.MJ · Node: require('./engine.js')
 *
 * Tile codes
 *   1m–9m characters 萬 · 1p–9p dots 筒 · 1s–9s bamboo 索
 *   1z East · 2z South · 3z West · 4z North · 5z White · 6z Green · 7z Red
 *   F1–F4 flowers 梅蘭菊竹 · S1–S4 seasons 春夏秋冬 · A1–A4 animals (cat, mouse, rooster, centipede)
 * Seats and winds are 0..3 = East, South, West, North. Players keep their seat index 0..3;
 * the dealer (East) moves, so a player's seat wind = (player - dealer + 4) % 4.
 */
(function (root, factory) {
  var MJ = factory();
  if (typeof module === 'object' && module.exports) module.exports = MJ;
  else root.MJ = MJ;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* =========================================================== TILES */
  const SUITS = ['m', 'p', 's'];
  const WINDS = ['East', 'South', 'West', 'North'];
  const WINDS_ZH = ['東', '南', '西', '北'];
  const HONOR_NAMES = ['East', 'South', 'West', 'North', 'White dragon', 'Green dragon', 'Red dragon'];
  const SUIT_NAMES = { m: 'Characters', p: 'Dots', s: 'Bamboo' };
  const BONUS_NAMES = {
    F1: 'Plum', F2: 'Orchid', F3: 'Chrysanthemum', F4: 'Bamboo flower',
    S1: 'Spring', S2: 'Summer', S3: 'Autumn', S4: 'Winter',
    A1: 'Cat', A2: 'Mouse', A3: 'Rooster', A4: 'Centipede',
  };

  function norm(raw) {
    if (typeof raw !== 'string') return null;
    const c = raw.trim();
    let m;
    if ((m = /^([1-9])([mps])$/i.exec(c))) return m[1] + m[2].toLowerCase();
    if ((m = /^0([mps])$/i.exec(c))) return '5' + m[1].toLowerCase(); // red five → plain five
    if ((m = /^([1-7])z$/i.exec(c))) return m[1] + 'z';
    if ((m = /^([fsa])([1-4])$/i.exec(c))) return m[1].toUpperCase() + m[2];
    return null;
  }
  const isBonus = (c) => /^[FSA][1-4]$/.test(c);
  const isTile = (c) => /^([1-9][mps]|[1-7]z)$/.test(c);
  const ix = (c) => { const n = +c[0], s = c[1]; return s === 'z' ? 26 + n : SUITS.indexOf(s) * 9 + n - 1; };
  const cd = (i) => (i >= 27 ? (i - 26) + 'z' : (i % 9 + 1) + SUITS[(i / 9) | 0]);
  const isHonor = (i) => i >= 27;
  const isWind = (i) => i >= 27 && i <= 30;
  const isDragon = (i) => i >= 31;
  const isTerm = (i) => i < 27 && (i % 9 === 0 || i % 9 === 8);
  const isTH = (i) => i >= 27 || i % 9 === 0 || i % 9 === 8;
  const suitOf = (i) => (i >= 27 ? 3 : (i / 9) | 0);
  const TH = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
  const GREEN = new Set([19, 20, 21, 23, 25, 32]); // 2s 3s 4s 6s 8s + green dragon

  function tileName(c) {
    if (isBonus(c)) return BONUS_NAMES[c];
    const i = ix(c);
    if (i >= 27) return HONOR_NAMES[i - 27];
    return (i % 9 + 1) + ' ' + SUIT_NAMES[c[1]];
  }
  const sortKey = (c) => (isBonus(c) ? 100 + 'FSA'.indexOf(c[0]) * 4 + +c[1] : ix(c));
  const sortTiles = (list) => list.slice().sort((a, b) => sortKey(a) - sortKey(b));
  function countsOf(list) { const c = new Array(34).fill(0); for (const x of list) c[ix(x)]++; return c; }
  function meldIdx(m) {
    const i = ix(m.tile);
    return m.type === 'chi' ? [i, i + 1, i + 2] : m.type === 'pon' ? [i, i, i] : [i, i, i, i];
  }
  function groupTiles(groups) {
    const t = [];
    for (const g of groups) {
      if (g.kind === 'seq') t.push(g.i, g.i + 1, g.i + 2);
      else if (g.kind === 'pair') t.push(g.i, g.i);
      else if (g.kind === 'tri') t.push(g.i, g.i, g.i);
      else t.push(g.i, g.i, g.i, g.i);
    }
    return t;
  }

  /* HandTiles = { hand: codes (concealed, includes the winning tile),
                   melds: [{type:'chi'|'pon'|'kan', tile: lowest code, concealed?: bool}],
                   win: code, bonus: codes } */
  function emptyHand() { return { hand: [], melds: [], win: null, bonus: [] }; }

  function checkHand(h, handSize) {
    const expected = handSize + 1;
    const have = h.hand.length + h.melds.length * 3;
    const problems = [];
    const all = new Array(34).fill(0);
    h.hand.forEach((c) => all[ix(c)]++);
    for (const m of h.melds) {
      const i = ix(m.tile);
      if (m.type === 'chi' && (i >= 27 || i % 9 > 6)) problems.push('A chow needs three tiles in a row of one suit.');
      else meldIdx(m).forEach((j) => all[j]++);
    }
    all.forEach((n, i) => { if (n > 4) problems.push('More than four ' + tileName(cd(i)) + ' tiles.'); });
    const seen = new Set();
    for (const b of h.bonus) { if (seen.has(b)) problems.push('There is only one ' + tileName(b) + ' tile.'); seen.add(b); }
    if (have !== expected) {
      const d = Math.abs(expected - have);
      problems.unshift((have < expected ? 'Add ' : 'Remove ') + d + ' tile' + (d > 1 ? 's' : '') + ' (' + have + ' of ' + expected + ').');
    } else if (!(h.win && h.hand.includes(h.win))) problems.push('Mark the winning tile.');
    return { ok: problems.length === 0, have, expected, problems };
  }

  /* ====================================================== DECOMPOSE */
  // All ways to split counts into one pair + `need` sets (sequences / triplets).
  function decompose(counts, need) {
    const results = [];
    const acc = [];
    function rec(c, left, pair) {
      let i = 0;
      while (i < 34 && !c[i]) i++;
      if (i === 34) { if (left === 0) results.push({ pair, sets: acc.slice() }); return; }
      if (left === 0) return;
      if (c[i] >= 3) { c[i] -= 3; acc.push({ kind: 'tri', i }); rec(c, left - 1, pair); acc.pop(); c[i] += 3; }
      if (i < 27 && i % 9 <= 6 && c[i + 1] && c[i + 2]) {
        c[i]--; c[i + 1]--; c[i + 2]--;
        acc.push({ kind: 'seq', i }); rec(c, left - 1, pair); acc.pop();
        c[i]++; c[i + 1]++; c[i + 2]++;
      }
    }
    if (need < 0) return results;
    for (let p = 0; p < 34; p++) {
      if (counts[p] >= 2) { counts[p] -= 2; rec(counts, need, p); counts[p] += 2; }
    }
    return results;
  }
  function sevenPairs(counts, allowQuads) {
    let pairs = 0, total = 0;
    for (let i = 0; i < 34; i++) {
      const n = counts[i]; total += n;
      if (n === 2) pairs++;
      else if (n === 4 && allowQuads) pairs += 2;
      else if (n !== 0) return false;
    }
    return total === 14 && pairs === 7;
  }
  function orphans(counts) {
    let total = 0, dup = 0;
    for (let i = 0; i < 34; i++) {
      const n = counts[i]; total += n;
      if (TH.includes(i)) { if (n === 0 || n > 2) return false; if (n === 2) dup++; }
      else if (n) return false;
    }
    return total === 14 && dup === 1;
  }

  // Every way to read the finished hand: decomposition × which group the winning tile completed.
  function variants(h, selfDraw, opt) {
    const out = [];
    const need = (opt.handSize === 16 ? 5 : 4) - h.melds.length;
    const counts = countsOf(h.hand);
    const w = ix(h.win);
    const meldGroups = h.melds.map((m) => {
      const i = ix(m.tile);
      if (m.type === 'chi') return { kind: 'seq', i, open: true, concealed: false, meld: true };
      if (m.type === 'pon') return { kind: 'tri', i, open: true, concealed: false, meld: true };
      return { kind: 'kan', i, open: !m.concealed, concealed: !!m.concealed, meld: true };
    });
    for (const d of decompose(counts.slice(), need)) {
      const closed = d.sets.map((s) => ({ kind: s.kind, i: s.i, open: false, concealed: s.kind === 'tri', meld: false }));
      closed.push({ kind: 'pair', i: d.pair, open: false, concealed: true, meld: false });
      const seen = new Set();
      closed.forEach((g, gi) => {
        if (!(g.kind === 'seq' ? w >= g.i && w <= g.i + 2 : g.i === w)) return;
        const key = g.kind + ':' + g.i + ':' + (w - g.i);
        if (seen.has(key)) return;
        seen.add(key);
        let wait;
        if (g.kind === 'pair') wait = 'tanki';
        else if (g.kind === 'tri') wait = 'shanpon';
        else {
          const pos = w - g.i;
          wait = pos === 1 ? 'kanchan' : pos === 0 ? (g.i % 9 === 6 ? 'penchan' : 'ryanmen') : (g.i % 9 === 0 ? 'penchan' : 'ryanmen');
        }
        const groups = meldGroups.map((x) => Object.assign({}, x)).concat(closed.map((x, xi) => {
          const y = Object.assign({}, x, { isWin: xi === gi });
          if (y.isWin && y.kind === 'tri' && !selfDraw) y.concealed = false; // triplet finished on a discard counts as exposed
          return y;
        }));
        out.push({ form: 'standard', groups, wait, win: w, tiles: groupTiles(groups) });
      });
    }
    if (!h.melds.length && opt.handSize === 13) {
      if (opt.sevenPairs && sevenPairs(counts, opt.quadPairs)) {
        const groups = [];
        counts.forEach((n, i) => { for (let k = 0; k < n / 2; k++) groups.push({ kind: 'pair', i, open: false, concealed: true, meld: false }); });
        out.push({ form: 'pairs', groups, wait: 'tanki', win: w, tiles: groupTiles(groups) });
      }
      if (orphans(counts)) {
        const tiles = [];
        counts.forEach((n, i) => { for (let k = 0; k < n; k++) tiles.push(i); });
        out.push({ form: 'orphans', groups: [], wait: counts[w] === 2 ? 'orphans13' : 'orphans', win: w, tiles });
      }
    }
    return out;
  }

  // Tiles that would have completed the hand before the winning tile arrived.
  function waits(h, opt) {
    const counts = countsOf(h.hand);
    counts[ix(h.win)]--;
    const need = (opt.handSize === 16 ? 5 : 4) - h.melds.length;
    const res = [];
    for (let t = 0; t < 34; t++) {
      counts[t]++;
      const ok = decompose(counts.slice(), need).length > 0 ||
        (need === 4 && opt.handSize === 13 && ((opt.sevenPairs && sevenPairs(counts, opt.quadPairs)) || orphans(counts)));
      if (ok) res.push(t);
      counts[t]--;
    }
    return res;
  }

  function feat(v) {
    const G = v.groups, t = v.tiles;
    const suits = new Set(t.filter((i) => i < 27).map(suitOf));
    const honors = t.filter(isHonor).length;
    const trips = G.filter((g) => g.kind === 'tri' || g.kind === 'kan');
    const seqs = G.filter((g) => g.kind === 'seq');
    return {
      suitCount: suits.size,
      hasHonor: honors > 0,
      allHonors: honors === t.length,
      allTerminals: t.every(isTerm),
      allTH: t.every(isTH),
      allSimples: t.every((i) => !isTH(i)),
      trips, seqs,
      pair: v.form === 'standard' ? G.find((g) => g.kind === 'pair') : null,
      kans: G.filter((g) => g.kind === 'kan'),
      menzen: !G.some((g) => g.open),
      openMelds: G.filter((g) => g.open).length,
      concealedTrips: trips.filter((g) => g.concealed).length,
      dragonTrips: trips.filter((g) => isDragon(g.i)).length,
      windTrips: trips.filter((g) => isWind(g.i)),
    };
  }
  function nineGates(v) {
    if (v.form !== 'standard' || v.groups.some((g) => g.meld)) return null;
    const t = v.tiles, s = suitOf(t[0]);
    if (s === 3 || t.some((i) => suitOf(i) !== s)) return null;
    const c = new Array(9).fill(0);
    t.forEach((i) => c[i % 9]++);
    const need = [3, 1, 1, 1, 1, 1, 1, 1, 3];
    if (!need.every((n, k) => c[k] >= n)) return null;
    const before = c.slice();
    before[v.win % 9]--;
    return before.every((n, k) => n === need[k]) ? 'pure' : 'normal';
  }
  function bonusInfo(bonus, seat) {
    const F = new Set(), S = new Set();
    let A = 0;
    for (const b of bonus || []) {
      if (b[0] === 'F') F.add(+b[1]);
      else if (b[0] === 'S') S.add(+b[1]);
      else if (b[0] === 'A') A++;
    }
    const own = seat + 1;
    return {
      total: (bonus || []).length, F, S, A, own,
      seatCount: (F.has(own) ? 1 : 0) + (S.has(own) ? 1 : 0),
      fullSets: (F.size === 4 ? 1 : 0) + (S.size === 4 ? 1 : 0),
      seatOutsideSets: (F.size < 4 && F.has(own) ? 1 : 0) + (S.size < 4 && S.has(own) ? 1 : 0),
    };
  }
  const put = (c, id, n) => { n = n === undefined ? 1 : n; if (n > 0) c[id] = (c[id] || 0) + n; };

  /* ================================================ SHARED PATTERN HELPERS */
  function P(id, en, zh, v, g, extra) { return Object.assign({ id, en, zh, v, g, max: 1 }, extra || {}); }
  const GROUPS = {
    win: 'How it was won',
    bonus: 'Flowers and bonus tiles',
    sets: 'Pungs that score',
    hand: 'Hand patterns',
    limit: 'Limit hands',
  };
  function sumCounts(counts, values, patterns) {
    let lim = false, sum = 0;
    for (const p of patterns) {
      const n = counts[p.id];
      if (!n) continue;
      const val = values[p.id];
      if (val === 'L') lim = true;
      else sum += (+val || 0) * n;
    }
    return { lim, sum };
  }

  /* ================================================= HONG KONG (faan) */
  function hkPoints(faan, table) {
    if (faan < 0) return 0;
    if (table === 'full' || faan <= 4) return Math.pow(2, faan);
    const k = faan - 4;
    const base = 16 * Math.pow(2, Math.floor(k / 2));
    return k % 2 === 1 ? base * 1.5 : base;
  }
  const HK = {
    id: 'hk', name: 'Hong Kong', native: '香港麻雀', unit: 'faan', handSize: 13,
    blurb: 'Faan, 3 to win, half-spicy scoring',
    settings: [
      { key: 'minFaan', label: 'Faan needed to win', zh: '起糊', type: 'int', min: 0, max: 8, def: 3 },
      { key: 'maxFaan', label: 'Limit', zh: '爆棚', type: 'int', min: 5, max: 13, def: 10 },
      { key: 'table', label: 'Scoring table', type: 'select', def: 'half', options: [['half', 'Half-spicy 半辣 — doubles every 2 faan above 4'], ['full', 'Full-spicy 全辣 — doubles every faan']] },
      { key: 'pay', label: 'On a discard', type: 'select', def: 'full', options: [['full', 'Full-gun 全銃 — discarder loses all the points'], ['half', 'Half-gun 半銃 — discarder loses half, others a quarter each']] },
      { key: 'flowers', label: 'Play with flowers', type: 'bool', def: true },
      { key: 'concealedWithFlowers', label: 'Count 門前清 even with flowers', type: 'bool', def: false },
      { key: 'keepOnDraw', label: 'Dealer stays on a draw', type: 'bool', def: true },
    ],
    patterns: [
      P('selfDraw', 'Self-draw', '自摸', 1, 'win', { src: 'how' }),
      P('concealed', 'Concealed hand', '門前清', 1, 'win', { note: 'No chow, pung or open kong. Only counted without flowers unless the setting says so.' }),
      P('lastTile', 'Win on the last tile', '海底撈月', 1, 'win', { flag: true }),
      P('robbingKong', 'Robbing a kong', '搶槓', 1, 'win', { flag: true }),
      P('kongReplacement', 'Win on a kong replacement', '槓上開花', 1, 'win', { flag: true }),
      P('heavenly', 'Heavenly hand', '天糊', 'L', 'win', { flag: true, note: 'Dealer wins on the deal' }),
      P('earthly', 'Earthly hand', '地糊', 'L', 'win', { flag: true, note: "Wins on the dealer's first discard" }),
      P('noFlowers', 'No flowers', '無花', 1, 'bonus'),
      P('seatFlower', 'Seat flower', '正花', 1, 'bonus', { max: 2, note: 'Flower or season numbered for your seat' }),
      P('flowerSet', 'Full set of flowers or seasons', '一台花', 2, 'bonus', { max: 2 }),
      P('allFlowers', 'All eight flowers', '八仙過海', 'L', 'bonus'),
      P('dragonPung', 'Dragon pung', '番子', 1, 'sets', { max: 3 }),
      P('seatWind', 'Seat wind pung', '門風', 1, 'sets'),
      P('roundWind', 'Round wind pung', '圈風', 1, 'sets'),
      P('allChows', 'All chows', '平糊', 1, 'hand'),
      P('mixedTerminals', 'Terminals and honours', '混么九', 1, 'hand'),
      P('allPungs', 'All pungs', '對對糊', 3, 'hand'),
      P('mixedSuit', 'Half flush (one suit + honours)', '混一色', 3, 'hand', { note: 'One suit plus honours' }),
      P('smallDragons', 'Small three dragons', '小三元', 5, 'hand', { note: 'Includes the two dragon pungs' }),
      P('smallWinds', 'Small four winds', '小四喜', 6, 'hand', { note: 'Includes the wind pungs' }),
      P('pureSuit', 'Full flush (one suit only)', '清一色', 7, 'hand'),
      P('bigDragons', 'Big three dragons', '大三元', 8, 'hand', { note: 'Includes the dragon pungs' }),
      P('sevenPairs', 'Seven pairs', '七對子', 0, 'hand', { note: 'House rule. Give it a value (often 4) to allow it.' }),
      P('bigWinds', 'Big four winds', '大四喜', 'L', 'limit'),
      P('allHonors', 'All honours', '字一色', 'L', 'limit'),
      P('allTerminals', 'All terminals', '清么九', 'L', 'limit'),
      P('thirteenOrphans', 'Thirteen orphans', '十三么', 'L', 'limit'),
      P('nineGates', 'Nine gates', '九子連環', 'L', 'limit'),
      P('fourConcealed', 'All concealed pungs', '坎坎糊', 'L', 'limit'),
      P('fourKongs', 'Four kongs', '十八羅漢', 'L', 'limit'),
    ],
    excl: {
      bigDragons: ['dragonPung', 'smallDragons'], smallDragons: ['dragonPung'],
      smallWinds: ['seatWind', 'roundWind'], pureSuit: ['mixedSuit'],
      allFlowers: ['seatFlower', 'flowerSet', 'noFlowers'], sevenPairs: ['concealed'],
      seatFlower: ['noFlowers'], flowerSet: ['noFlowers'],
    },
    variantOpts: (S, V) => ({ handSize: 13, sevenPairs: +V.sevenPairs > 0, quadPairs: false }),
    detect(v, ctx, S, h) {
      const f = feat(v), c = {};
      if (v.form === 'orphans') put(c, 'thirteenOrphans');
      if (f.allHonors) put(c, 'allHonors');
      if (f.allTerminals) put(c, 'allTerminals');
      if (v.form === 'standard') {
        if (f.windTrips.length === 4) put(c, 'bigWinds');
        if (f.kans.length === 4) put(c, 'fourKongs');
        if (f.concealedTrips === 4) put(c, 'fourConcealed');
        if (nineGates(v)) put(c, 'nineGates');
      }
      const b = bonusInfo(h.bonus, ctx.seat);
      if (S.flowers && b.F.size === 4 && b.S.size === 4) put(c, 'allFlowers');
      if (Object.keys(c).length) return { counts: c, limit: true };
      if (f.menzen && v.form !== 'pairs' && (!S.flowers || S.concealedWithFlowers)) put(c, 'concealed');
      if (S.flowers) {
        if (!b.total) put(c, 'noFlowers');
        put(c, 'flowerSet', b.fullSets);
        put(c, 'seatFlower', b.seatOutsideSets);
      }
      const pairDragon = f.pair && isDragon(f.pair.i), pairWind = f.pair && isWind(f.pair.i);
      if (f.dragonTrips === 3) put(c, 'bigDragons');
      else if (f.dragonTrips === 2 && pairDragon) put(c, 'smallDragons');
      else put(c, 'dragonPung', f.dragonTrips);
      if (f.windTrips.length === 3 && pairWind) put(c, 'smallWinds');
      else {
        if (f.windTrips.some((g) => g.i === 27 + ctx.seat)) put(c, 'seatWind');
        if (f.windTrips.some((g) => g.i === 27 + ctx.round)) put(c, 'roundWind');
      }
      if (v.form === 'standard') {
        if (!f.trips.length) put(c, 'allChows');
        if (!f.seqs.length) put(c, 'allPungs');
      }
      if (v.form === 'pairs') put(c, 'sevenPairs');
      if (f.suitCount === 1) put(c, f.hasHonor ? 'mixedSuit' : 'pureSuit');
      if (f.allTH && f.hasHonor && !f.allHonors) put(c, 'mixedTerminals');
      return { counts: c };
    },
    ctxCounts(c, ctx) { if (ctx.selfDraw) put(c, 'selfDraw'); },
    total(eff, V, S) {
      const { lim, sum } = sumCounts(eff, V, HK.patterns);
      const faan = lim ? S.maxFaan : Math.min(sum, S.maxFaan);
      const capped = lim || sum >= S.maxFaan;
      const pts = hkPoints(faan, S.table);
      return {
        valid: faan >= S.minFaan,
        reason: faan >= S.minFaan ? '' : 'Needs ' + S.minFaan + ' faan to win. This hand has ' + faan + '.',
        score: faan, text: faan + ' faan' + (capped ? ' · limit' : ''), rank: faan * 1000 + sum, pts,
        detail: pts + ' pts on the table',
      };
    },
    pay(res, g) {
      const P = res.pts, d = [0, 0, 0, 0], w = g.winner;
      for (let p = 0; p < 4; p++) {
        if (p === w) continue;
        let a = 0;
        if (g.selfDraw) a = P / 2;
        else if (g.S.pay === 'full') a = p === g.discarder ? P : 0;
        else a = p === g.discarder ? P / 2 : P / 4;
        d[p] -= a; d[w] += a;
      }
      return { deltas: d };
    },
  };

  /* ================================================== SINGAPORE (tai) */
  const SG = {
    id: 'sg', name: 'Singapore', native: '新加坡麻将', unit: 'tai', handSize: 13,
    blurb: 'Tai with animals, 1 to win, capped at 5',
    settings: [
      { key: 'minTai', label: 'Tai needed to win', type: 'int', min: 0, max: 4, def: 1 },
      { key: 'maxTai', label: 'Tai cap', type: 'int', min: 3, max: 10, def: 5 },
      { key: 'pay', label: 'On a discard', type: 'select', def: 'standard', options: [['standard', 'Shooter loses double, others single'], ['all', 'Shooter loses the points for everyone'], ['only', 'Only the shooter loses points (double)']] },
      { key: 'strictPingHu', label: 'Ping Hu needs a plain pair and a two-sided wait', type: 'bool', def: true },
      { key: 'keepOnDraw', label: 'Dealer stays on a draw', type: 'bool', def: true },
    ],
    patterns: [
      P('selfDraw', 'Self-draw', '自摸', 0, 'win', { src: 'how', note: 'Self-draw already doubles the points. Some tables add 1 tai.' }),
      P('concealedSelfDraw', 'Fully concealed self-draw', '门清自摸', 0, 'win', { note: 'House rule, often 1 tai' }),
      P('lastTile', 'Win on the last tile', '海底捞月', 1, 'win', { flag: true }),
      P('robbingKong', 'Robbing a kong', '抢杠', 1, 'win', { flag: true }),
      P('kongReplacement', 'Win on a kong replacement', '杠上开花', 1, 'win', { flag: true }),
      P('heavenly', 'Heavenly hand', '天胡', 'L', 'win', { flag: true }),
      P('earthly', 'Earthly hand', '地胡', 'L', 'win', { flag: true }),
      P('seatFlower', 'Seat flower', '正花', 1, 'bonus', { max: 2, note: 'Flower or season numbered for your seat' }),
      P('flowerSet', 'Full set of flowers or seasons', '一台花', 1, 'bonus', { max: 2, note: 'Extra, on top of the seat flower' }),
      P('animal', 'Animal', '动物', 1, 'bonus', { max: 4 }),
      P('allAnimals', 'All four animals', '四动物', 1, 'bonus', { note: 'Extra, on top of each animal' }),
      P('dragonPung', 'Dragon pung', '三元', 1, 'sets', { max: 3 }),
      P('seatWind', 'Seat wind pung', '门风', 1, 'sets'),
      P('roundWind', 'Round wind pung', '圈风', 1, 'sets'),
      P('allChows', 'All chows', '平胡 (有花)', 1, 'hand', { note: 'All chows, but with bonus tiles or a scoring pair' }),
      P('pingHu', 'Ping Hu', '平胡', 4, 'hand', { note: 'All chows and no bonus tiles' }),
      P('allPungs', 'All pungs', '对对胡', 2, 'hand'),
      P('mixedSuit', 'Half flush (one suit + honours)', '混一色', 2, 'hand'),
      P('mixedTerminals', 'Terminals and honours', '混么九', 2, 'hand'),
      P('smallDragons', 'Small three dragons', '小三元', 1, 'hand', { note: 'Extra, on top of the dragon pungs' }),
      P('pureSuit', 'Full flush (one suit only)', '清一色', 4, 'hand'),
      P('bigDragons', 'Big three dragons', '大三元', 'L', 'limit'),
      P('smallWinds', 'Small four winds', '小四喜', 'L', 'limit'),
      P('bigWinds', 'Big four winds', '大四喜', 'L', 'limit'),
      P('allHonors', 'All honours', '字一色', 'L', 'limit'),
      P('allTerminals', 'All terminals', '清么九', 'L', 'limit'),
      P('thirteenOrphans', 'Thirteen wonders', '十三幺', 'L', 'limit'),
      P('nineGates', 'Nine gates', '九莲宝灯', 'L', 'limit'),
      P('fourConcealed', 'Four concealed pungs', '四暗刻', 'L', 'limit'),
      P('fourKongs', 'Four kongs', '十八罗汉', 'L', 'limit'),
    ],
    instant: [
      { id: 'kong', en: 'Exposed kong', zh: '明杠', each: 1 },
      { id: 'concealedKong', en: 'Concealed kong', zh: '暗杠', each: 2 },
      { id: 'bite', en: 'Animal pair (cat + mouse, rooster + centipede)', zh: '咬', each: 1 },
      { id: 'allAnimals', en: 'All four animals', zh: '四动物', each: 2 },
      { id: 'flowerSet', en: 'Full set of flowers or seasons', zh: '一台花', each: 2 },
      { id: 'wedding', en: 'Seat flower and seat season', zh: '', each: 1 },
    ],
    excl: { pingHu: ['allChows'], pureSuit: ['mixedSuit'], bigDragons: ['dragonPung', 'smallDragons'], concealedSelfDraw: [] },
    variantOpts: () => ({ handSize: 13, sevenPairs: false }),
    detect(v, ctx, S, h) {
      const f = feat(v), c = {};
      if (v.form === 'orphans') put(c, 'thirteenOrphans');
      if (f.allHonors) put(c, 'allHonors');
      if (f.allTerminals) put(c, 'allTerminals');
      const pairDragon = f.pair && isDragon(f.pair.i), pairWind = f.pair && isWind(f.pair.i);
      if (v.form === 'standard') {
        if (f.dragonTrips === 3) put(c, 'bigDragons');
        if (f.windTrips.length === 4) put(c, 'bigWinds');
        else if (f.windTrips.length === 3 && pairWind) put(c, 'smallWinds');
        if (f.kans.length === 4) put(c, 'fourKongs');
        if (f.concealedTrips === 4) put(c, 'fourConcealed');
        if (nineGates(v)) put(c, 'nineGates');
      }
      if (Object.keys(c).length) return { counts: c, limit: true };
      const b = bonusInfo(h.bonus, ctx.seat);
      put(c, 'seatFlower', b.seatCount);
      put(c, 'flowerSet', b.fullSets);
      put(c, 'animal', b.A);
      if (b.A === 4) put(c, 'allAnimals');
      put(c, 'dragonPung', f.dragonTrips);
      if (f.dragonTrips === 2 && pairDragon) put(c, 'smallDragons');
      if (f.windTrips.some((g) => g.i === 27 + ctx.seat)) put(c, 'seatWind');
      if (f.windTrips.some((g) => g.i === 27 + ctx.round)) put(c, 'roundWind');
      if (!f.trips.length) {
        const plainPair = f.pair && !isDragon(f.pair.i) && f.pair.i !== 27 + ctx.seat && f.pair.i !== 27 + ctx.round;
        const strictOk = !S.strictPingHu || (plainPair && v.wait === 'ryanmen');
        put(c, !b.total && strictOk ? 'pingHu' : 'allChows');
      }
      if (!f.seqs.length) put(c, 'allPungs');
      if (f.suitCount === 1) put(c, f.hasHonor ? 'mixedSuit' : 'pureSuit');
      if (f.allTH && f.hasHonor && !f.allHonors) put(c, 'mixedTerminals');
      if (f.menzen && ctx.selfDraw) put(c, 'concealedSelfDraw');
      return { counts: c };
    },
    ctxCounts(c, ctx) { if (ctx.selfDraw) put(c, 'selfDraw'); },
    total(eff, V, S) {
      const { lim, sum } = sumCounts(eff, V, SG.patterns);
      const tai = lim ? S.maxTai : Math.min(sum, S.maxTai);
      const pts = Math.pow(2, tai - 1);
      return {
        valid: tai >= S.minTai,
        reason: tai >= S.minTai ? '' : 'Needs ' + S.minTai + ' tai to win.',
        score: tai, text: tai + ' tai' + (lim || sum >= S.maxTai ? ' · max' : ''), rank: tai * 1000 + sum, pts,
        detail: pts + ' pts per share',
      };
    },
    pay(res, g) {
      const P = res.pts, d = [0, 0, 0, 0], w = g.winner;
      for (let p = 0; p < 4; p++) {
        if (p === w) continue;
        let a;
        if (g.selfDraw) a = 2 * P;
        else if (g.S.pay === 'all') a = p === g.discarder ? 4 * P : 0;
        else if (g.S.pay === 'only') a = p === g.discarder ? 2 * P : 0;
        else a = p === g.discarder ? 2 * P : P;
        d[p] -= a; d[w] += a;
      }
      return { deltas: d };
    },
  };

  /* ============================================ JAPANESE RIICHI (han/fu) */
  // [id, en, jp, closed han, open han (null = closed only), group]
  const RIICHI_YAKU = [
    ['riichi', 'Riichi', '立直', 1, null, 'win'],
    ['doubleRiichi', 'Double riichi', 'ダブル立直', 2, null, 'win'],
    ['ippatsu', 'Ippatsu', '一発', 1, null, 'win'],
    ['menzenTsumo', 'Fully concealed self-draw', '門前清自摸和', 1, null, 'win'],
    ['haitei', 'Last tile (haitei / houtei)', '海底 · 河底', 1, 1, 'win'],
    ['rinshan', 'After a kan (rinshan)', '嶺上開花', 1, 1, 'win'],
    ['chankan', 'Robbing a kan (chankan)', '搶槓', 1, 1, 'win'],
    ['pinfu', 'Pinfu', '平和', 1, null, 'hand'],
    ['tanyao', 'All simples (tanyao)', '断么九', 1, 1, 'hand'],
    ['iipeikou', 'Pure double sequence', '一盃口', 1, null, 'hand'],
    ['yakuhaiSeat', 'Seat wind triplet', '自風牌', 1, 1, 'sets'],
    ['yakuhaiRound', 'Round wind triplet', '場風牌', 1, 1, 'sets'],
    ['haku', 'White dragon triplet', '白', 1, 1, 'sets'],
    ['hatsu', 'Green dragon triplet', '發', 1, 1, 'sets'],
    ['chun', 'Red dragon triplet', '中', 1, 1, 'sets'],
    ['chiitoitsu', 'Seven pairs (chiitoitsu)', '七対子', 2, null, 'hand'],
    ['sanshoku', 'Mixed triple sequence', '三色同順', 2, 1, 'hand'],
    ['ittsu', 'Pure straight (ittsu)', '一気通貫', 2, 1, 'hand'],
    ['chanta', 'Outside hand (chanta)', '混全帯么九', 2, 1, 'hand'],
    ['toitoi', 'All triplets (toitoi)', '対々和', 2, 2, 'hand'],
    ['sanankou', 'Three concealed triplets', '三暗刻', 2, 2, 'hand'],
    ['sanshokuDoukou', 'Triple triplets', '三色同刻', 2, 2, 'hand'],
    ['sankantsu', 'Three kans', '三槓子', 2, 2, 'hand'],
    ['honroutou', 'All terminals and honours', '混老頭', 2, 2, 'hand'],
    ['shousangen', 'Little three dragons', '小三元', 2, 2, 'hand'],
    ['honitsu', 'Half flush (honitsu)', '混一色', 3, 2, 'hand'],
    ['junchan', 'Terminal in each set (junchan)', '純全帯么九', 3, 2, 'hand'],
    ['ryanpeikou', 'Twice pure double sequence', '二盃口', 3, null, 'hand'],
    ['chinitsu', 'Full flush (chinitsu)', '清一色', 6, 5, 'hand'],
  ];
  const RIICHI_YAKUMAN = [
    ['kokushi', 'Thirteen orphans', '国士無双'], ['suuankou', 'Four concealed triplets', '四暗刻'],
    ['daisangen', 'Big three dragons', '大三元'], ['shousuushii', 'Little four winds', '小四喜'],
    ['daisuushii', 'Big four winds', '大四喜'], ['tsuuiisou', 'All honours', '字一色'],
    ['chinroutou', 'All terminals', '清老頭'], ['ryuuiisou', 'All green', '緑一色'],
    ['chuuren', 'Nine gates', '九蓮宝燈'], ['suukantsu', 'Four kans', '四槓子'],
    ['tenhou', 'Blessing of heaven (dealer)', '天和', true], ['chiihou', 'Blessing of earth', '地和', true],
  ];
  const YAKU = {};
  RIICHI_YAKU.forEach(([id, en, zh, c, o, g]) => (YAKU[id] = { id, en, zh, closed: c, open: o, g }));
  RIICHI_YAKUMAN.forEach(([id, en, zh, flag]) => (YAKU[id] = { id, en, zh, yakuman: true, g: 'limit', flag: !!flag }));
  const ceil100 = (x) => Math.ceil(x / 100) * 100;
  function riichiBase(han, fu, ym, S) {
    if (ym > 0) return 8000 * ym;
    if (han >= 13) return S.kazoe === false ? 6000 : 8000;
    if (han >= 11) return 6000;
    if (han >= 8) return 4000;
    if (han >= 6) return 3000;
    if (han >= 5) return 2000;
    const b = fu * Math.pow(2, han + 2);
    if (b >= 2000) return 2000;
    if (S.kiriage && ((han === 4 && fu === 30) || (han === 3 && fu === 60))) return 2000;
    return b;
  }
  function riichiName(han, fu, ym, base) {
    if (ym) return (ym > 1 ? ym + '× ' : '') + 'Yakuman';
    if (base >= 8000) return 'Counted yakuman';
    if (base >= 6000) return 'Sanbaiman';
    if (base >= 4000) return 'Baiman';
    if (base >= 3000) return 'Haneman';
    if (base >= 2000) return 'Mangan';
    return han + ' han ' + fu + ' fu';
  }
  function riichiFu(v, f, ctx, S, pinfu) {
    if (v.form === 'pairs') return 25;
    if (v.form === 'orphans') return 30;
    if (pinfu) return ctx.selfDraw ? 20 : 30;
    let fu = 20;
    if (f.menzen && !ctx.selfDraw) fu += 10;
    if (ctx.selfDraw) fu += 2;
    for (const g of v.groups) {
      if (g.kind === 'tri' || g.kind === 'kan') {
        let x = 2;
        if (isTH(g.i)) x *= 2;
        if (g.concealed) x *= 2;
        if (g.kind === 'kan') x *= 4;
        fu += x;
      }
    }
    if (f.pair) {
      const p = f.pair.i;
      let pf = 0;
      if (isDragon(p)) pf += 2;
      if (p === 27 + ctx.seat) pf += 2;
      if (p === 27 + ctx.round) pf += 2;
      if (pf > 2 && +S.doubleWindPair === 2) pf = 2;
      fu += pf;
    }
    if (v.wait === 'kanchan' || v.wait === 'penchan' || v.wait === 'tanki') fu += 2;
    if (!f.menzen && fu === 20) fu = 30;
    return Math.ceil(fu / 10) * 10;
  }
  const RIICHI = {
    id: 'riichi', name: 'Japanese Riichi', native: '立直麻雀', unit: 'han', handSize: 13,
    blurb: 'Han and fu, riichi sticks, honba',
    settings: [
      { key: 'startPoints', label: 'Starting points', type: 'int', min: 1000, max: 100000, step: 1000, def: 25000 },
      { key: 'returnPoints', label: 'Target (return) points', type: 'int', min: 1000, max: 100000, step: 1000, def: 30000 },
      { key: 'uma', label: 'Uma', type: 'select', def: '20-10', options: [['20-10', '+20 / +10 / −10 / −20'], ['15-5', '+15 / +5 / −5 / −15'], ['30-10', '+30 / +10 / −10 / −30'], ['none', 'No uma']] },
      { key: 'length', label: 'Game length', type: 'select', def: 'south', options: [['south', 'Half game (East + South)'], ['east', 'East round only']] },
      { key: 'kuitan', label: 'Open tanyao allowed', type: 'bool', def: true },
      { key: 'kiriage', label: 'Round 4 han 30 fu up to mangan', type: 'bool', def: false },
      { key: 'kazoe', label: '13+ han counts as yakuman', type: 'bool', def: true },
      { key: 'doubleYakuman', label: 'Double yakuman for special waits', type: 'bool', def: false },
      { key: 'doubleWindPair', label: 'Double-wind pair', type: 'select', def: '4', options: [['4', '4 fu'], ['2', '2 fu']] },
    ],
    patterns: RIICHI_YAKU.map(([id, en, zh, c, o, g]) => P(id, en, zh, c, g, { open: o, flag: g === 'win' && id !== 'menzenTsumo' }))
      .concat(RIICHI_YAKUMAN.map(([id, en, zh, flag]) => P(id, en, zh, 'Y', 'limit', { flag: !!flag, yakuman: true }))),
    fixedValues: true,
    excl: { doubleRiichi: ['riichi'], ryanpeikou: ['iipeikou'], chinitsu: ['honitsu'], junchan: ['chanta'], chiitoitsu: ['pinfu', 'iipeikou', 'ryanpeikou'] },
    variantOpts: () => ({ handSize: 13, sevenPairs: true, quadPairs: false }),
    detect(v, ctx, S) {
      const f = feat(v), y = {};
      const seatW = 27 + ctx.seat, roundW = 27 + ctx.round;
      if (v.form === 'orphans') put(y, 'kokushi', S.doubleYakuman && v.wait === 'orphans13' ? 2 : 1);
      if (v.form === 'standard') {
        if (f.concealedTrips === 4) put(y, 'suuankou', S.doubleYakuman && v.wait === 'tanki' ? 2 : 1);
        if (f.dragonTrips === 3) put(y, 'daisangen');
        if (f.windTrips.length === 4) put(y, 'daisuushii', S.doubleYakuman ? 2 : 1);
        else if (f.windTrips.length === 3 && f.pair && isWind(f.pair.i)) put(y, 'shousuushii');
        if (f.kans.length === 4) put(y, 'suukantsu');
        const ng = nineGates(v);
        if (ng) put(y, 'chuuren', S.doubleYakuman && ng === 'pure' ? 2 : 1);
      }
      if (f.allHonors) put(y, 'tsuuiisou');
      if (f.allTerminals) put(y, 'chinroutou');
      if (v.tiles.every((i) => GREEN.has(i))) put(y, 'ryuuiisou');
      if (Object.keys(y).length) return { counts: y, fu: 0, menzen: f.menzen, limit: true };
      if (f.menzen && ctx.selfDraw) put(y, 'menzenTsumo');
      if (v.form === 'pairs') put(y, 'chiitoitsu');
      if (f.allSimples && (f.menzen || S.kuitan)) put(y, 'tanyao');
      for (const g of f.trips) {
        if (g.i === seatW) put(y, 'yakuhaiSeat');
        if (g.i === roundW) put(y, 'yakuhaiRound');
        if (g.i === 31) put(y, 'haku');
        if (g.i === 32) put(y, 'hatsu');
        if (g.i === 33) put(y, 'chun');
      }
      let pinfu = false;
      if (v.form === 'standard') {
        const seqs = f.seqs;
        const pairYaku = f.pair && (isDragon(f.pair.i) || f.pair.i === seatW || f.pair.i === roundW);
        if (f.menzen && seqs.length === 4 && !pairYaku && v.wait === 'ryanmen') { put(y, 'pinfu'); pinfu = true; }
        if (f.menzen) {
          const cnt = {};
          seqs.forEach((g) => (cnt[g.i] = (cnt[g.i] || 0) + 1));
          let dbl = 0;
          Object.values(cnt).forEach((n) => (dbl += Math.floor(n / 2)));
          if (dbl >= 2) put(y, 'ryanpeikou');
          else if (dbl === 1) put(y, 'iipeikou');
        }
        for (let n = 0; n < 7; n++) if ([0, 1, 2].every((s) => seqs.some((g) => g.i === s * 9 + n))) { put(y, 'sanshoku'); break; }
        for (let s = 0; s < 3; s++) if ([0, 3, 6].every((o) => seqs.some((g) => g.i === s * 9 + o))) { put(y, 'ittsu'); break; }
        if (!seqs.length) put(y, 'toitoi');
        if (f.concealedTrips === 3) put(y, 'sanankou');
        for (let n = 0; n < 9; n++) if ([0, 1, 2].every((s) => f.trips.some((g) => g.i === s * 9 + n))) { put(y, 'sanshokuDoukou'); break; }
        if (f.kans.length === 3) put(y, 'sankantsu');
        const outside = v.groups.every((g) => (g.kind === 'seq' ? g.i % 9 === 0 || g.i % 9 === 6 : isTH(g.i)));
        if (outside && seqs.length) put(y, f.hasHonor ? 'chanta' : 'junchan');
        if (f.dragonTrips === 2 && f.pair && isDragon(f.pair.i)) put(y, 'shousangen');
      }
      if (f.allTH && !f.allHonors && !f.allTerminals && !f.seqs.length) put(y, 'honroutou');
      if (f.suitCount === 1) put(y, f.hasHonor ? 'honitsu' : 'chinitsu');
      return { counts: y, fu: riichiFu(v, f, ctx, S, pinfu), menzen: f.menzen };
    },
    ctxCounts(c, ctx, S, input, fromTiles) {
      const r = input.riichi || {};
      if ((r.declared || []).includes(input.winner)) put(c, 'riichi');
      if (!fromTiles && r.closed !== false && ctx.selfDraw) put(c, 'menzenTsumo');
    },
    total(eff, V, S, det, ctx, input) {
      const r = input.riichi || {};
      const menzen = det ? det.menzen : r.closed !== false;
      let ym = 0, han = 0, yakuN = 0;
      for (const id in eff) {
        const y = YAKU[id], n = eff[id];
        if (!y || !n) continue;
        if (y.yakuman) { ym += n; continue; }
        const h = menzen ? y.closed : y.open;
        if (h == null) continue;
        han += h * n; yakuN++;
      }
      if (!ym && !yakuN) {
        return { valid: false, reason: 'No yaku. Dora alone does not make a winning hand.', score: 0, text: 'No yaku', rank: 0, base: 0 };
      }
      const dora = ym ? 0 : Math.max(0, +r.dora || 0);
      han += dora;
      let fu = det && det.fu ? det.fu : +r.fu || 30;
      if (!det && eff.chiitoitsu) fu = 25;
      if (!det && eff.pinfu) fu = ctx.selfDraw ? 20 : 30;
      const base = riichiBase(han, fu, ym, S);
      const dealer = ctx.isDealer;
      let pay;
      if (ctx.selfDraw) pay = dealer ? ceil100(base * 2).toLocaleString('en-US') + ' all' : ceil100(base).toLocaleString('en-US') + ' / ' + ceil100(base * 2).toLocaleString('en-US');
      else pay = ceil100(base * (dealer ? 6 : 4)).toLocaleString('en-US');
      const name = riichiName(han, fu, ym, base);
      return {
        valid: true, reason: '', score: ym ? 13 * ym : han, han, fu, dora, ym, base,
        text: name + (ym ? '' : name.indexOf('han') > -1 ? '' : ' · ' + han + ' han') + ' · ' + pay,
        rank: base * 100 + han * 10 + fu / 10,
        detail: dora ? 'includes ' + dora + ' dora' : '',
      };
    },
    pay(res, g) {
      const d = [0, 0, 0, 0], w = g.winner, st = g.state;
      const honba = st.honba || 0;
      const wDealer = w === st.dealer;
      if (!g.selfDraw) {
        const a = ceil100(res.base * (wDealer ? 6 : 4)) + 300 * honba;
        d[g.discarder] -= a; d[w] += a;
      } else {
        for (let p = 0; p < 4; p++) {
          if (p === w) continue;
          const a = ceil100(res.base * (wDealer || p === st.dealer ? 2 : 1)) + 100 * honba;
          d[p] -= a; d[w] += a;
        }
      }
      const declared = ((g.input.riichi || {}).declared || []).filter((p) => p >= 0 && p < 4);
      declared.forEach((p) => (d[p] -= 1000));
      d[w] += (st.pot || 0) + declared.length * 1000;
      return { deltas: d, pot: 0 };
    },
    drawPay(input, st) {
      const d = [0, 0, 0, 0];
      const r = input.riichi || {};
      const declared = (r.declared || []).filter((p) => p >= 0 && p < 4);
      declared.forEach((p) => (d[p] -= 1000));
      const draw = input.draw || {};
      if (!draw.abortive) {
        const t = (draw.tenpai || []).filter((p) => p >= 0 && p < 4);
        if (t.length > 0 && t.length < 4) {
          const noten = [0, 1, 2, 3].filter((p) => !t.includes(p));
          t.forEach((p) => (d[p] += 3000 / t.length));
          noten.forEach((p) => (d[p] -= 3000 / noten.length));
        }
      }
      return { deltas: d, pot: (st.pot || 0) + declared.length * 1000 };
    },
  };

  /* ============================================= TAIWANESE 16-TILE (tai) */
  const TW = {
    id: 'tw', name: 'Taiwanese 16-tile', native: '台灣麻將', unit: 'tai', handSize: 16,
    blurb: 'Base + tai, dealer and streak tai',
    settings: [
      { key: 'base', label: 'Base', zh: '底', type: 'int', min: 0, max: 100000, def: 30 },
      { key: 'perTai', label: 'Per tai', zh: '台', type: 'int', min: 0, max: 100000, def: 10 },
      { key: 'minTai', label: 'Tai needed to win', type: 'int', min: 0, max: 5, def: 0 },
    ],
    patterns: [
      P('selfDraw', 'Self-draw', '自摸', 1, 'win', { src: 'how' }),
      P('concealed', 'Concealed hand', '門清', 1, 'win', { note: 'No chow, pung or open kong' }),
      P('concealedSelfDraw', 'Concealed self-draw', '門清一摸三', 3, 'win', { note: 'Replaces 門清 + 自摸' }),
      P('allFromOthers', 'All melded, won on a discard', '全求人', 2, 'win'),
      P('singleWait', 'Single wait', '獨聽', 1, 'win', { note: 'Edge, middle or pair wait with only one winning tile' }),
      P('lastTile', 'Win on the last tile', '海底撈月', 1, 'win', { flag: true }),
      P('kongReplacement', 'Win on a kong replacement', '槓上開花', 1, 'win', { flag: true }),
      P('robbingKong', 'Robbing a kong', '搶槓', 1, 'win', { flag: true }),
      P('heavenly', 'Heavenly hand', '天胡', 24, 'win', { flag: true }),
      P('earthly', 'Earthly hand', '地胡', 16, 'win', { flag: true }),
      P('human', 'Human hand', '人胡', 8, 'win', { flag: true, note: 'Wins on a discard in the first go-round' }),
      P('seatFlower', 'Seat flower', '正花', 1, 'bonus', { max: 2 }),
      P('flowerKong', 'Full set of flowers or seasons', '花槓', 2, 'bonus', { max: 2 }),
      P('eightFlowers', 'All eight flowers', '八仙過海', 8, 'bonus'),
      P('sevenRobOne', 'Seven flowers, robbing the eighth', '七搶一', 8, 'bonus', { flag: true }),
      P('dragonPung', 'Dragon pung', '三元牌', 1, 'sets', { max: 3 }),
      P('roundWind', 'Round wind pung', '圈風', 1, 'sets'),
      P('seatWind', 'Seat wind pung', '門風', 1, 'sets'),
      P('pingHu', 'All chows (ping hu)', '平胡', 2, 'hand', { note: 'All chows, no flowers or honours, two-sided wait, on a discard' }),
      P('threeConcealed', 'Three concealed pungs', '三暗刻', 2, 'hand'),
      P('allPungs', 'All pungs', '碰碰胡', 4, 'hand'),
      P('mixedSuit', 'Half flush (one suit + honours)', '混一色', 4, 'hand'),
      P('smallDragons', 'Small three dragons', '小三元', 4, 'hand'),
      P('fourConcealed', 'Four concealed pungs', '四暗刻', 5, 'hand'),
      P('pureSuit', 'Full flush (one suit only)', '清一色', 8, 'hand'),
      P('fiveConcealed', 'Five concealed pungs', '五暗刻', 8, 'hand'),
      P('bigDragons', 'Big three dragons', '大三元', 8, 'hand'),
      P('smallWinds', 'Small four winds', '小四喜', 8, 'hand'),
      P('allHonors', 'All honours', '字一色', 16, 'hand'),
      P('bigWinds', 'Big four winds', '大四喜', 16, 'hand'),
    ],
    excl: {
      concealedSelfDraw: ['selfDraw', 'concealed'], allFromOthers: ['singleWait'],
      allHonors: ['allPungs', 'mixedSuit'], bigDragons: ['dragonPung', 'smallDragons'], smallDragons: ['dragonPung'],
      bigWinds: ['seatWind', 'roundWind', 'smallWinds'], smallWinds: ['seatWind', 'roundWind'],
      fiveConcealed: ['fourConcealed', 'threeConcealed'], fourConcealed: ['threeConcealed'],
      pureSuit: ['mixedSuit'], eightFlowers: ['seatFlower', 'flowerKong'], sevenRobOne: ['seatFlower', 'flowerKong'],
    },
    variantOpts: () => ({ handSize: 16, sevenPairs: false }),
    detect(v, ctx, S, h) {
      const f = feat(v), c = {};
      const b = bonusInfo(h.bonus, ctx.seat);
      if (f.menzen && ctx.selfDraw) put(c, 'concealedSelfDraw');
      else if (f.menzen) put(c, 'concealed');
      const openCount = h.melds.filter((m) => !m.concealed).length;
      if (openCount === 5 && !ctx.selfDraw) put(c, 'allFromOthers');
      const w = waits(h, { handSize: 16 });
      if (w.length === 1) put(c, 'singleWait');
      if (b.F.size === 4 && b.S.size === 4) put(c, 'eightFlowers');
      else { put(c, 'flowerKong', b.fullSets); put(c, 'seatFlower', b.seatOutsideSets); }
      const pairDragon = f.pair && isDragon(f.pair.i), pairWind = f.pair && isWind(f.pair.i);
      if (f.dragonTrips === 3) put(c, 'bigDragons');
      else if (f.dragonTrips === 2 && pairDragon) put(c, 'smallDragons');
      else put(c, 'dragonPung', f.dragonTrips);
      if (f.windTrips.length === 4) put(c, 'bigWinds');
      else if (f.windTrips.length === 3 && pairWind) put(c, 'smallWinds');
      else {
        if (f.windTrips.some((g) => g.i === 27 + ctx.round)) put(c, 'roundWind');
        if (f.windTrips.some((g) => g.i === 27 + ctx.seat)) put(c, 'seatWind');
      }
      if (!f.trips.length && !b.total && !f.hasHonor && !ctx.selfDraw && v.wait === 'ryanmen' && w.length > 1) put(c, 'pingHu');
      if (!f.seqs.length) put(c, 'allPungs');
      if (f.concealedTrips >= 5) put(c, 'fiveConcealed');
      else if (f.concealedTrips === 4) put(c, 'fourConcealed');
      else if (f.concealedTrips === 3) put(c, 'threeConcealed');
      if (f.allHonors) put(c, 'allHonors');
      else if (f.suitCount === 1) put(c, f.hasHonor ? 'mixedSuit' : 'pureSuit');
      return { counts: c };
    },
    ctxCounts(c, ctx) { if (ctx.selfDraw && !c.concealedSelfDraw) put(c, 'selfDraw'); },
    total(eff, V, S, det, ctx, input, st) {
      const { sum } = sumCounts(eff, V, TW.patterns);
      const dealerTai = 1 + 2 * ((st && st.streak) || 0);
      return {
        valid: sum >= (S.minTai || 0), reason: sum >= (S.minTai || 0) ? '' : 'Needs ' + S.minTai + ' tai to win.',
        score: sum, text: sum + ' tai', rank: sum, dealerTai,
        detail: 'Dealer adds ' + dealerTai + ' tai when involved',
      };
    },
    pay(res, g) {
      const d = [0, 0, 0, 0], w = g.winner, dealer = g.state.dealer;
      const amount = (p) => g.S.base + g.S.perTai * (res.score + (w === dealer || p === dealer ? res.dealerTai : 0));
      for (let p = 0; p < 4; p++) {
        if (p === w) continue;
        if (!g.selfDraw && p !== g.discarder) continue;
        const a = amount(p);
        d[p] -= a; d[w] += a;
      }
      return { deltas: d };
    },
  };

  /* ========================================= CHINESE OFFICIAL / MCR (fan) */
  // Manual only in the MVP: 81 fan with values; [id, en, zh, fan, max]
  const MCR_LIST = [
    ['bigFourWinds', 'Big four winds', '大四喜', 88], ['bigThreeDragons', 'Big three dragons', '大三元', 88], ['allGreen', 'All green', '绿一色', 88],
    ['nineGates', 'Nine gates', '九莲宝灯', 88], ['fourKongs', 'Four kongs', '四杠', 88], ['sevenShiftedPairs', 'Seven shifted pairs', '连七对', 88],
    ['thirteenOrphans', 'Thirteen orphans', '十三幺', 88],
    ['allTerminals', 'All terminals', '清幺九', 64], ['littleFourWinds', 'Little four winds', '小四喜', 64], ['littleThreeDragons', 'Little three dragons', '小三元', 64],
    ['allHonors', 'All honours', '字一色', 64], ['fourConcealedPungs', 'Four concealed pungs', '四暗刻', 64], ['pureTerminalChows', 'Pure terminal chows', '一色双龙会', 64],
    ['quadrupleChow', 'Quadruple chow', '一色四同顺', 48], ['fourPureShiftedPungs', 'Four pure shifted pungs', '一色四节高', 48],
    ['fourPureShiftedChows', 'Four pure shifted chows', '一色四步高', 32], ['threeKongs', 'Three kongs', '三杠', 32], ['allTerminalsHonors', 'All terminals and honours', '混幺九', 32],
    ['sevenPairs', 'Seven pairs', '七对', 24], ['greaterHonorsKnitted', 'Greater honours and knitted tiles', '七星不靠', 24], ['allEvenPungs', 'All even pungs', '全双刻', 24],
    ['fullFlush', 'Full flush', '清一色', 24], ['pureTripleChow', 'Pure triple chow', '一色三同顺', 24], ['pureShiftedPungs', 'Pure shifted pungs', '一色三节高', 24],
    ['upperTiles', 'Upper tiles', '全大', 24], ['middleTiles', 'Middle tiles', '全中', 24], ['lowerTiles', 'Lower tiles', '全小', 24],
    ['pureStraight', 'Pure straight', '清龙', 16], ['threeSuitedTerminalChows', 'Three-suited terminal chows', '三色双龙会', 16], ['pureShiftedChows', 'Pure shifted chows', '一色三步高', 16],
    ['allFives', 'All fives', '全带五', 16], ['triplePung', 'Triple pung', '三同刻', 16], ['threeConcealedPungs', 'Three concealed pungs', '三暗刻', 16],
    ['lesserHonorsKnitted', 'Lesser honours and knitted tiles', '全不靠', 12], ['knittedStraight', 'Knitted straight', '组合龙', 12], ['upperFour', 'Upper four', '大于五', 12],
    ['lowerFour', 'Lower four', '小于五', 12], ['bigThreeWinds', 'Big three winds', '三风刻', 12],
    ['mixedStraight', 'Mixed straight', '花龙', 8], ['reversibleTiles', 'Reversible tiles', '推不倒', 8], ['mixedTripleChow', 'Mixed triple chow', '三色三同顺', 8],
    ['mixedShiftedPungs', 'Mixed shifted pungs', '三色三节高', 8], ['chickenHand', 'Chicken hand', '无番和', 8], ['lastTileDraw', 'Last tile draw', '妙手回春', 8],
    ['lastTileClaim', 'Last tile claim', '海底捞月', 8], ['outWithReplacement', 'Out with replacement tile', '杠上开花', 8], ['robbingTheKong', 'Robbing the kong', '抢杠和', 8],
    ['allPungs', 'All pungs', '碰碰和', 6], ['halfFlush', 'Half flush', '混一色', 6], ['mixedShiftedChows', 'Mixed shifted chows', '三色三步高', 6],
    ['allTypes', 'All types', '五门齐', 6], ['meldedHand', 'Melded hand', '全求人', 6], ['twoConcealedKongs', 'Two concealed kongs', '双暗杠', 6],
    ['twoDragonPungs', 'Two dragon pungs', '双箭刻', 6],
    ['outsideHand', 'Outside hand', '全带幺', 4], ['fullyConcealed', 'Fully concealed hand', '不求人', 4], ['twoMeldedKongs', 'Two melded kongs', '双明杠', 4],
    ['lastTile', 'Last of its kind', '和绝张', 4],
    ['dragonPung', 'Dragon pung', '箭刻', 2, 2], ['prevalentWind', 'Prevalent wind', '圈风刻', 2], ['seatWind', 'Seat wind', '门风刻', 2],
    ['concealedHand', 'Concealed hand', '门前清', 2], ['allChows', 'All chows', '平和', 2], ['tileHog', 'Tile hog', '四归一', 2, 3],
    ['doublePung', 'Double pung', '双同刻', 2, 2], ['twoConcealedPungs', 'Two concealed pungs', '双暗刻', 2], ['concealedKong', 'Concealed kong', '暗杠', 2],
    ['allSimples', 'All simples', '断幺', 2],
    ['pureDoubleChow', 'Pure double chow', '一般高', 1, 2], ['mixedDoubleChow', 'Mixed double chow', '喜相逢', 1, 2], ['shortStraight', 'Short straight', '连六', 1, 2],
    ['twoTerminalChows', 'Two terminal chows', '老少副', 1, 2], ['pungTerminalsHonors', 'Pung of terminals or honours', '幺九刻', 1, 4], ['meldedKong', 'Melded kong', '明杠', 1],
    ['oneVoidedSuit', 'One voided suit', '缺一门', 1], ['noHonors', 'No honours', '无字', 1], ['edgeWait', 'Edge wait', '边张', 1],
    ['closedWait', 'Closed wait', '嵌张', 1], ['singleWait', 'Single wait', '单钓将', 1], ['selfDrawn', 'Self-drawn', '自摸', 1],
    ['flowers', 'Flower tiles (each)', '花牌', 1, 8],
  ];
  const MCR = {
    id: 'mcr', name: 'Chinese Official', native: '国标麻将', unit: 'fan', handSize: 13, manualOnly: true,
    blurb: '81 fan, 8 to win. Tick the fan yourself',
    settings: [
      { key: 'minFan', label: 'Fan needed to win (flowers excluded)', type: 'int', min: 0, max: 20, def: 8 },
      { key: 'base', label: 'Base points from each opponent', type: 'int', min: 0, max: 100, def: 8 },
    ],
    patterns: MCR_LIST.map(([id, en, zh, fan, max]) => P(id, en, zh, fan, 'f' + fan, { max: max || 1, src: id === 'selfDrawn' ? 'how' : undefined })),
    fixedValues: true,
    excl: {
      fullyConcealed: ['selfDrawn', 'concealedHand'], lastTileDraw: ['selfDrawn'], outWithReplacement: ['selfDrawn'],
      bigThreeDragons: ['dragonPung', 'twoDragonPungs'], littleThreeDragons: ['dragonPung', 'twoDragonPungs'], twoDragonPungs: ['dragonPung'],
      fullFlush: ['oneVoidedSuit', 'noHonors'], sevenPairs: ['concealedHand', 'singleWait', 'fullyConcealed'],
    },
    ctxCounts(c, ctx) { if (ctx.selfDraw) put(c, 'selfDrawn'); },
    total(eff, V, S) {
      let fan = 0;
      for (const p of MCR.patterns) if (eff[p.id]) fan += p.v * eff[p.id];
      const flowers = eff.flowers || 0;
      const core = fan - flowers;
      return {
        valid: core >= S.minFan, reason: core >= S.minFan ? '' : 'Needs ' + S.minFan + ' fan before flowers. This hand has ' + core + '.',
        score: fan, text: fan + ' fan', rank: fan,
      };
    },
    pay(res, g) {
      const d = [0, 0, 0, 0], w = g.winner;
      for (let p = 0; p < 4; p++) {
        if (p === w) continue;
        const a = g.selfDraw || p === g.discarder ? g.S.base + res.score : g.S.base;
        d[p] -= a; d[w] += a;
      }
      return { deltas: d };
    },
  };

  /* ========================================================== CUSTOM */
  const CUSTOM = {
    id: 'custom', name: 'Custom points', native: '自訂', unit: 'pts', handSize: 13, manualOnly: true, valueEntry: true,
    blurb: 'Type the hand value, choose who loses the points',
    settings: [
      { key: 'discard', label: 'On a discard', type: 'select', def: 'discarder', options: [['discarder', 'Discarder loses the value'], ['double', 'Discarder loses double, others single']] },
      { key: 'selfMult', label: 'Self-draw: each player loses × value', type: 'int', min: 1, max: 4, def: 1 },
      { key: 'keepOnDraw', label: 'Dealer stays on a draw', type: 'bool', def: true },
    ],
    patterns: [],
    fixedValues: true,
    total(eff, V, S, det, ctx, input) {
      const v = Math.max(0, +input.value || 0);
      return { valid: v > 0, reason: v > 0 ? '' : 'Enter the hand value.', score: v, text: v + ' pts' + (input.label ? ' · ' + input.label : ''), rank: v };
    },
    pay(res, g) {
      const d = [0, 0, 0, 0], w = g.winner, V = res.score;
      for (let p = 0; p < 4; p++) {
        if (p === w) continue;
        let a;
        if (g.selfDraw) a = V * (g.S.selfMult || 1);
        else if (g.S.discard === 'double') a = p === g.discarder ? 2 * V : V;
        else a = p === g.discarder ? V : 0;
        d[p] -= a; d[w] += a;
      }
      return { deltas: d };
    },
  };

  const RULES = { hk: HK, sg: SG, riichi: RIICHI, tw: TW, mcr: MCR, custom: CUSTOM };
  const ORDER = ['hk', 'sg', 'riichi', 'tw', 'mcr', 'custom'];

  /* ============================================================ GAME */
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function defaults(R) { const s = {}; R.settings.forEach((x) => (s[x.key] = x.def)); return s; }
  function valuesOf(game) {
    const R = RULES[game.ruleset], V = {};
    R.patterns.forEach((p) => (V[p.id] = p.v));
    if (!R.fixedValues) Object.assign(V, game.values || {});
    return V;
  }
  function newGame(opts) {
    const R = RULES[opts.ruleset];
    const now = Date.now();
    return {
      id: uid(), v: 1, createdAt: now, updatedAt: now,
      name: opts.name || '', ruleset: R.id,
      settings: Object.assign(defaults(R), opts.settings || {}),
      money: Object.assign({ per: 0, symbol: '' }, opts.money || {}),
      values: opts.values || {},
      players: opts.players.map((p) => ({ name: String(p.name || '').slice(0, 24) })),
      start: { dealer: opts.dealer || 0 },
      state: { round: 0, dealer: opts.dealer || 0, streak: 0, honba: 0, pot: 0, handNo: 0 },
      entries: [], finished: false,
    };
  }
  const seatOf = (game, p, st) => ((p - (st || game.state).dealer + 4) % 4);
  function applyExclusions(R, counts) {
    const eff = Object.assign({}, counts), by = {};
    const ex = R.excl || {};
    for (const id in counts) {
      if (!counts[id]) continue;
      for (const x of ex[id] || []) if (eff[x]) { by[x] = id; delete eff[x]; }
    }
    return { eff, by };
  }
  function bestReading(R, h, ctx, S, V, input) {
    const vs = variants(h, ctx.selfDraw, R.variantOpts(S, V));
    let top = null;
    for (const v of vs) {
      const det = R.detect(v, ctx, S, h);
      const c = Object.assign({}, det.counts);
      if (R.ctxCounts) R.ctxCounts(c, ctx, S, input, true);
      const res = R.total(applyExclusions(R, c).eff, V, S, det, ctx, input, {});
      if (!top || res.rank > top.rank) top = { rank: res.rank, det, v };
    }
    return top ? Object.assign({}, top.det, { variant: top.v }) : null;
  }

  function evaluate(game, input) {
    const R = RULES[game.ruleset], S = game.settings, st = game.state, V = valuesOf(game);
    if (input.outcome === 'draw') {
      const r = R.drawPay ? R.drawPay(input, st, S) : { deltas: [0, 0, 0, 0], pot: st.pot || 0 };
      return { valid: true, outcome: 'draw', text: 'Draw', deltas: r.deltas, pot: r.pot, counts: {}, eff: {}, by: {} };
    }
    const w = input.winner;
    const selfDraw = input.how === 'self';
    let missing = '';
    if (w == null) missing = 'Pick who won.';
    else if (!selfDraw && (input.discarder == null || input.discarder === w)) missing = 'Pick who discarded the winning tile.';
    const ctx = { selfDraw, seat: w == null ? 0 : seatOf(game, w), round: st.round % 4, isDealer: w === st.dealer, dealer: st.dealer };
    let det = null, tileCheck = null, tileNote = '';
    if (input.tiles && R.detect) {
      tileCheck = checkHand(input.tiles, R.handSize);
      if (tileCheck.ok && w != null) {
        det = bestReading(R, input.tiles, ctx, S, V, input);
        if (!det) tileNote = 'These tiles don’t form a winning hand. Fix the tiles or tick the patterns yourself.';
      }
    }
    const counts = det ? Object.assign({}, det.counts) : {};
    if (R.ctxCounts) R.ctxCounts(counts, ctx, S, input, !!det);
    const auto = Object.assign({}, counts);
    const manual = input.manual || {};
    for (const id in manual) { if (manual[id] > 0) counts[id] = manual[id]; else delete counts[id]; }
    const { eff, by } = applyExclusions(R, counts);
    const res = R.total(eff, V, S, det, ctx, input, st);
    if (missing) { res.valid = false; res.reason = missing; }
    let deltas = [0, 0, 0, 0], pot = st.pot || 0;
    if (res.valid) {
      const pr = R.pay(res, { winner: w, discarder: input.discarder, selfDraw, state: st, S, input });
      deltas = pr.deltas;
      if (pr.pot != null) pot = pr.pot;
      if (input.liable != null && input.liable !== w && game.ruleset !== 'riichi') {
        let owed = 0;
        for (let p = 0; p < 4; p++) if (p !== w) { owed -= deltas[p]; deltas[p] = 0; }
        deltas[input.liable] = -owed;
      }
    }
    return Object.assign({}, res, { outcome: 'win', counts, auto, eff, by, det, ctx, tileCheck, tileNote, deltas, pot, V });
  }

  function nextState(game, entry) {
    const st = Object.assign({}, game.state);
    const id = game.ruleset, S = game.settings;
    const win = entry.outcome === 'win';
    const dealerWon = win && entry.winner === st.dealer;
    let keep;
    if (id === 'mcr') keep = false;
    else if (id === 'riichi') keep = win ? dealerWon : !!(entry.draw && (entry.draw.abortive || (entry.draw.tenpai || []).includes(st.dealer)));
    else if (id === 'tw') keep = win ? dealerWon : true;
    else keep = win ? dealerWon : !!S.keepOnDraw;
    st.handNo = (st.handNo || 0) + 1;
    if (id === 'riichi') { st.honba = win && !dealerWon ? 0 : (st.honba || 0) + 1; st.pot = entry.pot || 0; }
    if (keep) st.streak = (st.streak || 0) + 1;
    else {
      st.streak = 0;
      st.dealer = (st.dealer + 1) % 4;
      if (st.dealer === game.start.dealer) st.round += 1;
    }
    return st;
  }
  function recordHand(game, input) {
    const r = evaluate(game, input);
    if (!r.valid) throw new Error(r.reason || 'Invalid hand');
    const R = RULES[game.ruleset];
    const names = [];
    if (r.outcome === 'win') {
      for (const p of R.patterns) if (r.eff[p.id]) names.push((p.zh || p.en) + (r.eff[p.id] > 1 ? ' ×' + r.eff[p.id] : ''));
    }
    const entry = {
      id: uid(), kind: 'hand', at: Date.now(), outcome: r.outcome,
      winner: r.outcome === 'win' ? input.winner : null,
      how: r.outcome === 'win' ? input.how : null,
      discarder: r.outcome === 'win' && input.how !== 'self' ? input.discarder : null,
      liable: input.liable != null ? input.liable : null,
      draw: input.outcome === 'draw' ? input.draw || {} : null,
      riichi: input.riichi || null,
      tiles: input.tiles || null,
      manual: input.manual || {},
      value: input.value, label: input.label || '',
      text: r.text, score: r.score || 0, patterns: names, counts: r.eff,
      deltas: r.deltas.map((x) => Math.round(x * 1000) / 1000), pot: r.pot,
      before: Object.assign({}, game.state),
    };
    game.entries.push(entry);
    game.state = nextState(game, entry);
    game.updatedAt = Date.now();
    return entry;
  }
  function recordSide(game, deltas, label) {
    const entry = { id: uid(), kind: 'side', at: Date.now(), label: label || 'Adjustment', deltas: deltas.slice(), before: Object.assign({}, game.state) };
    game.entries.push(entry);
    game.updatedAt = Date.now();
    return entry;
  }
  function undo(game) {
    const e = game.entries.pop();
    if (e) { game.state = e.before; game.updatedAt = Date.now(); }
    return e;
  }
  function totals(game) {
    const start = game.ruleset === 'riichi' ? +game.settings.startPoints || 0 : 0;
    const t = [start, start, start, start];
    for (const e of game.entries) e.deltas.forEach((d, p) => (t[p] += d));
    return t.map((x) => Math.round(x * 1000) / 1000);
  }
  function standings(game) {
    const t = totals(game);
    const order = [0, 1, 2, 3].sort((a, b) => t[b] - t[a] || a - b);
    const rows = order.map((p, rank) => ({ p, rank, points: t[p] }));
    if (game.ruleset === 'riichi') {
      const S = game.settings;
      const uma = { '20-10': [20, 10, -10, -20], '15-5': [15, 5, -5, -15], '30-10': [30, 10, -10, -30], none: [0, 0, 0, 0] }[S.uma] || [0, 0, 0, 0];
      const oka = ((+S.returnPoints - +S.startPoints) * 4) / 1000;
      rows.forEach((r) => {
        r.final = Math.round(((r.points - +S.returnPoints) / 1000 + uma[r.rank] + (r.rank === 0 ? oka : 0)) * 10) / 10;
      });
      // The pot left on the table goes to first place
      if (game.state.pot) rows[0].final = Math.round((rows[0].final + game.state.pot / 1000) * 10) / 10;
    }
    return rows;
  }
  function roundLabel(game, st) {
    st = st || game.state;
    const w = WINDS[st.round % 4];
    const n = ((st.dealer - game.start.dealer + 4) % 4) + 1;
    let s = w + ' ' + n;
    if (game.ruleset === 'riichi' && st.honba) s += ' · ' + st.honba + ' honba';
    else if (game.ruleset !== 'riichi' && game.ruleset !== 'mcr' && st.streak) s += ' · streak ' + st.streak;
    return s;
  }
  function gameComplete(game) {
    const st = game.state;
    if (game.ruleset === 'riichi') return st.round >= (game.settings.length === 'east' ? 1 : 2);
    return st.round >= 4;
  }


  /* ====================================================== SETTLEMENT */
  // Fewest transfers that settle net amounts (positive = is owed, negative = owes).
  // Exact debtor/creditor matches are paired first, then largest debtor pays largest creditor.
  function settle(nets, eps) {
    eps = eps == null ? 0.005 : eps;
    const round = (x) => Math.round(x * 100) / 100;
    const cred = [], debt = [];
    nets.forEach((v, p) => { v = +v || 0; if (v > eps) cred.push({ p, v }); else if (v < -eps) debt.push({ p, v: -v }); });
    const out = [];
    for (const d of debt) {
      const k = cred.findIndex((c) => c.v > eps && Math.abs(c.v - d.v) <= eps);
      if (k > -1) { out.push({ from: d.p, to: cred[k].p, amount: round(d.v) }); cred[k].v = 0; d.v = 0; }
    }
    cred.sort((a, b) => b.v - a.v); debt.sort((a, b) => b.v - a.v);
    let i = 0, j = 0;
    while (i < debt.length && j < cred.length) {
      if (debt[i].v <= eps) { i++; continue; }
      if (cred[j].v <= eps) { j++; continue; }
      const a = Math.min(debt[i].v, cred[j].v);
      out.push({ from: debt[i].p, to: cred[j].p, amount: round(a) });
      debt[i].v -= a; cred[j].v -= a;
    }
    return out;
  }
  // Net money per player for a game: points × money per point (Riichi: final score × money per 1,000).
  function moneyNets(game) {
    const per = +(game.money && game.money.per) || 0;
    const rows = standings(game);
    const nets = [0, 0, 0, 0];
    rows.forEach((r) => { nets[r.p] = game.ruleset === 'riichi' ? (r.final || 0) * per : r.points * per; });
    return nets;
  }

  /* ============================================================ SCAN */
  function scanPrompt(R) {
    const size = R.handSize + 1;
    return [
      'This photo shows a finished mahjong hand: the winning player\'s tiles laid face up. Read every tile.',
      '',
      'Tile codes:',
      '- Characters (a Chinese numeral above a red 萬 or 万): 1m to 9m',
      '- Dots / circles (筒, 餅): 1p to 9p',
      '- Bamboo (索, 條; the 1 is usually a bird): 1s to 9s',
      '- Winds: 1z East 東, 2z South 南, 3z West 西, 4z North 北',
      '- Dragons: 5z White 白 (blank or a blue frame), 6z Green 發, 7z Red 中',
      '- Flowers 梅 蘭 菊 竹 (plum, orchid, chrysanthemum, bamboo, numbered 1-4): F1 to F4',
      '- Seasons 春 夏 秋 冬 (numbered 1-4): S1 to S4',
      '- Animals: A1 cat, A2 mouse, A3 rooster, A4 centipede',
      '',
      'Group the tiles the way they are laid out:',
      '- "hand": the tiles in the main row, including the winning tile.',
      '- "melds": sets placed apart from the main row (exposed chow, pung or kong). A kong shown with face-down tiles is concealed.',
      '- "bonus": flower, season and animal tiles.',
      '- "win": the code of the winning tile if it is set apart or turned sideways, otherwise null.',
      '- "redFives": how many red five tiles you see (Japanese sets), else 0.',
      '',
      'A complete ' + (R.handSize === 16 ? 'Taiwanese 16-tile' : '13-tile') + ' winning hand has ' + size + ' tiles when each kong counts as 3. If you count a different number, recheck the photo, then report what you actually see.',
      'List each tile once, left to right. If a tile is unclear, give your best guess and describe it in "unsure".',
      '',
      'Reply with only JSON in this shape:',
      '{"hand":["1m","2m","3m"],"melds":[{"type":"pung","tiles":["5p","5p","5p"],"concealed":false}],"bonus":["F1"],"win":null,"redFives":0,"unsure":["third tile from left could be 3s or 5s"],"note":""}',
    ].join('\n');
  }
  function parseScan(j, R) {
    const out = { tiles: emptyHand(), redFives: 0, unsure: [], note: '' };
    if (!j || typeof j !== 'object') return out;
    const hand = [], bonus = [];
    const take = (arr) => (Array.isArray(arr) ? arr : []).map(norm).filter(Boolean);
    for (const c of take(j.hand)) (isBonus(c) ? bonus : hand).push(c);
    for (const c of take(j.bonus)) if (isBonus(c)) bonus.push(c);
    const melds = [];
    for (const m of Array.isArray(j.melds) ? j.melds : []) {
      const ts = take(m && m.tiles).filter(isTile);
      if (ts.length < 3) { hand.push(...ts); continue; }
      const idx = ts.map(ix).sort((a, b) => a - b);
      const same = idx.every((x) => x === idx[0]);
      if (same && ts.length >= 4) melds.push({ type: 'kan', tile: cd(idx[0]), concealed: !!m.concealed });
      else if (same && ts.length === 3) melds.push({ type: 'pon', tile: cd(idx[0]) });
      else if (ts.length === 3 && idx[0] < 27 && idx[1] === idx[0] + 1 && idx[2] === idx[0] + 2 && suitOf(idx[0]) === suitOf(idx[2])) melds.push({ type: 'chi', tile: cd(idx[0]) });
      else hand.push(...ts);
    }
    let win = norm(j.win);
    if (win && !isTile(win)) win = null;
    if (win && !hand.includes(win) && hand.length + melds.length * 3 < R.handSize + 1) hand.push(win);
    if (win && !hand.includes(win)) win = null;
    if (!win && hand.length) win = hand[hand.length - 1];
    out.tiles = { hand, melds, win, bonus: Array.from(new Set(bonus)) };
    out.redFives = Math.max(0, Math.min(4, +j.redFives || 0));
    out.unsure = (Array.isArray(j.unsure) ? j.unsure : []).map(String).filter(Boolean).slice(0, 6);
    out.note = typeof j.note === 'string' ? j.note.slice(0, 300) : '';
    return out;
  }
  // Compact text form, e.g. "123m 456p 11z | pon:5p kan*:7z | F1 | win:3m"
  function handToText(h) {
    const parts = [sortTiles(h.hand).join(' ')];
    if (h.melds.length) parts.push(h.melds.map((m) => m.type + (m.concealed ? '*' : '') + ':' + m.tile).join(' '));
    if (h.bonus.length) parts.push(h.bonus.join(' '));
    if (h.win) parts.push('win:' + h.win);
    return parts.join(' | ');
  }
  // Test helper: "123m456p789s11z22z" style → codes
  function parse(str) {
    const out = [];
    const re = /([0-9]+)([mpsz])|([FSA][1-4])/g;
    let m;
    while ((m = re.exec(str))) {
      if (m[3]) out.push(m[3]);
      else for (const d of m[1]) out.push(norm(d + m[2]));
    }
    return out;
  }

  return {
    version: '1.0.0',
    RULES, ORDER, GROUPS, WINDS, WINDS_ZH, BONUS_NAMES,
    norm, isBonus, isTile, ix, cd, tileName, sortTiles, emptyHand, checkHand, parse,
    variants, waits, decompose,
    hkPoints, riichiBase,
    newGame, evaluate, recordHand, recordSide, undo, totals, standings, seatOf, roundLabel, gameComplete, valuesOf,
    scanPrompt, parseScan, handToText,
    settle, moneyNets,
  };
});
