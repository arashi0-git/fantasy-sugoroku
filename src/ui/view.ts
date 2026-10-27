// 画面の描画。GameState を受け取って DOM を作るだけで、ルールは持たない。

import { BOARD, GROUPS, Square, SquareKind } from '../data/board';
import { CardId, CARDS } from '../data/cards';
import { CHARACTER_LIST, CHARACTERS, CharacterId, StatId, STAT_NAMES, STAT_ORDER, STAT_TEXT } from '../data/characters';
import { CONFIG, LEVEL, LEVEL_NAMES } from '../data/config';
import { MISSIONS } from '../data/missions';
import { GameReward, levelOf, ownsChar, Profile, unownedChars, xpProgress } from '../meta/profile';
import { COSMETIC_KIND_NAMES, COSMETIC_LIST, CosmeticKind, cosmeticById } from '../meta/cosmetics';
import { GachaResult, isRareResult, PITY_LIMIT } from '../meta/gacha';
import { grownStats } from '../meta/growth';
import {
  Action,
  actorOf,
  aimHitRateOf,
  canFly,
  canOfferTrade,
  chainLength,
  flyTargets,
  buildOptions,
  cardUsable,
  earthquakeTargets,
  festivalLimit,
  festivalTargets,
  sealTargets,
  statMod,
  Aim,
  AIM_ZONES,
  blessingTargets,
  buyOptions,
  buyoutPrice,
  choiceTargets,
  completedGroups,
  GameState,
  GROUP_SQUARES,
  hasTrait,
  investedValue,
  isCursed,
  isLastSpurt,
  isProtected,
  isTourist,
  landPrice,
  LevelOption,
  missionProgress,
  ownedSquares,
  roundOrder,
  PUSH_DIRS,
  PushDir,
  raidPrice,
  raidTargets,
  rankByAssets,
  relocateDests,
  relocateSources,
  rentAt,
  rentOf,
  salaryFor,
  sanctuaryTargets,
  curseTargets,
  sellValue,
  stealTargets,
  swapGiveTargets,
  swapWantTargets,
  totalAssets,
  tradeValueOf,
  touristCount,
  TOURIST_SQUARES,
  TRIPLE_GROUPS,
  WinReason,
} from '../core/game';

export interface ViewHandlers {
  roll(aim?: Aim): void;
  reroll(use: boolean): void;
  escape(): void;
  buy(level: number): void;
  build(level: number): void;
  buyout(): void;
  useCard(action: Extract<Action, { type: 'useCard' }>): void;
  adjust(delta: -1 | 0 | 1): void;
  react(use: boolean): void;
  pick(index: number): void;
  discard(index: number): void;
  fly(square: number): void;
  choose(square: number): void;
  pass(): void;
  sell(square: number): void;
  puppet(delta: -1 | 0 | 1): void;
  push(target: number, dir: PushDir): void;
  gamble(use: boolean): void;
  tradeOffer(offer: { to: number; want: number; give: number[]; money: number }): void;
  tradeAnswer(accept: boolean): void;
  restart(): void;
}

export interface GachaHandlers {
  /** ガチャを引く。コインが足りなければ null */
  draw(count: 1 | 10): { profile: Profile; results: GachaResult[] } | null;
  back(): void;
}

export interface CollectionHandlers {
  /** 見た目アイテムを装備する（id が null なら外す）。装備後のプロフィールを返す */
  equip(kind: CosmeticKind, id: string | null): Profile;
  back(): void;
}

export interface ViewExtras {
  /** アニメーション中のコマの表示位置（プレイヤーID → マス） */
  shownPositions: number[];
  /** サイコロの表示（振っている間は rolling） */
  dice: [number, number] | null;
  rolling: boolean;
  /** 演出中 */
  busy: boolean;
  /** 人間が操作するプレイヤーID */
  human: number;
  /** プレイヤーごとの性格の呼び名（人間は null） */
  labels: (string | null)[];
  /** いま出している CPU の一言（turn・current は言ったときの手番。手番が変わったら消す） */
  speech: { player: number; text: string; turn: number; current: number } | null;
  /** これまでの CPU の一言。at = 言ったときのログの件数（ログのその位置に差し込んで表示する） */
  sayLog: { at: number; player: number; text: string }[];
  /** あなたのプロフィール（所持コイン・装備中の見た目などの表示に使う） */
  profile?: Profile | null;
  /** この対戦で得た報酬（結果画面に出す。まだ確定していなければ null） */
  reward?: (GameReward & { charName: string; rank: number }) | null;
}

const KIND_LABEL: Record<SquareKind, string> = {
  start: 'スタート',
  land: '土地',
  tourist: '観光地',
  chance: 'チャンス',
  island: '無人島',
  festival: '祭り',
  travel: '世界旅行',
};

const fmt = (n: number) => `${n.toLocaleString('ja-JP')}G`;

/**
 * 建物のアイソメトリック（斜め見下ろし）アイコン（レベル別）。
 * 上面・左面・右面の3面で立体感を出し、持ち主色は --owner、ランドマークの金は --brass を使う。
 * レベルごとにシルエットがはっきり違う：別荘=三角屋根の家、ビル=高い箱、ホテル=2段重ね、ランドマーク=城。
 */
const BUILDING_SHADOW = `<ellipse cx="24" cy="42.5" rx="15" ry="3" fill="rgba(0,0,0,.25)"/>`;
const BUILDING_SVGS: Record<number, string> = {
  1: `<svg viewBox="0 0 48 46" aria-hidden="true">${BUILDING_SHADOW}<polygon points="13,25.5 24,31 24,39 13,33.5" fill="#ded3ba"/><polygon points="24,31 35,25.5 35,33.5 24,39" fill="#f7f0dd"/><polygon points="13,25.5 24,31 24,13" fill="var(--owner)" opacity=".82"/><polygon points="24,31 35,25.5 24,13" fill="var(--owner)"/><polygon points="16.5,29.3 20,31 20,34 16.5,32.3" fill="var(--owner)" opacity=".7"/><polygon points="27,32.6 30.5,30.9 30.5,36.4 27,38.1" fill="var(--owner)"/></svg>`,
  2: `<svg viewBox="0 0 48 46" aria-hidden="true">${BUILDING_SHADOW}<polygon points="24,6.5 36.5,12.75 24,19 11.5,12.75" fill="var(--owner)"/><polygon points="13,14.5 24,20 24,40 13,34.5" fill="#ded3ba"/><polygon points="24,20 35,14.5 35,34.5 24,40" fill="#f7f0dd"/><polygon points="24,9 35,14.5 24,20 13,14.5" fill="#efe8d5"/><g fill="var(--owner)" opacity=".72"><polygon points="15,18.6 18.4,20.3 18.4,23.9 15,22.2"/><polygon points="19.2,20.7 22.6,22.4 22.6,26 19.2,24.3"/><polygon points="15,24.6 18.4,26.3 18.4,29.9 15,28.2"/><polygon points="19.2,26.7 22.6,28.4 22.6,32 19.2,30.3"/><polygon points="15,30.6 18.4,32.3 18.4,35.9 15,34.2"/><polygon points="26,20.5 29.4,18.8 29.4,22.4 26,24.1"/><polygon points="30.2,18.4 33.6,16.7 33.6,20.3 30.2,22"/><polygon points="26,26.5 29.4,24.8 29.4,28.4 26,30.1"/><polygon points="30.2,24.4 33.6,22.7 33.6,26.3 30.2,28"/><polygon points="26,32.5 29.4,30.8 29.4,34.4 26,36.1"/><polygon points="30.2,30.4 33.6,28.7 33.6,32.3 30.2,34"/></g></svg>`,
  3: `<svg viewBox="0 0 48 46" aria-hidden="true">${BUILDING_SHADOW}<polygon points="16,8 24,12 24,20 16,16" fill="#ded3ba"/><polygon points="24,12 32,8 32,16 24,20" fill="#f7f0dd"/><polygon points="24,4 32,8 24,12 16,8" fill="var(--owner)"/><polygon points="8,25 24,32 24,41 8,34" fill="#ded3ba"/><polygon points="24,32 40,25 40,34 24,41" fill="#f7f0dd"/><polygon points="24,18 40,25 24,32 8,25" fill="#efe8d5"/><polygon points="8,26.8 24,33.8 24,36.8 8,29.8" fill="var(--owner)" opacity=".9"/><polygon points="24,33.8 40,26.8 40,29.8 24,36.8" fill="var(--owner)" opacity=".9"/><circle cx="24" cy="8.2" r="1.5" fill="var(--brass)"/><g fill="var(--owner)" opacity=".75"><polygon points="18.5,11 21,12.25 21,15 18.5,13.75"/><polygon points="25,12.25 27.5,11 27.5,13.75 25,15"/></g><g fill="#8a744a" opacity=".65"><polygon points="11,31.5 14.6,33.3 14.6,36.3 11,34.5"/><polygon points="16.5,34 20.1,35.8 20.1,38.8 16.5,37"/><polygon points="31,32.6 34.6,30.8 34.6,33.8 31,35.6"/></g><polygon points="25.2,34.8 28.8,33 28.8,38.6 25.2,40.4" fill="var(--owner)"/></svg>`,
  4: `<svg viewBox="0 0 48 46" aria-hidden="true"><ellipse cx="24" cy="44" rx="16" ry="2.8" fill="rgba(0,0,0,.25)"/><polygon points="8.5,17.25 13,19.5 13,34 8.5,31.75" fill="#ded3ba"/><polygon points="13,19.5 17.5,17.25 17.5,31.75 13,34" fill="#f7f0dd"/><polygon points="8.5,17.25 13,19.5 13,9.5" fill="var(--brass)" opacity=".85"/><polygon points="13,19.5 17.5,17.25 13,9.5" fill="var(--brass)"/><polygon points="30.5,17.25 35,19.5 35,34 30.5,31.75" fill="#ded3ba"/><polygon points="35,19.5 39.5,17.25 39.5,31.75 35,34" fill="#f7f0dd"/><polygon points="30.5,17.25 35,19.5 35,9.5" fill="var(--brass)" opacity=".85"/><polygon points="35,19.5 39.5,17.25 35,9.5" fill="var(--brass)"/><polygon points="16.5,12.75 24,16.5 24,28 16.5,24.25" fill="#e3d8bf"/><polygon points="24,16.5 31.5,12.75 31.5,24.25 24,28" fill="#f7f0dd"/><polygon points="16.5,12.75 24,16.5 24,2.5" fill="var(--brass)" opacity=".85"/><polygon points="24,16.5 31.5,12.75 24,2.5" fill="var(--brass)"/><line x1="24" y1="2.5" x2="24" y2="0.2" stroke="#7a5c14" stroke-width="1.1"/><polygon points="24,0.2 27.5,1.3 24,2.4" fill="#c0392b"/><polygon points="8,32 24,40 24,44.5 8,36.5" fill="#d5c8ab"/><polygon points="24,40 40,32 40,36.5 24,44.5" fill="#efe6cf"/><polygon points="24,24 40,32 24,40 8,32" fill="#e9e2d0"/><polyline points="8,32 24,40 40,32" fill="none" stroke="var(--brass)" stroke-width="1.6"/><g fill="var(--brass)"><polygon points="20.8,19.5 23,20.6 23,23.4 20.8,22.3"/><polygon points="25,20.6 27.2,19.5 27.2,22.3 25,23.4"/></g></svg>`,
};

/** 特殊マスのイラスト（土地以外のマス）。観光地は場所ごとのモチーフ */
const ART_SHADOW = `<ellipse cx="24" cy="36.5" rx="15" ry="2.8" fill="rgba(0,0,0,.22)"/>`;
const KIND_ART: Partial<Record<SquareKind, string>> = {
  start: `<svg viewBox="0 0 48 40" aria-hidden="true">${ART_SHADOW}<rect x="11" y="12" width="5" height="22" rx="1" fill="#d9d2c3" stroke="rgba(90,70,30,.4)"/><rect x="32" y="12" width="5" height="22" rx="1" fill="#d9d2c3" stroke="rgba(90,70,30,.4)"/><polygon points="7,12 41,12 37.5,6 10.5,6" fill="var(--brass)"/><polygon points="24,0.5 31,6 17,6" fill="#9a7426"/><circle cx="24" cy="21" r="3.6" fill="var(--brass)" stroke="#9a7426"/></svg>`,
  chance: `<svg viewBox="0 0 48 40" aria-hidden="true"><ellipse cx="24" cy="36.5" rx="13" ry="2.6" fill="rgba(0,0,0,.22)"/><rect x="16" y="5" width="16" height="27" rx="3" fill="#b9bec9" stroke="#8a90a0" stroke-width="1.4"/><polygon points="24,10 26.1,15.2 31,17 26.1,18.8 24,24 21.9,18.8 17,17 21.9,15.2" fill="var(--brass)"/><rect x="12" y="32" width="24" height="3.6" rx="1.8" fill="#9aa0ae"/></svg>`,
  island: `<svg viewBox="0 0 48 40" aria-hidden="true"><ellipse cx="24" cy="34.5" rx="18" ry="4.2" fill="#5aa7c7" opacity=".55"/><polygon points="10,34.5 14.5,21.5 21,16.5 28.5,17.5 35,23.5 38,34.5" fill="#8d8d94"/><polygon points="21,16.5 28.5,17.5 35,23.5 38,34.5 25,34.5" fill="#74747c"/><rect x="17.2" y="7.5" width="13.6" height="17" fill="#cfd4dc" opacity=".45"/><g fill="#33373f"><rect x="18.6" y="7.5" width="2.3" height="17" rx="1"/><rect x="22.85" y="7.5" width="2.3" height="17" rx="1"/><rect x="27.1" y="7.5" width="2.3" height="17" rx="1"/><rect x="16.6" y="6.4" width="14.8" height="2.6" rx="1.3"/><rect x="16.6" y="15" width="14.8" height="2.2" rx="1.1"/><rect x="16.6" y="23.4" width="14.8" height="2.4" rx="1.2"/></g></svg>`,
  festival: `<svg viewBox="0 0 48 40" aria-hidden="true">${ART_SHADOW}<rect x="9" y="10" width="2.6" height="24" rx="1" fill="#7a5c14"/><rect x="36.4" y="10" width="2.6" height="24" rx="1" fill="#7a5c14"/><path d="M10.3 11 Q24 19.5 37.7 11" stroke="#c2453d" stroke-width="1.6" fill="none"/><polygon points="14.5,13.8 18.5,15.2 16,19" fill="#c9a227"/><polygon points="22,16.2 26,16.2 24,20" fill="#3a74d8"/><polygon points="29.5,15.2 33.5,13.8 32,19" fill="#2f9e57"/><ellipse cx="10.3" cy="19" rx="3.6" ry="4.8" fill="#e2574c"/><rect x="7.9" y="13.6" width="4.8" height="1.8" rx=".9" fill="#7a5c14"/><ellipse cx="37.7" cy="19" rx="3.6" ry="4.8" fill="#e2574c"/><rect x="35.3" y="13.6" width="4.8" height="1.8" rx=".9" fill="#7a5c14"/><ellipse cx="24" cy="27" rx="3.2" ry="4.3" fill="#f0a13c"/><rect x="21.8" y="22.2" width="4.4" height="1.7" rx=".85" fill="#7a5c14"/></svg>`,
  travel: `<svg viewBox="0 0 48 40" aria-hidden="true"><ellipse cx="24" cy="31" rx="16" ry="5.5" fill="#cfc4e8"/><ellipse cx="24" cy="30" rx="14.5" ry="4.8" fill="#e6defa" stroke="#8b6bc2" stroke-width="1.6"/><ellipse cx="24" cy="30" rx="8.5" ry="2.9" fill="none" stroke="#8b6bc2" stroke-width="1.3"/><polygon points="24,1.5 26,6.4 30.5,8.5 26,10.6 24,15.5 22,10.6 17.5,8.5 22,6.4" fill="#8b6bc2"/><polygon points="11,10 12.2,13 15,14.2 12.2,15.4 11,18.4 9.8,15.4 7,14.2 9.8,13" fill="#b79ce0"/><polygon points="37,10 38.2,13 41,14.2 38.2,15.4 37,18.4 35.8,15.4 33,14.2 35.8,13" fill="#b79ce0"/><circle cx="24" cy="30" r="1.8" fill="#8b6bc2"/></svg>`,
};

/** 観光地ごとのモチーフ（マス番号キー）：古代樹の神殿=大樹、沈んだ灯台=灯台、竜骨の谷=竜の骨、天空の浮島=浮島 */
const TOURIST_ART: Record<number, string> = {
  4: `<svg viewBox="0 0 48 40" aria-hidden="true"><ellipse cx="24" cy="36.5" rx="14" ry="2.6" fill="rgba(0,0,0,.22)"/><path d="M22 35 L23.2 21 L24.8 21 L26 35 Z" fill="#7a5230"/><circle cx="24" cy="12.5" r="7.6" fill="#4f8f5a"/><circle cx="16.3" cy="17" r="5.4" fill="#3f7a49"/><circle cx="31.7" cy="17" r="5.4" fill="#4f8f5a"/><circle cx="24" cy="18.5" r="6.2" fill="#589c63"/><rect x="21" y="29.5" width="6" height="5.5" fill="#ece7dc" stroke="rgba(90,70,30,.4)"/><polygon points="19.8,29.5 28.2,29.5 24,25.8" fill="var(--brass)"/></svg>`,
  12: `<svg viewBox="0 0 48 40" aria-hidden="true"><ellipse cx="24" cy="35" rx="15" ry="3.6" fill="#5aa7c7" opacity=".65"/><polygon points="26.5,7.5 38,4.5 38,12 26.5,10.5" fill="#ffd94d" opacity=".35"/><polygon points="20.5,32 22,13 26,13 27.5,32" fill="#f5edd9" stroke="rgba(90,70,30,.35)"/><polygon points="21.5,20.5 26.5,20.5 27,25 21,25" fill="#c2453d"/><rect x="20.6" y="7.6" width="6.8" height="5.2" fill="#3c414c"/><circle cx="24" cy="10.2" r="1.9" fill="#ffd94d"/><polygon points="19.6,7.6 28.4,7.6 24,3.2" fill="#c2453d"/></svg>`,
  21: `<svg viewBox="0 0 48 40" aria-hidden="true"><ellipse cx="24" cy="36.2" rx="15" ry="2.8" fill="rgba(0,0,0,.22)"/><polygon points="7,35.5 13.5,26.5 34.5,26.5 41,35.5" fill="#a68d5f" stroke="#8a744a"/><g stroke="rgba(0,0,0,.18)" stroke-width="4.4" fill="none" stroke-linecap="round"><path d="M14.5 34.5 Q15.5 21 21.5 15.5"/><path d="M22.5 34.5 Q23.5 18 29.5 13.5"/><path d="M30.5 34.5 Q31.5 22 36.5 17.5"/></g><g stroke="#f0e7cd" stroke-width="3.4" fill="none" stroke-linecap="round"><path d="M14.5 33.5 Q15.5 20 21.5 14.5"/><path d="M22.5 33.5 Q23.5 17 29.5 12.5"/><path d="M30.5 33.5 Q31.5 21 36.5 16.5"/></g><path d="M11 34 Q24 29.8 38.5 33" stroke="#e2d5ae" stroke-width="2.6" fill="none"/><circle cx="37.8" cy="28.8" r="2.8" fill="#f0e7cd"/><circle cx="36.9" cy="28.5" r=".85" fill="#8a7a5c"/></svg>`,
  29: `<svg viewBox="0 0 48 40" aria-hidden="true"><polygon points="10.5,14.5 37.5,14.5 27,29.5 24,32.5 21,29.5" fill="#9a8a76"/><polygon points="24,14.5 37.5,14.5 27,29.5 24,32.5" fill="#87765f"/><ellipse cx="24" cy="14" rx="14" ry="4.4" fill="#9cc46b"/><rect x="20" y="5.5" width="8" height="6.5" fill="#ece7dc" stroke="rgba(90,70,30,.35)"/><polygon points="18.8,5.5 29.2,5.5 24,1.2" fill="var(--brass)"/><circle cx="32.5" cy="9" r="2.7" fill="#4f8f5a"/><rect x="31.9" y="10.5" width="1.3" height="2.6" fill="#7a5230"/><g fill="#ffffff" opacity=".85"><ellipse cx="11" cy="35" rx="6" ry="2.1"/><ellipse cx="24" cy="37.6" rx="8" ry="2.3"/><ellipse cx="36" cy="35" rx="6" ry="2.1"/></g></svg>`,
};

/** 特殊マスの効果説明（詳細パネル用） */
const SPECIAL_TEXT: Partial<Record<SquareKind, string>> = {
  start: `通過すると給料（基本${fmt(CONFIG.salary)}＋土地1つ${fmt(CONFIG.landIncomePerLand)}＋建物1段階${fmt(CONFIG.landIncomePerLevel)}、総資産が最下位なら2倍）がもらえます。ぴったり止まると祝福：自分の土地を無料で1段階上げられます。`,
  chance: '運命の石碑。止まると運命のカードをめくり、選んだ1枚を手札に加えられます。',
  island: `霧の孤島。止まると最大${CONFIG.islandTurns}手番動けなくなります。ゾロ目が出れば脱出でき、${fmt(CONFIG.escapeFee)}を払って出ることもできます。封印の鎖やゾロ目3連続でも送られてきます。`,
  festival: `収穫祭の広場。止まると自分の土地1つで祭りを開けます。祭りの土地は通行料が${CONFIG.festivalMultiplier}倍（祭囃子のキャラは${CONFIG.mishaFestivalMultiplier}倍）になります。`,
  travel: '転移の魔法陣。止まると好きなマスへワープできます。始まりの門を越えると給料がもらえます。',
};

/** プレイヤーのコマ（チェスのポーン型）。色は --c を使う */
const PAWN_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="21.7" rx="6.2" ry="1.6" fill="rgba(0,0,0,.28)"/><path d="M12 2.6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8Z" fill="var(--c)" stroke="rgba(255,255,255,.9)" stroke-width="1.1"/><path d="M8.6 10.2h6.8l.7 2.3H7.9Z" fill="var(--c)" stroke="rgba(255,255,255,.9)" stroke-width="1.1"/><path d="M9.2 12.5c.5 2.9-.4 4.7-2 6.3h9.6c-1.6-1.6-2.5-3.4-2-6.3Z" fill="var(--c)" stroke="rgba(255,255,255,.9)" stroke-width="1.1"/><rect x="5.6" y="18.4" width="12.8" height="2.7" rx="1.3" fill="var(--c)" stroke="rgba(255,255,255,.9)" stroke-width="1.1"/><ellipse cx="10.4" cy="5" rx="1.5" ry="1" fill="rgba(255,255,255,.4)"/></svg>`;

/** マス番号 → 9×9 グリッド上の位置と、盤の内側を向く辺 */
function placement(i: number): { row: number; col: number; side: 'bottom' | 'left' | 'top' | 'right' } {
  if (i <= 8) return { row: 9, col: 9 - i, side: 'bottom' };
  if (i <= 16) return { row: 9 - (i - 8), col: 1, side: 'left' };
  if (i <= 24) return { row: 1, col: 1 + (i - 16), side: 'top' };
  return { row: 1 + (i - 24), col: 9, side: 'right' };
}

const isCorner = (sq: Square) => sq.index % 8 === 0;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class View {
  private tiles: HTMLElement[] = [];
  /** 盤面のマスをクリックしたときの動作（場面ごとに差し替える） */
  private onTileClick: ((square: number) => void) | null = null;

  // ---- サイコロのゲージ ----
  /** ゲージが動き始めた時刻 */
  private gaugeStart = performance.now();
  /** 止めた位置（止めていなければ null で、動き続ける） */
  private gaugeFrozen: number | null = null;
  /** 往復1回にかかる時間（ミリ秒） */
  private readonly gaugePeriod = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 2600 : 1500;

  /** いまのゲージの位置（0〜1 を往復） */
  private gaugePos(): number {
    if (this.gaugeFrozen !== null) return this.gaugeFrozen;
    const t = ((performance.now() - this.gaugeStart) / this.gaugePeriod) % 1;
    return t < 0.5 ? t * 2 : 2 - t * 2;
  }

  private static zoneAt(pos: number): Aim {
    return pos < 1 / 3 ? 'low' : pos < 2 / 3 ? 'mid' : 'high';
  }

  /** 毎フレーム、画面にあるゲージの目盛りを動かす */
  private tickGauge = () => {
    const marker = document.querySelector<HTMLElement>('.gauge .marker');
    if (marker) {
      const pos = this.gaugePos();
      marker.style.left = `${pos * 100}%`;
      const zone = View.zoneAt(pos);
      document.querySelectorAll<HTMLElement>('.gauge .zone').forEach((z) => {
        z.classList.toggle('on', z.dataset.zone === zone);
      });
    }
    requestAnimationFrame(this.tickGauge);
  };

  constructor(
    private boardEl: HTMLElement,
    private centerEl: HTMLElement,
    private playersEl: HTMLElement,
    private logEl: HTMLElement,
    /** 盤面が小さいときに操作パネルとお知らせを出す場所（横の列のいちばん上。スマホでは盤面の下） */
    private dockEl: HTMLElement,
    /** あなたの手札を出す場所 */
    private handEl: HTMLElement,
    private h: ViewHandlers,
  ) {
    // 盤面の大きさが変わったら、パネルの置き場所を決め直して描き直す
    new ResizeObserver(() => {
      const compact = this.boardEl.clientWidth < View.COMPACT_BOARD;
      if (compact !== this.compact) {
        this.compact = compact;
        if (this.last) this.render(...this.last);
      }
    }).observe(this.boardEl);
    for (const sq of BOARD) {
      const { row, col, side } = placement(sq.index);
      const tile = el('div', `tile side-${side} kind-${sq.kind}`);
      tile.style.gridRow = String(row);
      tile.style.gridColumn = String(col);
      if (sq.kind !== 'land') tile.classList.add('special');
      if (sq.kind === 'tourist') tile.classList.add('tourist');
      if (isCorner(sq)) tile.classList.add('corner');
      if (sq.group) tile.style.setProperty('--band', GROUPS[sq.group].color);
      const fest = el('span', 'fest-badge', '祭');
      fest.title = '祭り開催中（通行料2倍）';
      const sanct = el('span', 'sanct-badge', '聖');
      sanct.title = '聖域の紋章で守られている（買収・略奪の令状の対象にならない）';
      const curse = el('span', 'curse-badge', '呪');
      curse.title = '呪いの刻印（持ち主が1周するまで通行料0）';
      const art = el('div', 'art');
      const artSvg = sq.kind === 'tourist' ? TOURIST_ART[sq.index] : KIND_ART[sq.kind];
      if (artSvg) art.innerHTML = artSvg;
      // 価格・通行料と建物アイコンは1行に並べる（スマホの小さいマスでも収まるように）
      const meta = el('div', 'meta');
      meta.append(el('div', 'sub'), el('div', 'lv'));
      tile.append(el('div', 'band'), el('div', 'name', sq.name), art, meta, fest, sanct, curse, el('div', 'tokens'));
      tile.addEventListener('click', () => this.tapTile(sq.index));
      tile.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.tapTile(sq.index);
        }
      });
      this.tiles.push(tile);
      this.boardEl.append(tile);
    }
    this.buildSheet();
    this.buildTiltToggle();
    this.buildRotateHint();
    requestAnimationFrame(this.tickGauge);
  }

  /** 盤面を斜め見下ろしにする「3D風」表示の切り替えボタン（速度バーの隣に作る） */
  private buildTiltToggle() {
    const speedbar = document.getElementById('speedbar');
    if (!speedbar?.parentElement) return;
    const bar = el('div', 'speed-bar tilt-bar');
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', '盤面の見え方');
    const btn = el('button', 'tilt-btn', '3D風');
    btn.type = 'button';
    const sync = () => {
      const on = document.body.classList.contains('tilt-on');
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    };
    try {
      if (window.localStorage.getItem('fs-tilt') === '1') document.body.classList.add('tilt-on');
    } catch {
      /* 保存できない環境では初期値オフのまま */
    }
    btn.addEventListener('click', () => {
      const on = document.body.classList.toggle('tilt-on');
      try {
        window.localStorage.setItem('fs-tilt', on ? '1' : '0');
      } catch {
        /* 保存できなくても切り替え自体は有効 */
      }
      sync();
    });
    bar.append(el('span', 'speed-label', '見え方'), btn);
    speedbar.after(bar);
    sync();
  }

  /** 縦向きのスマホで対戦画面を開いている間だけ出す「横画面が見やすいよ」の小さな案内 */
  private buildRotateHint() {
    try {
      if (window.sessionStorage.getItem('fs-rotate-hint') === 'off') document.body.classList.add('hint-off');
    } catch {
      /* 判定できない環境ではそのまま出す */
    }
    const hint = el('div', 'rotate-hint');
    const close = el('button', 'rotate-hint-close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', '案内を閉じる');
    close.addEventListener('click', () => {
      document.body.classList.add('hint-off');
      try {
        window.sessionStorage.setItem('fs-rotate-hint', 'off');
      } catch {
        /* 保存できなくても、この画面では閉じられる */
      }
    });
    hint.append(el('span', 'rotate-hint-text', '📱 横画面が見やすいよ'), close);
    document.body.append(hint);
  }

  /** マスをタップしたとき：対象選択中ならそちらを優先し、それ以外は詳細シートを開く */
  private tapTile(i: number) {
    if (this.tiles[i].classList.contains('selectable')) {
      this.onTileClick?.(i);
      return;
    }
    if (!this.selectionActive) this.openDetail(i);
  }

  // ---- マスの詳細シート ----
  private detailSquare: number | null = null;
  /** 対象選択の場面かどうか（選択中はタップを詳細表示に使わない） */
  private selectionActive = false;
  private sheetEl!: HTMLElement;
  private sheetTitle!: HTMLElement;
  private sheetBody!: HTMLElement;

  /** 詳細シートの土台（画面下から出るパネル）を1回だけ作る */
  private buildSheet() {
    const overlay = el('div', 'sheet-overlay');
    overlay.hidden = true;
    const sheet = el('section', 'sheet');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'false');
    sheet.setAttribute('aria-label', 'マスの詳細');
    const head = el('div', 'sheet-head');
    this.sheetTitle = el('h3', 'sheet-title', 'マスの詳細');
    const close = el('button', 'sheet-close', '✕');
    close.setAttribute('aria-label', '詳細を閉じる');
    close.addEventListener('click', () => this.closeDetail());
    head.append(this.sheetTitle, close);
    this.sheetBody = el('div', 'sheet-body');
    sheet.append(head, this.sheetBody);
    overlay.append(sheet);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.closeDetail();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeDetail();
    });
    document.body.append(overlay);
    this.sheetEl = overlay;
  }

  private openDetail(i: number) {
    this.detailSquare = i;
    this.sheetEl.hidden = false;
    if (this.last) this.refreshDetail(this.last[0]);
  }

  closeDetail() {
    this.detailSquare = null;
    if (this.sheetEl) this.sheetEl.hidden = true;
  }

  private human = 0;
  /** 盤面がこの幅（px）より小さいときは、操作パネルを盤面の中に収めず、横の列（スマホでは盤面の下）に出す */
  private static readonly COMPACT_BOARD = 760;
  private compact = false;
  private last: [GameState, ViewExtras] | null = null;

  /** 使おうとしている攻めのカード（対象を選んでいる途中）。場面が変わったら取り消す */
  private pendingCard: CardId | null = null;
  /** 交換の契約書・移築の書で、先に選んだ自分の土地（交換に出す土地／建物の移し元） */
  private pendingSource: number | null = null;
  /** 天翔の行き先を選んでいる途中 */
  private pendingFly = false;
  /** 取引の提示を作っている途中（相手・欲しい土地・対価の土地と金額）。場面が変わったら取り消す */
  private tradeDraft: { to: number; want: number | null; give: number[]; money: number } | null = null;
  private pendingKey = '';

  render(s: GameState, x: ViewExtras) {
    this.last = [s, x];
    this.human = x.human;
    // いま決めるのがあなたか（守りのカードの割り込みでは、相手の手番でもあなたが決めることがある）
    const myTurn = actorOf(s) === x.human && s.phase.kind !== 'gameover' && !x.busy;
    const key = `${s.turn}:${s.current}:${s.phase.kind}:${s.cardsUsed}:${s.tradeUsed}`;
    if (key !== this.pendingKey || !myTurn) {
      this.pendingCard = null;
      this.pendingSource = null;
      this.pendingFly = false;
      this.tradeDraft = null;
    }
    this.pendingKey = key;
    // あなたが判断する場面では詳細シートを閉じて、操作パネルを見せる
    if (myTurn) this.closeDetail();
    this.renderTiles(s, x, myTurn);
    this.renderCenter(s, x, myTurn);
    this.renderHand(s, x, myTurn);
    this.renderPlayers(s, x);
    this.renderLog(s, x);
    if (this.detailSquare !== null) this.refreshDetail(s);
  }

  /** 手札のカードを使う。対象が必要なカードは、対象選びの画面にする */
  private startCard(card: CardId) {
    if (card === 'treasure') {
      this.h.useCard({ type: 'useCard', card });
      return;
    }
    this.pendingCard = card;
    this.pendingSource = null;
    if (this.last) this.render(...this.last);
  }

  private cancelCard = () => {
    this.pendingCard = null;
    this.pendingSource = null;
    this.pendingFly = false;
    this.tradeDraft = null;
    if (this.last) this.render(...this.last);
  };

  /** 人間が盤面のマスを選べる場面なら、その候補とクリック時の動作 */
  private selectable(s: GameState, myTurn: boolean): { targets: Set<number>; onPick: (sq: number) => void } | null {
    if (!myTurn) return null;
    if (s.phase.kind === 'liquidate') {
      return { targets: new Set(ownedSquares(s, s.current)), onPick: (sq) => this.h.sell(sq) };
    }
    if (this.pendingFly) {
      return { targets: new Set(flyTargets(s)), onPick: (square) => this.h.fly(square) };
    }
    if (this.pendingCard === 'earthquake' || this.pendingCard === 'festival' || this.pendingCard === 'growth' || this.pendingCard === 'raid') {
      const card = this.pendingCard;
      const targets =
        card === 'earthquake' ? earthquakeTargets(s) : card === 'festival' ? festivalTargets(s) : card === 'raid' ? raidTargets(s) : blessingTargets(s);
      return { targets: new Set(targets), onPick: (square) => this.h.useCard({ type: 'useCard', card, square }) };
    }
    if (this.pendingCard === 'sanctuary' || this.pendingCard === 'curse') {
      const card = this.pendingCard;
      const targets = card === 'sanctuary' ? sanctuaryTargets(s) : curseTargets(s);
      return { targets: new Set(targets), onPick: (square) => this.h.useCard({ type: 'useCard', card, square }) };
    }
    if (this.pendingCard === 'swap' || this.pendingCard === 'relocate') {
      const card = this.pendingCard;
      // まず自分の土地（交換に出す土地／建物の移し元）を選び、次に相手の土地／移し先を選ぶ
      if (this.pendingSource === null) {
        const firsts = card === 'swap' ? swapGiveTargets(s) : relocateSources(s);
        return {
          targets: new Set(firsts),
          onPick: (sq) => {
            this.pendingSource = sq;
            if (this.last) this.render(...this.last);
          },
        };
      }
      const give = this.pendingSource;
      const seconds = card === 'swap' ? swapWantTargets(s, give) : relocateDests(s, give);
      return { targets: new Set(seconds), onPick: (square) => this.h.useCard({ type: 'useCard', card, square, give }) };
    }
    const targets = choiceTargets(s);
    if (targets.length) return { targets: new Set(targets), onPick: (sq) => this.h.choose(sq) };
    return null;
  }

  private renderTiles(s: GameState, x: ViewExtras, myTurn: boolean) {
    const sel = this.selectable(s, myTurn);
    this.onTileClick = sel?.onPick ?? null;
    this.selectionActive = !!sel;
    const ph = s.phase;
    const highlight = (ph.kind === 'buy' || ph.kind === 'build' || ph.kind === 'buyout') && !x.busy ? ph.square : -1;

    BOARD.forEach((sq, i) => {
      const tile = this.tiles[i];
      const sub = tile.querySelector('.sub')!;
      const prop = s.properties[i];

      // マスに出すのは土地名・建物・通行料（所有者は枠の色で判別）。空き地は価格
      if (sq.kind === 'land' || sq.kind === 'tourist') {
        const text = prop ? fmt(rentOf(s, i)) : fmt(landPrice(i));
        sub.textContent = text;
        // 4桁以上の金額は、スマホの小さいマスでも切れないよう少し詰める
        sub.classList.toggle('long', text.length >= 7);
      } else if (!isCorner(sq)) {
        sub.textContent = KIND_LABEL[sq.kind];
        sub.classList.remove('long');
      }

      const lv = tile.querySelector('.lv')!;
      lv.replaceChildren();
      if (prop && prop.level > 0) {
        const b = el('span', 'building');
        b.innerHTML = BUILDING_SVGS[prop.level] ?? '';
        lv.append(b);
      }

      tile.classList.toggle('owned', !!prop);
      if (prop) tile.style.setProperty('--owner', s.players[prop.owner].color);
      tile.classList.toggle('festival-on', s.festivals.includes(i));
      tile.classList.toggle('sanctuary-on', !!prop && isProtected(s, i));
      tile.classList.toggle('curse-on', !!prop && isCursed(s, i));
      const pickable = !!sel?.targets.has(i);
      tile.classList.toggle('selectable', pickable);
      tile.classList.toggle(
        'danger',
        pickable && (ph.kind === 'liquidate' || this.pendingCard === 'earthquake' || this.pendingCard === 'raid' || this.pendingCard === 'curse'),
      );
      if (pickable) {
        tile.tabIndex = 0;
        tile.setAttribute('role', 'button');
        tile.removeAttribute('aria-label');
      } else if (!sel) {
        // 対象選択中でないときは、タップで詳細を開けるボタンとして扱う
        tile.tabIndex = 0;
        tile.setAttribute('role', 'button');
        tile.setAttribute('aria-label', `${sq.name}の詳細を見る`);
      } else {
        tile.removeAttribute('tabindex');
        tile.removeAttribute('role');
        tile.removeAttribute('aria-label');
      }
      tile.classList.toggle('highlight', highlight === i);
      tile.title = this.tileTitle(s, sq);

      const tokens = tile.querySelector('.tokens')!;
      tokens.replaceChildren(
        ...s.players
          .filter((p) => !p.bankrupt && x.shownPositions[p.id] === i)
          .map((p) => {
            const skin = p.id === x.human ? x.profile?.equipped.pawn : null;
            const t = el('span', 'token' + (p.id === s.current ? ' active' : '') + (skin ? ` ${skin}` : ''));
            t.style.setProperty('--c', p.color);
            t.innerHTML = PAWN_SVG;
            t.title = p.name;
            return t;
          }),
      );
    });
  }

  private tileTitle(s: GameState, sq: Square): string {
    const prop = s.properties[sq.index];
    if (sq.kind === 'tourist') {
      const owner = prop ? `持ち主：${s.players[prop.owner].name}・通行料 ${fmt(rentOf(s, sq.index))}` : '空き地';
      const fx = `${isProtected(s, sq.index) ? '\n聖域の紋章で守られている（買収されない）' : ''}${isCursed(s, sq.index) ? '\n呪いの刻印（持ち主が1周するまで通行料0）' : ''}`;
      return `${sq.name}（観光地）\n価格 ${fmt(CONFIG.touristPrice)} / ${owner}\n通行料は持っている観光地の数で上がる${fx}`;
    }
    if (sq.kind === 'start') {
      return `${sq.name}（スタート）\n通過すると給料：基本${fmt(CONFIG.salary)}＋土地1つ${fmt(CONFIG.landIncomePerLand)}＋建物1段階${fmt(CONFIG.landIncomePerLevel)}（総資産が最下位なら2倍）\nぴったり止まると祝福：自分の土地を無料で1段階上げられる`;
    }
    if (sq.kind !== 'land') return `${sq.name}（${KIND_LABEL[sq.kind]}）`;
    const g = GROUPS[sq.group!];
    const owner = prop
      ? `持ち主：${s.players[prop.owner].name}・${LEVEL_NAMES[prop.level]}・通行料 ${fmt(rentOf(s, sq.index))}`
      : '空き地';
    const fest = s.festivals.includes(sq.index) ? '\n祭り開催中（通行料アップ）' : '';
    const fx = `${isProtected(s, sq.index) ? '\n聖域の紋章で守られている（買収されない）' : ''}${isCursed(s, sq.index) ? '\n呪いの刻印（持ち主が1周するまで通行料0）' : ''}`;
    const chain = prop ? chainLength(s, sq.index) : 0;
    const bonus = CONFIG.chainBonus[Math.min(chain, CONFIG.chainBonus.length - 1)] ?? 0;
    const chainText = bonus > 0 ? `\n${chain}マス連続で通行料+${Math.round(bonus * 100)}%` : '';
    return `${sq.name}（${g.name}）\n価格 ${fmt(g.price)} / ${owner}${fest}${fx}${chainText}`;
  }

  /** 通行料の内訳（基礎と、効いている倍率・補正の内訳）。合計は rentOf の値と一致させる */
  private rentSteps(s: GameState, sq: Square): string[] {
    const prop = s.properties[sq.index];
    if (!prop) return [];
    if (isCursed(s, sq.index)) return ['呪いの刻印が効いているため、通行料は0'];
    const owner = s.players[prop.owner];
    const prestige = statMod(owner, 'prestige');
    const pct = (m: number) => `${m >= 0 ? '+' : ''}${Math.round(m * 100)}%`;
    const steps: string[] = [];
    if (isTourist(sq.index)) {
      const n = touristCount(s, prop.owner);
      steps.push(`基礎 ${fmt(CONFIG.touristRent[n])}（観光地${n}つ所有）`);
      if (prestige !== 0) steps.push(`威光 ${pct(prestige)}`);
      if (hasTrait(owner, 'voyage')) steps.push(`大航海 ×${CONFIG.voyageTouristRentRate}`);
      if (isLastSpurt(s)) steps.push(`ラストスパート ×${CONFIG.lastSpurtRate}`);
      return steps;
    }
    steps.push(`基礎 ${fmt(rentAt(sq.index, prop.level))}（${LEVEL_NAMES[prop.level]}）`);
    if (prestige !== 0) steps.push(`威光 ${pct(prestige)}`);
    if (s.festivals.includes(sq.index)) {
      steps.push(`祭り ×${hasTrait(owner, 'festival') ? CONFIG.mishaFestivalMultiplier : CONFIG.festivalMultiplier}`);
    }
    const chain = chainLength(s, sq.index);
    const bonus = CONFIG.chainBonus[Math.min(chain, CONFIG.chainBonus.length - 1)] ?? 0;
    if (bonus > 0) steps.push(`連続${chain}マス +${Math.round(bonus * 100)}%`);
    const g = sq.group;
    if (g && hasTrait(owner, 'formation') && completedGroups(s, prop.owner).includes(g)) steps.push(`布陣 ×${CONFIG.formationRate}`);
    if (isLastSpurt(s)) steps.push(`ラストスパート ×${CONFIG.lastSpurtRate}`);
    return steps;
  }

  /** 詳細シートの中身を、いまの状態で作り直す */
  private refreshDetail(s: GameState) {
    const i = this.detailSquare;
    if (i === null) return;
    const sq = BOARD[i];
    const prop = s.properties[i];
    this.sheetTitle.textContent = sq.name;
    const body = this.sheetBody;
    body.replaceChildren();

    const kindText =
      sq.kind === 'land' ? `${GROUPS[sq.group!].name}グループの土地` : sq.kind === 'tourist' ? '観光地' : KIND_LABEL[sq.kind];
    body.append(el('p', 'detail-kind', kindText));

    // 特殊マスは効果の説明だけ
    if (sq.kind !== 'land' && sq.kind !== 'tourist') {
      if (SPECIAL_TEXT[sq.kind]) body.append(el('p', 'detail-desc', SPECIAL_TEXT[sq.kind]!));
      const here = s.players.filter((p) => !p.bankrupt && p.position === i);
      if (here.length) {
        body.append(el('p', 'detail-desc', `いまここにいる人：${here.map((p) => p.name).join('・')}`));
      }
      return;
    }

    const rows = el('dl', 'detail-rows');
    const row = (label: string, value: Node | string) => {
      const div = el('div');
      const dd = el('dd');
      if (typeof value === 'string') dd.textContent = value;
      else dd.append(value);
      div.append(el('dt', '', label), dd);
      rows.append(div);
    };
    const ownerSpan = (id: number) => {
      const span = el('span', 'detail-owner');
      const dot = el('span', 'dot');
      dot.style.setProperty('--c', s.players[id].color);
      span.append(dot, id === this.human ? `${s.players[id].name}（あなた）` : s.players[id].name);
      return span;
    };

    row('所有者', prop ? ownerSpan(prop.owner) : '空き地');
    if (sq.kind === 'land') row('建物', prop ? LEVEL_NAMES[prop.level] : '—');
    row('土地価格', fmt(landPrice(i)));
    if (prop) {
      row('投資総額', fmt(investedValue(s, i)));
      if (prop.owner !== s.current) {
        row('買収価格', LEVEL.LANDMARK === prop.level ? '買収できない（ランドマーク）' : `${fmt(buyoutPrice(s, i))}（${s.players[s.current].name}が買収する場合）`);
      }
      if (isProtected(s, i)) row('聖域の紋章', `あと${(prop.protectedUntil ?? s.turn) - s.turn + 1}ターン買収されない`);
      if (s.festivals.includes(i)) row('祭り', '開催中（通行料アップ）');
    }
    body.append(rows);

    // 通行料とその内訳
    if (prop) {
      const rent = el('div', 'detail-rent');
      const total = el('p', 'rent-total');
      total.append('いま止まると通行料 ', el('strong', '', fmt(rentOf(s, i))));
      rent.append(total);
      const steps = this.rentSteps(s, sq);
      if (steps.length) {
        const ul = el('ul', 'rent-steps');
        for (const t of steps) ul.append(el('li', '', t));
        rent.append(ul);
      }
      body.append(rent);
    }

    // 色グループ／観光地の所有状況
    const status = el('div', 'detail-group');
    if (sq.kind === 'land') {
      const squares = GROUP_SQUARES[sq.group!];
      status.append(el('span', 'detail-group-label', `${GROUPS[sq.group!].name}グループ`));
      for (const x of squares) {
        const chip = el('span', 'sq-chip');
        const xp = s.properties[x];
        const dot = el('span', 'dot');
        dot.style.setProperty('--c', xp ? s.players[xp.owner].color : 'rgba(128,128,128,.45)');
        chip.append(dot, BOARD[x].name);
        if (x === i) chip.classList.add('self');
        status.append(chip);
      }
      if (prop) {
        const n = squares.filter((x) => s.properties[x]?.owner === prop.owner).length;
        status.append(
          el('span', 'detail-group-note', n >= squares.length ? '独占中！' : `${s.players[prop.owner].name} は ${n}/${squares.length}（あと${squares.length - n}つで独占）`),
        );
      }
    } else {
      status.append(el('span', 'detail-group-label', '観光地'));
      for (const x of TOURIST_SQUARES) {
        const chip = el('span', 'sq-chip');
        const xp = s.properties[x];
        const dot = el('span', 'dot');
        dot.style.setProperty('--c', xp ? s.players[xp.owner].color : 'rgba(128,128,128,.45)');
        chip.append(dot, BOARD[x].name);
        if (x === i) chip.classList.add('self');
        status.append(chip);
      }
      if (prop) {
        const n = touristCount(s, prop.owner);
        const note =
          s.touristClaim === prop.owner
            ? `守り切り中（${n}/${TOURIST_SQUARES.length}）`
            : `${s.players[prop.owner].name} は ${n}/${TOURIST_SQUARES.length}（あと${TOURIST_SQUARES.length - n}つで独占）`;
        status.append(el('span', 'detail-group-note', note));
      }
    }
    body.append(status);
  }

  private renderCenter(s: GameState, x: ViewExtras, myTurn: boolean) {
    const c = this.centerEl;
    c.replaceChildren();
    this.dockEl.replaceChildren();
    // お知らせと操作パネルの置き場所：盤面が大きければ中央、小さければ横の列（スマホでは盤面の下）
    this.compact = this.boardEl.clientWidth < View.COMPACT_BOARD;
    const host = this.compact ? this.dockEl : c;
    c.append(el('h1', 'title', 'ファンタジーすごろく'));
    c.append(el('p', 'turn', `ターン ${s.turn} / ${s.maxTurns}`));

    if (s.phase.kind === 'gameover') {
      host.append(this.resultPanel(s, x));
      return;
    }

    const me = s.players[s.current];
    const isCpu = me.id !== x.human;
    const whose = el('p', 'whose');
    if (s.phase.kind === 'react' && s.phase.responder !== s.current) {
      whose.classList.add('interrupt');
    }
    if (!isCpu) whose.classList.add('mine');
    const dot = el('span', 'dot');
    dot.style.setProperty('--c', me.color);
    whose.append(dot, isCpu ? `${me.name} の番（CPU）` : `${me.name} の番`);
    c.append(whose);
    c.append(this.orderBar(s, x));

    c.append(this.dice(x));

    // いちばん新しい出来事を大きく出す（ログを追わなくても流れが分かるように）
    const banner = this.eventBanner(s, x);
    if (banner) c.append(banner);

    // CPU の一言（演出中も出す）
    // カードの結果が同じ人のものなら、吹き出しの下にまとめて場所を節約する
    const merged = !!x.speech && !x.busy && !!s.lastCard && s.lastCard.player === x.speech.player;
    if (x.speech && !this.pendingCard && !this.pendingFly && !this.tradeDraft) host.append(this.speechBubble(s, x.speech, merged ? s.lastCard : null));

    // 観光地の守り切り中は、ずっと知らせる
    if (s.touristClaim !== null && !this.pendingCard && !this.pendingFly && !this.tradeDraft) {
      const c = s.players[s.touristClaim];
      const mine = c.id === x.human;
      host.append(
        el(
          'p',
          'notice claim',
          mine
            ? `観光地を${TOURIST_SQUARES.length}つ揃えました。次のあなたの番まで守り切れば勝利です`
            : `${c.name} が観光地を${TOURIST_SQUARES.length}つ揃えた！ 次の ${c.name} の番までに1つ買収しないと負けです`,
        ),
      );
    }

    // 直前の出来事（カード・支払い・ゾロ目）。カードの対象や取引を選んでいる間は、場所を空けるために出さない
    if (!x.busy && !this.pendingCard && !this.pendingFly && !this.tradeDraft) {
      const ph = s.phase.kind;
      if (s.lastMission) host.append(this.missionNotice(s));
      if (s.lastCard && !merged) host.append(this.cardNotice(s));
      if (s.lastPayment && ph !== 'buyout') host.append(this.paymentNotice(s));
      if (ph === 'roll' && s.doublesInRow > 0) host.append(el('p', 'notice', 'ゾロ目！ もう一度振れます'));
    }

    const panel = this.pendingFly
      ? this.flyPanel()
      : this.tradeDraft
        ? this.tradePanel(s)
        : this.pendingCard
          ? this.cardTargetPanel(s, this.pendingCard)
          : this.phasePanel(s, myTurn);
    if (panel) host.append(panel);

    // 盤面の中央に収まりきらないとき：まず前の人のカードのお知らせを省き、それでもあふれるなら横の列へ移す
    if (host === c && c.scrollHeight > c.clientHeight + 1) {
      const card = c.querySelector(':scope > .card-notice:not(.mission)');
      if (card && s.lastCard && s.lastCard.player !== s.current) card.remove();
      if (c.scrollHeight > c.clientHeight + 1) {
        const keep = new Set(['title', 'turn', 'whose', 'dice', 'event-banner']);
        for (const node of [...c.children]) {
          if (![...node.classList].some((k) => keep.has(k))) this.dockEl.append(node);
        }
      }
    }
  }

  /** このターンの順番（今動いている人を強調、終わった人は薄く） */
  private orderBar(s: GameState, x: ViewExtras): HTMLElement {
    const order = roundOrder(s.turn, s.players.length).filter((id) => !s.players[id].bankrupt);
    const at = order.indexOf(s.current);
    const bar = el('ol', 'order-bar');
    bar.setAttribute('aria-label', 'このターンの順番');
    order.forEach((id, k) => {
      const p = s.players[id];
      const li = el('li', k === at ? 'now' : k < at ? 'done' : '');
      li.style.setProperty('--c', p.color);
      li.append(el('span', 'dot'), id === x.human ? `${p.name}（あなた）` : p.name);
      bar.append(li);
    });
    return bar;
  }

  /** 天翔の行き先を選ぶ画面 */
  private flyPanel(): HTMLElement {
    const panel = el('div', 'panel');
    panel.append(el('h3', '', '天翔'));
    panel.append(el('p', '', '飛んでいくマスを盤面から選んでください。始まりの門を越えると給料がもらえます。'));
    const actions = el('div', 'actions');
    const cancel = el('button', 'btn quiet', 'やめる');
    cancel.addEventListener('click', this.cancelCard);
    actions.append(cancel);
    panel.append(actions);
    return panel;
  }

  /** 土地の取引の提示を作る画面（相手 → 欲しい土地 → 対価の土地と金額） */
  private tradePanel(s: GameState): HTMLElement {
    const me = s.players[s.current];
    const d = this.tradeDraft!;
    const panel = el('div', 'panel');
    panel.append(el('h3', '', '土地の取引'));
    panel.append(el('p', '', '相手の土地1つを指名して、自分の土地とお金で交換を持ちかけます。成立すると、土地は建物ごと持ち主が移ります。'));

    const rerender = () => {
      if (this.last) this.render(...this.last);
    };
    // 価値の目安は、相手にとっての価値でそろえて見せる
    const valueTo = (sq: number) => tradeValueOf(s, sq, d.to);

    // 相手の選択
    panel.append(el('h4', 'trade-head', '相手'));
    const oppList = el('ul', 'choice-list');
    for (const p of s.players) {
      if (p.id === me.id || p.bankrupt || ownedSquares(s, p.id).length === 0) continue;
      const li = el('li');
      const b = el('button');
      if (p.id === d.to) b.classList.add('selected');
      b.append(el('span', '', p.name), el('span', 'cost', `土地 ${ownedSquares(s, p.id).length}・総資産 ${fmt(totalAssets(s, p.id))}`));
      b.addEventListener('click', () => {
        d.to = p.id;
        d.want = null;
        rerender();
      });
      li.append(b);
      oppList.append(li);
    }
    panel.append(oppList);

    // 欲しい土地
    panel.append(el('h4', 'trade-head', '欲しい土地'));
    const wantList = el('ul', 'choice-list');
    for (const sq of ownedSquares(s, d.to)) {
      const prop = s.properties[sq];
      const li = el('li');
      const b = el('button');
      if (sq === d.want) b.classList.add('selected');
      b.append(
        el('span', '', BOARD[sq].name),
        el('span', 'cost', `${isTourist(sq) ? '観光地' : LEVEL_NAMES[prop.level]}・価値 ${fmt(valueTo(sq))}`),
      );
      b.addEventListener('click', () => {
        d.want = sq;
        rerender();
      });
      li.append(b);
      wantList.append(li);
    }
    panel.append(wantList);

    // 対価に出す自分の土地（複数選択）
    panel.append(el('h4', 'trade-head', '対価に出す自分の土地（任意・複数可）'));
    const mine = ownedSquares(s, me.id);
    if (!mine.length) {
      panel.append(el('p', 'hint', '自分の土地は持っていないので、対価はお金だけになります'));
    } else {
      const giveList = el('ul', 'choice-list');
      for (const sq of mine) {
        const prop = s.properties[sq];
        const on = d.give.includes(sq);
        const li = el('li');
        const b = el('button');
        if (on) b.classList.add('selected');
        b.append(
          el('span', '', `${on ? '✓ ' : ''}${BOARD[sq].name}`),
          el('span', 'cost', `${isTourist(sq) ? '観光地' : LEVEL_NAMES[prop.level]}・価値 ${fmt(valueTo(sq))}`),
        );
        b.addEventListener('click', () => {
          d.give = on ? d.give.filter((x) => x !== sq) : [...d.give, sq];
          rerender();
        });
        li.append(b);
        giveList.append(li);
      }
      panel.append(giveList);
    }

    // 対価のお金
    const actions = el('div', 'actions');
    const offer = el('button', 'btn', '取引を持ちかける');
    const syncOffer = () => {
      offer.disabled = d.want === null || (d.give.length === 0 && d.money <= 0) || d.money > me.money;
    };
    const summary = el('p', 'trade-summary');
    const updateSummary = () => {
      const giveTotal = d.give.reduce((sum, sq) => sum + valueTo(sq), 0) + d.money;
      summary.textContent =
        d.want === null
          ? `あなたの対価の価値：${fmt(giveTotal)}（欲しい土地を選んでください）`
          : `あなたの対価の価値 ${fmt(giveTotal)} ／ ${BOARD[d.want].name} の価値 ${fmt(valueTo(d.want))}（どちらも相手にとっての価値）`;
    };
    const moneyRow = el('div', 'trade-money');
    const label = el('label', '', '対価のお金');
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '50';
    input.max = String(me.money);
    input.value = String(d.money);
    input.setAttribute('aria-label', '対価のお金');
    input.addEventListener('input', () => {
      const v = Math.floor(Number(input.value) || 0);
      d.money = Math.max(0, Math.min(me.money, v));
      updateSummary();
      syncOffer();
    });
    moneyRow.append(label, input, el('span', 'cost', `所持金 ${fmt(me.money)}`));
    panel.append(moneyRow);
    updateSummary();
    panel.append(summary);

    offer.title = '相手が断ることもあります';
    offer.addEventListener('click', () => {
      const o = { to: d.to, want: d.want!, give: [...d.give], money: d.money };
      this.tradeDraft = null;
      this.h.tradeOffer(o);
    });
    const cancel = el('button', 'btn quiet', 'やめる');
    cancel.addEventListener('click', this.cancelCard);
    actions.append(offer, cancel);
    syncOffer();
    panel.append(actions);
    return panel;
  }

  /** 攻めのカードの対象を選ぶ画面 */
  private cardTargetPanel(s: GameState, card: CardId): HTMLElement {
    const panel = el('div', 'panel');
    panel.append(el('h3', '', `「${CARDS[card].name}」を使う`));
    if (card === 'earthquake') {
      panel.append(el('p', '', '建物を1段階壊す土地を、盤面か一覧から選んでください。'));
      panel.append(
        this.squareList(
          earthquakeTargets(s),
          (sq) => {
            const prop = s.properties[sq];
            return `${s.players[prop.owner].name}・${LEVEL_NAMES[prop.level]}→${LEVEL_NAMES[prop.level - 1]}`;
          },
          false,
          (square) => this.h.useCard({ type: 'useCard', card, square }),
        ),
      );
    } else if (card === 'festival') {
      panel.append(el('p', '', `祭りを開く自分の土地を選んでください（通行料${this.festMult(s)}倍）。`));
      panel.append(
        this.squareList(
          festivalTargets(s),
          (sq) => `通行料 ${fmt(rentAt(sq, s.properties[sq].level))} → ${fmt(rentAt(sq, s.properties[sq].level) * this.festMult(s))}`,
          false,
          (square) => this.h.useCard({ type: 'useCard', card, square }),
        ),
      );
    } else if (card === 'growth') {
      panel.append(el('p', '', '無料で1段階上げる自分の土地を、盤面か一覧から選んでください。'));
      panel.append(
        this.squareList(
          blessingTargets(s),
          (sq) => {
            const lv = s.properties[sq].level;
            return `${LEVEL_NAMES[lv]}→${LEVEL_NAMES[lv + 1]}・通行料 ${fmt(rentAt(sq, lv + 1))}`;
          },
          false,
          (square) => this.h.useCard({ type: 'useCard', card, square }),
        ),
      );
    } else if (card === 'raid') {
      panel.append(
        el('p', '', `奪う土地を、盤面か一覧から選んでください。支払いは買収価格の${CONFIG.raidRate}倍で、持ち主には買収価格を、残りは銀行に払います。`),
      );
      panel.append(
        this.squareList(
          raidTargets(s),
          (sq) => {
            const prop = s.properties[sq];
            const lv = isTourist(sq) ? '観光地' : LEVEL_NAMES[prop.level];
            return `${s.players[prop.owner].name}・${lv}・${fmt(raidPrice(s, sq))}`;
          },
          false,
          (square) => this.h.useCard({ type: 'useCard', card, square }),
        ),
      );
    } else if (card === 'seal') {
      panel.append(el('p', '', '霧の孤島へ送る相手を選んでください。'));
      const list = el('ul', 'choice-list');
      for (const id of sealTargets(s)) {
        const p = s.players[id];
        const li = el('li');
        const b = el('button');
        b.append(el('span', '', p.name), el('span', 'cost', `総資産 ${fmt(totalAssets(s, id))}・手札 ${p.hand.length}枚`));
        b.addEventListener('click', () => this.h.useCard({ type: 'useCard', card, target: id }));
        li.append(b);
        list.append(li);
      }
      panel.append(list);
    } else if (card === 'steal') {
      panel.append(el('p', '', '手札を1枚奪う相手を選んでください（何が奪えるかは運次第です）。'));
      const list = el('ul', 'choice-list');
      for (const id of stealTargets(s)) {
        const p = s.players[id];
        const li = el('li');
        const b = el('button');
        b.append(el('span', '', p.name), el('span', 'cost', `手札 ${p.hand.length}枚・総資産 ${fmt(totalAssets(s, id))}`));
        b.addEventListener('click', () => this.h.useCard({ type: 'useCard', card, target: id }));
        li.append(b);
        list.append(li);
      }
      panel.append(list);
    } else if (card === 'sanctuary') {
      panel.append(el('p', '', `${CONFIG.sanctuaryTurns}ターンのあいだ買収・略奪の令状から守る、自分の土地を選んでください。`));
      panel.append(
        this.squareList(
          sanctuaryTargets(s),
          (sq) => `${isTourist(sq) ? '観光地' : LEVEL_NAMES[s.properties[sq].level]}・通行料 ${fmt(rentOf(s, sq))}`,
          false,
          (square) => this.h.useCard({ type: 'useCard', card, square }),
        ),
      );
    } else if (card === 'curse') {
      panel.append(el('p', '', '通行料を0にする相手の土地を、盤面か一覧から選んでください（持ち主が1周するまで続きます）。'));
      panel.append(
        this.squareList(
          curseTargets(s),
          (sq) => {
            const prop = s.properties[sq];
            return `${s.players[prop.owner].name}・${isTourist(sq) ? '観光地' : LEVEL_NAMES[prop.level]}・通行料 ${fmt(rentOf(s, sq))}`;
          },
          false,
          (square) => this.h.useCard({ type: 'useCard', card, square }),
        ),
      );
    } else if (card === 'swap') {
      if (this.pendingSource === null) {
        panel.append(el('p', '', 'まず、交換に出す自分の土地を盤面か一覧から選んでください。'));
        panel.append(
          this.squareList(
            swapGiveTargets(s),
            (sq) => `${isTourist(sq) ? '観光地' : LEVEL_NAMES[s.properties[sq].level]}・通行料 ${fmt(rentOf(s, sq))}`,
            false,
            (sq) => {
              this.pendingSource = sq;
              if (this.last) this.render(...this.last);
            },
          ),
        );
      } else {
        const give = this.pendingSource;
        panel.append(
          el('p', '', `${BOARD[give].name}（${isTourist(give) ? '観光地' : LEVEL_NAMES[s.properties[give].level]}）と入れ替える相手の土地を選んでください（同じ段階以下の土地だけ）。`),
        );
        panel.append(
          this.squareList(
            swapWantTargets(s, give),
            (sq) => {
              const prop = s.properties[sq];
              return `${s.players[prop.owner].name}・${isTourist(sq) ? '観光地' : LEVEL_NAMES[prop.level]}・通行料 ${fmt(rentOf(s, sq))}`;
            },
            false,
            (square) => this.h.useCard({ type: 'useCard', card, square, give }),
          ),
        );
        const back = el('div', 'actions');
        const bb = el('button', 'btn quiet', '出す土地を選び直す');
        bb.addEventListener('click', () => {
          this.pendingSource = null;
          if (this.last) this.render(...this.last);
        });
        back.append(bb);
        panel.append(back);
      }
    } else if (card === 'relocate') {
      if (this.pendingSource === null) {
        panel.append(el('p', '', 'まず、建物を移す元の自分の土地を盤面か一覧から選んでください。'));
        panel.append(
          this.squareList(
            relocateSources(s),
            (sq) => `${LEVEL_NAMES[s.properties[sq].level]}・通行料 ${fmt(rentOf(s, sq))}`,
            false,
            (sq) => {
              this.pendingSource = sq;
              if (this.last) this.render(...this.last);
            },
          ),
        );
      } else {
        const src = this.pendingSource;
        panel.append(el('p', '', `${BOARD[src].name} の${LEVEL_NAMES[s.properties[src].level]}の移し先（更地の自分の土地）を選んでください。`));
        panel.append(
          this.squareList(
            relocateDests(s, src),
            (sq) => `${GROUPS[BOARD[sq].group!].name}・価格 ${fmt(landPrice(sq))}`,
            false,
            (square) => this.h.useCard({ type: 'useCard', card, square, give: src }),
          ),
        );
        const back = el('div', 'actions');
        const bb = el('button', 'btn quiet', '移す元を選び直す');
        bb.addEventListener('click', () => {
          this.pendingSource = null;
          if (this.last) this.render(...this.last);
        });
        back.append(bb);
        panel.append(back);
      }
    } else if (card === 'destiny') {
      const pos = s.players[s.current].position;
      panel.append(el('p', '', `${fmt(CONFIG.destinyCost)}払って、進む数を選びます（ゾロ目扱いにはなりません）。`));
      const grid = el('div', 'sum-grid');
      for (let n = 2; n <= 12; n++) {
        const b = el('button', 'sum-btn');
        const dest = BOARD[(pos + n) % BOARD.length];
        b.append(el('span', 'n', String(n)), el('span', 'to', dest.name));
        b.title = this.tileTitle(s, dest);
        b.addEventListener('click', () => this.h.useCard({ type: 'useCard', card, sum: n }));
        grid.append(b);
      }
      panel.append(grid);
    }
    const actions = el('div', 'actions');
    const cancel = el('button', 'btn quiet', 'やめる');
    cancel.addEventListener('click', this.cancelCard);
    actions.append(cancel);
    panel.append(actions);
    return panel;
  }

  /** あなたの手札 */
  private renderHand(s: GameState, x: ViewExtras, myTurn: boolean) {
    const me = s.players[x.human];
    this.handEl.replaceChildren();
    if (s.phase.kind === 'gameover' || me.bankrupt) return;
    if (me.mission) this.handEl.append(this.missionBox(s, me.id));
    const head = el('h2', '', `あなたの手札 ${me.hand.length}/${CONFIG.handLimit}`);
    this.handEl.append(head);
    if (me.hand.length === 0) {
      this.handEl.append(el('p', 'hand-empty', '始まりの門を通過するか、運命の石碑で手に入ります'));
      return;
    }
    const discarding = myTurn && s.phase.kind === 'discard';
    const list = el('ul', 'hand-list');
    me.hand.forEach((id, index) => {
      const card = CARDS[id];
      const li = el('li', `hand-card kind-${card.kind}`);
      const top = el('div', 'hc-top');
      top.append(el('span', 'hc-name', card.name), el('span', 'hc-kind', card.kind === 'attack' ? '攻め' : '守り'));
      li.append(top, el('p', 'hc-text', card.text));
      if (discarding) {
        const b = el('button', 'btn quiet small', '捨てる');
        b.addEventListener('click', () => this.h.discard(index));
        li.append(b);
      } else if (card.kind === 'attack') {
        const check = myTurn && !this.pendingCard ? cardUsable(s, id) : null;
        const b = el('button', 'btn small', '使う');
        b.disabled = !check?.ok;
        if (check && !check.ok) b.title = check.why;
        else if (!check) b.title = 'あなたの番に、サイコロを振る前に使えます';
        b.addEventListener('click', () => this.startCard(id));
        li.append(b);
      } else {
        li.append(el('p', 'hc-note', '使える場面で確認されます'));
      }
      list.append(li);
    });
    this.handEl.append(list);
  }

  private phasePanel(s: GameState, myTurn: boolean): HTMLElement | null {
    const me = s.players[s.current];
    const phase = s.phase;
    const off = !myTurn;

    if (phase.kind === 'roll') {
      const actions = el('div', 'actions');
      if (me.islandTurns > 0) {
        const wrap = el('div', 'panel');
        wrap.append(el('h3', '', '霧の孤島'));
        wrap.append(el('p', '', `あと最大${me.islandTurns}手番動けません。ゾロ目が出れば脱出できます。`));
        const esc = el('button', 'btn', `${fmt(CONFIG.escapeFee)}払って出る`);
        const tryB = el('button', 'btn quiet', 'ゾロ目に挑戦');
        esc.disabled = off || me.money < CONFIG.escapeFee;
        tryB.disabled = off;
        esc.addEventListener('click', () => this.h.escape());
        tryB.addEventListener('click', () => this.h.roll());
        actions.append(esc, tryB);
        wrap.append(actions);
        if (myTurn) queueMicrotask(() => tryB.focus());
        return wrap;
      }
      if (me.id !== this.human) {
        const b = el('button', 'btn', 'サイコロを振る');
        b.disabled = true;
        actions.append(b);
        return actions;
      }
      // 人間の番：ゲージを止めた位置のゾーンを狙って振る
      if (myTurn) this.gaugeFrozen = null;
      const wrap = el('div', 'gauge-wrap');
      wrap.append(this.gauge());
      const b = el('button', 'btn', 'ゲージを止めて振る');
      b.disabled = off;
      b.addEventListener('click', () => {
        const pos = this.gaugePos();
        this.gaugeFrozen = pos;
        this.h.roll(View.zoneAt(pos));
      });
      actions.append(b);
      if (canFly(s)) {
        const f = el('button', 'btn quiet', '天翔で飛ぶ');
        f.disabled = off;
        f.title = CHARACTERS.garm.trait.text;
        f.addEventListener('click', () => {
          this.pendingFly = true;
          if (this.last) this.render(...this.last);
        });
        actions.append(f);
      }
      // 土地の取引：相手に土地を持っている人がいるときだけ出せる
      const tradeTargets = s.players.filter((p) => p.id !== me.id && !p.bankrupt && ownedSquares(s, p.id).length > 0);
      if (canOfferTrade(s) && tradeTargets.length) {
        const t = el('button', 'btn quiet', '土地の取引');
        t.disabled = off;
        t.title = '相手の土地を、自分の土地やお金と交換してもらう交渉ができます（1回の手番に1回まで）';
        t.addEventListener('click', () => {
          this.tradeDraft = { to: tradeTargets[0].id, want: null, give: [], money: 0 };
          if (this.last) this.render(...this.last);
        });
        actions.append(t);
      }
      wrap.append(actions);
      wrap.append(el('p', 'hint', `止めたゾーンの出目が出やすくなります（${Math.round(aimHitRateOf(me) * 100)}%）`));
      if (myTurn) queueMicrotask(() => b.focus());
      return wrap;
    }

    if (phase.kind === 'reroll') {
      const panel = el('div', 'panel');
      if (me.id !== this.human) {
        panel.append(el('h3', '', `${me.name} が時を見ています`));
        panel.append(el('p', '', '巻き戻しを使うか考えています。'));
        return panel;
      }
      const dest = BOARD[(me.position + phase.sum) % BOARD.length];
      panel.append(el('h3', '', `出目は ${phase.sum}（${phase.dice[0]}・${phase.dice[1]}）。巻き戻す？`));
      panel.append(
        el('p', '', `いまの目では ${dest.name} に止まります。時の魔導士の特性で、1周に1回だけサイコロを振り直せます（振り直した目を採用します）。`),
      );
      panel.append(this.twoButtons('振り直す', 'このまま進む', off, () => this.h.reroll(true), () => this.h.reroll(false), 'second'));
      return panel;
    }

    if (phase.kind === 'buy') {
      const sq = BOARD[phase.square];
      const panel = el('div', 'panel');
      panel.append(el('h3', '', sq.name));
      if (isTourist(phase.square)) {
        const n = touristCount(s, me.id) + 1;
        panel.append(
          el('p', '', `観光地。建物は建てられず、通行料は持っている観光地の数で上がります（買うと${n}つ目・通行料 ${fmt(CONFIG.touristRent[n])}）。`),
        );
      } else {
        panel.append(el('p', '', `${GROUPS[sq.group!].name}の空き地。どこまで建てて買うか選んでください。`));
      }
      panel.append(this.levelChoices(phase.square, buyOptions(s, phase.square), off, (lv) => this.h.buy(lv), 'buy'));
      if (!me.lapped && !isTourist(phase.square)) panel.append(el('p', 'hint', 'ホテルはスタートを1回通過してから建てられます'));
      panel.append(this.passButton('買わない', off));
      return panel;
    }

    if (phase.kind === 'build') {
      const sq = BOARD[phase.square];
      const prop = s.properties[phase.square];
      const panel = el('div', 'panel');
      panel.append(el('h3', '', sq.name));
      panel.append(el('p', '', `いまは${LEVEL_NAMES[prop.level]}（通行料 ${fmt(rentOf(s, phase.square))}）。建て増しますか？`));
      panel.append(this.levelChoices(phase.square, buildOptions(s, phase.square), off, (lv) => this.h.build(lv), 'build'));
      if (!me.lapped && prop.level < LEVEL.HOTEL) panel.append(el('p', 'hint', 'ホテルはスタートを1回通過してから建てられます'));
      panel.append(this.passButton('建てない', off));
      return panel;
    }

    if (phase.kind === 'buyout') {
      const sq = BOARD[phase.square];
      const prop = s.properties[phase.square];
      const price = buyoutPrice(s, phase.square);
      const owner = s.players[prop.owner].name;
      const panel = el('div', 'panel');
      if (s.lastPayment) panel.append(this.paymentNotice(s));
      panel.append(el('h3', '', `${sq.name} を買収する？`));
      panel.append(el('p', '', `${owner} の${LEVEL_NAMES[prop.level]}を建物ごと ${fmt(price)} で奪えます。代金は ${owner} に支払います。`));
      panel.append(this.twoButtons(`${fmt(price)}で買収する`, '買収しない', off, () => this.h.buyout(), () => this.h.pass(), 'second'));
      return panel;
    }

    if (phase.kind === 'react') {
      const responder = s.players[phase.responder];
      const panel = el('div', 'panel react');
      if (phase.responder !== this.human) {
        panel.append(el('h3', '', `${responder.name} が考えています`));
        panel.append(el('p', '', 'カードで割り込むかどうか、返事を待っています。'));
        return panel;
      }
      const ctx = phase.ctx;
      const attacker = s.players[s.current].name;
      let title = '';
      let text = '';
      let noLabel = '使わない';
      if (ctx.type === 'rent') {
        title = '天使の加護を使う？';
        text = `${s.players[ctx.owner].name} の ${BOARD[ctx.square].name} の通行料 ${fmt(ctx.rent)} を払わずに済みます。`;
        noLabel = `${fmt(ctx.rent)}を払う`;
      } else if (ctx.type === 'buyout' && phase.card === 'mirror') {
        title = '鏡の盾で跳ね返す？';
        text = `${attacker} が${ctx.raid ? '略奪の令状で' : ''}あなたの ${BOARD[ctx.square].name} を ${fmt(buyoutPrice(s, ctx.square))}${ctx.raid ? "（あなたが受け取る額）" : ""} で買収しようとしています。鏡の盾を使うと買収を防ぎ、${attacker} に通行料 ${fmt(rentOf(s, ctx.square))} をもう一度払わせます。`;
        noLabel = responder.hand.includes('barrier') ? '使わない（結界を考える）' : '買収を受け入れる';
      } else if (ctx.type === 'buyout') {
        title = '守護の結界で守る？';
        text = `${attacker} が${ctx.raid ? '略奪の令状で' : ''}あなたの ${BOARD[ctx.square].name} を ${fmt(buyoutPrice(s, ctx.square))}${ctx.raid ? "（あなたが受け取る額）" : ""} で買収しようとしています。結界を使うと買収を防げます。`;
        noLabel = '買収を受け入れる';
      } else if (ctx.type === 'earthquake') {
        title = '鏡の盾で跳ね返す？';
        text = `${attacker} があなたの ${BOARD[ctx.square].name} に地震を使いました。跳ね返すと、${attacker} の建物が1段階壊れます。`;
      } else {
        title = '鏡の盾で跳ね返す？';
        text = `${attacker} があなたに封印の鎖を使いました。跳ね返すと、${attacker} が霧の孤島へ行きます。`;
      }
      panel.append(el('h3', '', title), el('p', '', text));
      panel.append(this.twoButtons(`「${CARDS[phase.card].name}」を使う`, noLabel, off, () => this.h.react(true), () => this.h.react(false), 'first'));
      return panel;
    }

    if (phase.kind === 'puppet') {
      const roller = s.players[s.current];
      const panel = el('div', 'panel react');
      if (phase.responder !== this.human) {
        panel.append(el('h3', '', `${s.players[phase.responder].name} が糸を引くか考えています`));
        return panel;
      }
      panel.append(el('h3', '', `操り糸：${roller.name} の出目は ${phase.sum}`));
      panel.append(el('p', '', '1周に1回、出目を1つ増やすか減らせます。'));
      const list = el('ul', 'choice-list');
      const opts: (-1 | 0 | 1)[] = phase.sum > 1 ? [-1, 0, 1] : [0, 1];
      for (const d of opts) {
        const dest = (roller.position + phase.sum + d) % BOARD.length;
        const li = el('li');
        const b = el('button');
        b.append(el('span', '', d === 0 ? `${phase.sum}マス（操らない）` : `${phase.sum + d}マスにする`), el('span', 'cost', this.squareHintFor(s, dest, roller.id)));
        b.disabled = off;
        b.addEventListener('click', () => this.h.puppet(d));
        li.append(b);
        list.append(li);
      }
      panel.append(list);
      return panel;
    }

    if (phase.kind === 'push') {
      const panel = el('div', 'panel react');
      if (phase.pusher !== this.human) {
        panel.append(el('h3', '', `${s.players[phase.pusher].name} が押し出すか考えています`));
        return panel;
      }
      panel.append(el('h3', '', '剛腕：押し出す？'));
      panel.append(el('p', '', '同じマスにいる相手を、前か後ろへ1〜2マス押し出せます。押し出し先のマスの効果が相手に起きます。'));
      const list = el('ul', 'choice-list');
      for (const id of phase.targets) {
        for (const dir of PUSH_DIRS) {
          const t = s.players[id];
          const dest = (t.position + dir + BOARD.length) % BOARD.length;
          const li = el('li');
          const b = el('button');
          b.append(el('span', '', `${t.name}を${Math.abs(dir)}マス${dir < 0 ? '戻す' : '進める'}`), el('span', 'cost', this.squareHintFor(s, dest, id)));
          b.disabled = off;
          b.addEventListener('click', () => this.h.push(id, dir));
          li.append(b);
          list.append(li);
        }
      }
      panel.append(list);
      panel.append(this.passButton('押し出さない', off));
      return panel;
    }

    if (phase.kind === 'trade') {
      const o = phase.offer;
      const from = s.players[o.from];
      const to = s.players[o.to];
      const panel = el('div', 'panel react');
      if (o.to !== this.human) {
        panel.append(el('h3', '', `${to.name} が取引を考えています`));
        panel.append(el('p', '', `${from.name} が ${BOARD[o.want].name} を求めています。返事を待っています。`));
        return panel;
      }
      const wantProp = s.properties[o.want];
      panel.append(el('h3', '', `${from.name} から取引の申し出`));
      panel.append(
        el('p', '', `${from.name} は、あなたの ${BOARD[o.want].name}（${isTourist(o.want) ? '観光地' : LEVEL_NAMES[wantProp.level]}）が欲しいそうです。受けると土地は建物ごと交換されます。`),
      );
      // 渡すものと、もらうものを並べて見せる（価値はあなたにとっての値でそろえる）
      const compare = el('div', 'trade-compare');
      const giveLine = el('p');
      giveLine.append(el('span', 'tc-label', 'あなたが渡す'), `${BOARD[o.want].name}（価値 ${fmt(tradeValueOf(s, o.want, o.to))}）`);
      compare.append(giveLine);
      const getParts = o.give.map(
        (sq) => `${BOARD[sq].name}（${isTourist(sq) ? '観光地' : LEVEL_NAMES[s.properties[sq].level]}・価値 ${fmt(tradeValueOf(s, sq, o.to))}）`,
      );
      if (o.money > 0) getParts.push(fmt(o.money));
      const gainTotal = o.give.reduce((sum, sq) => sum + tradeValueOf(s, sq, o.to), 0) + o.money;
      const getLine = el('p');
      getLine.append(el('span', 'tc-label', 'あなたがもらう'), `${getParts.join(' と ')}（合計 ${fmt(gainTotal)}）`);
      compare.append(getLine);
      panel.append(compare);
      panel.append(this.twoButtons('受ける', '断る', off, () => this.h.tradeAnswer(true), () => this.h.tradeAnswer(false), 'second'));
      return panel;
    }

    if (phase.kind === 'gamble') {
      const panel = el('div', 'panel');
      if (me.id !== this.human) {
        panel.append(el('h3', '', `${me.name} が勝負するか考えています`));
        return panel;
      }
      const win = Math.round(phase.rent * CONFIG.gambleWin);
      const lose = Math.round(phase.rent * CONFIG.gambleLose);
      panel.append(el('h3', '', `大勝負：通行料 ${fmt(phase.rent)}`));
      panel.append(
        el('p', '', `サイコロ1つを振って${CONFIG.gambleWinAt}以上なら ${fmt(win)}、${CONFIG.gambleWinAt - 1}以下なら ${fmt(lose)} を払います。`),
      );
      panel.append(this.twoButtons('勝負する', `${fmt(phase.rent)}を払う`, off, () => this.h.gamble(true), () => this.h.gamble(false), 'second'));
      return panel;
    }

    if (phase.kind === 'adjust') {
      const sum = phase.sum;
      const pos = me.position;
      const panel = el('div', 'panel');
      if (me.id !== this.human) {
        panel.append(el('h3', '', `${me.name} が出目を見ています`));
        return panel;
      }
      panel.append(el('h3', '', `出目は ${sum}。追い風の羽を使う？`));
      panel.append(el('p', '', '羽を使うと、進む数を1つ増やすか減らせます。'));
      const list = el('ul', 'choice-list');
      const opts: (-1 | 0 | 1)[] = sum > 2 ? [-1, 0, 1] : [0, 1];
      for (const d of opts) {
        const dest = BOARD[(pos + sum + d) % BOARD.length];
        const li = el('li');
        const b = el('button');
        const label = d === 0 ? `${sum}マス（羽を使わない）` : `${sum + d}マス（羽を使う）`;
        b.append(el('span', '', label), el('span', 'cost', this.squareHint(s, dest.index)));
        b.disabled = off;
        b.addEventListener('click', () => this.h.adjust(d));
        li.append(b);
        list.append(li);
      }
      panel.append(list);
      return panel;
    }

    if (phase.kind === 'pick') {
      const panel = el('div', 'panel');
      if (me.id !== this.human) {
        panel.append(el('h3', '', `${me.name} がカードを選んでいます`));
        return panel;
      }
      panel.append(el('h3', '', '運命の石碑'));
      panel.append(el('p', '', 'めくれたカードから1枚選んで手札に加えます。'));
      const list = el('ul', 'card-choices');
      phase.options.forEach((id, i) => {
        const card = CARDS[id];
        const li = el('li');
        const b = el('button', `hand-card kind-${card.kind}`);
        const top = el('div', 'hc-top');
        top.append(el('span', 'hc-name', card.name), el('span', 'hc-kind', card.kind === 'attack' ? '攻め' : '守り'));
        b.append(top, el('p', 'hc-text', card.text));
        b.disabled = off;
        b.addEventListener('click', () => this.h.pick(i));
        li.append(b);
        list.append(li);
      });
      panel.append(list);
      return panel;
    }

    if (phase.kind === 'discard') {
      const panel = el('div', 'panel');
      if (me.id !== this.human) {
        panel.append(el('h3', '', `${me.name} が手札を整理しています`));
        return panel;
      }
      panel.append(el('h3', '', '手札がいっぱいです'));
      panel.append(el('p', '', `手札は${CONFIG.handLimit}枚までです。捨てるカードを手札から1枚選んでください。`));
      return panel;
    }

    if (phase.kind === 'travel') {
      const panel = el('div', 'panel');
      panel.append(el('h3', '', '転移の魔法陣'));
      panel.append(el('p', '', '行き先のマスを盤面から選んでください。始まりの門を越えると給料がもらえます。'));
      return panel;
    }

    if (phase.kind === 'festival') {
      const panel = el('div', 'panel');
      panel.append(el('h3', '', '祭りを開く'));
      panel.append(el('p', '', `自分の土地を1つ選んでください。祭りの土地は通行料が${this.festMult(s)}倍になります（祭りは1人${this.festLimit(s)}か所まで。超えると古い祭りが終わります）。`));
      panel.append(
        this.squareList(
          choiceTargets(s),
          (sq) => `通行料 ${fmt(rentOf(s, sq))} → ${fmt(rentAt(sq, s.properties[sq].level) * this.festMult(s))}`,
          off,
          (sq) => this.h.choose(sq),
        ),
      );
      return panel;
    }

    if (phase.kind === 'blessing') {
      const panel = el('div', 'panel');
      panel.append(el('h3', '', '祝福の門'));
      panel.append(el('p', '', 'ぴったり止まった祝福です。自分の土地を1つ選ぶと、無料で建物が1段階上がります。'));
      panel.append(
        this.squareList(
          blessingTargets(s),
          (sq) => {
            const lv = s.properties[sq].level;
            return `${LEVEL_NAMES[lv]}→${LEVEL_NAMES[lv + 1]}・通行料 ${fmt(rentAt(sq, lv + 1))}`;
          },
          off,
          (sq) => this.h.choose(sq),
        ),
      );
      return panel;
    }

    if (phase.kind === 'liquidate') {
      const short = phase.debt - me.money;
      const panel = el('div', 'panel');
      panel.append(el('h3', '', '土地を売って支払う'));
      const p = el('p');
      p.append('支払い ', fmt(phase.debt), '・あと ');
      p.append(el('span', 'need', fmt(short)));
      const sellRateText = me.character && CHARACTERS[me.character].trait.id === 'alchemy' ? '75%（黄金変換）' : '半分';
      p.append(` 足りない。売る土地を選んでください（売値は投資額の${sellRateText}）。`);
      panel.append(p);
      panel.append(
        this.squareList(
          ownedSquares(s, me.id),
          (sq) => `${fmt(sellValue(s, sq))}で売る`,
          off,
          (sq) => this.h.sell(sq),
        ),
      );
      return panel;
    }

    return null;
  }

  private speechBubble(s: GameState, sp: NonNullable<ViewExtras['speech']>, card: GameState['lastCard']): HTMLElement {
    const p = s.players[sp.player];
    const n = el('div', 'say');
    n.style.setProperty('--c', p.color);
    n.append(el('span', 'say-name', p.name), el('span', 'say-text', `「${sp.text}」`));
    if (card) n.append(el('span', 'say-result', `${card.title ?? (card.card ? CARDS[card.card].name : '')}：${card.text}`));
    return n;
  }

  private missionNotice(s: GameState): HTMLElement {
    const { player, mission } = s.lastMission!;
    const m = MISSIONS[mission];
    const n = el('div', 'card-notice mission');
    n.append(el('span', 'card-name', '秘密の使命 達成'), el('span', 'card-text', `${s.players[player].name}：「${m.name}」${m.text}（+${fmt(m.reward)}）`));
    return n;
  }

  /** あなたの秘密の使命と進み具合 */
  private missionBox(s: GameState, id: number): HTMLElement {
    const p = s.players[id];
    const m = MISSIONS[p.mission!];
    const box = el('div', 'mission-box' + (p.missionDone ? ' done' : ''));
    const head = el('div', 'mb-head');
    head.append(el('span', 'mb-label', '秘密の使命'), el('span', 'mb-name', m.name));
    box.append(head, el('p', 'mb-text', m.text));
    const foot = el('div', 'mb-foot');
    if (p.missionDone) {
      foot.append(el('span', 'mb-done', `達成！ ${fmt(m.reward)} を受け取りました`));
    } else {
      const { now, goal } = missionProgress(s, id, m.id);
      const money = m.id === 'rich' || m.id === 'toll';
      const bar = el('div', 'mb-bar');
      const fill = el('span');
      fill.style.width = `${Math.min(100, Math.round((100 * now) / goal))}%`;
      bar.append(fill);
      foot.append(bar, el('span', 'mb-num', money ? `${fmt(Math.min(now, goal))} / ${fmt(goal)}` : `${Math.min(now, goal)} / ${goal}`));
      foot.append(el('span', 'mb-reward', `報酬 ${fmt(m.reward)}`));
    }
    box.append(foot);
    box.title = 'ほかのプレイヤーには見えません。達成すると報酬がもらえ、全員に公開されます';
    return box;
  }

  private cardNotice(s: GameState): HTMLElement {
    const { player, card, text, title } = s.lastCard!;
    const n = el('div', `card-notice ${title || !card ? 'trait' : `kind-${CARDS[card].kind}`}`);
    n.append(el('span', 'card-name', title ?? (card ? CARDS[card].name : '')), el('span', 'card-text', `${s.players[player].name}：${text}`));
    return n;
  }

  /** 手番の人の祭りの倍率と、同時に開ける数 */
  private festMult(s: GameState): number {
    const c = s.players[s.current].character;
    return c && CHARACTERS[c].trait.id === 'festival' ? CONFIG.mishaFestivalMultiplier : CONFIG.festivalMultiplier;
  }
  private festLimit(s: GameState): number {
    return festivalLimit(s.players[s.current]);
  }

  /** player がそのマスに止まるとどうなるかの短い説明 */
  private squareHintFor(s: GameState, sq: number, player: number): string {
    const square = BOARD[sq];
    const prop = s.properties[sq];
    if (square.kind === 'land' || square.kind === 'tourist') {
      if (!prop) return `${square.name}・空き地`;
      if (prop.owner === player) return `${square.name}・本人の土地`;
      return `${square.name}・通行料 ${fmt(rentOf(s, sq))}`;
    }
    return `${square.name}・${KIND_LABEL[square.kind]}`;
  }

  /** そのマスに止まるとどうなるかの短い説明 */
  private squareHint(s: GameState, sq: number): string {
    const square = BOARD[sq];
    const prop = s.properties[sq];
    if (square.kind === 'land' || square.kind === 'tourist') {
      if (!prop) return `${square.name}・空き地 ${fmt(landPrice(sq))}`;
      if (prop.owner === s.current) return `${square.name}・自分の土地`;
      return `${square.name}・通行料 ${fmt(rentOf(s, sq))}`;
    }
    return `${square.name}・${KIND_LABEL[square.kind]}`;
  }

  /** いちばん新しいログを目立つ帯で出す。秘密の内容は本人にだけ見せる（ログと同じ扱い） */
  private eventBanner(s: GameState, x: ViewExtras): HTMLElement | null {
    const e = s.log[s.log.length - 1];
    if (!e) return null;
    const text = e.secret && e.player === x.human ? e.secret : e.text;
    const n = el('p', 'event-banner');
    const dot = el('span', 'dot');
    if (e.player !== null) {
      dot.style.setProperty('--c', s.players[e.player].color);
      n.append(dot);
    }
    n.append(text);
    return n;
  }

  private shakenFor = '';

  private paymentNotice(s: GameState): HTMLElement {
    const pay = s.lastPayment!;
    if (pay.amount >= 1000) {
      // 高額の支払いは盤面を揺らして見せ場にする（同じ支払いで二重に揺らさない）
      const sig = `${pay.payer}:${pay.payee}:${pay.amount}:${pay.square}:${s.log.length}`;
      if (this.shakenFor !== sig) {
        this.shakenFor = sig;
        this.boardEl.classList.remove('shake');
        void this.boardEl.offsetWidth;
        this.boardEl.classList.add('shake');
        window.setTimeout(() => this.boardEl.classList.remove('shake'), 550);
      }
    }
    const n = el('p', 'notice pay' + (pay.amount >= 1000 ? ' big' : ''));
    n.append(
      `${s.players[pay.payer].name} が ${s.players[pay.payee].name} に `,
      el('strong', '', fmt(pay.amount)),
      ` を支払った（${BOARD[pay.square].name}）`,
    );
    return n;
  }

  private twoButtons(
    a: string,
    b: string,
    off: boolean,
    onA: () => void,
    onB: () => void,
    focus: 'first' | 'second',
  ): HTMLElement {
    const actions = el('div', 'actions');
    const ba = el('button', 'btn', a);
    const bb = el('button', 'btn quiet', b);
    ba.disabled = bb.disabled = off;
    ba.addEventListener('click', onA);
    bb.addEventListener('click', onB);
    actions.append(ba, bb);
    if (!off) queueMicrotask(() => (focus === 'first' ? ba : bb).focus());
    return actions;
  }

  private squareList(squares: number[], detail: (sq: number) => string, off: boolean, onPick: (sq: number) => void) {
    const list = el('ul', 'choice-list');
    for (const sq of squares) {
      const li = el('li');
      const b = el('button');
      b.append(el('span', '', BOARD[sq].name), el('span', 'cost', detail(sq)));
      b.disabled = off;
      b.addEventListener('click', () => onPick(sq));
      li.append(b);
      list.append(li);
    }
    return list;
  }

  private levelChoices(
    square: number,
    options: LevelOption[],
    off: boolean,
    onPick: (level: number) => void,
    mode: 'buy' | 'build',
  ): HTMLElement {
    const list = el('ul', 'choice-list');
    let focused = false;
    for (const o of options) {
      const li = el('li');
      const b = el('button');
      const label =
        mode === 'buy' && o.level === LEVEL.VACANT ? (isTourist(square) ? '買う' : '土地だけ') : `${LEVEL_NAMES[o.level]}まで`;
      const rent = isTourist(square) ? '' : `・通行料 ${fmt(rentAt(square, o.level))}`;
      b.append(el('span', '', label), el('span', 'cost', `${fmt(o.cost)}${rent}`));
      b.disabled = off || !o.affordable;
      if (!o.affordable) b.title = 'お金が足りません';
      b.addEventListener('click', () => onPick(o.level));
      li.append(b);
      list.append(li);
      if (!focused && o.affordable && !off) {
        focused = true;
        queueMicrotask(() => b.focus());
      }
    }
    return list;
  }

  private passButton(label: string, off: boolean): HTMLElement {
    const actions = el('div', 'actions');
    const b = el('button', 'btn quiet', label);
    b.disabled = off;
    b.addEventListener('click', () => this.h.pass());
    actions.append(b);
    return actions;
  }

  private gauge(): HTMLElement {
    const g = el('div', 'gauge');
    g.setAttribute('aria-hidden', 'true');
    for (const z of ['low', 'mid', 'high'] as Aim[]) {
      const zone = el('div', 'zone');
      zone.dataset.zone = z;
      const { name, min, max } = AIM_ZONES[z];
      zone.append(el('span', 'zname', name), el('span', 'zrange', `${min}〜${max}`));
      g.append(zone);
    }
    const marker = el('div', 'marker');
    marker.style.left = `${this.gaugePos() * 100}%`;
    g.append(marker);
    return g;
  }

  private dice(x: ViewExtras): HTMLElement {
    const PIPS: Record<number, number[]> = {
      1: [4],
      2: [0, 8],
      3: [0, 4, 8],
      4: [0, 2, 6, 8],
      5: [0, 2, 4, 6, 8],
      6: [0, 2, 3, 5, 6, 8],
    };
    const wrap = el('div', 'dice');
    wrap.setAttribute('aria-live', 'polite');
    const values = x.dice ?? [1, 1];
    wrap.setAttribute('aria-label', x.dice ? `出目 ${values[0]} と ${values[1]}` : 'サイコロ');
    for (const v of values) {
      const die = el('div', 'die' + (x.rolling ? ' rolling' : ''));
      for (let k = 0; k < 9; k++) die.append(el('span', PIPS[v].includes(k) ? 'on' : ''));
      wrap.append(die);
    }
    return wrap;
  }

  private resultPanel(s: GameState, x: ViewExtras): HTMLElement {
    if (s.phase.kind !== 'gameover') throw new Error();
    const winner = s.players[s.phase.winner];
    const panel = el('div', 'panel result');
    panel.append(el('h3', '', `${winner.name} の勝利`));
    const REASON: Record<WinReason, string> = {
      assets: `${s.maxTurns}ターン終了。総資産がいちばん多いプレイヤーの勝ち`,
      survivor: 'ほかの全員が破産しました',
      triple: `色グループを${TRIPLE_GROUPS}つ独占しました（${completedGroups(s, winner.id).map((g) => GROUPS[g].name).join('・')}）`,
      tourist: `観光地を${TOURIST_SQUARES.length}つすべて揃え、次の番まで守り切りました`,
    };
    panel.append(el('p', '', REASON[s.phase.reason]));
    const ol = el('ol');
    for (const id of rankByAssets(s)) ol.append(el('li', '', `${s.players[id].name}　${fmt(totalAssets(s, id))}`));
    for (const p of s.players.filter((p) => p.bankrupt)) ol.append(el('li', '', `${p.name}　破産`));
    panel.append(ol);
    // 秘密の使命の答え合わせ
    const ms = el('ul', 'mission-reveal');
    for (const p of s.players) {
      if (!p.mission) continue;
      const m = MISSIONS[p.mission];
      const li = el('li', p.missionDone ? 'done' : '');
      li.append(el('span', 'mr-who', p.name), el('span', 'mr-what', `「${m.name}」${m.text}`), el('span', 'mr-res', p.missionDone ? '達成' : '未達成'));
      ms.append(li);
    }
    if (ms.childElementCount) {
      panel.append(el('h4', '', '秘密の使命'));
      panel.append(ms);
    }
    // 対戦の報酬（スターコインと経験値）
    if (x.reward) {
      const r = x.reward;
      const box = el('div', 'reward-box');
      box.append(el('h4', '', '対戦の報酬'));
      const coinLine = el('p', 'reward-line', `🪙 スターコイン +${r.coins}（${r.rank}位 ${r.rankCoins}${r.bonus ? ` ＋ 独占ボーナス ${r.bonus}` : ''}）`);
      box.append(coinLine);
      const leveled = r.levelAfter > r.levelBefore;
      box.append(
        el('p', 'reward-line', `${r.charName}に経験値 +${r.xp}　Lv.${r.levelBefore} → Lv.${r.levelAfter}${leveled ? '　レベルアップ！' : ''}`),
      );
      panel.append(box);
    }
    // 勝利の紙吹雪（色は勝者の色＋金などを混ぜる。位置やタイミングは決定的にばらす）
    const confetti = el('div', 'confetti');
    confetti.setAttribute('aria-hidden', 'true');
    const palette = ['#d8b25e', '#c0392b', '#3d7dd8', '#3a9a6a', '#f3ead3', winner.color];
    for (let i = 0; i < 42; i++) {
      const piece = el('i', '');
      piece.style.left = `${(i * 37 + 11) % 100}%`;
      piece.style.background = palette[i % palette.length];
      piece.style.setProperty('--d', `${((i * 29) % 20) / 10}s`);
      piece.style.setProperty('--t', `${2.6 + ((i * 13) % 14) / 10}s`);
      piece.style.setProperty('--sway', `${((i * 53) % 53) - 26}px`);
      if (i % 3 === 0) piece.style.borderRadius = '50%';
      confetti.append(piece);
    }
    panel.append(confetti);
    const again = el('button', 'btn', 'もう一度遊ぶ');
    again.addEventListener('click', () => this.h.restart());
    panel.append(again);
    queueMicrotask(() => again.focus());
    return panel;
  }

  private renderPlayers(s: GameState, x: ViewExtras) {
    this.playersEl.replaceChildren(
      ...s.players.map((p) => {
        const li = el('li', 'player');
        li.style.setProperty('--c', p.color);
        if (p.id === s.current && s.phase.kind !== 'gameover') li.classList.add('current');
        if (p.bankrupt) li.classList.add('bankrupt');
        const row = el('div', 'row');
        const name = el('span', 'pname');
        const pos = roundOrder(s.turn, s.players.length).filter((id) => !s.players[id].bankrupt).indexOf(p.id);
        if (pos >= 0) name.append(el('span', 'seat', `${pos + 1}番手`));
        name.append(p.name);
        if (p.id !== x.human) name.append(el('span', 'cpu-tag', x.labels[p.id] ? `CPU・${x.labels[p.id]}` : 'CPU'));
        else {
          name.append(el('span', 'cpu-tag you', 'あなた'));
          const myTitle = x.profile?.equipped.title ? cosmeticById(x.profile.equipped.title) : undefined;
          if (myTitle) name.append(el('span', 'title-tag', `称号「${myTitle.name}」`));
        }
        row.append(name, el('span', 'money', p.bankrupt ? '破産' : fmt(p.money)));
        li.append(row);
        if (p.character) {
          const c = CHARACTERS[p.character];
          const trait = el('div', 'trait');
          trait.append(el('span', 'trait-name', `${c.title}・${c.trait.name}`));
          if (c.rare) trait.append(el('span', 'rare-badge small', 'レア'));
          trait.append(` ${c.trait.text}`);
          li.append(trait);
          li.append(this.statRow(p.character, false, p.statsOverride ?? undefined));
        }
        if (!p.bankrupt) {
          const lands = ownedSquares(s, p.id).length;
          li.append(el('div', 'meta', `総資産 ${fmt(totalAssets(s, p.id))}・土地 ${lands}`));
          const sal = salaryFor(s, p.id);
          const salLine = el('div', 'meta', `次の給料 ${fmt(sal.total)}`);
          if (sal.rate !== 1) salLine.append(el('span', 'boost', `最下位で${sal.rate}倍`));
          salLine.title = `基本 ${fmt(sal.base)} ＋ 領地収入 ${fmt(sal.land)}（土地1つ${fmt(CONFIG.landIncomePerLand)}・建物1段階${fmt(CONFIG.landIncomePerLevel)}）`;
          li.append(salLine);
          const chips = el('div', 'chips');
          const groups = completedGroups(s, p.id).length;
          const tourists = touristCount(s, p.id);
          if (groups > 0) {
            const c = el('span', 'chip' + (groups === TRIPLE_GROUPS - 1 ? ' reach' : ''), `色独占 ${groups}/${TRIPLE_GROUPS}`);
            c.title = completedGroups(s, p.id).map((g) => GROUPS[g].name).join('・');
            chips.append(c);
          }
          if (tourists > 0) {
            const total = TOURIST_SQUARES.length;
            chips.append(el('span', 'chip' + (tourists === total - 1 ? ' reach' : ''), `観光地 ${tourists}/${total}`));
          }
          if (s.touristClaim === p.id) chips.append(el('span', 'chip reach', '守り切り中'));
          if (p.mission && p.missionDone) {
            const c = el('span', 'chip mission', `使命達成：${MISSIONS[p.mission].name}`);
            c.title = MISSIONS[p.mission].text;
            chips.append(c);
          } else if (p.mission && p.id !== x.human) {
            const c = el('span', 'chip quiet', '使命 ？');
            c.title = '秘密の使命（中身はわかりません）';
            chips.append(c);
          }
          if (p.id !== x.human) chips.append(el('span', 'chip quiet', `手札 ${p.hand.length}枚`));
          if (p.islandTurns > 0) chips.append(el('span', 'chip', `孤島 あと${p.islandTurns}`));
          if (p.travelPending) chips.append(el('span', 'chip', '転移待ち'));
          if (chips.childElementCount) li.append(chips);
        }
        return li;
      }),
    );
  }

  /** ステータスの小さな表示（収入●●●○○ …）。stats を渡すと育成後の値で出す */
  private statRow(id: CharacterId, big = false, stats?: Record<StatId, number>): HTMLElement {
    const row = el('dl', big ? 'stats big' : 'stats');
    for (const st of STAT_ORDER) {
      const v = (stats ?? CHARACTERS[id].stats)[st];
      const item = el('div', `stat ${v > 3 ? 'up' : v < 3 ? 'down' : ''}`);
      item.title = `${STAT_NAMES[st]} ${v}：${STAT_TEXT[st]}`;
      const pips = el('dd', 'pips');
      const pipsMax = Math.max(5, v);
      for (let i = 1; i <= pipsMax; i++) pips.append(el('span', i <= v ? 'on' : ''));
      item.append(el('dt', '', STAT_NAMES[st]), pips);
      row.append(item);
    }
    return row;
  }

  /** 起動直後のタイトル画面。「はじめる」でキャラ選びへ進む */
  showTitle(host: HTMLElement, onStart: () => void, profile?: Profile | null, nav?: { onGacha: () => void; onCollection: () => void }) {
    this.closeDetail();
    host.replaceChildren();
    host.hidden = false;
    // 装備中のタイトルテーマを反映（テーマは2種とも専用クラス）
    host.classList.remove('theme-sunset', 'theme-night');
    const theme = profile?.equipped.theme;
    if (theme === 'theme-sunset' || theme === 'theme-night') host.classList.add(theme);
    const wrap = el('div', 'title-wrap');
    wrap.append(el('p', 'title-kicker', 'すごろく型・資産ゲーム'));
    const logo = el('h1', 'title-logo');
    logo.append(el('span', 'logo-line', 'ファンタジー'), el('span', 'logo-line logo-line-2', 'すごろく'));
    wrap.append(logo);
    wrap.append(el('p', 'title-tagline', '土地を買って、建てて、独占を狙え。'));
    if (profile) wrap.append(el('p', 'title-coins', `🪙 スターコイン ${profile.coins.toLocaleString('ja-JP')}`));
    const myTitle = profile?.equipped.title ? cosmeticById(profile.equipped.title) : undefined;
    if (myTitle) wrap.append(el('p', 'title-honor', `称号「${myTitle.name}」`));
    const icons = el('p', 'title-icons');
    icons.append(el('span', '', '🎲'), el('span', '', '🏰'), el('span', '', '🪙'));
    wrap.append(icons);
    const startBtn = el('button', 'title-start', 'ゲームをはじめる');
    startBtn.addEventListener('click', () => {
      host.hidden = true;
      onStart();
    });
    wrap.append(startBtn);
    if (nav) {
      const navRow = el('div', 'title-nav');
      const gachaBtn = el('button', 'title-sub', '🎰 ガチャ');
      gachaBtn.addEventListener('click', () => {
        host.hidden = true;
        nav.onGacha();
      });
      const colBtn = el('button', 'title-sub', '📖 コレクション');
      colBtn.addEventListener('click', () => {
        host.hidden = true;
        nav.onCollection();
      });
      navRow.append(gachaBtn, colBtn);
      wrap.append(navRow);
    }
    const howBtn = el('button', 'title-how', 'あそびかた');
    const how = el('div', 'title-rules');
    how.hidden = true;
    const rules = [
      'あなたとCPU3人の4人対戦。30ターンで決着します。',
      'ゲージを止めてサイコロを振り、止まった土地を買って建物を建てよう。',
      '他人の土地に止まると通行料。同じ色の土地を揃えると独占ボーナス！',
      '色グループ3つの独占・観光地4つの独占・最後の1人になると即勝利。',
      '手札カードと、あなただけの「秘密の使命」（達成で+1,000G）を使いこなそう。',
    ];
    const ul = el('ul', 'title-rule-list');
    for (const r of rules) ul.append(el('li', '', r));
    how.append(ul);
    howBtn.addEventListener('click', () => {
      how.hidden = !how.hidden;
    });
    wrap.append(howBtn, how);
    wrap.append(el('p', 'title-foot', '© AGameLab'));
    host.append(wrap);
  }

  /** ゲーム開始前のキャラ選び。profile があれば未所持キャラをロックし、所持キャラにレベルを出す */
  showCharacterSelect(host: HTMLElement, onPick: (id: CharacterId) => void, profile?: Profile | null) {
    this.closeDetail();
    host.replaceChildren();
    host.hidden = false;
    const wrap = el('div', 'select-wrap');
    wrap.append(el('h1', 'select-title', 'ファンタジーすごろく'));
    wrap.append(el('p', 'select-lead', '一緒に旅をするキャラクターを選んでください。残りの中から3人がCPUとして参加します。'));
    const note = el('p', 'select-note');
    note.append('ステータスは合計がみんな同じで、3が標準です。ゲーム開始時に、自分だけに見える「秘密の使命」が1枚配られます。');
    wrap.append(note);
    const makeGrid = () => el('ul', 'select-grid');
    const grid = makeGrid();
    const rareGrid = makeGrid();
    let shown = 0;
    for (const c of CHARACTER_LIST) {
      const li = el('li');
      const owned = !profile || ownsChar(profile, c.id);
      const frame = profile?.equipped.frame;
      const card = el('button', 'char-card' + (c.rare ? ' rare' : '') + (owned ? '' : ' locked') + (frame ? ` ${frame}` : ''));
      card.style.setProperty('--c', c.color);
      card.style.animationDelay = `${shown++ * 45}ms`;
      const head = el('div', 'char-head');
      const emblem = el('span', 'char-emblem', c.name.slice(0, 1));
      emblem.setAttribute('aria-hidden', 'true');
      const nameBox = el('div', 'char-namebox');
      nameBox.append(el('span', 'char-title', c.title), el('span', 'char-name', c.name));
      head.append(emblem, nameBox);
      if (c.rare) head.append(el('span', 'rare-badge', '★レア'));
      if (profile && owned) {
        const lb = profile.limitBreak[c.id] ?? 0;
        head.append(el('span', 'char-level', `Lv.${levelOf(profile, c.id)}${lb > 0 ? ` ★${lb}` : ''}`));
      }
      const trait = el('div', 'char-trait');
      trait.append(el('span', 'trait-name', c.trait.name), el('span', 'trait-text', c.trait.text));
      card.append(head, this.statRow(c.id, true, profile && owned ? grownStats(c.id, levelOf(profile, c.id)) : undefined), trait);
      if (owned) {
        card.addEventListener('click', () => {
          host.hidden = true;
          onPick(c.id);
        });
      } else {
        card.disabled = true;
        card.append(el('p', 'char-lock', '🔒 ガチャで解放'));
      }
      li.append(card);
      (c.rare ? rareGrid : grid).append(li);
    }
    wrap.append(grid);
    const rareHead = el('div', 'select-rare-head');
    rareHead.append(el('h2', '', 'レアキャラ'), el('p', '', '特性が強く、ほかのプレイヤーに直接手を出せるキャラです。CPUとして出てくることもあります。'));
    wrap.append(rareHead, rareGrid);
    host.append(wrap);
    queueMicrotask(() => (grid.querySelector('button:not(:disabled)') as HTMLButtonElement | null)?.focus());
  }

  /** ガチャ画面。回す→光る→結果、の短い演出つき */
  showGacha(host: HTMLElement, profile: Profile, h: GachaHandlers) {
    this.closeDetail();
    host.replaceChildren();
    host.hidden = false;
    let current = profile;
    let rolling = false;
    const wrap = el('div', 'select-wrap gacha-wrap');
    host.append(wrap);

    const resultCard = (r: GachaResult, i: number): HTMLElement => {
      const card = el('div', 'gacha-card' + (isRareResult(r) ? ' rare' : '') + (r.kind === 'newChar' ? ' new' : ''));
      card.style.animationDelay = `${i * 90}ms`;
      if (r.kind === 'newChar' || r.kind === 'limitBreak') {
        const c = CHARACTERS[r.charId];
        const emblem = el('span', 'char-emblem', c.name.slice(0, 1));
        emblem.style.setProperty('--c', c.color);
        emblem.style.background = c.color;
        card.append(emblem, el('p', 'gacha-name', `${c.title} ${c.name}`));
        if (r.kind === 'newChar') card.append(el('span', 'gacha-badge new', 'NEW!'));
        else card.append(el('span', 'gacha-badge', `限界突破 ★${current.limitBreak[r.charId] ?? 0}`));
        if (c.rare) card.append(el('span', 'gacha-badge rare', '★レア'));
      } else if (r.kind === 'cosmetic') {
        const item = cosmeticById(r.cosmeticId)!;
        const icon = { frame: '🖼️', title: '🎖️', pawn: '♟️', theme: '🌆' }[item.kind];
        card.append(el('span', 'gacha-icon', icon), el('p', 'gacha-name', item.name));
        card.append(el('span', 'gacha-badge new', 'NEW!'));
        if (item.rare) card.append(el('span', 'gacha-badge rare', '★レア'));
      } else {
        card.append(el('span', 'gacha-icon', '🪙'), el('p', 'gacha-name', `スターコイン +${r.amount}`));
      }
      return card;
    };

    const render = (results: GachaResult[] | null) => {
      wrap.replaceChildren();
      wrap.append(el('h1', 'select-title', 'ガチャ'));
      wrap.append(
        el('p', 'select-lead', 'スターコインで引く、キャラと見た目アイテムのガチャ。所持済みのキャラは限界突破に、行き先のない景品はコインになります。'),
      );
      const status = el('p', 'gacha-status', `🪙 スターコイン ${current.coins.toLocaleString('ja-JP')}`);
      const missing = unownedChars(current).length;
      status.append(
        missing > 0
          ? el('span', '', `　未所持キャラ あと${missing}人 ／ 天井（未所持キャラ確定）まで あと${PITY_LIMIT - current.pity}回`)
          : el('span', '', '　全キャラ解放済み！'),
      );
      wrap.append(status);
      if (rolling) {
        wrap.append(el('div', 'gacha-rolling', '✨'));
      } else if (results) {
        const grid = el('div', results.length > 1 ? 'gacha-grid' : 'gacha-grid single');
        results.forEach((r, i) => grid.append(resultCard(r, i)));
        wrap.append(grid);
      }
      const btns = el('div', 'gacha-btns');
      const one = el('button', 'title-start', '1回引く（100）');
      const ten = el('button', 'title-start', '10連引く（1000）');
      one.disabled = rolling || current.coins < 100;
      ten.disabled = rolling || current.coins < 1000;
      const pull = (count: 1 | 10) => {
        if (rolling) return;
        const out = h.draw(count);
        if (!out) return;
        rolling = true;
        render(null);
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.setTimeout(() => {
          rolling = false;
          current = out.profile;
          render(out.results);
        }, reduce ? 60 : 1100);
      };
      one.addEventListener('click', () => pull(1));
      ten.addEventListener('click', () => pull(10));
      btns.append(one, ten);
      wrap.append(btns);
      const back = el('button', 'title-how', 'タイトルへもどる');
      back.addEventListener('click', () => {
        host.hidden = true;
        h.back();
      });
      wrap.append(back);
    };
    render(null);
  }

  /** コレクション画面。見た目アイテムの装備と、所持キャラのレベル確認ができる */
  showCollection(host: HTMLElement, profile: Profile, h: CollectionHandlers) {
    this.closeDetail();
    host.replaceChildren();
    host.hidden = false;
    let current = profile;
    const wrap = el('div', 'select-wrap');
    host.append(wrap);

    const render = () => {
      wrap.replaceChildren();
      wrap.append(el('h1', 'select-title', 'コレクション'));
      wrap.append(el('p', 'select-lead', `🪙 スターコイン ${current.coins.toLocaleString('ja-JP')}　集めた見た目アイテムと、育てたキャラの一覧です。`));
      for (const kind of ['frame', 'title', 'pawn', 'theme'] as CosmeticKind[]) {
        wrap.append(el('h2', 'collection-head', COSMETIC_KIND_NAMES[kind]));
        const list = el('ul', 'collection-list');
        for (const item of COSMETIC_LIST.filter((c) => c.kind === kind)) {
          const li = el('li', 'collection-item');
          const owned = current.ownedCosmetics.includes(item.id);
          const equipped = current.equipped[kind] === item.id;
          const nameBox = el('div', 'collection-name');
          nameBox.append(el('span', 'collection-item-name', item.name));
          if (item.rare) nameBox.append(el('span', 'rare-badge small', '★レア'));
          nameBox.append(el('span', 'collection-text', item.text));
          li.append(nameBox);
          if (!owned) li.append(el('span', 'collection-locked', '未所持（ガチャで入手）'));
          else if (equipped) {
            const off = el('button', 'btn small', '装備中（外す）');
            off.addEventListener('click', () => {
              current = h.equip(kind, null);
              render();
            });
            li.append(off);
          } else {
            const on = el('button', 'btn small', '装備する');
            on.addEventListener('click', () => {
              current = h.equip(kind, item.id);
              render();
            });
            li.append(on);
          }
          list.append(li);
        }
        wrap.append(list);
      }
      wrap.append(el('h2', 'collection-head', 'キャラクター'));
      const grid = el('ul', 'select-grid');
      for (const c of CHARACTER_LIST) {
        const owned = ownsChar(current, c.id);
        const li = el('li');
        const card = el('div', 'char-card mini' + (c.rare ? ' rare' : '') + (owned ? '' : ' locked'));
        card.style.setProperty('--c', c.color);
        const head = el('div', 'char-head');
        const emblem = el('span', 'char-emblem', c.name.slice(0, 1));
        emblem.setAttribute('aria-hidden', 'true');
        const nameBox = el('div', 'char-namebox');
        nameBox.append(el('span', 'char-title', c.title), el('span', 'char-name', c.name));
        head.append(emblem, nameBox);
        if (c.rare) head.append(el('span', 'rare-badge', '★レア'));
        card.append(head);
        if (owned) {
          const prog = xpProgress(current, c.id);
          const lb = current.limitBreak[c.id] ?? 0;
          const line =
            prog.nextAt === null
              ? `Lv.${prog.level}（上限）${lb > 0 ? `　限界突破 ★${lb}` : ''}`
              : `Lv.${prog.level}${lb > 0 ? `　限界突破 ★${lb}` : ''}　経験値 ${prog.xp} / 次のレベルまで ${prog.nextAt}`;
          card.append(el('p', 'char-progress', line));
        } else {
          card.append(el('p', 'char-lock', '🔒 ガチャで解放'));
        }
        li.append(card);
        grid.append(li);
      }
      wrap.append(grid);
      const back = el('button', 'title-how', 'タイトルへもどる');
      back.addEventListener('click', () => {
        host.hidden = true;
        h.back();
      });
      wrap.append(back);
    };
    render();
  }

  private renderLog(s: GameState, x: ViewExtras) {
    // ゲームのログに、CPU の一言を言った位置で差し込む
    type Row = { player: number | null; text: string; say?: boolean };
    const rows: Row[] = [];
    let k = 0;
    const says = x.sayLog;
    s.log.forEach((e, i) => {
      while (k < says.length && says[k].at <= i) rows.push({ player: says[k].player, text: `「${says[k++].text}」`, say: true });
      // 引いたカードの名前などは本人にだけ見せる
      rows.push({ player: e.player, text: e.secret && e.player === x.human ? e.secret : e.text });
    });
    while (k < says.length) rows.push({ player: says[k].player, text: `「${says[k++].text}」`, say: true });
    const items = rows.slice(-90).reverse();
    this.logEl.replaceChildren(
      ...items.map((e, idx) => {
        const li = el('li', (e.say ? 'say-log' : '') + (idx === 0 ? ' latest' : ''));
        const dot = el('span', 'dot');
        if (e.player !== null) dot.style.setProperty('--c', s.players[e.player].color);
        li.append(dot, e.say && e.player !== null ? `${s.players[e.player].name}${e.text}` : e.text);
        return li;
      }),
    );
  }
}
