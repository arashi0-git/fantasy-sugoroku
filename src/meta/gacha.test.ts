import { describe, expect, it } from 'vitest';
import { CHARACTER_LIST } from '../data/characters';
import { COSMETIC_LIST } from './cosmetics';
import { defaultProfile, Profile } from './profile';
import { drawGacha, FALLBACK_COINS, GachaResult, PITY_LIMIT, Rand, seededRand } from './gacha';

/** 決まった並びを返す乱数（尽きたら最後の値を繰り返す） */
const scripted = (values: number[]): Rand => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
};
const always = (v: number): Rand => () => v;

const rich = (over: Partial<Profile> = {}): Profile => ({ ...defaultProfile(), coins: 100000, ...over });
const kinds = (rs: GachaResult[]) => rs.map((r) => r.kind);

describe('ガチャの基本', () => {
  it('コインが足りなければ引けない', () => {
    expect(drawGacha({ ...defaultProfile(), coins: 99 }, 1, always(0))).toBeNull();
    expect(drawGacha({ ...defaultProfile(), coins: 999 }, 10, always(0))).toBeNull();
  });

  it('料金は1回100・10連1000', () => {
    const one = drawGacha(rich(), 1, always(0.99))!;
    expect(one.profile.coins).toBe(100000 - 100 + FALLBACK_COINS); // 0.99 はコイン枠
    const ten = drawGacha(rich(), 10, seededRand(7))!;
    expect(ten.results).toHaveLength(10);
  });

  it('新規キャラが当たる（重み順で先頭はヴェル）', () => {
    const { profile, results } = drawGacha(rich(), 1, scripted([0.1, 0]))!;
    expect(results[0]).toEqual({ kind: 'newChar', charId: 'verre' });
    expect(profile.ownedCharIds).toContain('verre');
    expect(profile.pity).toBe(0);
  });

  it('レアキャラは重みが軽い（乱数の後ろの方で当たる）', () => {
    const { results } = drawGacha(rich(), 1, scripted([0.1, 0.99]))!;
    expect(results[0]).toEqual({ kind: 'newChar', charId: 'mors' });
  });

  it('所持済みキャラの枠は限界突破になる', () => {
    const { profile, results } = drawGacha(rich(), 1, scripted([0.4, 0]))!;
    expect(results[0]).toEqual({ kind: 'limitBreak', charId: 'bald' });
    expect(profile.limitBreak.bald).toBe(1);
  });

  it('見た目アイテムが当たり、空いている装備枠に自動で入る', () => {
    const { profile, results } = drawGacha(rich(), 1, scripted([0.6, 0]))!;
    expect(results[0]).toEqual({ kind: 'cosmetic', cosmeticId: 'frame-silver' });
    expect(profile.ownedCosmetics).toContain('frame-silver');
    expect(profile.equipped.frame).toBe('frame-silver');
  });

  it('同じ乱数シードでは同じ結果になる', () => {
    const a = drawGacha(rich(), 10, seededRand(42))!;
    const b = drawGacha(rich(), 10, seededRand(42))!;
    expect(a.results).toEqual(b.results);
    expect(a.profile).toEqual(b.profile);
  });
});

describe('天井と保証', () => {
  it('天井（30回目）は、どんな乱数でも未所持キャラが確定する', () => {
    const p = rich({ pity: PITY_LIMIT - 1 });
    const { profile, results } = drawGacha(p, 1, always(0.99))!;
    expect(results[0].kind).toBe('newChar');
    expect(profile.pity).toBe(0);
  });

  it('未所持キャラが出なければ天井カウンタが進む', () => {
    const { profile, results } = drawGacha(rich(), 1, always(0.99))!;
    expect(results[0].kind).toBe('coins');
    expect(profile.pity).toBe(1);
  });

  it('10連は最後の1枠で未所持キャラを保証する', () => {
    const { profile, results } = drawGacha(rich({ coins: 1000 }), 10, always(0.99))!;
    expect(kinds(results.slice(0, 9))).toEqual(Array(9).fill('coins'));
    expect(results[9].kind).toBe('newChar');
    expect(profile.coins).toBe(9 * FALLBACK_COINS);
  });

  it('全キャラ所持済みの10連は、最後の1枠でレア以上を保証する', () => {
    const all = CHARACTER_LIST.map((c) => c.id);
    const nonRareCosmetics = COSMETIC_LIST.filter((c) => !c.rare).map((c) => c.id);
    const p = rich({ ownedCharIds: all, ownedCosmetics: nonRareCosmetics });
    const { results } = drawGacha(p, 10, always(0.99))!;
    const last = results[9];
    expect(last.kind).toBe('cosmetic');
    if (last.kind === 'cosmetic') expect(COSMETIC_LIST.find((c) => c.id === last.cosmeticId)?.rare).toBe(true);
  });
});

describe('行き先がない場合の変換', () => {
  it('全キャラ限界突破MAX・全見た目所持なら、コインに変換される', () => {
    const all = CHARACTER_LIST.map((c) => c.id);
    const p = rich({
      ownedCharIds: all,
      limitBreak: Object.fromEntries(all.map((id) => [id, 5])),
      ownedCosmetics: COSMETIC_LIST.map((c) => c.id),
    });
    const { profile, results } = drawGacha(p, 1, always(0.4))!;
    expect(results[0]).toEqual({ kind: 'coins', amount: FALLBACK_COINS });
    expect(profile.pity).toBe(0);
  });

  it('限界突破が上限のキャラは抽選候補から外れる', () => {
    const p = rich({ limitBreak: { bald: 5 } });
    const { results } = drawGacha(p, 1, scripted([0.4, 0]))!;
    expect(results[0]).toEqual({ kind: 'limitBreak', charId: 'lila' });
  });
});
