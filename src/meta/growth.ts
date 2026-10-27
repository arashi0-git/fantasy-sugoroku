// 育成によるステータスの成長。レベルが上がると、そのキャラのステータスに少しずつ上乗せされる。
// 配分はキャラごとの固定パターン（基礎ステータスが高い順）で決定的に決まる。
// 成長が効くのは人間の使うキャラだけ（CPU は素のステータス）。適用は対戦開始時に core へ渡す。

import { CHARACTERS, CharacterId, StatId, STAT_ORDER } from '../data/characters';

/**
 * 成長のペース：このレベル数ごとに、ステータス合計 +1。
 * Lv10 で +3・Lv20 で +6 になる。
 * ペース1（Lv10で+9）は予備測定で最大45.0%、ペース2（Lv20で+9）は本測定で最大48.0%（ガロウ）と
 * 上限の45%を超えたため 3 にした。測定の詳細は growth.sim.ts 参照。
 */
export const LEVELS_PER_POINT = 3;

/** そのレベルで得られる成長ポイントの合計 */
export function growthPoints(level: number): number {
  return Math.max(0, Math.floor((level - 1) / LEVELS_PER_POINT));
}

/** 成長の優先順位：基礎ステータスが高い順（同点は STAT_ORDER の順） */
export function growthOrder(charId: CharacterId): StatId[] {
  const base = CHARACTERS[charId].stats;
  return [...STAT_ORDER].sort((a, b) => base[b] - base[a] || STAT_ORDER.indexOf(a) - STAT_ORDER.indexOf(b));
}

/** レベルに応じた成長後のステータス。優先順位の高いものから +1 ずつ配り、1周したらまた頭から配る */
export function grownStats(charId: CharacterId, level: number): Record<StatId, number> {
  const stats = { ...CHARACTERS[charId].stats };
  const order = growthOrder(charId);
  let points = growthPoints(level);
  for (let i = 0; points > 0; i++) {
    stats[order[i % order.length]]++;
    points--;
  }
  return stats;
}
