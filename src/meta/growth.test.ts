import { describe, expect, it } from 'vitest';
import { createGame, statMod } from '../core/game';
import { CHARACTERS, CHARACTER_LIST, STAT_ORDER } from '../data/characters';
import { CONFIG } from '../data/config';
import { grownStats, growthOrder, growthPoints } from './growth';

describe('成長の配分', () => {
  it('優先順位は基礎ステータスが高い順（バルドは交渉→収入→威光→幸運→建築）', () => {
    expect(growthOrder('bald')).toEqual(['deal', 'income', 'prestige', 'luck', 'build']);
  });

  it('Lv1 は基礎ステータスのまま', () => {
    for (const c of CHARACTER_LIST) expect(grownStats(c.id, 1)).toEqual(c.stats);
  });

  it('成長ポイントの合計がレベルと一致する', () => {
    for (const level of [2, 5, 10, 20]) {
      for (const c of CHARACTER_LIST) {
        const grown = grownStats(c.id, level);
        const total = STAT_ORDER.reduce((sum, st) => sum + grown[st], 0);
        expect(total).toBe(15 + growthPoints(level));
      }
    }
  });

  it('高いステータスから順に配られ、1周したらまた頭から配られる', () => {
    // バルド基礎：収入3・建築2・交渉4・威光3・幸運3。ペースは3レベルで+1
    expect(grownStats('bald', 4)).toEqual({ income: 3, build: 2, deal: 5, prestige: 3, luck: 3 });
    expect(grownStats('bald', 16)).toEqual({ income: 4, build: 3, deal: 5, prestige: 4, luck: 4 });
    expect(grownStats('bald', 19)).toEqual({ income: 4, build: 3, deal: 6, prestige: 4, luck: 4 });
  });

  it('決定的：同じ入力では同じ結果', () => {
    expect(grownStats('mors', 17)).toEqual(grownStats('mors', 17));
  });
});

describe('対戦への反映（core のフック）', () => {
  it('セットアップで渡した成長ステータスが statMod に効く', () => {
    const grown = grownStats('bald', 21); // 交渉6
    const s = createGame([
      { name: 'あなた', color: '#000', character: 'bald', stats: grown },
      { name: 'CPU', color: '#111', character: 'bald' },
    ]);
    expect(statMod(s.players[0], 'deal')).toBeCloseTo((6 - 3) * CONFIG.statStep.deal);
    expect(statMod(s.players[1], 'deal')).toBeCloseTo((4 - 3) * CONFIG.statStep.deal);
  });

  it('成長を渡さなければ従来どおり基礎ステータス', () => {
    const s = createGame([{ name: 'a', color: '#000', character: 'verre' }]);
    expect(s.players[0].statsOverride).toBeNull();
    expect(statMod(s.players[0], 'income')).toBeCloseTo((CHARACTERS.verre.stats.income - 3) * CONFIG.statStep.income);
  });
});
