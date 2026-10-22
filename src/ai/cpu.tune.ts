// CPU の数値を、自動対戦で少しずつ良くしていく（`npm run tune`）。
// TUNE_TARGET の性格だけ候補の数値で動かし、ほかの性格はいまの数値のまま対戦させる。
// 候補の性格の勝率が上がれば採用する（山登り法）。毎回同じ試合の組み合わせ（シード）で比べるので、
// 運の差で良し悪しを見誤りにくい。最後に、別の組み合わせで確かめる。

import { it } from 'vitest';
import { actorOf, applyAction, createGame, GameState } from '../core/game';
import { nextRandom } from '../core/rng';
import { CharacterId, CHARACTER_LIST, CHARACTERS } from '../data/characters';
import { decideCpu } from './cpu';
import { Personality, PersonalityId, PERSONALITIES } from './personality';

declare const process: { env: Record<string, string | undefined> };

const TARGET = (process.env.TUNE_TARGET ?? 'bold') as PersonalityId;
const N = Number(process.env.TUNE_N ?? 600);
const ROUNDS = Number(process.env.TUNE_ROUNDS ?? 2);
const CHECK_SEED = 90000;

/** 調整する数値と、1回に動かす幅・範囲 */
const ALL_KNOBS: { key: keyof Personality; step: number; min: number; max: number }[] = [
  { key: 'buyoutUntil', step: 4, min: 6, max: 30 },
  { key: 'reserve', step: 150, min: 100, max: 2000 },
  { key: 'dangerFactor', step: 0.25, min: 0, max: 2 },
  { key: 'quakeNeed', step: 150, min: 0, max: 1500 },
  { key: 'destinyNeed', step: 40, min: 40, max: 400 },
];
/** TUNE_KNOBS=buyoutUntil,reserve のように、動かす数値を絞れる */
const KNOBS = process.env.TUNE_KNOBS ? ALL_KNOBS.filter((k) => process.env.TUNE_KNOBS!.split(',').includes(k.key)) : ALL_KNOBS;

function charsFor(seed: number): CharacterId[] {
  const ids = CHARACTER_LIST.map((c) => c.id);
  let r = seed * 7907;
  for (let i = ids.length - 1; i > 0; i--) {
    let v: number;
    [v, r] = nextRandom(r);
    const j = Math.floor(v * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, 4);
}

/** cand で動く TARGET 性格の席の勝率と破産率（ほかの性格はいまの数値） */
function evaluate(cand: Personality, seedFrom: number, n: number): { win: number; bankrupt: number } {
  let wins = 0;
  let seats = 0;
  let broke = 0;
  for (let seed = seedFrom; seed < seedFrom + n; seed++) {
    const chars = charsFor(seed);
    const pers = chars.map((c) => (CHARACTERS[c].personality === TARGET ? cand : PERSONALITIES[CHARACTERS[c].personality]));
    if (!pers.includes(cand)) continue;
    let r = seed * 31;
    const rand = () => {
      let v: number;
      [v, r] = nextRandom(r);
      return v;
    };
    let s: GameState = createGame(chars.map((c) => ({ name: c, color: '#000', character: c })), seed);
    while (s.phase.kind !== 'gameover') s = applyAction(s, decideCpu(s, pers[actorOf(s)], rand));
    pers.forEach((p, i) => {
      if (p !== cand) return;
      seats++;
      if (s.phase.kind === 'gameover' && s.phase.winner === i) wins++;
      if (s.players[i].bankrupt) broke++;
    });
  }
  return { win: wins / seats, bankrupt: broke / seats };
}

it(`CPU の調整：${TARGET}`, () => {
  let best: Personality = { ...PERSONALITIES[TARGET] };
  let bestScore = evaluate(best, 1, N);
  const fmt = (p: Personality) => KNOBS.map((k) => `${k.key}=${p[k.key]}`).join(' ');
  const pc = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(`[${TARGET}] はじめ ${fmt(best)} → 勝率 ${pc(bestScore.win)} 破産 ${pc(bestScore.bankrupt)}`);
  const start = { ...best };
  for (let round = 1; round <= ROUNDS; round++) {
    for (const k of KNOBS) {
      for (const dir of [1, -1]) {
        const v = Math.round(((best[k.key] as number) + dir * k.step) * 100) / 100;
        if (v < k.min || v > k.max) continue;
        const cand = { ...best, [k.key]: v } as Personality;
        const score = evaluate(cand, 1, N);
        const better = score.win > bestScore.win + 0.005;
        console.log(`[${TARGET}] ${round}周目 ${k.key}=${v} → 勝率 ${pc(score.win)} 破産 ${pc(score.bankrupt)}${better ? '  ← 採用' : ''}`);
        if (better) {
          best = cand;
          bestScore = score;
          break;
        }
      }
    }
  }
  // 別の組み合わせで、はじめの数値と比べて確かめる
  const before = evaluate(start, CHECK_SEED, N);
  const after = evaluate(best, CHECK_SEED, N);
  console.log(`[${TARGET}] 結果 ${fmt(best)}`);
  console.log(`[${TARGET}] 確認（別の${N}ゲーム） はじめ 勝率 ${pc(before.win)} 破産 ${pc(before.bankrupt)} → 調整後 勝率 ${pc(after.win)} 破産 ${pc(after.bankrupt)}`);
  console.log(`TUNEJSON ${JSON.stringify({ target: TARGET, best, before, after })}`);
}, 7200000);
