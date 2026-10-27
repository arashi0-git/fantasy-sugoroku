import { describe, expect, it } from 'vitest';
import { actorOf, applyAction, createGame, GameState, ISLAND } from '../core/game';
import { nextRandom } from '../core/rng';
import { acceptsTrade, decideCpu, Rand } from './cpu';
import { PersonalityId, PERSONALITIES } from './personality';

const SETUP = ['A', 'B', 'C', 'D'].map((name) => ({ name, color: '#000' }));
const always = (v: number): Rand => () => v;

/** 手札を空にしたゲーム（カードを使わない判断のテスト用） */
function newGame(seed = 1): GameState {
  const s = createGame(SETUP, seed);
  s.players.forEach((p) => ((p.hand = []), (p.mission = null)));
  return s;
}

function seeded(seed: number): Rand {
  let s = seed;
  return () => {
    let r: number;
    [r, s] = nextRandom(s);
    return r;
  };
}

/** プレイヤー0が sq の購入場面にいる状態 */
function atBuy(sq: number, money = 3000): GameState {
  const s = newGame(1);
  s.players[0].money = money;
  s.players[0].position = sq;
  s.phase = { kind: 'buy', square: sq };
  return s;
}

describe('性格ごとの判断', () => {
  it('策士は、相手があと1つで揃う土地を買って阻む', () => {
    const s = atBuy(2, 900);
    s.properties[1] = { owner: 1, level: 0 }; // 草原（1・2）の1つは相手
    expect(decideCpu(s, PERSONALITIES.schemer, always(0))).toEqual({ type: 'buy', level: 0 });
  });

  it('慎重派は、購入時の建物をビルまでに抑える（積極派はホテルまで建てる）', () => {
    const s = atBuy(31);
    s.players[0].lapped = true;
    expect(decideCpu(s, PERSONALITIES.careful, always(0))).toEqual({ type: 'buy', level: 2 });
    expect(decideCpu(s, PERSONALITIES.bold, always(0))).toEqual({ type: 'buy', level: 3 });
  });

  it('積極派は、余裕を残して建てられるだけ建てて買う', () => {
    const s = atBuy(31); // 400G：ビルまでで1000G
    expect(decideCpu(s, PERSONALITIES.bold, always(0))).toEqual({ type: 'buy', level: 2 });
  });

  it('積極派は払えるならよく買収し、慎重派は手元にお金が十分残るときだけ', () => {
    const s = newGame(1);
    s.players[0].money = 1300; // 買収価格 420G を払うと 880G 残る
    s.properties[5] = { owner: 1, level: 1 };
    s.phase = { kind: 'buyout', square: 5 };
    expect(decideCpu(s, PERSONALITIES.bold, always(0))).toEqual({ type: 'buyout' });
    expect(decideCpu(s, PERSONALITIES.careful, always(0))).toEqual({ type: 'pass' });
  });

  it('買収で自分の色グループが揃うなら、どの性格も少し無理をしてでも買収する。ねらいのない買収は慎重派はしない', () => {
    const s = newGame(1);
    s.players[0].money = 700;
    s.properties[1] = { owner: 0, level: 0 };
    s.properties[2] = { owner: 1, level: 1 }; // 買収価格 (100+50)×2 = 300
    s.phase = { kind: 'buyout', square: 2 };
    expect(decideCpu(s, PERSONALITIES.schemer, always(0))).toEqual({ type: 'buyout' });
    expect(decideCpu(s, PERSONALITIES.careful, always(0))).toEqual({ type: 'buyout' });
    s.properties[1] = { owner: 2, level: 0 };
    expect(decideCpu(s, PERSONALITIES.careful, always(0))).toEqual({ type: 'pass' });
  });

  it('終盤（buyoutUntil を過ぎたら）は、ねらいのない買収をしない', () => {
    const s = newGame(1);
    s.players[0].money = 3000;
    s.properties[5] = { owner: 1, level: 1 };
    s.phase = { kind: 'buyout', square: 5 };
    const late = { ...PERSONALITIES.bold, buyoutUntil: 20 };
    s.turn = 10;
    expect(decideCpu(s, late, always(0))).toEqual({ type: 'buyout' });
    s.turn = 25;
    expect(decideCpu(s, late, always(0))).toEqual({ type: 'pass' });
  });

  it('お金に余裕がないとき、慎重派は霧の孤島に居座り、積極派は脱出料を払う', () => {
    const s = newGame(1);
    s.players[0].money = 1500;
    s.players[0].position = ISLAND;
    s.players[0].islandTurns = 3;
    expect(decideCpu(s, PERSONALITIES.careful, always(0)).type).toBe('roll');
    expect(decideCpu(s, PERSONALITIES.bold, always(0))).toEqual({ type: 'payEscape' });
  });

  it('積極派はゲージを狙わない', () => {
    const s = newGame(1);
    expect(decideCpu(s, PERSONALITIES.bold, always(0))).toEqual({ type: 'roll', aim: undefined });
  });

  it('策士は、自分の色グループが揃うマスのあるゾーンを狙う', () => {
    const s = newGame(1);
    s.properties[1] = { owner: 0, level: 0 }; // 風車の丘（2マス先）を買えば草原が揃う
    expect(decideCpu(s, PERSONALITIES.schemer, always(0))).toEqual({ type: 'roll', aim: 'low' });
  });

  it('慎重派は、高い通行料のマスがあるゾーンを避ける', () => {
    const s = newGame(1);
    for (const sq of [5, 6, 7]) s.properties[sq] = { owner: 1, level: 3 };
    const d = decideCpu(s, PERSONALITIES.careful, always(0));
    expect(d.type).toBe('roll');
    expect(d.type === 'roll' && d.aim).not.toBe('low');
  });

  it('狙いは外れることもある', () => {
    const s = newGame(1);
    s.properties[1] = { owner: 0, level: 0 };
    const d = decideCpu(s, PERSONALITIES.schemer, always(0.99));
    expect(d.type === 'roll' && d.aim).not.toBe('low');
  });
});

describe('手札カードの判断', () => {
  it('独占リーチの相手には封印の鎖を使う', () => {
    const s = newGame();
    s.players[0].hand = ['seal'];
    for (const sq of [1, 2, 5, 6, 7]) s.properties[sq] = { owner: 2, level: 0 };
    expect(decideCpu(s, PERSONALITIES.schemer, always(0))).toEqual({ type: 'useCard', card: 'seal', target: 2 });
  });

  it('地震は大物まで取っておく：別荘には使わず、ホテルには積極派が使い、慎重派はもっと高い建物を待つ', () => {
    const s = newGame();
    s.players[0].hand = ['earthquake'];
    s.properties[5] = { owner: 1, level: 1 };
    expect(decideCpu(s, PERSONALITIES.bold, always(0)).type).toBe('roll');
    s.properties[17] = { owner: 1, level: 3 }; // 氷晶の街のホテル（通行料780G）
    expect(decideCpu(s, PERSONALITIES.bold, always(0))).toEqual({ type: 'useCard', card: 'earthquake', square: 17 });
    expect(decideCpu(s, PERSONALITIES.careful, always(0)).type).toBe('roll');
  });

  it('手札がいっぱいなら、地震を小物にも使う', () => {
    const s = newGame();
    s.players[0].hand = ['earthquake', 'angel', 'angel', 'barrier', 'barrier'];
    s.properties[5] = { owner: 1, level: 1 };
    expect(decideCpu(s, PERSONALITIES.careful, always(0))).toEqual({ type: 'useCard', card: 'earthquake', square: 5 });
  });

  it('観光地の守り切りを狙う相手からは、慎重派でも観光地を買収する', () => {
    const s = newGame();
    for (const sq of [4, 12, 21, 29]) s.properties[sq] = { owner: 1, level: 0 };
    s.touristClaim = 1;
    s.players[0].money = 800;
    s.phase = { kind: 'buyout', square: 4 };
    expect(decideCpu(s, PERSONALITIES.careful, always(0))).toEqual({ type: 'buyout' });
  });

  it('秘密の使命が進む土地は、慎重派でも少し無理をして買う', () => {
    const s = atBuy(30, 650); // 王都の大聖堂（400G）
    s.players[0].mission = 'noble';
    s.properties[25] = { owner: 0, level: 0 };
    expect(decideCpu(s, PERSONALITIES.careful, always(0))).toMatchObject({ type: 'buy' });
    s.players[0].mission = null;
    expect(decideCpu(s, PERSONALITIES.careful, always(0))).toEqual({ type: 'pass' });
  });

  it('運命の賽は温存し、高い通行料が並ぶ危ない場面で使って避ける', () => {
    const s = newGame();
    s.players[0].hand = ['destiny'];
    s.players[0].position = 0;
    s.players[0].money = 3000;
    // 草原を揃えられるだけなら使わない
    s.properties[1] = { owner: 0, level: 0 };
    expect(decideCpu(s, PERSONALITIES.schemer, always(0)).type).toBe('roll');
    // 森（5〜7）に相手のホテルが並ぶと使う
    for (const sq of [5, 6, 7]) s.properties[sq] = { owner: 1, level: 3 };
    const d = decideCpu(s, PERSONALITIES.schemer, always(0));
    expect(d).toMatchObject({ type: 'useCard', card: 'destiny' });
    expect(d.type === 'useCard' && [5, 6, 7].includes(d.sum!)).toBe(false);
  });

  it('追い風の羽で、高い通行料のマスを避ける', () => {
    const s = newGame();
    s.players[0].hand = ['tailwind'];
    s.properties[5] = { owner: 1, level: 3 };
    s.phase = { kind: 'adjust', dice: [2, 3], sum: 5 };
    const d = decideCpu(s, PERSONALITIES.careful, always(0));
    expect(d.type === 'adjust' && d.delta).not.toBe(0);
  });

  it('守護の結界：持ち主（手番でない人）の性格で判断する', () => {
    const s = newGame();
    s.players[1].hand = ['barrier'];
    s.properties[5] = { owner: 1, level: 2 };
    s.phase = { kind: 'react', responder: 1, card: 'barrier', ctx: { type: 'buyout', square: 5 } };
    expect(decideCpu(s, PERSONALITIES.bold, always(0))).toEqual({ type: 'react', use: true });
  });

  it('手札があふれたら、いちばん価値の低いカードを捨てる', () => {
    const s = newGame();
    s.players[0].hand = ['destiny', 'seal', 'treasure', 'barrier', 'mirror', 'angel'];
    s.phase = { kind: 'discard', then: 'end' };
    expect(decideCpu(s, PERSONALITIES.schemer, always(0))).toEqual({ type: 'discard', index: 2 });
  });
});

describe('CPU同士の自動対戦', () => {
  /** 席0は性格を順に入れ替え、席1〜3は実際のゲームと同じバルド・リラ・ゼノ */
  const SEATS: PersonalityId[] = ['bold', 'careful', 'schemer'];

  function playOut(seed: number) {
    const seat0 = SEATS[seed % 3];
    const pers = [seat0, ...SEATS].map((id) => PERSONALITIES[id]);
    const rand = seeded(seed * 7919);
    let s = createGame(SETUP, seed);
    let actions = 0;
    while (s.phase.kind !== 'gameover') {
      s = applyAction(s, decideCpu(s, pers[actorOf(s)], rand));
      if (++actions > 20000) throw new Error(`seed ${seed}: ゲームが終わらない`);
    }
    return { s, pers };
  }

  it('100ゲームがすべて例外なく最後まで終わる', () => {
    const reasons = { assets: 0, survivor: 0, triple: 0, tourist: 0 };
    const wins: Record<string, number> = { bold: 0, careful: 0, schemer: 0 };
    let turns = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const { s, pers } = playOut(seed);
      if (s.phase.kind !== 'gameover') throw new Error();
      reasons[s.phase.reason] += 1;
      // 席1〜3（バルド・リラ・ゼノ）の勝ちだけ数える
      if (s.phase.winner > 0) wins[pers[s.phase.winner].id] += 1;
      turns += s.turn;
      expect(s.players.every((p) => p.money >= 0)).toBe(true);
    }
    expect(Object.values(reasons).reduce((a, b) => a + b, 0)).toBe(100);
    console.log('勝ち方の内訳', reasons, '性格ごとの勝ち（席1〜3）', wins, '平均ターン', turns / 100);
  }, 120000);
});

describe('土地の取引の判断', () => {
  /** P0 の提示に P1 が応答する場面を作る */
  function offered(setup: (s: GameState) => void, want: number, give: number[], money: number): GameState {
    const s = newGame(1);
    setup(s);
    return applyAction(s, { type: 'offerTrade', to: 1, want, give, money });
  }

  it('割のいい提示は、どの性格でも受ける', () => {
    const s = offered((x) => (x.properties[13] = { owner: 1, level: 0 }), 13, [], 500); // 220Gの土地に500G
    for (const id of ['bold', 'careful', 'schemer'] as const) {
      expect(decideCpu(s, PERSONALITIES[id], always(0.5))).toEqual({ type: 'answerTrade', accept: true });
    }
  });

  it('割に合わない提示は断る', () => {
    // 氷晶の街のホテル（投資額 1040G）に 500G
    const s = offered((x) => (x.properties[17] = { owner: 1, level: 3 }), 17, [], 500);
    expect(acceptsTrade(s, PERSONALITIES.bold, always(0.5))).toBe(false);
    expect(acceptsTrade(s, PERSONALITIES.careful, always(0.5))).toBe(false);
  });

  it('積極派は、自分の色グループが揃う土地をもらえるなら少し損でも受け、慎重派は断る', () => {
    // P1 は森を2つ持ち、王都の大聖堂（400G）を P0 が欲しがる。対価は森の最後の1つ＋180G
    const s = offered(
      (x) => {
        x.properties[5] = { owner: 0, level: 0 };
        x.properties[6] = { owner: 1, level: 0 };
        x.properties[7] = { owner: 1, level: 0 };
        x.properties[30] = { owner: 1, level: 0 };
      },
      30,
      [5],
      180,
    );
    expect(acceptsTrade(s, PERSONALITIES.bold, always(0.5))).toBe(true);
    expect(acceptsTrade(s, PERSONALITIES.careful, always(0.5))).toBe(false);
  });

  it('策士は、自分の独占に直結しない取引は適正価格でも受けにくい', () => {
    const s = offered((x) => (x.properties[13] = { owner: 1, level: 0 }), 13, [], 230); // 投資額 220G
    expect(acceptsTrade(s, PERSONALITIES.schemer, always(0.5))).toBe(false);
    expect(acceptsTrade(s, PERSONALITIES.bold, always(0.5))).toBe(true);
    const s2 = offered((x) => (x.properties[13] = { owner: 1, level: 0 }), 13, [], 300);
    expect(acceptsTrade(s2, PERSONALITIES.schemer, always(0.5))).toBe(true);
  });

  it('相手の独占を完成させる土地は、割増でないと渡さない', () => {
    // P0 は森を2つ持ち、P1 の苔むす泉（140G）で揃う
    const setup = (x: GameState) => {
      x.properties[5] = { owner: 1, level: 0 };
      x.properties[6] = { owner: 0, level: 0 };
      x.properties[7] = { owner: 0, level: 0 };
    };
    const cheap = offered(setup, 5, [], 140); // 投資額ちょうど
    expect(acceptsTrade(cheap, PERSONALITIES.careful, always(0.5))).toBe(false);
    const rich = offered(setup, 5, [], 500); // 独占を完成させる分まで見込んだ割増
    expect(acceptsTrade(rich, PERSONALITIES.careful, always(0.5))).toBe(true);
  });

  it('策士は、あと1つで色グループが揃う土地を、不要な土地で取りにいく', () => {
    const s = newGame(1);
    s.properties[5] = { owner: 1, level: 0 }; // 森の最後の1つ
    s.properties[6] = { owner: 0, level: 0 };
    s.properties[7] = { owner: 0, level: 0 };
    s.properties[13] = { owner: 0, level: 0 }; // 対価に出せる砂漠の市場
    const d = decideCpu(s, PERSONALITIES.schemer, always(0));
    // 相手の得にならない取引なので、完成させる割増まで見込んでお金も足す
    expect(d).toEqual({ type: 'offerTrade', to: 1, want: 5, give: [13], money: 200 });
  });

  it('提示して受け入れられたら、その手番ではもう取引しない', () => {
    const s = newGame(1);
    s.properties[5] = { owner: 1, level: 0 };
    s.properties[6] = { owner: 0, level: 0 };
    s.properties[7] = { owner: 0, level: 0 };
    s.properties[13] = { owner: 0, level: 0 };
    let next = applyAction(s, decideCpu(s, PERSONALITIES.schemer, always(0)));
    expect(next.phase.kind).toBe('trade');
    next = applyAction(next, decideCpu(next, PERSONALITIES.bold, always(0.5)));
    expect(next.phase.kind).toBe('roll');
    expect(next.properties[5].owner).toBe(0);
    expect(decideCpu(next, PERSONALITIES.schemer, always(0)).type).toBe('roll');
  });
});

describe('略奪の令状の判断', () => {
  it('自分の色グループが揃う土地を奪う。奪う価値のない土地には使わない', () => {
    const s = newGame();
    s.players[0].hand = ['raid'];
    s.properties[5] = { owner: 1, level: 1 };
    expect(decideCpu(s, PERSONALITIES.schemer, always(0)).type).toBe('roll');
    s.properties[6] = { owner: 0, level: 0 };
    s.properties[7] = { owner: 0, level: 0 };
    expect(decideCpu(s, PERSONALITIES.schemer, always(0))).toEqual({ type: 'useCard', card: 'raid', square: 5 });
  });
});
