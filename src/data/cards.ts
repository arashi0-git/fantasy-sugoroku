// 手札カード。attack = 自分の番に使う、guard = 使える場面なら相手の番でも割り込める、instant = 引いたらその場で発動。
// weight は山札での出やすさ（大きいほど出やすい）。

export type CardId =
  | 'tailwind'
  | 'destiny'
  | 'earthquake'
  | 'seal'
  | 'festival'
  | 'treasure'
  | 'growth'
  | 'raid'
  | 'steal'
  | 'swap'
  | 'sanctuary'
  | 'curse'
  | 'relocate'
  | 'angel'
  | 'barrier'
  | 'mirror'
  | 'tax'
  | 'fog';

export type CardKind = 'attack' | 'guard' | 'instant';

export interface Card {
  id: CardId;
  name: string;
  kind: CardKind;
  text: string;
  weight: number;
}

export const CARDS: Record<CardId, Card> = {
  tailwind: { id: 'tailwind', name: '追い風の羽', kind: 'attack', text: 'サイコロを振ったあと、出目を±1できる', weight: 5 },
  destiny: {
    id: 'destiny',
    name: '運命の賽',
    kind: 'attack',
    text: '400G払って、サイコロを振らずに出目の合計を2〜12から選ぶ（ゾロ目扱いにはならない・霧の孤島では使えない）',
    weight: 1.5,
  },
  earthquake: { id: 'earthquake', name: '地震', kind: 'attack', text: '他人の土地の建物を1段階壊す（ランドマークは対象外）', weight: 3 },
  seal: { id: 'seal', name: '封印の鎖', kind: 'attack', text: '他のプレイヤー1人を霧の孤島へ送る', weight: 1.5 },
  festival: { id: 'festival', name: '祭りの招待状', kind: 'attack', text: '自分の土地1つで祭りを開く（通行料2倍。祭りは1人1か所までで、新しく開くと前の祭りは終わる）', weight: 3 },
  treasure: { id: 'treasure', name: '宝箱', kind: 'attack', text: '開けると200〜2,000Gのどれかが入っている', weight: 5 },
  growth: { id: 'growth', name: '築城の詔', kind: 'attack', text: '自分の土地1つの建物を、無料で1段階上げる（1周目はビルまで）', weight: 3 },
  raid: {
    id: 'raid',
    name: '略奪の令状',
    kind: 'attack',
    text: '相手の土地か観光地を1つ選び、止まらずに買収する（買収価格の1.5倍。上乗せ分は銀行へ。ランドマークは対象外）',
    weight: 2,
  },
  steal: { id: 'steal', name: '盗賊の手', kind: 'attack', text: '相手1人の手札を1枚、ランダムに奪う（何を奪ったかは本人にだけ見える）', weight: 3 },
  swap: {
    id: 'swap',
    name: '交換の契約書',
    kind: 'attack',
    text: '自分の土地1つと、建物の段階がそれ以下の相手の土地1つを入れ替える（建物はそのまま移る）',
    weight: 1.5,
  },
  // 守るためのカードだが、使うのは自分の番（攻めのカードと同じ流れ）なので kind は attack
  sanctuary: {
    id: 'sanctuary',
    name: '聖域の紋章',
    kind: 'attack',
    text: '自分の土地1つを3ターン、買収と略奪の令状から守る',
    weight: 3,
  },
  curse: {
    id: 'curse',
    name: '呪いの刻印',
    kind: 'attack',
    text: '相手の土地1つの通行料を、持ち主が1周するあいだ0にする',
    weight: 2,
  },
  relocate: {
    id: 'relocate',
    name: '移築の書',
    kind: 'attack',
    text: '自分の建物を、別の自分の更地の土地へ移す（建物の段階はそのまま。移し先の上限を超える段階は移せない）',
    weight: 2,
  },
  angel: { id: 'angel', name: '天使の加護', kind: 'guard', text: '通行料を1回払わずに済む', weight: 3 },
  barrier: { id: 'barrier', name: '守護の結界', kind: 'guard', text: '自分の土地への買収を1回無効にする', weight: 3 },
  mirror: { id: 'mirror', name: '鏡の盾', kind: 'guard', text: '自分に向けられた地震・封印の鎖・買収を跳ね返す（買収なら、相手に通行料をもう一度払わせる）', weight: 1.5 },
  tax: { id: 'tax', name: '王の徴税', kind: 'instant', text: '所持金の10%を銀行に払う', weight: 3 },
  fog: { id: 'fog', name: '迷いの霧', kind: 'instant', text: '霧の孤島へ移動する', weight: 1.5 },
};

export const CARD_LIST: Card[] = Object.values(CARDS);
