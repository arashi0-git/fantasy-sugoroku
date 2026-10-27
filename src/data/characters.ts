// キャラクター。ステータスは5種類それぞれ1〜5で、合計は全員15（3が標準）。
// 固有特性はキャラに1つ。効果の中身はルール（core/game.ts）側に書く。

export type CharacterId =
  | 'bald'
  | 'lila'
  | 'zeno'
  | 'misha'
  | 'serena'
  | 'ord'
  | 'crow'
  | 'garm'
  | 'verre'
  | 'rosso'
  // ここからレア
  | 'tsumuji'
  | 'azuma'
  | 'noel'
  | 'garou'
  | 'karuta'
  | 'kugutsu'
  | 'echo'
  | 'chrono'
  | 'mors';

export type StatId = 'income' | 'build' | 'deal' | 'prestige' | 'luck';

export type TraitId =
  | 'merchant'
  | 'fogsight'
  | 'formation'
  | 'festival'
  | 'blessing'
  | 'stargaze'
  | 'quickhand'
  | 'skyride'
  | 'alchemy'
  | 'voyage'
  | 'gust'
  | 'pierce'
  | 'pioneer'
  | 'shove'
  | 'gamble'
  | 'puppet'
  | 'mimic'
  | 'rewind'
  | 'soulpact';

export type PersonalityId = 'bold' | 'careful' | 'schemer';

export interface Character {
  id: CharacterId;
  name: string;
  title: string;
  color: string;
  stats: Record<StatId, number>;
  trait: { id: TraitId; name: string; text: string };
  /** CPU が動かすときの性格 */
  personality: PersonalityId;
  /** レアキャラ（特性が強く、他のプレイヤーに直接手を出せる） */
  rare?: boolean;
}

export const STAT_NAMES: Record<StatId, string> = {
  income: '収入',
  build: '建築',
  deal: '交渉',
  prestige: '威光',
  luck: '幸運',
};

export const STAT_TEXT: Record<StatId, string> = {
  income: '給料が増える',
  build: '建設費が安くなる',
  deal: '買収価格が安くなる',
  prestige: '自分の土地の通行料が上がる',
  luck: 'ゲージで狙った出目が出やすくなる',
};

export const STAT_ORDER: StatId[] = ['income', 'build', 'deal', 'prestige', 'luck'];

export const CHARACTERS: Record<CharacterId, Character> = {
  bald: {
    id: 'bald',
    name: 'バルド',
    title: '豪商',
    color: '#e0902b',
    stats: { income: 3, build: 2, deal: 4, prestige: 3, luck: 3 },
    trait: { id: 'merchant', name: '商魂', text: '買収した土地を、その場で1段階無料で建て増せる' },
    personality: 'bold',
  },
  lila: {
    id: 'lila',
    name: 'リラ',
    title: '霧の魔女',
    color: '#3a9a6a',
    stats: { income: 3, build: 3, deal: 2, prestige: 3, luck: 4 },
    trait: { id: 'fogsight', name: '霧読み', text: '霧の孤島へ送られない（孤島のマス・迷いの霧・封印の鎖・ゾロ目3連続の効果を受けない）。霧の孤島に止まると、次の手番で好きなマスへ移動できる（霧渡り）' },
    personality: 'careful',
  },
  zeno: {
    id: 'zeno',
    name: 'ゼノ',
    title: '騎士',
    color: '#3d7dd8',
    stats: { income: 3, build: 4, deal: 3, prestige: 3, luck: 2 },
    trait: { id: 'formation', name: '布陣', text: '揃えた色グループの土地は、通行料が2倍になる' },
    personality: 'schemer',
  },
  misha: {
    id: 'misha',
    name: 'ミーシャ',
    title: '吟遊詩人',
    color: '#c2569b',
    stats: { income: 3, build: 3, deal: 2, prestige: 5, luck: 2 },
    trait: { id: 'festival', name: '祭囃子', text: '祭りを2か所まで同時に開け、自分の祭りは通行料3倍。始まりの門を通過するたびに、自分の土地で自動で祭りが始まる' },
    personality: 'bold',
  },
  serena: {
    id: 'serena',
    name: 'セレナ',
    title: '聖女',
    color: '#d9b84a',
    stats: { income: 3, build: 4, deal: 2, prestige: 2, luck: 4 },
    trait: { id: 'blessing', name: '祝福の声', text: '祝福の門にぴったり止まると2段階上げられる。通過したときも、自分の土地1つが無料で1段階上がる' },
    personality: 'careful',
  },
  ord: {
    id: 'ord',
    name: 'オルド',
    title: '占星術師',
    color: '#7a6fd1',
    stats: { income: 3, build: 3, deal: 3, prestige: 3, luck: 3 },
    trait: { id: 'stargaze', name: '星読み', text: '運命の石碑で、3枚めくって2枚もらえる' },
    personality: 'schemer',
  },
  crow: {
    id: 'crow',
    name: 'クロウ',
    title: '盗賊',
    color: '#5f6b7a',
    stats: { income: 4, build: 3, deal: 3, prestige: 3, luck: 2 },
    trait: { id: 'quickhand', name: '早業', text: '攻めのカードを1回の手番に2枚まで使える。始まりの門を2周通過するごとに、カードを2枚引く' },
    personality: 'bold',
  },
  garm: {
    id: 'garm',
    name: 'ガルム',
    title: '竜騎士',
    color: '#c4513b',
    stats: { income: 2, build: 3, deal: 3, prestige: 3, luck: 4 },
    trait: { id: 'skyride', name: '天翔', text: '2周に1回、300G払ってサイコロの代わりに好きなマスへ飛べる（始まりの門を越えれば給料）' },
    personality: 'schemer',
  },
  verre: {
    id: 'verre',
    name: 'ヴェル',
    title: '錬金術師',
    color: '#0e7c86',
    stats: { income: 4, build: 4, deal: 2, prestige: 3, luck: 2 },
    trait: { id: 'alchemy', name: '黄金変換', text: '土地を銀行に売るとき、通常は投資額の半額のところを、投資額の全額で売れる' },
    personality: 'bold',
  },
  rosso: {
    id: 'rosso',
    name: 'ロッソ',
    title: '海賊船長',
    color: '#2b4c7e',
    stats: { income: 4, build: 2, deal: 4, prestige: 3, luck: 2 },
    trait: { id: 'voyage', name: '大航海', text: '自分の観光地の通行料が+50%。観光地を買収するときの価格が2割引になる' },
    personality: 'bold',
  },

  // ---------- レア ----------
  tsumuji: {
    id: 'tsumuji',
    name: 'ツムジ',
    title: '風の巫女',
    color: '#5fb8a8',
    stats: { income: 3, build: 3, deal: 3, prestige: 3, luck: 3 },
    trait: { id: 'gust', name: '旋風', text: '自分と相手が同じマスに止まったとき（自分が止まっても、相手が止まってきても）、相手を自分の通行料がいちばん高い土地へ吹き飛ばす（2周に1回）' },
    personality: 'schemer',
    rare: true,
  },
  azuma: {
    id: 'azuma',
    name: 'アズマ',
    title: '破魔の剣士',
    color: '#b23a5a',
    stats: { income: 3, build: 3, deal: 4, prestige: 3, luck: 2 },
    trait: { id: 'pierce', name: '破魔', text: '相手が自分に向けて使った守りのカード（天使の加護・守護の結界・鏡の盾）を無効にする' },
    personality: 'bold',
    rare: true,
  },
  noel: {
    id: 'noel',
    name: 'ノエル',
    title: '開拓者',
    color: '#8fae3c',
    stats: { income: 3, build: 3, deal: 3, prestige: 3, luck: 3 },
    trait: { id: 'pioneer', name: '開拓', text: '始まりの門を通過するたびに、空き地を1つ無料でもらう（空き地がなければ300G）' },
    personality: 'careful',
    rare: true,
  },
  garou: {
    id: 'garou',
    name: 'ガロウ',
    title: '剛腕の闘士',
    color: '#a0682c',
    stats: { income: 3, build: 3, deal: 3, prestige: 3, luck: 3 },
    trait: { id: 'shove', name: '剛腕', text: '同じマスに止まった相手（自分が止まったときも、相手が止まってきたときも）を、前か後ろへ1〜2マス押し出し、手間賃300Gをもらう。押し出し先のマスの効果が起きる' },
    personality: 'bold',
    rare: true,
  },
  karuta: {
    id: 'karuta',
    name: 'カルタ',
    title: '賭博師',
    color: '#d14f8c',
    stats: { income: 3, build: 3, deal: 3, prestige: 3, luck: 3 },
    trait: { id: 'gamble', name: '大勝負', text: '通行料を払うとき勝負できる。サイコロ1つで3以上なら半額、2以下なら1.25倍' },
    personality: 'schemer',
    rare: true,
  },
  kugutsu: {
    id: 'kugutsu',
    name: 'クグツ',
    title: '人形使い',
    color: '#6a7fa8',
    stats: { income: 3, build: 3, deal: 3, prestige: 3, luck: 3 },
    trait: { id: 'puppet', name: '操り糸', text: '1周に1回、他のプレイヤーが振った出目を±1できる' },
    personality: 'careful',
    rare: true,
  },
  echo: {
    id: 'echo',
    name: 'エコー',
    title: '写し身',
    color: '#9a8fc9',
    stats: { income: 3, build: 3, deal: 3, prestige: 3, luck: 3 },
    trait: { id: 'mimic', name: '写し身', text: '他のプレイヤーが攻めのカードを使うと、25%で同じカードを1枚もらう' },
    personality: 'careful',
    rare: true,
  },
  chrono: {
    id: 'chrono',
    name: 'クロノ',
    title: '時の魔導士',
    color: '#6d28a8',
    stats: { income: 3, build: 3, deal: 3, prestige: 2, luck: 4 },
    trait: { id: 'rewind', name: '巻き戻し', text: '1周に1回、サイコロを振り直せる（振り直した目を採用する。霧の孤島にいるときは使えない）' },
    personality: 'schemer',
    rare: true,
  },
  mors: {
    id: 'mors',
    name: 'モルス',
    title: '死霊術師',
    color: '#374151',
    stats: { income: 2, build: 2, deal: 3, prestige: 4, luck: 4 },
    trait: { id: 'soulpact', name: '魂の抵当', text: 'ゲームに1回だけ、破産する代わりに所持金300Gで踏みとどまる（土地はそのまま）' },
    personality: 'bold',
    rare: true,
  },
};

export const CHARACTER_LIST: Character[] = Object.values(CHARACTERS);
