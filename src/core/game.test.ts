import { beforeAll, describe, expect, it } from 'vitest';
import { BOARD } from '../data/board';
import { CARDS } from '../data/cards';
import { CharacterId } from '../data/characters';
import { CONFIG, LEVEL } from '../data/config';
import { MISSIONS } from '../data/missions';
import {
  actorOf,
  AIM_ZONES,
  Aim,
  applyAction,
  blessingTargets,
  canBuyout,
  canFly,
  canOfferTrade,
  cardUsable,
  chainLength,
  buildOptions,
  buyOptions,
  buyoutPrice,
  completedGroups,
  createGame,
  escapeFeeOf,
  GameError,
  GameState,
  investedValue,
  ISLAND,
  isProtected,
  missionProgress,
  raidPrice,
  raidTargets,
  roundOrder,
  isLastSpurt,
  rentOf,
  rollDice,
  salaryFor,
  sellValue,
  totalAssets,
  tradeValueOf,
  TRAVEL,
} from './game';
import { rollDie } from './rng';

// ほとんどのテストは「毎ターン同じ順」で書いてある。先頭がずれる順は専用のテストで確かめる
beforeAll(() => {
  (CONFIG as unknown as Record<string, unknown>).turnOrder = 'fixed';
});

const SETUP = [
  { name: 'あなた', color: '#e33' },
  { name: 'CPU1', color: '#33e' },
  { name: 'CPU2', color: '#3a3' },
  { name: 'CPU3', color: '#aa3' },
];

/** サイコロ2つを振ったあとのシードと出目 */
function dice(seed: number): [number, number, number] {
  const [a, s1] = rollDie(seed);
  const [b, s2] = rollDie(s1);
  return [a, b, s2];
}

/** 次のサイコロの合計が sum になるシードを探す（double でゾロ目かどうかも指定） */
function seedFor(sum: number, double = false, from = 1): number {
  for (let seed = from; seed < 500000; seed++) {
    const [a, b] = dice(seed);
    if (a + b === sum && (a === b) === double) return seed;
  }
  throw new Error('not found');
}

/** 現在のプレイヤーを target マスへ動かす */
function rollTo(state: GameState, target: number, double = false): GameState {
  const from = state.players[state.current].position;
  const sum = (target - from + BOARD.length) % BOARD.length;
  if (sum < 2 || sum > 12) throw new Error(`${from}→${target} は1回で行けない`);
  return applyAction({ ...state, seed: seedFor(sum, double) }, { type: 'roll' });
}

/** target へ動いた結果が ok を満たすシードを探して、その結果を返す（石碑でめくれるカードを選ぶのに使う） */
function rollToWhere(state: GameState, target: number, ok: (s: GameState) => boolean): GameState {
  const from = state.players[state.current].position;
  const sum = (target - from + BOARD.length) % BOARD.length;
  let seed = 0;
  for (let i = 0; i < 2000; i++) {
    seed = seedFor(sum, false, seed + 1);
    const next = applyAction({ ...state, seed }, { type: 'roll' });
    if (ok(next)) return next;
  }
  throw new Error('条件に合う展開が見つからない');
}

/** 手札と使命を空にしたゲーム（手札・使命の影響を受けないテスト用） */
function newGame(seed = 1): GameState {
  const s = createGame(SETUP, seed);
  // 席ごとのお金の上乗せはなしにする（お金の計算を単純にするため）
  s.players.forEach((p) => ((p.hand = []), (p.mission = null), (p.money = CONFIG.initialMoney)));
  return s;
}

/** 手番の人が、空き地の苔むす泉（5）へ進んで買わずに手番を終える（観光地の守り切りのテスト用） */
function passTurn(s: GameState): GameState {
  const p = s.players[s.current];
  p.position = 0;
  s = applyAction({ ...s, seed: seedFor(5) }, { type: 'roll' });
  if (s.phase.kind === 'buy') s = applyAction(s, { type: 'pass' });
  return s;
}

/** 全員を同じマスに置く */
function placeAll(s: GameState, square: number): GameState {
  s.players.forEach((p) => (p.position = square));
  return s;
}

describe('ゲームの基本', () => {
  it('初期状態は全員スタートにいて、後の席ほど最初のお金が多い', () => {
    const s = createGame(SETUP, 1);
    expect(s.players.map((p) => p.money)).toEqual(CONFIG.seatBonus.map((b) => CONFIG.initialMoney + b));
    expect(s.players.every((p) => p.position === 0)).toBe(true);
    expect(s.phase.kind).toBe('roll');
  });

  it('同じシードなら同じ展開になる', () => {
    const a = applyAction(newGame(42), { type: 'roll' });
    const b = applyAction(newGame(42), { type: 'roll' });
    expect(a.rolled).toEqual(b.rolled);
    expect(a.moves).toEqual(b.moves);
  });

  it('元の state は変更されない', () => {
    const s = newGame(1);
    applyAction(s, { type: 'roll' });
    expect(s.players[0].position).toBe(0);
  });

  it('空き地に止まると購入でき、手番が次へ移る', () => {
    let s = rollTo(newGame(1), 5); // 苔むす泉 140G
    expect(s.phase).toEqual({ kind: 'buy', square: 5 });
    s = applyAction(s, { type: 'buy', level: 0 });
    expect(s.properties[5]).toEqual({ owner: 0, level: 0 });
    expect(s.players[0].money).toBe(2860);
    expect(s.current).toBe(1);
  });

  it('見送ると土地は空き地のまま', () => {
    let s = rollTo(newGame(1), 5);
    s = applyAction(s, { type: 'pass' });
    expect(s.properties[5]).toBeUndefined();
    expect(s.current).toBe(1);
  });

  it('スタートを通過すると給料をもらう', () => {
    let s = placeAll(newGame(1), 30);
    s = rollTo(s, 5);
    expect(s.players[0].money).toBe(3000 + CONFIG.salary);
    expect(s.players[0].lapped).toBe(true);
  });

  it('購入の場面以外で buy すると例外', () => {
    expect(() => applyAction(newGame(1), { type: 'buy', level: 0 })).toThrow(GameError);
  });
});

describe('給料（領地収入と最下位の倍率）', () => {
  it('給料は 基本 ＋ 土地1つ30G ＋ 建物1段階30G', () => {
    const s = newGame(1);
    s.properties[1] = { owner: 0, level: 2 };
    s.properties[2] = { owner: 0, level: 0 };
    s.players[0].money = 9999; // 首位にして倍率がかからないように
    expect(salaryFor(s, 0)).toMatchObject({ base: 300, land: 2 * 30 + 2 * 30, rate: 1, total: 420 });
  });

  it('総資産が単独最下位なら2倍', () => {
    const s = newGame(1);
    s.properties[1] = { owner: 0, level: 1 };
    s.players[0].money = 100;
    expect(salaryFor(s, 0)).toMatchObject({ base: 300, land: 60, rate: 2, total: 720 });
  });

  it('最下位が同点なら倍率はかからない（序盤の全員同点など）', () => {
    const s = newGame(1);
    expect(salaryFor(s, 3).rate).toBe(1);
  });

  it('通過したときの給料に反映される', () => {
    let s = newGame(1);
    s.players[0].money = 1000; // 単独最下位
    s.players[0].position = 30;
    s = rollTo(s, 5);
    expect(s.players[0].money).toBe(1000 + 600);
    expect(s.log.some((e) => e.text.includes('最下位なので2倍'))).toBe(true);
  });
});

describe('祝福の門（スタートにぴったり）', () => {
  it('自分の土地を1つ選んで無料で1段階上げられる', () => {
    let s = placeAll(newGame(1), 29);
    s.properties[5] = { owner: 0, level: 1 };
    s.properties[6] = { owner: 1, level: 1 };
    s = rollTo(s, 0);
    expect(s.phase).toEqual({ kind: 'blessing' });
    expect(() => applyAction(s, { type: 'choose', square: 6 })).toThrow(GameError);
    const money = s.players[0].money;
    s = applyAction(s, { type: 'choose', square: 5 });
    expect(s.properties[5].level).toBe(2);
    expect(s.players[0].money).toBe(money);
  });

  it('ホテルからランドマークにも上げられ、ランドマークの土地は選べない', () => {
    let s = placeAll(newGame(1), 29);
    s.properties[5] = { owner: 0, level: 3 };
    s.properties[6] = { owner: 0, level: 4 };
    s = rollTo(s, 0);
    expect(blessingTargets(s)).toEqual([5]);
    s = applyAction(s, { type: 'choose', square: 5 });
    expect(s.properties[5].level).toBe(4);
  });

  it('上げられる土地がなければ給料をもう1回分もらう', () => {
    let s = placeAll(newGame(1), 29);
    s = rollTo(s, 0);
    expect(s.players[0].money).toBe(3000 + CONFIG.salary * 2);
    expect(s.current).toBe(1);
  });

  it('通過しただけでは祝福は起きない', () => {
    let s = placeAll(newGame(1), 30);
    s.properties[5] = { owner: 0, level: 1 };
    s = rollTo(s, 2);
    expect(s.phase.kind).toBe('buy');
  });
});

describe('建物', () => {
  it('1周目は購入時にビルまでしか建てられない', () => {
    const s = rollTo(newGame(1), 5);
    expect(buyOptions(s, 5).map((o) => o.level)).toEqual([0, 1, 2]);
    expect(() => applyAction(s, { type: 'buy', level: 3 })).toThrow(GameError);
  });

  it('購入と同時に建てると、土地代と建設費をまとめて払う', () => {
    let s = rollTo(newGame(1), 5);
    s = applyAction(s, { type: 'buy', level: 2 });
    expect(s.players[0].money).toBe(3000 - 350);
    expect(investedValue(s, 5)).toBe(350);
    expect(rentOf(s, 5)).toBe(210);
  });

  it('ラストスパート（残り5ターン）は通行料が1.2倍になる', () => {
    let s = rollTo(newGame(1), 5);
    s = applyAction(s, { type: 'buy', level: 2 });
    expect(isLastSpurt(s)).toBe(false);
    expect(rentOf(s, 5)).toBe(210);
    s.turn = s.maxTurns - CONFIG.lastSpurtTurns; // 残り6ターンの時点ではまだ
    expect(isLastSpurt(s)).toBe(false);
    expect(rentOf(s, 5)).toBe(210);
    s.turn = s.maxTurns - CONFIG.lastSpurtTurns + 1; // 残り5ターンで開始
    expect(isLastSpurt(s)).toBe(true);
    expect(rentOf(s, 5)).toBe(Math.round(210 * CONFIG.lastSpurtRate));
  });

  it('スタートを通過したあとはホテルまで建てられる', () => {
    let s = newGame(1);
    s.players[0].position = 30;
    s = rollTo(s, 5);
    expect(buyOptions(s, 5).map((o) => o.level)).toEqual([0, 1, 2, 3]);
  });

  it('自分の土地に止まると建て増しでき、ランドマークはホテルからだけ', () => {
    let s = newGame(1);
    s.players[0].lapped = true;
    s.properties[5] = { owner: 0, level: 1 };
    s = rollTo(s, 5);
    expect(s.phase).toEqual({ kind: 'build', square: 5 });
    expect(buildOptions(s, 5).map((o) => o.level)).toEqual([2, 3]);
    s = applyAction(s, { type: 'build', level: 3 });
    expect(s.properties[5].level).toBe(LEVEL.HOTEL);
    expect(s.players[0].money).toBe(3000 - 140 - 210);

    s.current = 0;
    s.players[0].position = 30;
    s = rollTo(s, 5);
    expect(buildOptions(s, 5).map((o) => o.level)).toEqual([4]);
  });

  it('ランドマークが建っていれば建設の場面にならない', () => {
    let s = newGame(1);
    s.properties[5] = { owner: 0, level: 4 };
    s = rollTo(s, 5);
    expect(s.phase.kind).toBe('roll');
    expect(s.current).toBe(1);
  });
});

describe('通行料と買収', () => {
  function withOwnedBy1(level: number): GameState {
    const s = newGame(1);
    s.properties[5] = { owner: 1, level };
    return s;
  }

  it('通行料を払うと、その支払いが記録される', () => {
    const s = rollTo(withOwnedBy1(1), 5);
    const rent = Math.round(140 * 0.6);
    expect(s.players[0].money).toBe(3000 - rent);
    expect(s.players[1].money).toBe(3000 + rent);
    expect(s.lastPayment).toEqual({ payer: 0, payee: 1, amount: rent, square: 5 });
  });

  it('払ったあとは買収の場面になり、買収すると元の持ち主に投資額の2倍を払う', () => {
    let s = rollTo(withOwnedBy1(1), 5);
    expect(s.phase).toEqual({ kind: 'buyout', square: 5 });
    const price = buyoutPrice(s, 5);
    expect(price).toBe((140 + 70) * 2);
    const before0 = s.players[0].money;
    const before1 = s.players[1].money;
    s = applyAction(s, { type: 'buyout' });
    expect(s.properties[5]).toEqual({ owner: 0, level: 1 });
    expect(s.players[0].money).toBe(before0 - price);
    expect(s.players[1].money).toBe(before1 + price);
    expect(s.phase).toEqual({ kind: 'build', square: 5 });
  });

  it('ランドマークの土地は買収できない', () => {
    const s = rollTo(withOwnedBy1(4), 5);
    expect(s.phase.kind).toBe('roll');
    expect(s.current).toBe(1);
  });

  it('買収価格を払えなければ買収の場面にならない', () => {
    let s = withOwnedBy1(0);
    s.players[0].money = 100;
    s = rollTo(s, 5);
    expect(s.players[0].money).toBe(100 - 28);
    expect(s.current).toBe(1);
  });
});

describe('ゾロ目', () => {
  it('ゾロ目なら同じプレイヤーがもう一度振れる（購入のあとでも）', () => {
    let s = placeAll(newGame(1), 28);
    s = rollTo(s, 0, true); // 2・2 → 始まりの門
    expect(s.current).toBe(0);
    expect(s.phase.kind).toBe('roll');
    s = rollTo(s, 10, true); // 5・5 → 人魚の入江
    s = applyAction(s, { type: 'buy', level: 0 });
    expect(s.current).toBe(0);
    expect(s.phase.kind).toBe('roll');
  });

  it('ゾロ目が3回続くと進まずに無人島へ送られ、手番が終わる', () => {
    let s = placeAll(newGame(1), 28);
    s = rollTo(s, 0, true);
    s = rollTo(s, 10, true);
    s = applyAction(s, { type: 'pass' });
    s = applyAction({ ...s, seed: seedFor(6, true) }, { type: 'roll' });
    expect(s.players[0].position).toBe(ISLAND);
    expect(s.players[0].islandTurns).toBe(CONFIG.islandTurns);
    expect(s.moves.at(-1)?.kind).toBe('warp');
    expect(s.current).toBe(1);
  });
});

describe('霧の孤島（無人島）', () => {
  function onIsland(): GameState {
    let s = rollTo(newGame(1), ISLAND); // 0 → 8
    expect(s.players[0].islandTurns).toBe(CONFIG.islandTurns);
    expect(s.current).toBe(1);
    s.current = 0;
    s.phase = { kind: 'roll' };
    return s;
  }

  it('ゾロ目でなければ動けず、残り手番が減る', () => {
    let s = onIsland();
    s = applyAction({ ...s, seed: seedFor(7) }, { type: 'roll' });
    expect(s.players[0].position).toBe(ISLAND);
    expect(s.players[0].islandTurns).toBe(CONFIG.islandTurns - 1);
    expect(s.current).toBe(1);
  });

  it('ゾロ目なら脱出してその目で進むが、もう一度は振れない', () => {
    let s = onIsland();
    s = rollTo(s, 12, true); // 2・2 → 沈んだ灯台
    expect(s.players[0].islandTurns).toBe(0);
    expect(s.players[0].position).toBe(12);
    s = applyAction(s, { type: 'pass' });
    expect(s.current).toBe(1);
  });

  it('脱出料を払えば、その手番で普通に振れる', () => {
    let s = onIsland();
    const fee = escapeFeeOf(s, 0);
    s = applyAction(s, { type: 'payEscape' });
    expect(s.players[0].money).toBe(3000 - fee);
    expect(s.players[0].islandTurns).toBe(0);
    s = rollTo(s, 13);
    expect(s.phase).toEqual({ kind: 'buy', square: 13 });
  });

  it('脱出料は総資産の10%（最低200G・上限なし、10G単位に丸める）', () => {
    const s = newGame(1);
    s.players[0].money = 500;
    expect(escapeFeeOf(s, 0)).toBe(200); // 下限
    s.players[0].money = 10000;
    expect(escapeFeeOf(s, 0)).toBe(1000);
    s.players[0].money = 12345;
    expect(escapeFeeOf(s, 0)).toBe(1230); // 10G単位への丸め
    s.players[0].money = 30000;
    expect(escapeFeeOf(s, 0)).toBe(3000); // 上限なし
  });

  it('所持金が脱出料に足りないときは払って出られない', () => {
    const s = onIsland();
    s.players[0].money = 100;
    expect(() => applyAction(s, { type: 'payEscape' })).toThrow(GameError);
  });
});

describe('祭り', () => {
  it('祭りの広場に止まると自分の土地を選んで祭りを開き、その通行料が2倍になる', () => {
    let s = newGame(1);
    s.properties[17] = { owner: 0, level: 1 };
    s.players[0].position = 10;
    s = rollTo(s, 16);
    expect(s.phase).toEqual({ kind: 'festival' });
    expect(() => applyAction(s, { type: 'choose', square: 5 })).toThrow(GameError);
    s = applyAction(s, { type: 'choose', square: 17 });
    expect(s.festivals).toEqual([17]);
    expect(rentOf(s, 17)).toBe(Math.round(260 * 0.6) * 2);
  });

  it('土地を持っていなければ何も起きない', () => {
    let s = newGame(1);
    s.players[0].position = 10;
    s = rollTo(s, 16);
    expect(s.current).toBe(1);
  });
});

describe('転移の魔法陣（世界旅行）', () => {
  it('止まると次の手番で好きなマスへ移動でき、スタートを越えれば給料', () => {
    let s = newGame(1);
    s.players[0].position = 18;
    s = rollTo(s, TRAVEL);
    expect(s.players[0].travelPending).toBe(true);
    expect(s.current).toBe(1);
    // 他の3人が手番を終えると、転移の場面から始まる
    for (let i = 0; i < 3; i++) s = applyAction(rollTo(s, 5), { type: 'pass' });
    expect(s.current).toBe(0);
    expect(s.phase).toEqual({ kind: 'travel' });
    s = applyAction(s, { type: 'choose', square: 2 });
    expect(s.players[0].position).toBe(2);
    expect(s.players[0].money).toBe(3000 + CONFIG.salary);
    expect(s.phase).toEqual({ kind: 'buy', square: 2 });
  });
});

describe('観光地', () => {
  it('買えるが建物は建てられず、通行料は持っている数で上がる', () => {
    let s = rollTo(newGame(1), 4); // 古代樹の神殿
    expect(buyOptions(s, 4).map((o) => o.level)).toEqual([0]);
    s = applyAction(s, { type: 'buy', level: 0 });
    expect(s.players[0].money).toBe(3000 - CONFIG.touristPrice);
    expect(rentOf(s, 4)).toBe(100);
    s.properties[12] = { owner: 0, level: 0 };
    expect(rentOf(s, 4)).toBe(300);
  });

  it('観光地も買収できる（建て増しの場面にはならない）', () => {
    let s = newGame(1);
    s.properties[4] = { owner: 1, level: 0 };
    s = rollTo(s, 4);
    expect(s.players[0].money).toBe(3000 - 100);
    expect(s.phase).toEqual({ kind: 'buyout', square: 4 });
    expect(buyoutPrice(s, 4)).toBe(CONFIG.touristPrice * 2);
    s = applyAction(s, { type: 'buyout' });
    expect(s.properties[4].owner).toBe(0);
    expect(s.current).toBe(1);
  });

  it('観光地の買収で4つ揃っても、守り切りを待つ', () => {
    let s = newGame(1);
    for (const sq of [12, 21, 29]) s.properties[sq] = { owner: 0, level: 0 };
    s.properties[4] = { owner: 1, level: 0 };
    s = rollTo(s, 4);
    s = applyAction(s, { type: 'buyout' });
    expect(s.touristClaim).toBe(0);
    expect(s.phase.kind).not.toBe('gameover');
  });
});

describe('手札カード：入手と上限', () => {
  it('最初に2枚ずつ配られ、損をするカードは配られない', () => {
    const s = createGame(SETUP, 5);
    for (const p of s.players) {
      expect(p.hand.length).toBe(CONFIG.startHand);
      expect(p.hand.every((c) => CARDS[c].kind !== 'instant')).toBe(true);
    }
  });

  it('始まりの門を通過するたびに1枚引く（中身は本人のログにだけ出る）', () => {
    let s = placeAll(newGame(), 30);
    s = rollTo(s, 5);
    expect(s.players[0].hand.length).toBe(1);
    expect(CARDS[s.players[0].hand[0]].kind).not.toBe('instant');
    const entry = s.log.find((e) => e.text === '始まりの門でカードを1枚引いた');
    expect(entry?.secret).toContain(CARDS[s.players[0].hand[0]].name);
  });

  it('運命の石碑で2枚めくれたら、好きな方を1枚もらう', () => {
    let s = rollToWhere(newGame(), 3, (x) => x.phase.kind === 'pick');
    if (s.phase.kind !== 'pick') throw new Error();
    const second = s.phase.options[1];
    expect(s.phase.options.length).toBe(2);
    s = applyAction(s, { type: 'pick', index: 1 });
    expect(s.players[0].hand).toEqual([second]);
    expect(s.current).toBe(1);
  });

  it('石碑で損をするカードがめくれたら、その場で発動し、もう1枚をもらう', () => {
    const s = rollToWhere(newGame(), 3, (x) => x.log.some((e) => e.text.startsWith('王の徴税')) && x.players[0].hand.length === 1);
    expect(s.players[0].money).toBe(2700);
    expect(s.current).toBe(1);
  });

  it('手札が上限を超えたら、手番の終わりに1枚選んで捨てる', () => {
    let s = placeAll(newGame(), 30);
    s.players[0].hand = ['treasure', 'treasure', 'treasure', 'treasure', 'treasure'];
    s = rollTo(s, 5); // 始まりの門で6枚目
    expect(s.phase.kind).toBe('buy');
    s = applyAction(s, { type: 'pass' });
    expect(s.phase).toEqual({ kind: 'discard', then: 'after' });
    expect(s.current).toBe(0);
    s = applyAction(s, { type: 'discard', index: 0 });
    expect(s.players[0].hand.length).toBe(CONFIG.handLimit);
    expect(s.current).toBe(1);
  });
});

describe('手札カード：攻め', () => {
  it('宝箱で200〜2000Gのどれかをもらい、攻めのカードは1回の手番に1枚まで', () => {
    let s = newGame();
    s.players[0].hand = ['treasure', 'treasure'];
    s = applyAction(s, { type: 'useCard', card: 'treasure' });
    const got = s.players[0].money - 3000;
    expect(got).toBeGreaterThanOrEqual(CONFIG.treasureMin);
    expect(got).toBeLessThanOrEqual(CONFIG.treasureMax);
    expect(got % CONFIG.treasureStep).toBe(0);
    expect(s.players[0].hand).toEqual(['treasure']);
    expect(s.lastCard?.card).toBe('treasure');
    expect(() => applyAction(s, { type: 'useCard', card: 'treasure' })).toThrow(GameError);
  });

  it('次の手番になれば、また使える', () => {
    let s = newGame();
    s.players[0].hand = ['treasure', 'treasure'];
    s = applyAction(s, { type: 'useCard', card: 'treasure' });
    s = rollTo(s, 4);
    s = applyAction(s, { type: 'pass' });
    for (let i = 0; i < 3; i++) s = applyAction(rollTo(s, s.players[s.current].position + 4), { type: 'pass' });
    expect(s.current).toBe(0);
    const before = s.players[0].money;
    s = applyAction(s, { type: 'useCard', card: 'treasure' });
    expect(s.players[0].money).toBeGreaterThan(before);
  });

  it('祭りの招待状で自分の土地に祭りを開く', () => {
    let s = newGame();
    s.players[0].hand = ['festival'];
    s.properties[5] = { owner: 0, level: 1 };
    expect(() => applyAction(s, { type: 'useCard', card: 'festival', square: 6 })).toThrow(GameError);
    s = applyAction(s, { type: 'useCard', card: 'festival', square: 5 });
    expect(s.festivals).toEqual([5]);
  });

  it('地震で他人の建物を1段階壊す（ランドマークと自分の土地は対象外）', () => {
    let s = newGame();
    s.players[0].hand = ['earthquake'];
    s.properties[5] = { owner: 1, level: 2 };
    s.properties[6] = { owner: 1, level: 4 };
    s.properties[7] = { owner: 0, level: 2 };
    expect(() => applyAction(s, { type: 'useCard', card: 'earthquake', square: 6 })).toThrow(GameError);
    expect(() => applyAction(s, { type: 'useCard', card: 'earthquake', square: 7 })).toThrow(GameError);
    s = applyAction(s, { type: 'useCard', card: 'earthquake', square: 5 });
    expect(s.properties[5].level).toBe(1);
    expect(s.phase.kind).toBe('roll');
  });

  it('封印の鎖で相手を霧の孤島へ送る（自分の手番は続く）', () => {
    let s = newGame();
    s.players[0].hand = ['seal'];
    s = applyAction(s, { type: 'useCard', card: 'seal', target: 2 });
    expect(s.players[2].position).toBe(ISLAND);
    expect(s.players[2].islandTurns).toBe(CONFIG.islandTurns);
    expect(s.current).toBe(0);
    expect(s.phase.kind).toBe('roll');
  });

  it('運命の賽は400G払って出目を選べ、ゾロ目扱いにはならない', () => {
    let s = newGame();
    s.players[0].hand = ['destiny'];
    s = applyAction(s, { type: 'useCard', card: 'destiny', sum: 10 });
    expect(s.players[0].position).toBe(10);
    expect(s.players[0].money).toBe(3000 - CONFIG.destinyCost);
    expect(s.phase).toEqual({ kind: 'buy', square: 10 });
    s = applyAction(s, { type: 'pass' });
    expect(s.current).toBe(1);
  });

  it('運命の賽は霧の孤島では使えず、出目は2〜12だけ', () => {
    const s = newGame();
    s.players[0].hand = ['destiny'];
    expect(() => applyAction(s, { type: 'useCard', card: 'destiny', sum: 13 })).toThrow(GameError);
    s.players[0].position = ISLAND;
    s.players[0].islandTurns = 2;
    expect(() => applyAction(s, { type: 'useCard', card: 'destiny', sum: 4 })).toThrow(GameError);
  });

  it('追い風の羽：振ったあとに出目を±1できる', () => {
    let s = newGame();
    s.players[0].hand = ['tailwind'];
    s = applyAction({ ...s, seed: seedFor(4) }, { type: 'roll' });
    expect(s.phase).toEqual({ kind: 'adjust', dice: expect.any(Array), sum: expect.any(Number) });
    expect(s.players[0].position).toBe(0); // まだ動いていない
    s = applyAction(s, { type: 'adjust', delta: 1 });
    expect(s.players[0].position).toBe(5);
    expect(s.players[0].hand).toEqual([]);
  });

  it('追い風の羽を使わなければ普通に進み、羽は残る', () => {
    let s = newGame();
    s.players[0].hand = ['tailwind'];
    s = applyAction({ ...s, seed: seedFor(4) }, { type: 'roll' });
    s = applyAction(s, { type: 'adjust', delta: 0 });
    expect(s.players[0].position).toBe(4);
    expect(s.players[0].hand).toEqual(['tailwind']);
  });
});

describe('連続した土地のボーナス', () => {
  it('同じ人の土地が2マス続くと+30%、3マスで+60%', () => {
    const s = newGame();
    s.properties[5] = { owner: 1, level: 1 }; // 苔むす泉（別荘 84G）
    expect(chainLength(s, 5)).toBe(1);
    expect(rentOf(s, 5)).toBe(84);
    s.properties[6] = { owner: 1, level: 0 };
    expect(chainLength(s, 5)).toBe(2);
    expect(rentOf(s, 5)).toBe(Math.round(84 * 1.3));
    s.properties[7] = { owner: 1, level: 0 };
    expect(rentOf(s, 5)).toBe(Math.round(84 * 1.6));
  });

  it('別の人の土地や、土地以外のマスで途切れる', () => {
    const s = newGame();
    s.properties[5] = { owner: 1, level: 1 };
    s.properties[6] = { owner: 2, level: 0 };
    s.properties[7] = { owner: 1, level: 0 };
    expect(chainLength(s, 5)).toBe(1);
    s.properties[4] = { owner: 1, level: 0 }; // 観光地は土地ではないので数えない
    expect(chainLength(s, 5)).toBe(1);
  });
});

describe('築城の詔', () => {
  it('自分の土地を無料で1段階上げる', () => {
    let s = newGame();
    s.players[0].hand = ['growth'];
    s.properties[5] = { owner: 0, level: 1 };
    s.properties[6] = { owner: 1, level: 1 };
    expect(() => applyAction(s, { type: 'useCard', card: 'growth', square: 6 })).toThrow(GameError);
    s = applyAction(s, { type: 'useCard', card: 'growth', square: 5 });
    expect(s.properties[5].level).toBe(2);
    expect(s.players[0].money).toBe(3000);
  });

  it('1周目はビルまで、ランドマークは上げられない', () => {
    const s = newGame();
    s.players[0].hand = ['growth'];
    s.properties[5] = { owner: 0, level: 2 };
    s.properties[6] = { owner: 0, level: 4 };
    expect(() => applyAction(s, { type: 'useCard', card: 'growth', square: 5 })).toThrow(GameError);
    expect(() => applyAction(s, { type: 'useCard', card: 'growth', square: 6 })).toThrow(GameError);
  });
});

describe('宝箱の額', () => {
  it('200〜2000Gのいろいろな額が出る', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 400; seed++) {
      let s = newGame(seed);
      s.players[0].hand = ['treasure'];
      s = applyAction(s, { type: 'useCard', card: 'treasure' });
      seen.add(s.players[0].money - 3000);
    }
    expect(Math.min(...seen)).toBe(200);
    expect(Math.max(...seen)).toBe(2000);
    expect(seen.size).toBe(19);
  });
});

describe('手札カード：守り（割り込み）', () => {
  it('天使の加護：通行料を払う前に、使うか聞かれる', () => {
    let s = newGame();
    s.players[0].hand = ['angel'];
    s.properties[5] = { owner: 1, level: 2 };
    s = rollTo(s, 5);
    expect(s.phase).toMatchObject({ kind: 'react', responder: 0, card: 'angel' });
    s = applyAction(s, { type: 'react', use: true });
    expect(s.players[0].money).toBe(3000);
    expect(s.players[0].hand).toEqual([]);
    expect(s.phase).toEqual({ kind: 'buyout', square: 5 });
  });

  it('天使の加護を使わなければ普通に払い、カードは残る', () => {
    let s = newGame();
    s.players[0].hand = ['angel'];
    s.properties[5] = { owner: 1, level: 2 };
    s = rollTo(s, 5);
    s = applyAction(s, { type: 'react', use: false });
    expect(s.players[0].money).toBe(3000 - 210);
    expect(s.players[0].hand).toEqual(['angel']);
  });

  it('守護の結界：買収されそうになると、持ち主が割り込んで防げる', () => {
    let s = newGame();
    s.players[1].hand = ['barrier'];
    s.properties[5] = { owner: 1, level: 1 };
    s = rollTo(s, 5);
    s = applyAction(s, { type: 'buyout' });
    expect(s.phase).toMatchObject({ kind: 'react', responder: 1, card: 'barrier' });
    expect(actorOf(s)).toBe(1);
    const money = s.players[0].money;
    s = applyAction(s, { type: 'react', use: true });
    expect(s.properties[5].owner).toBe(1);
    expect(s.players[0].money).toBe(money);
    expect(s.players[1].hand).toEqual([]);
    expect(s.current).toBe(1);
  });

  it('守護の結界を使わなければ買収される', () => {
    let s = newGame();
    s.players[1].hand = ['barrier'];
    s.properties[5] = { owner: 1, level: 1 };
    s = rollTo(s, 5);
    s = applyAction(s, { type: 'buyout' });
    s = applyAction(s, { type: 'react', use: false });
    expect(s.properties[5].owner).toBe(0);
    expect(s.players[1].hand).toEqual(['barrier']);
  });

  it('鏡の盾：地震を跳ね返すと、使った人の建物が壊れる', () => {
    let s = newGame();
    s.players[0].hand = ['earthquake'];
    s.players[1].hand = ['mirror'];
    s.properties[5] = { owner: 1, level: 2 };
    s.properties[9] = { owner: 0, level: 3 };
    s = applyAction(s, { type: 'useCard', card: 'earthquake', square: 5 });
    expect(s.phase).toMatchObject({ kind: 'react', responder: 1, card: 'mirror' });
    s = applyAction(s, { type: 'react', use: true });
    expect(s.properties[5].level).toBe(2);
    expect(s.properties[9].level).toBe(2);
    expect(s.phase.kind).toBe('roll');
    expect(s.current).toBe(0);
  });

  it('鏡の盾：封印の鎖を跳ね返すと、使った人が孤島へ行き手番が終わる', () => {
    let s = newGame();
    s.players[0].hand = ['seal'];
    s.players[2].hand = ['mirror'];
    s = applyAction(s, { type: 'useCard', card: 'seal', target: 2 });
    s = applyAction(s, { type: 'react', use: true });
    expect(s.players[0].position).toBe(ISLAND);
    expect(s.players[2].position).toBe(0);
    expect(s.current).toBe(1);
  });

  it('鏡の盾を使わなければ、カードの効果をそのまま受ける', () => {
    let s = newGame();
    s.players[0].hand = ['seal'];
    s.players[2].hand = ['mirror'];
    s = applyAction(s, { type: 'useCard', card: 'seal', target: 2 });
    s = applyAction(s, { type: 'react', use: false });
    expect(s.players[2].position).toBe(ISLAND);
    expect(s.players[2].hand).toEqual(['mirror']);
    expect(s.current).toBe(0);
  });
});

describe('独占勝利', () => {
  /** プレイヤー0に色グループ A・B を独占させ、C の片方も持たせた状態 */
  function nearTriple(): GameState {
    const s = newGame(1);
    for (const sq of [1, 2, 5, 6, 7, 9]) s.properties[sq] = { owner: 0, level: 0 };
    return s;
  }

  it('2グループの独占では勝利にならない', () => {
    const s = nearTriple();
    expect(completedGroups(s, 0)).toEqual(['A', 'B']);
    expect(s.phase.kind).toBe('roll');
  });

  it('3つ目の色グループを買った瞬間に勝利する', () => {
    let s = nearTriple();
    s = rollTo(s, 10); // 人魚の入江
    s = applyAction(s, { type: 'buy', level: 0 });
    expect(s.phase).toEqual({ kind: 'gameover', winner: 0, reason: 'triple' });
  });

  it('買収で3つ目の色グループが揃っても勝利する', () => {
    let s = nearTriple();
    s.properties[10] = { owner: 1, level: 1 };
    s = rollTo(s, 10);
    expect(s.phase).toEqual({ kind: 'buyout', square: 10 });
    s = applyAction(s, { type: 'buyout' });
    expect(s.phase).toEqual({ kind: 'gameover', winner: 0, reason: 'triple' });
  });

  it('観光地4つを揃え、次の自分の番まで守り切ると勝利する', () => {
    let s = newGame(1);
    for (const sq of [12, 21, 29]) s.properties[sq] = { owner: 0, level: 0 };
    s = rollTo(s, 4);
    s = applyAction(s, { type: 'buy', level: 0 });
    expect(s.touristClaim).toBe(0);
    expect(s.current).toBe(1);
    s = passTurn(s);
    s = passTurn(s);
    expect(s.phase.kind).not.toBe('gameover');
    s = passTurn(s);
    expect(s.phase).toEqual({ kind: 'gameover', winner: 0, reason: 'tourist' });
  });

  it('守り切る前に観光地を買収されると、独占は崩れて勝利にならない', () => {
    let s = newGame(1);
    for (const sq of [12, 21, 29]) s.properties[sq] = { owner: 0, level: 0 };
    s = rollTo(s, 4);
    s = applyAction(s, { type: 'buy', level: 0 });
    // プレイヤー1が古代樹の神殿（4）に止まって買収する
    s = rollTo(s, 4);
    expect(s.phase).toEqual({ kind: 'buyout', square: 4 });
    s = applyAction(s, { type: 'buyout' });
    expect(s.touristClaim).toBeNull();
    s = passTurn(s);
    s = passTurn(s);
    expect(s.phase.kind).toBe('roll');
    expect(s.current).toBe(0);
  });

  it('観光地3つでは勝利にならない', () => {
    let s = newGame(1);
    for (const sq of [12, 21]) s.properties[sq] = { owner: 0, level: 0 };
    s = rollTo(s, 4);
    s = applyAction(s, { type: 'buy', level: 0 });
    expect(s.phase.kind).toBe('roll');
  });
});

describe('サイコロのゲージ', () => {
  function stats(aim?: Aim) {
    let seed = 7;
    let inZone = 0;
    let doubles = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const [a, b, next] = rollDice(seed, aim);
      seed = next;
      const zone = AIM_ZONES[aim ?? 'high'];
      if (a + b >= zone.min && a + b <= zone.max) inZone++;
      if (a === b) doubles++;
    }
    return { inZone: inZone / N, doubles: doubles / N };
  }

  it('狙うとそのゾーンの出目が出やすくなる', () => {
    // 大（8〜12）は普通に振ると約42%。狙うと 0.6 + 0.4 × 0.42 ≒ 77%
    expect(stats().inZone).toBeLessThan(0.47);
    expect(stats('high').inZone).toBeGreaterThan(0.72);
    expect(stats('low').inZone).toBeGreaterThan(0.72);
    expect(stats('mid').inZone).toBeGreaterThan(0.8);
  });

  it('狙ってもゾロ目の出やすさは大きく変わらない', () => {
    for (const aim of [undefined, 'low', 'mid', 'high'] as const) {
      const d = stats(aim).doubles;
      expect(d).toBeGreaterThan(0.11);
      expect(d).toBeLessThan(0.22);
    }
  });

  it('狙いはログに残る', () => {
    const s = applyAction(newGame(3), { type: 'roll', aim: 'high' });
    expect(s.log.some((e) => e.text.includes('狙い：大'))).toBe(true);
  });
});

describe('支払いと破産', () => {
  function withDebtor(money: number, ownsSquare?: number): GameState {
    const s = newGame(1);
    s.properties[31] = { owner: 1, level: 0 };
    s.players[0].position = 25;
    s.players[0].money = money;
    if (ownsSquare !== undefined) s.properties[ownsSquare] = { owner: 0, level: 0 };
    return s;
  }

  it('土地を売れば払えるなら売却の場面になる', () => {
    let s = rollTo(withDebtor(10, 30), 31);
    expect(s.phase).toEqual({ kind: 'liquidate', debt: 80, creditor: 1 });
    s = applyAction(s, { type: 'sell', square: 30 });
    expect(s.players[0].money).toBe(10 + 200 - 80);
    expect(s.players[1].money).toBe(3080);
  });

  it('売っても払えなければ破産し、土地は空き地に戻り、祭りも消える', () => {
    let s = withDebtor(10, 1);
    s.festivals = [1];
    s = rollTo(s, 31);
    expect(s.players[0].bankrupt).toBe(true);
    expect(s.properties[1]).toBeUndefined();
    expect(s.festivals).toEqual([]);
    expect(totalAssets(s, 0)).toBe(0);
  });

  it('最後の1人が勝つ', () => {
    let s = newGame(1);
    s.players[1].bankrupt = true;
    s.players[2].bankrupt = true;
    s.properties[31] = { owner: 3, level: 0 };
    s.players[0].position = 25;
    s.players[0].money = 0;
    s = rollTo(s, 31);
    expect(s.phase).toEqual({ kind: 'gameover', winner: 3, reason: 'survivor' });
  });
});

describe('ターン制限', () => {
  it('最終ターンの最後の手番が終わると総資産で勝者が決まる', () => {
    let s = placeAll(newGame(1), 29);
    s.turn = s.maxTurns;
    s.current = 3;
    s.players[2].money = 9999;
    s = rollTo(s, 0);
    expect(s.phase).toEqual({ kind: 'gameover', winner: 2, reason: 'assets' });
  });

  it('全員が1回ずつ手番を終えるとターンが進む', () => {
    let s = placeAll(newGame(1), 29);
    for (let i = 0; i < 4; i++) s = rollTo(s, 0);
    expect(s.turn).toBe(2);
    expect(s.current).toBe(0);
  });
});

/** 席0〜3にキャラを割り当てた、手札なしのゲーム */
function charGame(chars: (CharacterId | undefined)[], seed = 1): GameState {
  const s = createGame(SETUP.map((p, i) => ({ ...p, character: chars[i] })), seed);
  // 席ごとのお金の上乗せはなしにする（お金の計算を単純にするため）
  s.players.forEach((p) => ((p.hand = []), (p.mission = null), (p.money = CONFIG.initialMoney)));
  return s;
}

describe('キャラクター：ステータス', () => {
  it('収入：給料が1段階ごとに6%増減する（クロウは収入4、ガルムは収入2）', () => {
    const s = charGame(['crow', 'garm']);
    s.players[0].money = 9999;
    s.players[1].money = 9999;
    expect(salaryFor(s, 0).total).toBe(Math.round(300 * 1.06));
    expect(salaryFor(s, 1).total).toBe(Math.round(300 * 0.94));
  });

  it('建築：建設費が安くなる（土地代はそのまま）', () => {
    const s = charGame(['zeno']); // 建築4
    s.players[0].position = 0;
    s.phase = { kind: 'buy', square: 5 }; // 140G、ビルまで建設費210G
    expect(buyOptions(s, 5).find((o) => o.level === 2)!.cost).toBe(140 + Math.round(210 * 0.94));
  });

  it('交渉：買収価格が安くなる（バルドは交渉4で6%引き）', () => {
    const s = charGame(['bald']);
    s.properties[5] = { owner: 1, level: 1 };
    expect(buyoutPrice(s, 5)).toBe(Math.round(210 * 2 * 0.94));
  });

  it('威光：自分の土地の通行料が上がる（ミーシャは威光5で10%増し）', () => {
    const s = charGame([undefined, 'misha']);
    s.properties[5] = { owner: 1, level: 1 };
    expect(rentOf(s, 5)).toBe(Math.round(84 * 1.1));
  });

  it('キャラがいなければ補正はかからない', () => {
    const s = charGame([]);
    s.properties[5] = { owner: 1, level: 1 };
    expect(rentOf(s, 5)).toBe(84);
  });
});

describe('キャラクター：固有特性', () => {
  it('商魂（バルド）：買収した土地がその場で1段階上がる', () => {
    let s = charGame(['bald']);
    s.players[0].lapped = true;
    s.properties[5] = { owner: 1, level: 1 };
    s = rollTo(s, 5);
    s = applyAction(s, { type: 'buyout' });
    expect(s.properties[5]).toEqual({ owner: 0, level: 2 });
  });

  it('霧読み（リラ）：孤島のマスに止まっても流されない', () => {
    let s = charGame(['lila']);
    s = rollTo(s, ISLAND);
    expect(s.players[0].islandTurns).toBe(0);
    expect(s.current).toBe(1);
  });

  it('霧読み（リラ）：封印の鎖の対象にならない', () => {
    const s = charGame([undefined, 'lila']);
    s.players[0].hand = ['seal'];
    expect(() => applyAction(s, { type: 'useCard', card: 'seal', target: 1 })).toThrow(GameError);
  });

  it('霧読み（リラ）：ゾロ目3連続でも孤島へは行かず、手番が終わる', () => {
    let s = placeAll(charGame(['lila']), 28);
    s = rollTo(s, 0, true);
    s = rollTo(s, 10, true);
    s = applyAction(s, { type: 'pass' });
    s = applyAction({ ...s, seed: seedFor(6, true) }, { type: 'roll' });
    expect(s.players[0].position).toBe(10);
    expect(s.players[0].islandTurns).toBe(0);
    expect(s.current).toBe(1);
  });

  it('布陣（ゼノ）：揃えた色グループの土地は通行料2倍（連続ボーナスと重なる）', () => {
    const s = charGame([undefined, 'zeno']);
    s.properties[1] = { owner: 1, level: 1 };
    expect(rentOf(s, 1)).toBe(60);
    s.properties[2] = { owner: 1, level: 1 };
    expect(rentOf(s, 1)).toBe(Math.round(60 * 1.3 * 2));
  });

  it('祭囃子（ミーシャ）：自分の土地の祭りは3倍', () => {
    const s = charGame([undefined, 'misha']);
    s.properties[5] = { owner: 1, level: 1 };
    s.festivals = [5];
    expect(rentOf(s, 5)).toBe(Math.round(84 * 1.1 * 3));
  });

  it('祝福の声（セレナ）：祝福の門で2段階上がる', () => {
    let s = placeAll(charGame(['serena']), 29);
    s.players[0].lapped = true;
    s.properties[5] = { owner: 0, level: 1 };
    s = rollTo(s, 0);
    s = applyAction(s, { type: 'choose', square: 5 });
    expect(s.properties[5].level).toBe(3);
  });

  it('星読み（オルド）：運命の石碑で3枚めくれる', () => {
    const s = rollToWhere(charGame(['ord']), 3, (x) => x.phase.kind === 'pick' && x.phase.options.length === 3);
    expect(s.phase.kind).toBe('pick');
  });

  it('早業（クロウ）：攻めのカードを1回の手番に2枚使える', () => {
    let s = charGame(['crow']);
    s.players[0].hand = ['treasure', 'treasure', 'treasure'];
    s = applyAction(s, { type: 'useCard', card: 'treasure' });
    s = applyAction(s, { type: 'useCard', card: 'treasure' });
    expect(() => applyAction(s, { type: 'useCard', card: 'treasure' })).toThrow(GameError);
  });

  it('天翔（ガルム）：好きなマスへ飛べ、2周するまでは次を使えない', () => {
    let s = charGame(['garm']);
    s.players[0].laps = 1; // 初回は1周してから解放される
    expect(canFly(s)).toBe(true);
    s = applyAction(s, { type: 'fly', square: 13 });
    expect(s.players[0].position).toBe(13);
    expect(s.phase).toEqual({ kind: 'buy', square: 13 });
    s = applyAction(s, { type: 'pass' });
    for (let i = 0; i < 3; i++) s = applyAction(rollTo(s, 5), { type: 'pass' });
    expect(s.current).toBe(0);
    expect(canFly(s)).toBe(false);
  });

  it('天翔（ガルム）：始まりの門を越えて飛ぶと給料が出て、しばらくは飛べない', () => {
    let s = charGame(['garm']);
    s.players[0].laps = 1; // 初回は1周してから解放される
    s.players[0].position = 20;
    [1, 2, 3].forEach((i) => (s.players[i].money = 0)); // ガルムを首位にして、最下位の2倍がかからないように
    s = applyAction(s, { type: 'fly', square: 5 });
    expect(s.players[0].money).toBe(3000 - CONFIG.skyrideCost + Math.round(300 * 0.94)); // ガルムは収入2
    expect(s.players[0].skyUsed).toBe(true);
  });

  it('天翔はキャラが違えば使えない', () => {
    const s = charGame(['bald']);
    expect(() => applyAction(s, { type: 'fly', square: 5 })).toThrow(GameError);
  });

  it('天翔（ガルム）：初回は1周するまで使えず、2回目は従来どおり2周に1回', () => {
    let s = charGame(['garm']);
    // 0周では使えない
    expect(s.players[0].laps).toBe(0);
    expect(canFly(s)).toBe(false);
    expect(() => applyAction(s, { type: 'fly', square: 13 })).toThrow(GameError);
    // 1周完了で解放される
    s.players[0].laps = 1;
    expect(canFly(s)).toBe(true);
    s = applyAction(s, { type: 'fly', square: 13 });
    expect(s.players[0].skyUses).toBe(1);
    s = applyAction(s, { type: 'pass' });
    for (let i = 0; i < 3; i++) s = applyAction(rollTo(s, 5), { type: 'pass' });
    expect(s.current).toBe(0);
    expect(canFly(s)).toBe(false);
    // 始まりの門を1回通過しても、まだ戻らない
    s.players[0].position = 30;
    s = rollTo(s, 2);
    if (s.phase.kind === 'adjust') s = applyAction(s, { type: 'adjust', delta: 0 }); // 追い風の羽を持っていたら使わない
    if (s.phase.kind === 'buy') s = applyAction(s, { type: 'pass' });
    for (let i = 0; i < 3; i++) s = applyAction(rollTo(s, 10), { type: 'pass' });
    expect(s.current).toBe(0);
    expect(s.players[0].skyUsed).toBe(true);
    expect(canFly(s)).toBe(false);
    // 2回目の通過で戻り、初回ゲート（未使用でなければ）にはかからない
    s.players[0].position = 30;
    s = rollTo(s, 2);
    if (s.phase.kind === 'adjust') s = applyAction(s, { type: 'adjust', delta: 0 }); // 追い風の羽を持っていたら使わない
    if (s.phase.kind === 'buy') s = applyAction(s, { type: 'pass' });
    for (let i = 0; i < 3; i++) s = applyAction(rollTo(s, 15), { type: 'pass' });
    expect(s.current).toBe(0);
    expect(s.players[0].skyUsed).toBe(false);
    expect(canFly(s)).toBe(true);
  });
});

describe('鏡の盾：買収', () => {
  it('買収を跳ね返すと、土地は守られ、買収しようとした人が通行料をもう一度払う', () => {
    let s = newGame();
    s.properties[5] = { owner: 1, level: 1 };
    s.players[1].hand = ['mirror'];
    s = rollTo(s, 5);
    const rent = rentOf(s, 5);
    s = applyAction(s, { type: 'buyout' });
    expect(s.phase).toMatchObject({ kind: 'react', responder: 1, card: 'mirror' });
    s = applyAction(s, { type: 'react', use: true });
    expect(s.properties[5].owner).toBe(1);
    expect(s.players[0].money).toBe(3000 - rent * 2);
    expect(s.players[1].hand).toEqual([]);
  });

  it('鏡の盾を断ると、守護の結界を持っていればそちらを聞かれる', () => {
    let s = newGame();
    s.properties[5] = { owner: 1, level: 1 };
    s.players[1].hand = ['mirror', 'barrier'];
    s = rollTo(s, 5);
    s = applyAction(s, { type: 'buyout' });
    s = applyAction(s, { type: 'react', use: false });
    expect(s.phase).toMatchObject({ kind: 'react', responder: 1, card: 'barrier' });
    s = applyAction(s, { type: 'react', use: true });
    expect(s.properties[5].owner).toBe(1);
    expect(s.players[1].hand).toEqual(['mirror']);
  });
});

describe('秘密の使命', () => {
  it('1人1枚ずつ、重ならないように配られる', () => {
    const s = createGame(SETUP, 7);
    const ids = s.players.map((p) => p.mission);
    expect(ids.every((m) => m && MISSIONS[m])).toBe(true);
    expect(new Set(ids).size).toBe(4);
  });

  it('達成すると報酬をもらい、全員に公開される', () => {
    let s = newGame();
    s.players[0].mission = 'tourist2';
    s.properties[12] = { owner: 0, level: 0 };
    s = rollTo(s, 4);
    s = applyAction(s, { type: 'buy', level: 0 });
    expect(s.players[0].missionDone).toBe(true);
    expect(s.players[0].money).toBe(3000 - CONFIG.touristPrice + MISSIONS.tourist2.reward);
    expect(s.lastMission).toEqual({ player: 0, mission: 'tourist2' });
  });

  it('報酬は1回だけ', () => {
    let s = newGame();
    s.players[0].mission = 'tourist2';
    s.players[0].missionDone = true;
    s.properties[12] = { owner: 0, level: 0 };
    s = rollTo(s, 4);
    s = applyAction(s, { type: 'buy', level: 0 });
    expect(s.players[0].money).toBe(3000 - CONFIG.touristPrice);
  });

  it('関所の長：受け取った通行料を数える', () => {
    let s = newGame();
    s.players[1].mission = 'toll';
    s.properties[5] = { owner: 1, level: 2 };
    s = rollTo(s, 5);
    expect(missionProgress(s, 1, 'toll').now).toBe(rentOf(s, 5));
  });

  it('四方の領主：建物の建った土地のある辺の数を数える（更地と観光地は数えない）', () => {
    const s = newGame();
    s.properties[1] = { owner: 0, level: 1 };
    s.properties[2] = { owner: 0, level: 2 };
    s.properties[10] = { owner: 0, level: 0 };
    s.properties[12] = { owner: 0, level: 0 };
    s.properties[22] = { owner: 0, level: 1 };
    s.properties[30] = { owner: 0, level: 3 };
    expect(missionProgress(s, 0, 'frontier')).toEqual({ now: 3, goal: 4 });
  });

  it('城壁の連なり：2マス以上続いた土地の数を数える', () => {
    const s = newGame();
    s.properties[5] = { owner: 0, level: 0 };
    s.properties[6] = { owner: 0, level: 0 };
    s.properties[9] = { owner: 0, level: 0 };
    s.properties[13] = { owner: 0, level: 0 };
    s.properties[14] = { owner: 1, level: 0 };
    expect(missionProgress(s, 0, 'chain3')).toEqual({ now: 2, goal: 3 });
  });

  it('征服者：買収の回数を数える', () => {
    let s = newGame();
    s.properties[5] = { owner: 1, level: 0 };
    s = rollTo(s, 5);
    s = applyAction(s, { type: 'buyout' });
    expect(missionProgress(s, 0, 'raider').now).toBe(1);
  });
});

describe('略奪の令状', () => {
  it('止まらずに買収する。買収価格の1.5倍を払い、持ち主は買収価格を受け取る。そのあとサイコロを振れる', () => {
    let s = newGame();
    s.players[0].hand = ['raid'];
    s.properties[17] = { owner: 1, level: 2 };
    const price = buyoutPrice(s, 17);
    expect(raidPrice(s, 17)).toBe(Math.round(price * CONFIG.raidRate));
    s = applyAction(s, { type: 'useCard', card: 'raid', square: 17 });
    expect(s.properties[17].owner).toBe(0);
    expect(s.players[0].money).toBe(3000 - Math.round(price * CONFIG.raidRate));
    expect(s.players[1].money).toBe(3000 + price);
    expect(s.phase).toEqual({ kind: 'roll' });
    expect(s.current).toBe(0);
    expect(missionProgress(s, 0, 'raider').now).toBe(1);
  });

  it('守護の結界で防がれると、お金は動かず、サイコロを振る場面に戻る', () => {
    let s = newGame();
    s.players[0].hand = ['raid'];
    s.players[1].hand = ['barrier'];
    s.properties[17] = { owner: 1, level: 2 };
    s = applyAction(s, { type: 'useCard', card: 'raid', square: 17 });
    expect(s.phase).toMatchObject({ kind: 'react', responder: 1, card: 'barrier' });
    s = applyAction(s, { type: 'react', use: true });
    expect(s.properties[17].owner).toBe(1);
    expect(s.players[0].money).toBe(3000);
    expect(s.players[0].hand).toEqual([]);
    expect(s.phase).toEqual({ kind: 'roll' });
    expect(s.current).toBe(0);
  });

  it('ランドマークと、払えない土地は狙えない', () => {
    const s = newGame();
    s.properties[17] = { owner: 1, level: LEVEL.LANDMARK };
    s.properties[30] = { owner: 1, level: 3 };
    s.properties[5] = { owner: 1, level: 0 };
    s.players[0].money = 500;
    expect(raidTargets(s)).toEqual([5]);
  });
});

describe('レアキャラの特性', () => {
  const withConfig = (patch: Record<string, number>, fn: () => void) => {
    const c = CONFIG as unknown as Record<string, number>;
    const saved = Object.fromEntries(Object.keys(patch).map((k) => [k, c[k]]));
    Object.assign(c, patch);
    try {
      fn();
    } finally {
      Object.assign(c, saved);
    }
  };

  it('旋風：巫女のいるマスに止まると、巫女の通行料がいちばん高い土地へ飛ばされて払う（1周に1回）', () => {
    let s = charGame([undefined, 'tsumuji']);
    s.players[1].position = 5;
    s.properties[30] = { owner: 1, level: 2 };
    s.properties[9] = { owner: 1, level: 0 };
    const rent = rentOf(s, 30);
    s = rollTo(s, 5);
    expect(s.players[0].position).toBe(30);
    expect(s.players[0].money).toBe(3000 - rent);
    expect(s.players[1].traitUsed).toBe(true);
  });

  it('破魔：相手の守りのカードを無効にできる', () => {
    withConfig({ pierceRate: 1 }, () => {
      let s = charGame([undefined, 'azuma']);
      s.players[0].hand = ['angel'];
      s.properties[5] = { owner: 1, level: 2 };
      const rent = rentOf(s, 5);
      s = rollTo(s, 5);
      s = applyAction(s, { type: 'react', use: true });
      expect(s.players[0].hand).toEqual([]);
      expect(s.players[0].money).toBe(3000 - rent);
    });
  });

  it('開拓：2周目の通過で空き地を1つもらう', () => {
    let s = charGame(['noel']);
    s.players[0].laps = 1;
    s.players[0].position = 30;
    s = rollTo(s, 3);
    expect(s.players[0].laps).toBe(2);
    expect(Object.values(s.properties).filter((p) => p.owner === 0).length).toBe(1);
  });

  it('剛腕：同じマスの相手を押し出し、押し出し先の通行料を払わせる', () => {
    let s = charGame(['garou']);
    s.players[1].position = 6;
    s.properties[7] = { owner: 0, level: 1 };
    const rent = rentOf(s, 7);
    s = rollTo(s, 6);
    expect(s.phase).toEqual({ kind: 'push', pusher: 0, targets: [1] });
    s = applyAction(s, { type: 'push', target: 1, dir: 1 });
    expect(s.players[1].position).toBe(7);
    expect(s.players[1].money).toBe(3000 - rent - CONFIG.shoveFee);
    expect(s.players[0].money).toBe(3000 + rent + CONFIG.shoveFee);
    expect(s.phase).toEqual({ kind: 'buy', square: 6 });
  });

  it('剛腕：相手が止まってきたときも押し出せる。押し出された手番の人は、押し出し先で止まったことになる', () => {
    let s = charGame([undefined, 'garou']);
    s.players[1].position = 6;
    s = rollTo(s, 6);
    expect(s.phase).toEqual({ kind: 'push', pusher: 1, targets: [0] });
    expect(actorOf(s)).toBe(1);
    s = applyAction(s, { type: 'push', target: 0, dir: 2 });
    expect(s.players[0].position).toBe(8);
    expect(s.players[0].islandTurns).toBe(CONFIG.islandTurns);
  });

  it('剛腕：押し出さなければ、そのまま自分のマスの処理', () => {
    let s = charGame(['garou']);
    s.players[1].position = 6;
    s = rollTo(s, 6);
    s = applyAction(s, { type: 'pass' });
    expect(s.phase).toEqual({ kind: 'buy', square: 6 });
  });

  it('大勝負：勝てば半額、負ければ1.25倍', () => {
    const results = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      let s = charGame(['karuta'], seed);
      s.properties[5] = { owner: 1, level: 2 };
      s = rollTo(s, 5);
      expect(s.phase.kind).toBe('gamble');
      s = applyAction({ ...s, seed }, { type: 'gamble', use: true });
      results.add(3000 - s.players[0].money);
    }
    expect([...results].sort((a, b) => a - b)).toEqual([105, Math.round(210 * CONFIG.gambleLose)]);
  });

  it('操り糸：他人の出目を±1できる', () => {
    let s = charGame([undefined, 'kugutsu']);
    s = applyAction({ ...s, seed: seedFor(5) }, { type: 'roll' });
    expect(s.phase).toMatchObject({ kind: 'puppet', responder: 1, sum: 5 });
    expect(actorOf(s)).toBe(1);
    s = applyAction(s, { type: 'puppet', delta: 1 });
    expect(s.players[0].position).toBe(6);
    expect(s.players[1].traitUsed).toBe(true);
  });

  it('写し身：他人が攻めのカードを使うと、同じカードをもらえることがある', () => {
    withConfig({ mimicRate: 1 }, () => {
      let s = charGame([undefined, 'echo']);
      s.players[0].hand = ['treasure'];
      s = applyAction(s, { type: 'useCard', card: 'treasure' });
      expect(s.players[1].hand).toEqual(['treasure']);
    });
  });
});

describe('特性の強化', () => {
  it('祭囃子：2か所まで同時に祭りを開け、3か所目で一番古い祭りが終わる', () => {
    let s = charGame(['misha']);
    for (const sq of [5, 6, 7]) s.properties[sq] = { owner: 0, level: 1 };
    s.players[0].hand = ['festival', 'festival', 'festival'];
    for (const sq of [5, 6, 7]) {
      s = applyAction(s, { type: 'useCard', card: 'festival', square: sq });
      s.cardsUsed = 0;
    }
    expect(s.festivals).toEqual([6, 7]);
  });

  it('祭りは1人1か所まで。他の人が開いても自分の祭りは消えない', () => {
    let s = charGame([]);
    s.properties[5] = { owner: 0, level: 1 };
    s.properties[6] = { owner: 0, level: 1 };
    s.properties[9] = { owner: 1, level: 1 };
    s.festivals = [9];
    s.players[0].hand = ['festival', 'festival'];
    s = applyAction(s, { type: 'useCard', card: 'festival', square: 5 });
    s.cardsUsed = 0;
    s = applyAction(s, { type: 'useCard', card: 'festival', square: 6 });
    expect(s.festivals).toEqual([9, 6]);
  });

  it('祭りの土地が買収されると、祭りは終わる', () => {
    let s = charGame([]);
    s.properties[5] = { owner: 1, level: 1 };
    s.festivals = [5];
    s = rollTo(s, 5);
    s = applyAction(s, { type: 'buyout' });
    expect(s.properties[5].owner).toBe(0);
    expect(s.festivals).toEqual([]);
  });

  it('祭囃子：始まりの門を通過すると、自分の土地で自動で祭りが始まる', () => {
    let s = charGame(['misha']);
    s.properties[30] = { owner: 0, level: 2 };
    s.players[0].position = 29;
    s = rollTo(s, 3);
    expect(s.festivals).toEqual([30]);
  });

  it('祝福の声：始まりの門を通過しただけでも1段階上がる', () => {
    let s = charGame(['serena']);
    s.properties[30] = { owner: 0, level: 1 };
    s.players[0].position = 29;
    s.players[0].lapped = true;
    s = rollTo(s, 3);
    expect(s.properties[30].level).toBe(2);
  });

  it('霧渡り：霧の孤島に止まると、次の手番で好きなマスへ', () => {
    let s = charGame(['lila']);
    s = rollTo(s, 8);
    expect(s.players[0].islandTurns).toBe(0);
    expect(s.players[0].travelPending).toBe(true);
  });

  it('旋風：自分が止まったマスにいる相手も吹き飛ばして払わせる', () => {
    let s = charGame(['tsumuji']);
    s.players[1].position = 5;
    s.properties[30] = { owner: 0, level: 2 };
    s.properties[1] = { owner: 0, level: 0 };
    const rent = rentOf(s, 30);
    s = rollTo(s, 5);
    expect(s.players[1].position).toBe(30);
    expect(s.players[1].money).toBe(3000 - rent);
    expect(s.players[0].traitUsed).toBe(true);
  });
});

describe('土地の取引', () => {
  /** P0 が P1 の苔むす泉（5・ビル）を狙い、自分の漁火の港（9）を対価に出せる状態 */
  function tradeGame(): GameState {
    const s = newGame(1);
    s.properties[5] = { owner: 1, level: 2 };
    s.properties[9] = { owner: 0, level: 0 };
    return s;
  }

  it('提示すると応答フェーズになり、応答する人が actorOf になる', () => {
    const s0 = tradeGame();
    expect(canOfferTrade(s0)).toBe(true);
    const s = applyAction(s0, { type: 'offerTrade', to: 1, want: 5, give: [9], money: 100 });
    expect(s.phase.kind).toBe('trade');
    expect(actorOf(s)).toBe(1);
    expect(s.tradeUsed).toBe(true);
    expect(s.log.some((e) => /に取引を持ちかけた/.test(e.text))).toBe(true);
  });

  it('成立すると土地（建物の段階そのまま）とお金が移り、サイコロの場面に戻る', () => {
    let s = tradeGame();
    s = applyAction(s, { type: 'offerTrade', to: 1, want: 5, give: [9], money: 100 });
    s = applyAction(s, { type: 'answerTrade', accept: true });
    expect(s.properties[5]).toEqual({ owner: 0, level: 2 });
    expect(s.properties[9]).toEqual({ owner: 1, level: 0 });
    expect(s.players[0].money).toBe(2900);
    expect(s.players[1].money).toBe(3100);
    expect(s.phase.kind).toBe('roll');
    expect(s.log.some((e) => /取引成立/.test(e.text))).toBe(true);
  });

  it('断ると何も移らず、サイコロの場面に戻る', () => {
    let s = tradeGame();
    s = applyAction(s, { type: 'offerTrade', to: 1, want: 5, give: [], money: 500 });
    s = applyAction(s, { type: 'answerTrade', accept: false });
    expect(s.properties[5].owner).toBe(1);
    expect(s.players[0].money).toBe(3000);
    expect(s.players[1].money).toBe(3000);
    expect(s.phase.kind).toBe('roll');
    expect(s.log.some((e) => /取引を断った/.test(e.text))).toBe(true);
  });

  it('1回の手番に2回は持ちかけられず、次の手番ではまた持ちかけられる', () => {
    let s = tradeGame();
    s.properties[6] = { owner: 2, level: 0 };
    s = applyAction(s, { type: 'offerTrade', to: 1, want: 5, give: [], money: 500 });
    s = applyAction(s, { type: 'answerTrade', accept: false });
    expect(canOfferTrade(s)).toBe(false);
    expect(() => applyAction(s, { type: 'offerTrade', to: 2, want: 6, give: [], money: 100 })).toThrow(GameError);
    // 手番を終えると、また取引できる
    s.players[0].position = 2;
    s = applyAction({ ...s, seed: seedFor(10) }, { type: 'roll' }); // 沈んだ灯台（観光地・空き地）
    if (s.phase.kind === 'buy') s = applyAction(s, { type: 'pass' });
    expect(s.current).toBe(1);
    expect(s.tradeUsed).toBe(false);
    expect(canOfferTrade(s)).toBe(true);
  });

  it('サイコロを振る前以外は持ちかけられない', () => {
    const s = tradeGame();
    s.phase = { kind: 'buy', square: 13 };
    expect(canOfferTrade(s)).toBe(false);
    expect(() => applyAction(s, { type: 'offerTrade', to: 1, want: 5, give: [], money: 100 })).toThrow(GameError);
  });

  it('相手の土地でないものは指名できない', () => {
    const s = tradeGame();
    s.properties[6] = { owner: 2, level: 0 };
    // 自分の土地
    expect(() => applyAction(s, { type: 'offerTrade', to: 1, want: 9, give: [], money: 100 })).toThrow(GameError);
    // 空き地
    expect(() => applyAction(s, { type: 'offerTrade', to: 1, want: 13, give: [], money: 100 })).toThrow(GameError);
    // 第3者の土地
    expect(() => applyAction(s, { type: 'offerTrade', to: 1, want: 6, give: [], money: 100 })).toThrow(GameError);
  });

  it('対価の検証：他人の土地・所持金超え・対価なし・自分宛ては出せない', () => {
    const s = tradeGame();
    expect(() => applyAction(s, { type: 'offerTrade', to: 1, want: 5, give: [6], money: 0 })).toThrow(GameError);
    expect(() => applyAction(s, { type: 'offerTrade', to: 1, want: 5, give: [], money: 3001 })).toThrow(GameError);
    expect(() => applyAction(s, { type: 'offerTrade', to: 1, want: 5, give: [], money: 0 })).toThrow(GameError);
    expect(() => applyAction(s, { type: 'offerTrade', to: 0, want: 5, give: [], money: 100 })).toThrow(GameError);
  });

  it('祭りの開かれている土地が取引されると、祭りは終わる', () => {
    let s = tradeGame();
    s.festivals = [5];
    s = applyAction(s, { type: 'offerTrade', to: 1, want: 5, give: [9], money: 0 });
    s = applyAction(s, { type: 'answerTrade', accept: true });
    expect(s.festivals).not.toContain(5);
  });

  it('取引で観光地が4つ揃うと守り切りが始まり、手放すと取り消される', () => {
    let s = newGame(1);
    for (const sq of [4, 12, 21]) s.properties[sq] = { owner: 0, level: 0 };
    s.properties[29] = { owner: 1, level: 0 };
    s = applyAction(s, { type: 'offerTrade', to: 1, want: 29, give: [], money: 400 });
    s = applyAction(s, { type: 'answerTrade', accept: true });
    expect(s.touristClaim).toBe(0);
    // P1 の番にして、P0 の観光地を1つ取り返す
    s.current = 1;
    s.tradeUsed = false;
    s = applyAction(s, { type: 'offerTrade', to: 0, want: 29, give: [], money: 400 });
    s = applyAction(s, { type: 'answerTrade', accept: true });
    expect(s.properties[29].owner).toBe(1);
    expect(s.touristClaim).toBe(null);
  });

  it('取引で色グループ3つ目が完成すると、その場で勝利になる', () => {
    let s = newGame(1);
    for (const sq of [1, 2, 5, 6, 7, 9]) s.properties[sq] = { owner: 0, level: 0 };
    s.properties[10] = { owner: 1, level: 0 };
    s = applyAction(s, { type: 'offerTrade', to: 1, want: 10, give: [], money: 500 });
    s = applyAction(s, { type: 'answerTrade', accept: true });
    expect(s.phase.kind).toBe('gameover');
    if (s.phase.kind === 'gameover') {
      expect(s.phase.winner).toBe(0);
      expect(s.phase.reason).toBe('triple');
    }
  });

  it('tradeValueOf は、完成する土地を投資額より高く、関係ない土地は投資額どおりに評価する', () => {
    const s = newGame(1);
    s.properties[5] = { owner: 1, level: 0 };
    s.properties[6] = { owner: 0, level: 0 };
    s.properties[7] = { owner: 0, level: 0 };
    expect(investedValue(s, 5)).toBe(140);
    expect(tradeValueOf(s, 5, 0)).toBe(224); // P0 が手に入れると森が揃う
    expect(tradeValueOf(s, 5, 1)).toBe(140); // P1 にとっては投資額どおり
    s.properties[13] = { owner: 2, level: 0 };
    expect(tradeValueOf(s, 13, 0)).toBe(220);
  });
});

describe('手番の順（ターンごとに先頭がずれる）', () => {
  it('ターンが進むたびに先頭が1人ずつずれる', () => {
    const c = CONFIG as unknown as Record<string, unknown>;
    c.turnOrder = 'rotate';
    try {
      expect(roundOrder(1, 4)).toEqual([0, 1, 2, 3]);
      expect(roundOrder(2, 4)).toEqual([1, 2, 3, 0]);
      expect(roundOrder(5, 4)).toEqual([0, 1, 2, 3]);
      let s = newGame();
      // ターン1：0→1→2→3、ターン2の先頭は1
      for (let k = 0; k < 4; k++) {
        s.players[s.current].position = 0;
        s = applyAction({ ...s, seed: seedFor(5) }, { type: 'roll' });
        if (s.phase.kind === 'buy') s = applyAction(s, { type: 'pass' });
      }
      expect(s.turn).toBe(2);
      expect(s.current).toBe(1);
    } finally {
      c.turnOrder = 'fixed';
    }
  });
});

describe('新キャラ：黄金変換と大航海', () => {
  it('黄金変換：銀行への売値が投資額の全額（ふつうは半額）', () => {
    const s = charGame(['verre']);
    s.properties[1] = { owner: 0, level: 0 }; // 麦畑の里（100G）
    expect(sellValue(s, 1)).toBe(100);
    const plain = charGame([undefined]);
    plain.properties[1] = { owner: 0, level: 0 };
    expect(sellValue(plain, 1)).toBe(50);
  });

  it('大航海：自分の観光地の通行料が+50%', () => {
    const s = charGame(['rosso']);
    s.properties[4] = { owner: 0, level: 0 }; // 古代樹の神殿（観光地1つで通行料100G）
    expect(rentOf(s, 4)).toBe(150);
    const plain = charGame([undefined]);
    plain.properties[4] = { owner: 0, level: 0 };
    expect(rentOf(plain, 4)).toBe(100);
  });

  it('大航海：観光地の買収価格が2割引（土地は割引なし）', () => {
    const s = charGame([undefined, 'rosso']);
    s.properties[4] = { owner: 0, level: 0 }; // 観光地（300G）
    // 買収価格 = 300 × 2（買収倍率）× 0.94（交渉4の割引）× 0.8（大航海）
    expect(buyoutPrice(s, 4, 1)).toBe(Math.round(300 * 2 * 0.94 * 0.8));
    s.properties[1] = { owner: 0, level: 0 }; // 土地（100G）は大航海の割引なし
    expect(buyoutPrice(s, 1, 1)).toBe(Math.round(100 * 2 * 0.94));
  });
});

describe('新キャラ：巻き戻し', () => {
  it('サイコロを振ると、動く前に振り直しを選ぶ場面になる', () => {
    let s = charGame(['chrono']);
    s = applyAction(s, { type: 'roll' });
    expect(s.phase.kind).toBe('reroll');
    expect(s.players[0].position).toBe(0); // まだ動いていない
  });

  it('振り直さないと、いまの目で進む（特性は温存される）', () => {
    let s = charGame(['chrono']);
    s = applyAction(s, { type: 'roll' });
    if (s.phase.kind !== 'reroll') throw new Error('巻き戻しの場面のはず');
    const sum = s.phase.sum;
    s = applyAction(s, { type: 'reroll', use: false });
    expect(s.players[0].position).toBe(sum);
    expect(s.players[0].rerollUsed).toBe(false);
  });

  it('振り直すと、その周ではもう振り直しを選べない', () => {
    let s = charGame(['chrono']);
    s = applyAction(s, { type: 'roll' });
    s = applyAction(s, { type: 'reroll', use: true });
    expect(s.players[0].rerollUsed).toBe(true);
    expect(s.phase.kind).not.toBe('reroll');
    expect(s.log.some((e) => /巻き戻しで/.test(e.text))).toBe(true);
  });

  it('始まりの門を通過すると、また振り直せるようになる', () => {
    let s = charGame(['chrono']);
    s.players[0].rerollUsed = true;
    s.players[0].position = 30;
    s = rollTo(s, 3); // スタートを通過して運命の石碑へ
    expect(s.players[0].laps).toBe(1);
    expect(s.players[0].rerollUsed).toBe(false);
  });

  it('霧の孤島にいるときは振り直しを選べない', () => {
    let s = charGame(['chrono']);
    s.players[0].islandTurns = 2;
    s = applyAction({ ...s, seed: seedFor(5) }, { type: 'roll' }); // ゾロ目でないので脱出できない
    expect(s.phase.kind).not.toBe('reroll');
    expect(s.players[0].rerollUsed).toBe(false);
  });
});

describe('新キャラ：魂の抵当', () => {
  /** モルス（P1）が P0 の黄金の王城（ランドマーク・通行料2000G）に止まる状態 */
  function morsPays(): GameState {
    const s = charGame([undefined, 'mors']);
    s.properties[31] = { owner: 0, level: 4 };
    s.players[1].money = 100;
    s.players[1].position = 28;
    s.current = 1;
    return s;
  }

  it('払いきれない通行料でも、1回目は破産せず300Gで踏みとどまる', () => {
    let s = morsPays();
    s = rollTo(s, 31);
    expect(s.players[1].bankrupt).toBe(false);
    expect(s.players[1].money).toBe(CONFIG.soulMoney);
    expect(s.players[1].soulUsed).toBe(true);
    expect(s.log.some((e) => /魂の抵当で/.test(e.text))).toBe(true);
  });

  it('2回目は破産する', () => {
    let s = morsPays();
    s.players[1].soulUsed = true;
    s = rollTo(s, 31);
    expect(s.players[1].bankrupt).toBe(true);
  });

  it('押し出されて他人の土地に止まらされても、土地を売らずに踏みとどまる', () => {
    let s = charGame(['garou', 'mors']);
    s.properties[7] = { owner: 0, level: 4 }; // 木漏れ日の砦（140G・ランドマークで通行料700G）
    s.properties[17] = { owner: 1, level: 0 }; // モルスの土地（売らずに残るはず）
    s.players[1].money = 50;
    s.players[1].position = 5;
    s.players[0].position = 2;
    s = rollTo(s, 5); // ガロウがモルスと同じマスへ → 剛腕の場面
    expect(s.phase.kind).toBe('push');
    s = applyAction(s, { type: 'push', target: 1, dir: 2 }); // モルスを7へ押し出す
    expect(s.players[1].bankrupt).toBe(false);
    expect(s.players[1].money).toBe(CONFIG.soulMoney);
    expect(s.properties[17]?.owner).toBe(1);
  });
});

describe('新カード', () => {
  it('盗賊の手：相手の手札を1枚奪う', () => {
    const s0 = newGame(1);
    s0.players[0].hand = ['steal'];
    s0.players[1].hand = ['treasure'];
    const s = applyAction(s0, { type: 'useCard', card: 'steal', target: 1 });
    expect(s.players[1].hand).toEqual([]);
    expect(s.players[0].hand).toEqual(['treasure']);
  });

  it('盗賊の手：手札を持っている相手がいなければ使えない', () => {
    const s0 = newGame(1);
    s0.players[0].hand = ['steal'];
    expect(cardUsable(s0, 'steal').ok).toBe(false);
    expect(() => applyAction(s0, { type: 'useCard', card: 'steal', target: 1 })).toThrow(GameError);
  });

  it('交換の契約書：建物の段階そのままに持ち主が入れ替わる', () => {
    const s0 = newGame(1);
    s0.players[0].hand = ['swap'];
    s0.properties[9] = { owner: 0, level: 1 }; // 自分の漁火の港・別荘
    s0.properties[5] = { owner: 1, level: 1 }; // 相手の苔むす泉・別荘
    const s = applyAction(s0, { type: 'useCard', card: 'swap', square: 5, give: 9 });
    expect(s.properties[5]).toEqual({ owner: 0, level: 1 });
    expect(s.properties[9]).toEqual({ owner: 1, level: 1 });
    expect(s.players[0].hand).toEqual([]);
  });

  it('交換の契約書：相手の土地の段階が出す土地より高い組み合わせは使えない', () => {
    const s0 = newGame(1);
    s0.players[0].hand = ['swap'];
    s0.properties[9] = { owner: 0, level: 0 };
    s0.properties[5] = { owner: 1, level: 2 };
    expect(cardUsable(s0, 'swap').ok).toBe(false);
    expect(() => applyAction(s0, { type: 'useCard', card: 'swap', square: 5, give: 9 })).toThrow(GameError);
  });

  it('聖域の紋章：守られた土地は買収も略奪の令状もできない', () => {
    let s = newGame(1);
    s.players[0].hand = ['sanctuary'];
    s.properties[9] = { owner: 0, level: 1 };
    s = applyAction(s, { type: 'useCard', card: 'sanctuary', square: 9 });
    expect(isProtected(s, 9)).toBe(true);
    expect(canBuyout(s, 9)).toBe(false);
    s.current = 1; // 相手の番として、令状の対象に出てこないことを確かめる
    s.players[1].money = 5000;
    expect(raidTargets(s)).not.toContain(9);
  });

  it('聖域の紋章：守りのターンが過ぎると買収できるようになる', () => {
    let s = newGame(1);
    s.players[0].hand = ['sanctuary'];
    s.properties[9] = { owner: 0, level: 1 };
    s = applyAction(s, { type: 'useCard', card: 'sanctuary', square: 9 });
    s.turn += CONFIG.sanctuaryTurns;
    expect(isProtected(s, 9)).toBe(false);
    expect(canBuyout(s, 9)).toBe(true);
  });

  it('呪いの刻印：持ち主が1周するあいだ通行料が0になり、1周すると戻る', () => {
    let s = newGame(1);
    s.players[0].hand = ['curse'];
    s.properties[31] = { owner: 1, level: 3 };
    expect(rentOf(s, 31)).toBeGreaterThan(0);
    s = applyAction(s, { type: 'useCard', card: 'curse', square: 31 });
    expect(rentOf(s, 31)).toBe(0);
    s.players[1].laps += 1;
    expect(rentOf(s, 31)).toBeGreaterThan(0);
  });

  it('移築の書：建物を別の自分の土地へ、段階そのまま移す', () => {
    const s0 = newGame(1);
    s0.players[0].hand = ['relocate'];
    s0.properties[9] = { owner: 0, level: 2 };
    s0.properties[13] = { owner: 0, level: 0 };
    const s = applyAction(s0, { type: 'useCard', card: 'relocate', square: 13, give: 9 });
    expect(s.properties[13].level).toBe(2);
    expect(s.properties[9].level).toBe(0);
    expect(s.players[0].hand).toEqual([]);
  });

  it('移築の書：建物のある土地へは移せない', () => {
    const s0 = newGame(1);
    s0.players[0].hand = ['relocate'];
    s0.properties[9] = { owner: 0, level: 2 };
    s0.properties[13] = { owner: 0, level: 1 };
    expect(() => applyAction(s0, { type: 'useCard', card: 'relocate', square: 13, give: 9 })).toThrow(GameError);
  });
});
