// プレイヤーのプロフィール（コイン・所持キャラ・経験値・ガチャの天井など）。
// ブラウザ内（localStorage）に保存する。ルール本体（core）からは参照しない、メタ進行の置き場所。
// 保存・読み込みは文字列を介する純粋関数にしてあるので、そのまま単体テストできる。

import { CharacterId, CHARACTER_LIST } from '../data/characters';
import { WinReason } from '../core/game';

export const PROFILE_VERSION = 1;
export const PROFILE_KEY = 'fs-profile';

/** 最初から持っているキャラ（通常キャラの初期8人）。残りはガチャで解放する */
export const STARTER_CHAR_IDS: CharacterId[] = ['bald', 'lila', 'zeno', 'misha', 'serena', 'ord', 'crow', 'garm'];

/** 限界突破の上限 */
export const MAX_LIMIT_BREAK = 5;
/** 限界突破なしで到達できるレベル */
export const BASE_MAX_LEVEL = 10;
/** 限界突破1回で上がるレベルの上限 */
export const LEVELS_PER_LIMIT_BREAK = 2;

/** 装備中の見た目アイテム（種類ごとに1つ。id は cosmetics.ts で定義） */
export interface EquippedCosmetics {
  frame: string | null;
  title: string | null;
  pawn: string | null;
  theme: string | null;
}

export interface Profile {
  version: 1;
  /** スターコイン（ガチャを回す通貨。課金要素はない） */
  coins: number;
  /** 解放済みのキャラ */
  ownedCharIds: CharacterId[];
  /** キャラごとの累積経験値 */
  charXp: Partial<Record<CharacterId, number>>;
  /** キャラごとの限界突破の回数（0〜5） */
  limitBreak: Partial<Record<CharacterId, number>>;
  /** 天井カウンタ：未所持キャラが出てからの抽選回数 */
  pity: number;
  /** 所持している見た目アイテムの id */
  ownedCosmetics: string[];
  equipped: EquippedCosmetics;
}

export function defaultProfile(): Profile {
  return {
    version: 1,
    coins: 0,
    ownedCharIds: [...STARTER_CHAR_IDS],
    charXp: {},
    limitBreak: {},
    pity: 0,
    ownedCosmetics: [],
    equipped: { frame: null, title: null, pawn: null, theme: null },
  };
}

const CHAR_ID_SET = new Set<string>(CHARACTER_LIST.map((c) => c.id));

const asNonNegInt = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);

/** 保存された JSON 文字列をプロフィールに戻す。壊れている・版が違うときはデフォルトにする */
export function parseProfile(json: string | null): Profile {
  if (!json) return defaultProfile();
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return defaultProfile();
  }
  if (typeof raw !== 'object' || raw === null) return defaultProfile();
  const r = raw as Record<string, unknown>;
  if (r.version !== PROFILE_VERSION) return defaultProfile();

  const p = defaultProfile();
  p.coins = asNonNegInt(r.coins);
  p.pity = asNonNegInt(r.pity);

  if (Array.isArray(r.ownedCharIds)) {
    const ids = r.ownedCharIds.filter((id): id is CharacterId => typeof id === 'string' && CHAR_ID_SET.has(id));
    // スターターは常に所持しているものとして補う（保存データが古くても遊べなくならないように）
    p.ownedCharIds = [...new Set([...STARTER_CHAR_IDS, ...ids])];
  }
  if (typeof r.charXp === 'object' && r.charXp !== null) {
    for (const [id, v] of Object.entries(r.charXp as Record<string, unknown>)) {
      if (CHAR_ID_SET.has(id)) p.charXp[id as CharacterId] = asNonNegInt(v);
    }
  }
  if (typeof r.limitBreak === 'object' && r.limitBreak !== null) {
    for (const [id, v] of Object.entries(r.limitBreak as Record<string, unknown>)) {
      if (CHAR_ID_SET.has(id)) p.limitBreak[id as CharacterId] = Math.min(MAX_LIMIT_BREAK, asNonNegInt(v));
    }
  }
  if (Array.isArray(r.ownedCosmetics)) {
    p.ownedCosmetics = [...new Set(r.ownedCosmetics.filter((id): id is string => typeof id === 'string'))];
  }
  if (typeof r.equipped === 'object' && r.equipped !== null) {
    const eq = r.equipped as Record<string, unknown>;
    for (const kind of ['frame', 'title', 'pawn', 'theme'] as const) {
      const v = eq[kind];
      // 装備は所持しているものだけ有効にする
      p.equipped[kind] = typeof v === 'string' && p.ownedCosmetics.includes(v) ? v : null;
    }
  }
  return p;
}

export function serializeProfile(p: Profile): string {
  return JSON.stringify(p);
}

/** localStorage から読み込む（使えない環境ではデフォルト） */
export function loadProfile(): Profile {
  try {
    return parseProfile(window.localStorage.getItem(PROFILE_KEY));
  } catch {
    return defaultProfile();
  }
}

/** localStorage へ保存する（使えない環境では何もしない） */
export function saveProfile(p: Profile): void {
  try {
    window.localStorage.setItem(PROFILE_KEY, serializeProfile(p));
  } catch {
    /* 保存できなくてもゲームは続けられる */
  }
}

// ---------- レベル・経験値 ----------

/** そのレベルに到達するのに必要な累積経験値（Lv2=1, Lv3=3, Lv4=6, … の三角数） */
export function levelThreshold(level: number): number {
  return level <= 1 ? 0 : ((level - 1) * level) / 2;
}

/** 累積経験値から届くレベル（上限は見ない） */
export function levelForXp(xp: number): number {
  let lv = 1;
  while (levelThreshold(lv + 1) <= xp) lv++;
  return lv;
}

/** そのキャラのレベルの上限（限界突破で上がる） */
export function maxLevelFor(p: Profile, charId: CharacterId): number {
  return BASE_MAX_LEVEL + LEVELS_PER_LIMIT_BREAK * Math.min(MAX_LIMIT_BREAK, p.limitBreak[charId] ?? 0);
}

/** そのキャラの現在のレベル */
export function levelOf(p: Profile, charId: CharacterId): number {
  return Math.min(levelForXp(p.charXp[charId] ?? 0), maxLevelFor(p, charId));
}

/** レベル表示用：いまのレベル・次のレベルまでに必要な経験値など */
export function xpProgress(p: Profile, charId: CharacterId): { level: number; maxLevel: number; xp: number; nextAt: number | null } {
  const xp = p.charXp[charId] ?? 0;
  const level = levelOf(p, charId);
  const maxLevel = maxLevelFor(p, charId);
  return { level, maxLevel, xp, nextAt: level >= maxLevel ? null : levelThreshold(level + 1) };
}

// ---------- 対戦の報酬 ----------

/** 順位ごとのスターコイン（1位〜4位） */
export const RANK_COINS: readonly number[] = [100, 60, 40, 25];
/** 独占勝利（色グループ3つ・観光地）のボーナス */
export const MONOPOLY_BONUS = 30;
/** 経験値：対戦に参加すると +1、勝利するとさらに +1 */
export const XP_PER_GAME = 1;
export const XP_PER_WIN = 1;

export interface GameResultInput {
  /** あなたの順位（1〜4。破産したときは4） */
  rank: number;
  won: boolean;
  reason: WinReason;
}

export interface GameReward {
  /** もらえるスターコインの合計 */
  coins: number;
  rankCoins: number;
  bonus: number;
  xp: number;
  levelBefore: number;
  levelAfter: number;
}

/** 報酬の内訳だけを計算する（プロフィールは変えない） */
export function gameReward(p: Profile, charId: CharacterId, input: GameResultInput): GameReward {
  const rankCoins = RANK_COINS[Math.min(4, Math.max(1, input.rank)) - 1];
  const bonus = input.won && (input.reason === 'triple' || input.reason === 'tourist') ? MONOPOLY_BONUS : 0;
  const xp = XP_PER_GAME + (input.won ? XP_PER_WIN : 0);
  const levelBefore = levelOf(p, charId);
  const after: Profile = { ...p, charXp: { ...p.charXp, [charId]: (p.charXp[charId] ?? 0) + xp } };
  return { coins: rankCoins + bonus, rankCoins, bonus, xp, levelBefore, levelAfter: levelOf(after, charId) };
}

/** 対戦結果をプロフィールに反映した新しいプロフィールと、報酬の内訳を返す */
export function applyGameResult(p: Profile, charId: CharacterId, input: GameResultInput): { profile: Profile; reward: GameReward } {
  const reward = gameReward(p, charId, input);
  const profile: Profile = {
    ...p,
    coins: p.coins + reward.coins,
    charXp: { ...p.charXp, [charId]: (p.charXp[charId] ?? 0) + reward.xp },
  };
  return { profile, reward };
}

/** キャラを持っているか */
export function ownsChar(p: Profile, charId: CharacterId): boolean {
  return p.ownedCharIds.includes(charId);
}

/** まだ持っていないキャラ */
export function unownedChars(p: Profile): CharacterId[] {
  return CHARACTER_LIST.map((c) => c.id).filter((id) => !p.ownedCharIds.includes(id));
}
