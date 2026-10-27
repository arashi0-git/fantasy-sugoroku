// ガチャの抽選。プロフィールを受け取って、結果と新しいプロフィールを返す純粋関数。
// 乱数は外から渡す（テストでは決まった並びやシード付きを使える）。

import { nextRandom } from '../core/rng';
import { CHARACTERS, CharacterId } from '../data/characters';
import { COSMETIC_LIST, CosmeticId } from './cosmetics';
import { MAX_LIMIT_BREAK, Profile } from './profile';

export const GACHA_COST = 100;
export const GACHA_COST_10 = 1000;
/** 天井：未所持キャラが出ないままこの回数に届いたら、次は未所持キャラが確定する */
export const PITY_LIMIT = 30;
/** 限界突破が上限・行き先がない場合などに返るスターコイン */
export const FALLBACK_COINS = 50;

/** 抽選の内訳（目安。プールの残り具合で実際の割合は変わる） */
export const RATE_NEW_CHAR = 0.3;
export const RATE_LIMIT_BREAK = 0.25;
export const RATE_COSMETIC = 0.37;
// 残り（0.08）はスターコイン

/** 新規キャラの重み（レアキャラは出にくい） */
const newCharWeight = (id: CharacterId) => (CHARACTERS[id].rare ? 1 : 3);

export type Rand = () => number;

/** シード付きの乱数（core の乱数と同系統） */
export function seededRand(seed: number): Rand {
  let s = seed >>> 0;
  return () => {
    const [v, next] = nextRandom(s);
    s = next;
    return v;
  };
}

export type GachaResult =
  | { kind: 'newChar'; charId: CharacterId }
  | { kind: 'limitBreak'; charId: CharacterId }
  | { kind: 'cosmetic'; cosmeticId: CosmeticId }
  | { kind: 'coins'; amount: number };

interface Draft {
  coins: number;
  owned: Set<CharacterId>;
  limitBreak: Map<CharacterId, number>;
  cosmetics: Set<string>;
  pity: number;
}

const unownedOf = (d: Draft): CharacterId[] => Object.keys(CHARACTERS).filter((id) => !d.owned.has(id as CharacterId)) as CharacterId[];

/** 重み付きで1つ選ぶ */
function pickWeighted<T>(items: T[], weight: (item: T) => number, rand: Rand): T {
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  let r = rand() * total;
  for (const item of items) {
    r -= weight(item);
    if (r < 0) return item;
  }
  return items[items.length - 1];
}

function drawNewChar(d: Draft, rand: Rand): GachaResult {
  const charId = pickWeighted(unownedOf(d), newCharWeight, rand);
  d.owned.add(charId);
  d.pity = 0;
  return { kind: 'newChar', charId };
}

function drawLimitBreak(d: Draft, rand: Rand): GachaResult | null {
  const candidates = [...d.owned].filter((id) => (d.limitBreak.get(id) ?? 0) < MAX_LIMIT_BREAK);
  if (!candidates.length) return null;
  const charId = pickWeighted(candidates, () => 1, rand);
  d.limitBreak.set(charId, (d.limitBreak.get(charId) ?? 0) + 1);
  return { kind: 'limitBreak', charId };
}

function drawCosmetic(d: Draft, rand: Rand, rareOnly = false): GachaResult | null {
  const pool = COSMETIC_LIST.filter((c) => !d.cosmetics.has(c.id) && (!rareOnly || c.rare));
  if (!pool.length) return null;
  const picked = pickWeighted(pool, () => 1, rand);
  d.cosmetics.add(picked.id);
  return { kind: 'cosmetic', cosmeticId: picked.id };
}

/** 「レア以上」の1枠（10連の保証用）：レアな見た目 → レアキャラの限界突破 → 通常の抽選にフォールバック */
function drawRarePlus(d: Draft, rand: Rand): GachaResult {
  const cosmetic = drawCosmetic(d, rand, true);
  if (cosmetic) return cosmetic;
  const rareOwned = [...d.owned].filter((id) => CHARACTERS[id].rare && (d.limitBreak.get(id) ?? 0) < MAX_LIMIT_BREAK);
  if (rareOwned.length) {
    const charId = pickWeighted(rareOwned, () => 1, rand);
    d.limitBreak.set(charId, (d.limitBreak.get(charId) ?? 0) + 1);
    return { kind: 'limitBreak', charId };
  }
  return drawNormal(d, rand);
}

function drawNormal(d: Draft, rand: Rand): GachaResult {
  const r = rand();
  if (r < RATE_NEW_CHAR && unownedOf(d).length) return drawNewChar(d, rand);
  if (r < RATE_NEW_CHAR + RATE_LIMIT_BREAK) {
    const lb = drawLimitBreak(d, rand);
    if (lb) return lb;
  }
  if (r < RATE_NEW_CHAR + RATE_LIMIT_BREAK + RATE_COSMETIC) {
    const cosmetic = drawCosmetic(d, rand);
    if (cosmetic) return cosmetic;
  }
  d.coins += FALLBACK_COINS;
  return { kind: 'coins', amount: FALLBACK_COINS };
}

function drawOne(d: Draft, rand: Rand, guaranteed: 'none' | 'newChar' | 'rarePlus'): GachaResult {
  const hasUnowned = unownedOf(d).length > 0;
  let result: GachaResult;
  if (hasUnowned && d.pity >= PITY_LIMIT - 1) {
    result = drawNewChar(d, rand); // 天井
  } else if (guaranteed === 'newChar' && hasUnowned) {
    result = drawNewChar(d, rand); // 10連の保証枠
  } else if (guaranteed === 'rarePlus') {
    result = drawRarePlus(d, rand);
  } else {
    result = drawNormal(d, rand);
  }
  // 未所持キャラが出なかったら天井カウンタを進める（未所持が残っている間だけ）
  if (result.kind !== 'newChar' && unownedOf(d).length) d.pity += 1;
  if (!unownedOf(d).length) d.pity = 0;
  return result;
}

/**
 * ガチャを count 回引く。コインが足りなければ null。
 * 10連（count = 10）のときは、最後の1枠が保証枠になる：
 * 未所持キャラが残っていて、まだ新規キャラが出ていなければ未所持キャラ確定。
 * 未所持が残っていなければ「レア以上」を保証する。
 */
export function drawGacha(p: Profile, count: 1 | 10, rand: Rand): { profile: Profile; results: GachaResult[] } | null {
  const cost = count === 10 ? GACHA_COST_10 : GACHA_COST * count;
  if (p.coins < cost) return null;

  const d: Draft = {
    coins: p.coins - cost,
    owned: new Set(p.ownedCharIds),
    limitBreak: new Map(Object.entries(p.limitBreak) as [CharacterId, number][]),
    cosmetics: new Set(p.ownedCosmetics),
    pity: p.pity,
  };

  const results: GachaResult[] = [];
  for (let i = 0; i < count; i++) {
    const last = count === 10 && i === count - 1;
    let guaranteed: 'none' | 'newChar' | 'rarePlus' = 'none';
    if (last) {
      const gotNew = results.some((r) => r.kind === 'newChar');
      const gotRarePlus = results.some(
        (r) => (r.kind === 'cosmetic' && COSMETIC_LIST.find((c) => c.id === r.cosmeticId)?.rare) || (r.kind === 'limitBreak' && CHARACTERS[r.charId].rare),
      );
      if (unownedOf(d).length && !gotNew) guaranteed = 'newChar';
      else if (!unownedOf(d).length && !gotRarePlus) guaranteed = 'rarePlus';
    }
    results.push(drawOne(d, rand, guaranteed));
  }

  const profile: Profile = {
    ...p,
    coins: d.coins,
    ownedCharIds: Object.keys(CHARACTERS).filter((id) => d.owned.has(id as CharacterId)) as CharacterId[],
    limitBreak: Object.fromEntries(d.limitBreak),
    ownedCosmetics: [...d.cosmetics],
    pity: d.pity,
    equipped: { ...p.equipped },
  };
  // 見た目アイテムは、その種類で何も装備していなければ自動で装備する（すぐ画面に反映されるように）
  for (const r of results) {
    if (r.kind !== 'cosmetic') continue;
    const kind = COSMETIC_LIST.find((c) => c.id === r.cosmeticId)!.kind;
    if (!profile.equipped[kind]) profile.equipped[kind] = r.cosmeticId;
  }
  return { profile, results };
}

/** 結果が「レア以上」か（演出・保証の判定用） */
export function isRareResult(r: GachaResult): boolean {
  if (r.kind === 'newChar') return !!CHARACTERS[r.charId].rare;
  if (r.kind === 'limitBreak') return !!CHARACTERS[r.charId].rare;
  if (r.kind === 'cosmetic') return !!COSMETIC_LIST.find((c) => c.id === r.cosmeticId)?.rare;
  return false;
}
