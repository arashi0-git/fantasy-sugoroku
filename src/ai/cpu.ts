// CPU の判断。いまの state と性格から、次に出す行動を1つ決める。
// ルールは変えず、core/game.ts の公開関数だけを使って考える。

import { BOARD, GroupId } from '../data/board';
import { CardId } from '../data/cards';
import { CONFIG, LEVEL } from '../data/config';
import {
  Action,
  actorOf,
  canFly,
  cardUsable,
  flyTargets,
  islandImmune,
  PUSH_DIRS,
  PushDir,
  Aim,
  AIM_ZONES,
  blessingTargets,
  buildOptions,
  buyOptions,
  buyoutPrice,
  canBuyout,
  missionProgress,
  raidPrice,
  raidTargets,
  completedGroups,
  earthquakeTargets,
  festivalLimit,
  festivalTargets,
  GameState,
  GROUP_SQUARES,
  isLand,
  isTourist,
  landPrice,
  LevelOption,
  ownedSquares,
  rankByAssets,
  rentAt,
  rentOf,
  sealTargets,
  sellValue,
  touristCount,
  TOURIST_SQUARES,
  TRAVEL,
  travelTargets,
  TRIPLE_GROUPS,
} from '../core/game';
import { Personality } from './personality';

/** 0以上1未満の乱数を返す関数（テストではシード付き、画面では Math.random） */
export type Rand = () => number;

/**
 * いま行動を決める CPU（actorOf(s)）の次の行動。
 * 守りのカードの割り込みでは、手番の人ではなく割り込む人の性格を pers に渡す。
 */
export function decideCpu(s: GameState, pers: Personality, rand: Rand): Action {
  const p = s.players[actorOf(s)];
  const ph = s.phase;

  switch (ph.kind) {
    case 'roll': {
      const card = chooseAttackCard(s, pers);
      if (card) return card;
      const flight = chooseFly(s, pers);
      if (flight !== null) return { type: 'fly', square: flight };
      if (p.islandTurns > 0 && wantsEscape(s, pers)) return { type: 'payEscape' };
      return { type: 'roll', aim: chooseAim(s, pers, rand) };
    }

    case 'adjust':
      return { type: 'adjust', delta: chooseAdjust(s, pers, ph.sum) };

    case 'puppet':
      return { type: 'puppet', delta: choosePuppet(s, ph.responder, ph.sum) };

    case 'push': {
      const best = choosePush(s);
      return best ? { type: 'push', target: best.target, dir: best.dir } : { type: 'pass' };
    }

    case 'gamble': {
      // 勝負は得なので、負けても余裕が残るとき、または払えないときの一発逆転で勝負する
      const lose = Math.round(ph.rent * CONFIG.gambleLose);
      return { type: 'gamble', use: p.money - lose >= pers.reserve || p.money < ph.rent };
    }

    case 'react':
      return { type: 'react', use: wantsGuard(s, pers, p.id) };

    case 'pick':
      return { type: 'pick', index: ph.options.indexOf(maxByKey(ph.options, (c) => cardValue(pers, c, p.hand))) };

    case 'discard': {
      // いちばん価値の低いカードを捨てる（同じカードが重なっているほど価値は下がる）
      const values = p.hand.map((c, i) => cardValue(pers, c, [...p.hand.slice(0, i), ...p.hand.slice(i + 1)]));
      return { type: 'discard', index: values.indexOf(Math.min(...values)) };
    }

    case 'buy':
      return decideBuy(s, pers, ph.square);

    case 'build':
      return decideBuild(s, pers, ph.square);

    case 'buyout':
      return decideBuyout(s, pers, ph.square);

    case 'festival':
      return { type: 'choose', square: maxBy(festivalTargets(s), (sq) => rentAt(sq, s.properties[sq].level)) };

    case 'blessing': {
      // 通行料がいちばん上がる土地を上げる。策士は揃えかけの色グループを優先
      const gain = (sq: number) => {
        const lv = s.properties[sq].level;
        const up = rentAt(sq, lv + 1) - rentAt(sq, lv);
        return pers.id === 'schemer' && ownedInGroup(s, sq, p.id) >= 2 ? up * 1.5 : up;
      };
      return { type: 'choose', square: maxBy(blessingTargets(s), gain) };
    }

    case 'travel':
      return {
        type: 'choose',
        square: maxBy(travelTargets(), (sq) => squareValue(s, pers, sq) + (sq < TRAVEL ? 30 : 0)),
      };

    case 'liquidate':
      return { type: 'sell', square: pickToSell(s, pers) };

    case 'gameover':
      throw new Error('ゲームは終わっています');
  }
}

// ---------- 手札カード ----------

/** カードの価値（性格ごと）。手札に同じカードが多いほど下がる */
function cardValue(pers: Personality, card: CardId, otherHand: CardId[]): number {
  const base: Record<CardId, number> = {
    destiny: 9, raid: 8, seal: 7, barrier: 7, mirror: 6, earthquake: 6, angel: 6, growth: 6, tailwind: 5, festival: 5, treasure: 3, tax: 0, fog: 0,
  };
  const bonus: Record<string, Partial<Record<CardId, number>>> = {
    bold: { earthquake: 2, seal: 1, treasure: 1, raid: 1 },
    careful: { angel: 3, barrier: 2, mirror: 1 },
    schemer: { seal: 2, destiny: 1, barrier: 1, raid: 2 },
  };
  const dup = otherHand.filter((c) => c === card).length;
  return base[card] + (bonus[pers.id][card] ?? 0) - dup * 1.5;
}

/** 独占勝利まであと1つの相手（色グループ2つ、または観光地3つ） */
function reachPlayers(s: GameState): number[] {
  return s.players
    .filter((x) => !x.bankrupt && x.id !== s.current)
    .filter((x) => completedGroups(s, x.id).length >= TRIPLE_GROUPS - 1 || touristCount(s, x.id) >= TOURIST_SQUARES.length - 1)
    .map((x) => x.id);
}

/** サイコロを振る前に使う攻めのカード。使わないなら null */
function chooseAttackCard(s: GameState, pers: Personality): Action | null {
  const p = s.players[s.current];
  const can = (c: CardId) => p.hand.includes(c) && cardUsable(s, c).ok;
  const leader = rankByAssets(s).find((id) => id !== p.id);
  const reach = reachPlayers(s);

  // 封印の鎖：独占リーチの相手を止める。積極派は首位にも使う（霧読みの相手には使えない）
  if (can('seal')) {
    const ok = sealTargets(s);
    const target =
      reach.find((id) => ok.includes(id)) ??
      (pers.id === 'bold' && leader !== undefined && rankByAssets(s)[0] === leader && ok.includes(leader) ? leader : undefined);
    if (target !== undefined && s.players[target].islandTurns === 0) return { type: 'useCard', card: 'seal', target };
  }

  // 略奪の令状：自分の色が揃う・相手の独占を崩す・使命が進む土地を、止まらずに奪う
  if (can('raid')) {
    const target = chooseRaid(s, pers);
    if (target !== null) return { type: 'useCard', card: 'raid', square: target };
  }

  // 地震：ここぞという大物（通行料の高い建物）や、独占リーチの相手の土地まで取っておく。
  // 手札がいっぱいなら小物にも使う。策士は首位の土地も優先
  if (can('earthquake')) {
    const full = p.hand.length >= CONFIG.handLimit;
    const need = full ? 0 : pers.quakeNeed;
    const targets = earthquakeTargets(s);
    const urgent = targets.filter((sq) => reach.includes(s.properties[sq].owner));
    const big = targets.filter((sq) => rentOf(s, sq) >= need && s.properties[sq].level >= (full ? 1 : LEVEL.BUILDING));
    const preferred = big.filter((sq) => pers.id === 'schemer' && s.properties[sq].owner === leader);
    const pool = urgent.length ? urgent : preferred.length ? preferred : big;
    if (pool.length) return { type: 'useCard', card: 'earthquake', square: maxBy(pool, (sq) => rentOf(s, sq)) };
  }

  // 運命の賽：狙ったマスに止まる価値が、普通に振ったときよりかなり大きいときだけ（高いので温存する）
  if (can('destiny') && p.money - CONFIG.destinyCost >= pers.reserve) {
    const values = Array.from({ length: 11 }, (_, i) => i + 2).map((n) => ({ n, v: squareValue(s, pers, (p.position + n) % BOARD.length) }));
    const expected = values.reduce((sum, x) => sum + x.v * combos(x.n), 0) / 36;
    const best = values.reduce((a, b) => (b.v > a.v ? b : a));
    const need = pers.destinyNeed * (p.hand.length >= CONFIG.handLimit ? 0.5 : 1);
    if (best.v - expected >= need) return { type: 'useCard', card: 'destiny', sum: best.n };
  }

  // 祭りの招待状：通行料の高い自分の土地で、まだ祭りがないか、今の祭りより高いとき
  if (can('festival')) {
    const best = maxBy(festivalTargets(s), (sq) => rentAt(sq, s.properties[sq].level));
    const rent = rentAt(best, s.properties[best].level);
    // 上限まで開いているなら、いちばん安い自分の祭りより高いときだけ（古い祭りが終わるので）
    const mine = s.festivals.filter((sq) => s.properties[sq]?.owner === p.id);
    const current = mine.length >= festivalLimit(p) ? Math.min(...mine.map((sq) => rentAt(sq, s.properties[sq].level))) : 0;
    const need = { bold: 250, careful: 350, schemer: 250 }[pers.id];
    if (rent >= need && rent > current) return { type: 'useCard', card: 'festival', square: best };
  }

  // 築城の詔：通行料がいちばん上がる自分の土地を上げる
  if (can('growth')) {
    const best = maxBy(blessingTargets(s), (sq) => rentAt(sq, s.properties[sq].level + 1) - rentAt(sq, s.properties[sq].level));
    return { type: 'useCard', card: 'growth', square: best };
  }

  // 宝箱：持っていても得はないので、他に使うカードがなければ開ける
  if (can('treasure')) return { type: 'useCard', card: 'treasure' };
  return null;
}

/** 略奪の令状で奪う土地。奪う価値のある土地がなければ null */
export function chooseRaid(s: GameState, pers: Personality): number | null {
  const p = s.players[s.current];
  const full = p.hand.length >= CONFIG.handLimit;
  const score = (sq: number): number => {
    const owner = s.properties[sq].owner;
    if (p.money - raidPrice(s, sq) < (pers.id === 'bold' ? 200 : 400)) return 0;
    if (isTourist(sq) && s.touristClaim === owner) return 5;
    const g = BOARD[sq].group;
    if (g && isLand(sq) && GROUP_SQUARES[g].every((x) => x === sq || s.properties[x]?.owner === p.id)) return 4;
    if (g && completedGroups(s, owner).includes(g) && completedGroups(s, owner).length >= TRIPLE_GROUPS - 1) return 4;
    if (isTourist(sq) && touristCount(s, owner) >= TOURIST_SQUARES.length - 1) return 3;
    if (missionGain(s, p.id, sq) > 0 || (p.mission === 'raider' && !p.missionDone)) return 2;
    // 手札がいっぱいなら、稼ぎのいい土地も奪う
    if (full && rentOf(s, sq) >= 500) return 1;
    return 0;
  };
  const targets = raidTargets(s).filter((sq) => score(sq) > 0);
  if (!targets.length) return null;
  return maxBy(targets, (sq) => score(sq) * 10000 + rentOf(s, sq));
}

/** 天翔：飛んだ先の価値が、普通に振ったときより十分大きければ飛ぶ */
function chooseFly(s: GameState, pers: Personality): number | null {
  if (!canFly(s)) return null;
  const p = s.players[s.current];
  const values = Array.from({ length: 11 }, (_, i) => i + 2).map((n) => ({ n, v: squareValue(s, pers, (p.position + n) % BOARD.length) }));
  const expected = values.reduce((sum, x) => sum + x.v * combos(x.n), 0) / 36;
  const best = maxBy(flyTargets(s), (sq) => squareValue(s, pers, sq));
  const need = { bold: 40, careful: 50, schemer: 35 }[pers.id];
  return squareValue(s, pers, best) - expected >= need ? best : null;
}

/** 追い風の羽：出目を±1した先のほうが十分良ければ使う */
function chooseAdjust(s: GameState, pers: Personality, sum: number): -1 | 0 | 1 {
  const pos = s.players[s.current].position;
  const value = (n: number) => squareValue(s, pers, (pos + n) % BOARD.length);
  const base = value(sum);
  const need = pers.id === 'careful' ? 30 : 40;
  const options: (-1 | 1)[] = sum > 2 ? [-1, 1] : [1];
  const best = options.reduce((a, b) => (value(sum + b) > value(sum + a) ? b : a));
  return value(sum + best) - base >= need ? best : 0;
}

/** 守りのカードを使うか（me = 割り込む人） */
function wantsGuard(s: GameState, pers: Personality, me: number): boolean {
  const ph = s.phase;
  if (ph.kind !== 'react') return false;
  const p = s.players[me];
  switch (ph.ctx.type) {
    case 'rent': {
      const need = { bold: 150, careful: 80, schemer: 200 }[pers.id];
      return ph.ctx.rent >= need || ph.ctx.rent > p.money;
    }
    case 'buyout': {
      // 鏡の盾を聞かれたが結界も持っているなら、鏡は温存して結界で守る（このあと結界を聞かれる）
      if (ph.card === 'mirror' && p.hand.includes('barrier')) return false;
      if (pers.id === 'careful') return true;
      const sq = ph.ctx.square;
      const prop = s.properties[sq];
      const attacker = s.current;
      // 相手の独占が完成する土地や、自分が揃えている色グループの土地は必ず守る
      const completesThem =
        (isLand(sq) && groupOf(sq).every((x) => x === sq || s.properties[x]?.owner === attacker)) ||
        (isTourist(sq) && touristCount(s, attacker) >= TOURIST_SQUARES.length - 1);
      const mineGroup = isLand(sq) && ownedInGroup(s, sq, me) >= 2;
      return completesThem || mineGroup || prop.level >= LEVEL.BUILDING;
    }
    case 'earthquake':
    case 'seal':
      return true;
  }
}

// ---------- 購入・建設・買収 ----------

/** 余裕（reserve）を残して払える一番高い段階 */
function highestWithin(opts: LevelOption[], money: number, reserve: number): LevelOption | undefined {
  const ok = opts.filter((o) => o.affordable && money - o.cost >= reserve);
  return ok[ok.length - 1];
}

function decideBuy(s: GameState, pers: Personality, sq: number): Action {
  const p = s.players[s.current];
  const opts = buyOptions(s, sq);
  const price = opts[0].cost;

  // 秘密の使命が進む土地は、手元のお金を少し削ってでも買う
  if (missionGain(s, p.id, sq) > 0) {
    const best = highestWithin(opts, p.money, pers.reserve);
    if (best) return { type: 'buy', level: best.level };
    if (p.money - price >= 100) return { type: 'buy', level: 0 };
  }

  if (pers.id === 'bold') {
    const best = highestWithin(opts, p.money, pers.reserve);
    if (best) return { type: 'buy', level: best.level };
    return p.money - price >= 100 ? { type: 'buy', level: 0 } : { type: 'pass' };
  }

  if (pers.id === 'careful') {
    // 土地は積極的に買うが、建物は余裕を残してビルまで。手元のお金は多めに残す
    const best = highestWithin(opts.filter((o) => o.level <= LEVEL.BUILDING), p.money, pers.reserve);
    if (best) return { type: 'buy', level: best.level };
    return p.money - price >= 300 ? { type: 'buy', level: 0 } : { type: 'pass' };
  }

  // 策士：色グループを揃える・相手の独占を阻むことを優先する
  if (isTourist(sq)) {
    const mine = touristCount(s, p.id);
    const block = othersTouristMax(s) >= TOURIST_SQUARES.length - 2;
    const want = mine >= 1 || block || p.money - price >= 1200;
    return want && p.money - price >= 200 ? { type: 'buy', level: 0 } : { type: 'pass' };
  }
  const interest = groupInterest(s, sq);
  if (interest === 'complete') {
    const best = highestWithin(opts, p.money, pers.reserve);
    return { type: 'buy', level: best?.level ?? 0 };
  }
  if (interest === 'block') return { type: 'buy', level: 0 };
  if (interest === 'open') {
    const best = highestWithin(opts, p.money, pers.reserve);
    if (best) return { type: 'buy', level: best.level };
    return p.money - price >= 200 ? { type: 'buy', level: 0 } : { type: 'pass' };
  }
  // 他人もいる色グループも、余裕があればビルまでは買っておく（収入源になり、相手の独占も防げる）
  const best = highestWithin(opts.filter((o) => o.level <= LEVEL.BUILDING), p.money, pers.reserve);
  return best ? { type: 'buy', level: best.level } : { type: 'pass' };
}

function decideBuild(s: GameState, pers: Personality, sq: number): Action {
  const p = s.players[s.current];
  const opts = buildOptions(s, sq);

  // 建てれば秘密の使命が達成できるなら、その段階まで建てる
  const done = opts.find((o) => o.affordable && p.money - o.cost >= 100 && missionDoneByLevel(s, p.id, sq, o.level));
  if (done) return { type: 'build', level: done.level };

  if (pers.id === 'bold') {
    const best = highestWithin(opts, p.money, pers.reserve);
    return best ? { type: 'build', level: best.level } : { type: 'pass' };
  }
  if (pers.id === 'careful') {
    // 一度に2段階まで、手元のお金を残せる範囲で着実に建てる
    const prop = s.properties[sq];
    const best = highestWithin(opts.filter((o) => o.level <= prop.level + 2), p.money, pers.reserve);
    return best ? { type: 'build', level: best.level } : { type: 'pass' };
  }
  // 策士：建てられるだけ建てる。揃えかけの色グループの土地は、手元のお金を少し削ってでも建てる
  const strong = ownedInGroup(s, sq, p.id) >= 2;
  const best = highestWithin(opts, p.money, strong ? pers.reserve / 2 : pers.reserve);
  return best ? { type: 'build', level: best.level } : { type: 'pass' };
}

function decideBuyout(s: GameState, pers: Personality, sq: number): Action {
  const p = s.players[s.current];
  const price = buyoutPrice(s, sq);
  const left = p.money - price;
  const prop = s.properties[sq];

  if (pers.id === 'bold') return left >= pers.reserve ? { type: 'buyout' } : { type: 'pass' };

  // 観光地の守り切りを止める、または買収で秘密の使命が進むなら買収する
  if (s.touristClaim === prop.owner && isTourist(sq) && left >= 0) return { type: 'buyout' };
  const raider = p.mission === 'raider' && !p.missionDone;
  if ((missionGain(s, p.id, sq) > 0 || raider) && left >= 300) return { type: 'buyout' };

  if (isTourist(sq)) {
    // 観光地：相手があと1つで4つ揃うなら奪って止める。策士は自分が集めているときも奪う
    const ownerReach = touristCount(s, prop.owner) >= TOURIST_SQUARES.length - 1;
    const collecting = pers.id === 'schemer' && touristCount(s, p.id) >= 2;
    if ((ownerReach || collecting) && left >= 200) return { type: 'buyout' };
    return left >= (pers.id === 'careful' ? 1500 : pers.reserve) ? { type: 'buyout' } : { type: 'pass' };
  }

  if (pers.id === 'careful') {
    // 建物のある土地を、買収後も手元のお金を十分残せるときだけ
    return prop.level >= LEVEL.VILLA && left >= 1000 ? { type: 'buyout' } : { type: 'pass' };
  }

  // 策士：自分の色グループが揃うなら、または相手の独占を崩せるなら少し無理をしてでも買収する
  const g = BOARD[sq].group!;
  const completesMine = GROUP_SQUARES[g].every((x) => x === sq || s.properties[x]?.owner === p.id);
  const owner = prop.owner;
  const theirGroups = completedGroups(s, owner);
  const breaksReach = theirGroups.includes(g) && theirGroups.length >= TRIPLE_GROUPS - 1;
  if ((completesMine || breaksReach) && left >= 200) return { type: 'buyout' };
  return prop.level >= LEVEL.VILLA && left >= pers.reserve ? { type: 'buyout' } : { type: 'pass' };
}

// ---------- レアキャラの特性 ----------

/** victim が sq に送られたとき、me にとってどれだけうれしいか（相手が困るほど大きい） */
function harmTo(s: GameState, me: number, victim: number, sq: number): number {
  const prop = s.properties[sq];
  const kind = BOARD[sq].kind;
  const v = s.players[victim];
  if ((kind === 'land' || kind === 'tourist') && prop) {
    if (prop.owner === victim) return -20;
    const rent = rentOf(s, sq);
    return prop.owner === me ? rent * 2 : rent * 0.5;
  }
  if ((kind === 'land' || kind === 'tourist') && !prop) return v.money >= landPrice(sq) ? -40 : 0;
  switch (kind) {
    case 'island':
      return islandImmune(v) ? 0 : 200;
    case 'start':
      return -80;
    case 'chance':
      return -30;
    case 'travel':
      return -40;
    case 'festival':
      return festivalTargets({ ...s, current: victim }).length ? -30 : 0;
    default:
      return 0;
  }
}

/** 操り糸：相手の出目を、相手がいちばん困る方へ動かす。差が小さければ温存 */
function choosePuppet(s: GameState, me: number, sum: number): -1 | 0 | 1 {
  const pos = s.players[s.current].position;
  const harm = (n: number) => harmTo(s, me, s.current, (pos + n) % BOARD.length);
  const base = harm(sum);
  const options: (-1 | 1)[] = sum > 1 ? [-1, 1] : [1];
  const best = options.reduce((a, b) => (harm(sum + b) > harm(sum + a) ? b : a));
  return harm(sum + best) - base >= 120 ? best : 0;
}

/** 剛腕：いちばん相手が困る押し出し方。得がなければ null */
function choosePush(s: GameState): { target: number; dir: PushDir } | null {
  if (s.phase.kind !== 'push') return null;
  let best: { target: number; dir: PushDir; v: number } | null = null;
  const me = s.phase.pusher;
  for (const target of s.phase.targets) {
    for (const dir of PUSH_DIRS) {
      const sq = (s.players[target].position + dir + BOARD.length) % BOARD.length;
      const v = harmTo(s, me, target, sq);
      if (!best || v > best.v) best = { target, dir, v };
    }
  }
  return best && best.v > 0 ? best : null;
}

// ---------- 秘密の使命 ----------

/** sq を手に入れたら（今の建物のまま）、自分の使命がどれだけ進むか。達成済み・使命なしなら 0 */
export function missionGain(s: GameState, playerId: number, sq: number): number {
  const p = s.players[playerId];
  if (!p.mission || p.missionDone) return 0;
  const before = missionProgress(s, playerId, p.mission);
  if (before.now >= before.goal) return 0;
  const t = structuredClone(s.properties);
  const after = missionProgress({ ...s, properties: { ...t, [sq]: { owner: playerId, level: t[sq]?.level ?? 0 } } }, playerId, p.mission);
  return Math.max(0, after.now - before.now);
}

/** sq を段階 level まで建てたら使命を達成できるか */
function missionDoneByLevel(s: GameState, playerId: number, sq: number, level: number): boolean {
  const p = s.players[playerId];
  if (!p.mission || p.missionDone) return false;
  const after = missionProgress({ ...s, properties: { ...s.properties, [sq]: { owner: playerId, level } } }, playerId, p.mission);
  return after.now >= after.goal;
}

// ---------- 色グループの見立て ----------

function groupOf(sq: number): number[] {
  const g = BOARD[sq].group as GroupId;
  return GROUP_SQUARES[g];
}

function ownedInGroup(s: GameState, sq: number, playerId: number): number {
  return groupOf(sq).filter((x) => s.properties[x]?.owner === playerId).length;
}

/**
 * 空き地 sq が策士にとってどういう土地か。
 * complete = 買えば自分の色グループが揃う、block = 相手があと1つで揃う土地、
 * open = 他人がいない色グループ、contested = 他人もいる色グループ
 */
function groupInterest(s: GameState, sq: number): 'complete' | 'block' | 'open' | 'contested' {
  const me = s.current;
  const others = groupOf(sq).filter((x) => x !== sq);
  if (others.every((x) => s.properties[x]?.owner === me)) return 'complete';
  const owners = new Set(others.map((x) => s.properties[x]?.owner).filter((o) => o !== undefined));
  if (owners.size === 1 && !owners.has(me) && others.every((x) => s.properties[x])) return 'block';
  if ([...owners].every((o) => o === me)) return 'open';
  return 'contested';
}

function othersTouristMax(s: GameState): number {
  return Math.max(0, ...s.players.filter((p) => p.id !== s.current && !p.bankrupt).map((p) => touristCount(s, p.id)));
}

// ---------- マスの良し悪しとゲージ ----------

/** そのマスに止まったときの、性格ごとのうれしさ（大きいほど良い） */
function squareValue(s: GameState, pers: Personality, sq: number): number {
  const p = s.players[s.current];
  const kind = BOARD[sq].kind;
  const prop = s.properties[sq];

  if ((kind === 'land' || kind === 'tourist') && prop && prop.owner !== p.id) {
    const rent = rentOf(s, sq);
    // 観光地の守り切りを買収で止められるなら、通行料を払ってでも行く価値がある
    if (s.touristClaim === prop.owner && canBuyout(s, sq) && p.money - rent >= buyoutPrice(s, sq)) return 300;
    return -rent * { bold: 0.7, careful: 1.5, schemer: 1 }[pers.id];
  }
  if ((kind === 'land' || kind === 'tourist') && !prop) {
    const affordable = landPrice(sq) + pers.reserve <= p.money;
    if (!affordable) return 0;
    if (missionGain(s, p.id, sq) > 0) return 120;
    if (pers.id === 'bold') return 40 + landPrice(sq) / 10;
    if (pers.id === 'careful') return 35;
    if (isTourist(sq)) return 25;
    const interest = groupInterest(s, sq);
    return { complete: 150, block: 90, open: 45, contested: 15 }[interest];
  }
  if (prop && prop.owner === p.id) {
    if (!isLand(sq)) return 5;
    if (pers.id === 'schemer') return ownedInGroup(s, sq, p.id) >= 2 ? 60 : 30;
    return pers.id === 'bold' ? 25 : 10;
  }
  switch (kind) {
    case 'island':
      if (islandImmune(p)) return 0;
      return { bold: -50, careful: -10, schemer: -40 }[pers.id];
    case 'travel':
      return { bold: 20, careful: 15, schemer: 30 }[pers.id];
    case 'festival':
      return festivalTargets(s).length ? 20 : 0;
    case 'chance':
      return pers.id === 'bold' ? 25 : 15;
    case 'start':
      return blessingTargets(s).length ? 50 : 30;
    default:
      return 0;
  }
}

/** 2つのサイコロで合計 n が出る組み合わせの数 */
const combos = (n: number) => 6 - Math.abs(n - 7);

/** 性格に合わせてゲージの狙いを決める。狙いが外れると別のゾーンになる */
function chooseAim(s: GameState, pers: Personality, rand: Rand): Aim | undefined {
  if (pers.aimAccuracy <= 0) return undefined;
  const pos = s.players[s.current].position;
  const zones = Object.keys(AIM_ZONES) as Aim[];
  const best = maxByKey(zones, (z) => {
    const { min, max } = AIM_ZONES[z];
    let total = 0;
    let weight = 0;
    for (let n = min; n <= max; n++) {
      total += combos(n) * squareValue(s, pers, (pos + n) % BOARD.length);
      weight += combos(n);
    }
    return total / weight;
  });
  if (rand() < pers.aimAccuracy) return best;
  const others = zones.filter((z) => z !== best);
  return others[Math.floor(rand() * others.length)];
}

function wantsEscape(s: GameState, pers: Personality): boolean {
  const money = s.players[s.current].money;
  if (pers.id === 'bold') return money >= CONFIG.escapeFee + 500;
  // 慎重派は、お金に十分な余裕があるときだけ払って出る（序盤は通行料の危険も少ないので居座る）
  if (pers.id === 'careful') return money >= 2000;
  return money >= 1500;
}

function pickToSell(s: GameState, pers: Personality): number {
  const mine = ownedSquares(s, s.current);
  if (pers.id === 'schemer') {
    // 揃えかけの色グループの土地は最後まで残す
    const loose = mine.filter((sq) => !isLand(sq) || ownedInGroup(s, sq, s.current) < 2);
    if (loose.length) return maxBy(loose, (sq) => -sellValue(s, sq));
  }
  return maxBy(mine, (sq) => -sellValue(s, sq));
}

// ---------- 小道具 ----------

function maxBy(items: number[], score: (x: number) => number): number {
  return maxByKey(items, score);
}

function maxByKey<T>(items: T[], score: (x: T) => number): T {
  let best = items[0];
  let bestScore = -Infinity;
  for (const x of items) {
    const v = score(x);
    if (v > bestScore) {
      best = x;
      bestScore = v;
    }
  }
  return best;
}
