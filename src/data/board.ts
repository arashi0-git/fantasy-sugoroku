// 盤面データ。マス名と価格は仕様書の初期値（仮）。

export type GroupId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';

export interface Group {
  id: GroupId;
  name: string;
  /** 土地価格（G） */
  price: number;
  /** 画面でマスを塗る色 */
  color: string;
}

export const GROUPS: Record<GroupId, Group> = {
  A: { id: 'A', name: '草原', price: 100, color: '#9cc46b' },
  B: { id: 'B', name: '森', price: 140, color: '#4f8f5a' },
  C: { id: 'C', name: '海辺', price: 180, color: '#5aa7c7' },
  D: { id: 'D', name: '砂漠', price: 220, color: '#d9a94e' },
  E: { id: 'E', name: '雪原', price: 260, color: '#a9c4d8' },
  F: { id: 'F', name: '火山', price: 300, color: '#cf5f45' },
  G: { id: 'G', name: '魔導', price: 340, color: '#8b6bc2' },
  H: { id: 'H', name: '王都', price: 400, color: '#c9a227' },
};

export type SquareKind =
  | 'start'
  | 'land'
  | 'tourist'
  | 'chance'
  | 'island'
  | 'festival'
  | 'travel';

export interface Square {
  index: number;
  name: string;
  kind: SquareKind;
  group?: GroupId;
}

type Def = [name: string, kind: SquareKind, group?: GroupId];

const DEFS: Def[] = [
  ['始まりの門', 'start'],
  ['麦畑の里', 'land', 'A'],
  ['風車の丘', 'land', 'A'],
  ['運命の石碑', 'chance'],
  ['古代樹の神殿', 'tourist'],
  ['苔むす泉', 'land', 'B'],
  ['精霊の森', 'land', 'B'],
  ['木漏れ日の砦', 'land', 'B'],
  ['霧の孤島', 'island'],
  ['漁火の港', 'land', 'C'],
  ['人魚の入江', 'land', 'C'],
  ['運命の石碑', 'chance'],
  ['沈んだ灯台', 'tourist'],
  ['砂漠の市場', 'land', 'D'],
  ['蜃気楼のオアシス', 'land', 'D'],
  ['黄金の隊商宿', 'land', 'D'],
  ['収穫祭の広場', 'festival'],
  ['氷晶の街', 'land', 'E'],
  ['雪狼の峠', 'land', 'E'],
  ['白銀の城塞', 'land', 'E'],
  ['運命の石碑', 'chance'],
  ['竜骨の谷', 'tourist'],
  ['火山の鍛冶町', 'land', 'F'],
  ['溶岩の神殿', 'land', 'F'],
  ['転移の魔法陣', 'travel'],
  ['魔法学院', 'land', 'G'],
  ['星見の塔', 'land', 'G'],
  ['賢者の書庫', 'land', 'G'],
  ['運命の石碑', 'chance'],
  ['天空の浮島', 'tourist'],
  ['王都の大聖堂', 'land', 'H'],
  ['黄金の王城', 'land', 'H'],
];

export const BOARD: Square[] = DEFS.map(([name, kind, group], index) => ({
  index,
  name,
  kind,
  group,
}));

export const BOARD_SIZE = BOARD.length; // 32
