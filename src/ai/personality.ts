// CPU の性格。判断のしかたは cpu.ts で性格ごとに分ける。

export type PersonalityId = 'bold' | 'careful' | 'schemer';

export interface Personality {
  id: PersonalityId;
  /** 画面に出す呼び名 */
  label: string;
  /** 買い物のあとに最低限残しておく現金 */
  reserve: number;
  /** ゲージで狙ったゾーンを選べる確率（外れると別のゾーンになる）。0 なら狙わない */
  aimAccuracy: number;
  /** 地震を使う建物の通行料の下限（手札がいっぱいなら小物にも使う） */
  quakeNeed: number;
  /** 運命の賽を使う「狙ったマスのうれしさ − 普通に振ったときの見込み」の下限 */
  destinyNeed: number;
  /** 危険への備え：手元に残すお金に「相手の土地の最高の通行料 × この値」を足す */
  dangerFactor: number;
  /** このターンを過ぎたら、ねらいのない買収はしない（買収は払った額の半分しか資産に残らない） */
  buyoutUntil: number;
}

export const PERSONALITIES: Record<PersonalityId, Personality> = {
  // 豪商バルド：止まった土地はほぼ買い、建てられるだけ建て、よく買収する。ゲージは狙わない
  bold: { id: 'bold', label: '積極派', reserve: 150, aimAccuracy: 0, quakeNeed: 500, destinyNeed: 150, dangerFactor: 0, buyoutUntil: 30 },
  // 魔女リラ：安い土地を中心に買い、建設は控えめ。買収はほとんどしない。危ないマスを避けて狙う
  careful: { id: 'careful', label: '慎重派', reserve: 600, aimAccuracy: 0.7, quakeNeed: 800, destinyNeed: 200, dangerFactor: 0, buyoutUntil: 30 },
  // 騎士ゼノ：色グループを揃えることを最優先し、相手の独占を阻む。欲しい土地を狙う
  schemer: { id: 'schemer', label: '策士', reserve: 600, aimAccuracy: 0.75, quakeNeed: 600, destinyNeed: 130, dangerFactor: 0, buyoutUntil: 30 },
};
