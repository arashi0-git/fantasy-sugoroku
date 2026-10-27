// 育成の上限チェック用の自動対戦。`SIM=1 npx vitest run src/ai/growth.sim.ts` で単独実行する。
// 育ったキャラ1人（CPU操作・性格はそのキャラのもの）＋素のキャラ3人の4人対戦を、キャラ別に測る。
// GROWTH_N で1キャラあたりのゲーム数、GROWTH_LEVELS で測るレベルを変えられる。

import { it } from 'vitest';

declare const process: { env: Record<string, string | undefined> };
import { actorOf, applyAction, createGame, GameState } from '../core/game';
import { nextRandom } from '../core/rng';
import { CHARACTER_LIST, CHARACTERS, CharacterId } from '../data/characters';
import { grownStats } from '../meta/growth';
import { decideCpu } from './cpu';
import { PERSONALITIES } from './personality';

const N = Number(process.env.GROWTH_N ?? 150);
const LEVELS = (process.env.GROWTH_LEVELS ?? '1,10,20').split(',').map((v) => Number(v));

/** 対戦相手3人をシードで決定的に選ぶ */
function opponentsFor(target: CharacterId, seed: number): CharacterId[] {
  const ids = CHARACTER_LIST.map((c) => c.id).filter((id) => id !== target);
  let r = (seed * 2654435761) >>> 0;
  for (let i = ids.length - 1; i > 0; i--) {
    let v: number;
    [v, r] = nextRandom(r);
    const j = Math.floor(v * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, 3);
}

/** 育った target が勝ったら true。席はシードで回して席順の偏りをならす */
function playGame(target: CharacterId, level: number, seed: number): boolean {
  const seat = seed % 4;
  const chars = opponentsFor(target, seed);
  chars.splice(seat, 0, target);
  let r = seed * 31 + level * 7919;
  const rand = () => {
    let v: number;
    [v, r] = nextRandom(r);
    return v;
  };
  let s: GameState = createGame(
    chars.map((c, i) => ({
      name: c,
      color: '#000',
      character: c,
      ...(i === seat ? { stats: grownStats(c, level) } : {}),
    })),
    seed * 100003 + level,
  );
  let guard = 0;
  while (s.phase.kind !== 'gameover' && guard++ < 100000) {
    const a = decideCpu(s, PERSONALITIES[CHARACTERS[chars[actorOf(s)]].personality], rand);
    s = applyAction(s, a);
  }
  return s.phase.kind === 'gameover' && s.phase.winner === seat;
}

for (const level of LEVELS) {
  it(`成長 Lv${level} のキャラ別勝率`, () => {
    const rows: string[] = [];
    let worst = 0;
    let worstName = '';
    let sum = 0;
    for (const c of CHARACTER_LIST) {
      let wins = 0;
      for (let seed = 1; seed <= N; seed++) if (playGame(c.id, level, seed)) wins++;
      const rate = wins / N;
      sum += rate;
      if (rate > worst) {
        worst = rate;
        worstName = c.name;
      }
      rows.push(`  ${c.name.padEnd(5, '　')} ${(rate * 100).toFixed(1).padStart(5)}%（${wins}/${N}）`);
    }
    console.log(`==== 成長 Lv${level}（各${N}ゲーム、公平なら25%）`);
    console.log(rows.join('\n'));
    console.log(`  平均 ${(sum / CHARACTER_LIST.length * 100).toFixed(1)}% ／ 最大 ${worstName} ${(worst * 100).toFixed(1)}%`);
  }, 1800000);
}
