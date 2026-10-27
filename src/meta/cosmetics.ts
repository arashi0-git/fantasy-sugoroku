// 見た目アイテム（エンブレム枠・称号・コマのスキン・タイトル画面のテーマ）。
// 対戦の強さには一切影響しない、ガチャの景品とコレクションの対象。
// 反映先：枠＝キャラ選択カード、称号＝タイトル画面とプレイヤー一覧、コマ＝盤面の自分のコマ、テーマ＝タイトル画面の背景。

export type CosmeticKind = 'frame' | 'title' | 'pawn' | 'theme';

export type CosmeticId =
  | 'frame-silver'
  | 'frame-gold'
  | 'frame-rainbow'
  | 'title-traveler'
  | 'title-negotiator'
  | 'title-rich'
  | 'title-monopolist'
  | 'title-lucky'
  | 'pawn-gold'
  | 'pawn-crystal'
  | 'pawn-shadow'
  | 'theme-sunset'
  | 'theme-night';

export interface Cosmetic {
  id: CosmeticId;
  kind: CosmeticKind;
  name: string;
  /** レアな景品（ガチャの保証枠・演出の対象） */
  rare?: boolean;
  /** どんな見た目か、コレクション画面での説明 */
  text: string;
}

export const COSMETIC_KIND_NAMES: Record<CosmeticKind, string> = {
  frame: 'エンブレム枠',
  title: '称号',
  pawn: 'コマのスキン',
  theme: 'タイトルテーマ',
};

export const COSMETICS: Record<CosmeticId, Cosmetic> = {
  'frame-silver': { id: 'frame-silver', kind: 'frame', name: '銀のエンブレム枠', text: 'キャラ選択カードの枠が銀色になる' },
  'frame-gold': { id: 'frame-gold', kind: 'frame', name: '金のエンブレム枠', rare: true, text: 'キャラ選択カードの枠が金色に輝く' },
  'frame-rainbow': { id: 'frame-rainbow', kind: 'frame', name: '虹のエンブレム枠', rare: true, text: 'キャラ選択カードの枠が虹色に流れる' },
  'title-traveler': { id: 'title-traveler', kind: 'title', name: '旅人', text: '名前の横に称号「旅人」がつく' },
  'title-negotiator': { id: 'title-negotiator', kind: 'title', name: '交渉人', text: '名前の横に称号「交渉人」がつく' },
  'title-rich': { id: 'title-rich', kind: 'title', name: '大富豪', text: '名前の横に称号「大富豪」がつく' },
  'title-monopolist': { id: 'title-monopolist', kind: 'title', name: '独占王', rare: true, text: '名前の横に称号「独占王」がつく' },
  'title-lucky': { id: 'title-lucky', kind: 'title', name: '幸運の星', rare: true, text: '名前の横に称号「幸運の星」がつく' },
  'pawn-gold': { id: 'pawn-gold', kind: 'pawn', name: '黄金のコマ', text: '盤面の自分のコマが金色に光る' },
  'pawn-crystal': { id: 'pawn-crystal', kind: 'pawn', name: '水晶のコマ', text: '盤面の自分のコマが水色に透けて光る' },
  'pawn-shadow': { id: 'pawn-shadow', kind: 'pawn', name: '影のコマ', rare: true, text: '盤面の自分のコマが影のように黒く染まる' },
  'theme-sunset': { id: 'theme-sunset', kind: 'theme', name: '夕焼けの空', text: 'タイトル画面の空が夕焼け色になる' },
  'theme-night': { id: 'theme-night', kind: 'theme', name: '星空の夜', rare: true, text: 'タイトル画面の空が星空の夜になる' },
};

export const COSMETIC_LIST: Cosmetic[] = Object.values(COSMETICS);

export function cosmeticById(id: string): Cosmetic | undefined {
  return (COSMETICS as Record<string, Cosmetic>)[id];
}
