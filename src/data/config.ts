// 経済バランスの初期値。数値は後で自動対戦シミュレーションで調整する。

/** 建物の段階。0 = 更地 */
export const LEVEL = { VACANT: 0, VILLA: 1, BUILDING: 2, HOTEL: 3, LANDMARK: 4 } as const;
export const LEVEL_NAMES = ['更地', '別荘', 'ビル', 'ホテル', 'ランドマーク'] as const;

export const CONFIG = {
  initialMoney: 3000,
  /** 席ごとの最初のお金の上乗せ（後の席ほど不利なので埋め合わせる） */
  seatBonus: [0, 0, 0, 0] as readonly number[],
  /** 1周目（始まりの門を通過するまで）に建てられる最高段階。席ごと（1番手から順に） */
  firstLapCap: [2, 2, 2, 2] as readonly number[],
  /** 手番の回り方。fixed = 毎ターン同じ順、rotate = ターンごとに先頭が1人ずつずれる、snake = ターンごとに逆順 */
  turnOrder: 'rotate' as 'fixed' | 'rotate' | 'snake',
  salary: 300,
  /** 領地収入：給料に、土地1つごと・建物1段階ごとに足す額 */
  landIncomePerLand: 30,
  landIncomePerLevel: 30,
  /** 総資産の順位が下の人の給料倍率（[最下位, 下から2番目, …]。首位と同点の人にはかからない） */
  rankSalaryRates: [2] as readonly number[],
  maxTurns: 30,
  /** ラストスパート：残りこのターン数になると、通行料が lastSpurtRate 倍になる */
  lastSpurtTurns: 5,
  lastSpurtRate: 1.2,
  /** 各段階を建てる費用 = 土地価格 × この値（添字が段階） */
  buildCostRate: [0, 0.5, 1.0, 1.5, 2.0],
  /** 通行料 = 土地価格 × この値（添字が段階）。ホテル・ランドマークは破産の緊張感が出るよう高め */
  rentRate: [0.2, 0.6, 1.5, 3.0, 5.0],
  /** 買収価格 = 投資額 × この値（3倍は奪いにくかったので2倍に戻した） */
  buyoutRate: 2,
  /** 総資産を数えるとき、土地と建物を投資額の何割で数えるか */
  assetValueRate: 1,
  /** 銀行に売るときの売値 = 投資額 × この値 */
  sellRate: 0.5,
  /** この回数ゾロ目が続くと無人島へ */
  doublesToIsland: 3,

  /** 無人島で動けない手番の数と、脱出料 */
  islandTurns: 3,
  escapeFee: 200,
  /** 連続した土地のボーナス：同じ人の土地が盤面で n マス続いていると、通行料 ×(1 + chainBonus[n])（5マス以上は最後の値） */
  chainBonus: [0, 0, 0.3, 0.6, 1.0, 1.0] as readonly number[],
  /** 祭りの土地の通行料倍率 */
  festivalMultiplier: 2,
  /** 観光地の価格と、持っている数ごとの通行料（添字が所有数） */
  touristPrice: 300,
  touristRent: [0, 100, 300, 700, 1200],

  /** ゲージで狙ったゾーンの出目になる確率 */
  aimHitRate: 0.6,

  /** ステータス1段階（標準3との差1つ）ごとの補正 */
  statStep: {
    /** 給料の増減の割合 */
    income: 0.06,
    /** 建設費の増減の割合（高いほど安い） */
    build: 0.06,
    /** 買収価格の増減の割合（高いほど安い） */
    deal: 0.06,
    /** 自分の土地の通行料の増減の割合 */
    prestige: 0.05,
    /** ゲージで狙った出目になる確率の増減 */
    luck: 0.06,
  },
  /** 固有特性の数値 */
  formationRate: 2,
  mishaFestivalMultiplier: 3,
  /** 1人が同時に開ける祭りの数（祭囃子は mishaFestivals） */
  festivalsPerPlayer: 1,
  mishaFestivals: 2,
  stargazeReveal: 3,
  /** 星読みで石碑からもらえる枚数 */
  stargazePicks: 2,
  /** 天翔は、この周回数ごとに1回使える */
  skyrideLaps: 2,
  /** 天翔で飛ぶときに払う額 */
  skyrideCost: 300,
  quickhandCards: 2,
  /** 早業：始まりの門を quickhandEvery 周通過するごとに、カードを quickhandDraws 枚引く（ふつうは1枚） */
  quickhandDraws: 2,
  quickhandEvery: 2,
  /** レアキャラの特性 */
  /** 破魔：相手の守りのカードを無効にする確率 */
  pierceRate: 1,
  /** 開拓：この周回数ごとに空き地をもらう。空き地がなければこの額 */
  pioneerLaps: 1,
  pioneerFallback: 300,
  /** 剛腕：押し出した相手から受け取る額 */
  shoveFee: 300,
  /** 旋風：この周回数ごとに1回使える */
  gustEvery: 2,
  /** 大勝負：サイコロ1つでこの目以上なら勝ち。勝てば通行料×win、負ければ×lose */
  gambleWinAt: 3,
  gambleWin: 0.5,
  gambleLose: 1.25,
  /** 写し身：他人の攻めのカードを写し取る確率 */
  mimicRate: 0.25,

  /** 手札カード */
  startHand: 2,
  handLimit: 5,
  /** 運命の石碑でめくる枚数 */
  chanceReveal: 2,
  destinyCost: 400,
  /** 略奪の令状で払う額 = 買収価格 × この値（持ち主が受け取るのは買収価格まで。残りは銀行へ） */
  raidRate: 1.5,
  /** 土地の取引：色グループや観光地のセットが完成する土地の価値 = 投資額 × この値 */
  tradeCompleteRate: 1.6,
  /** 土地の取引：完成に近づく土地（グループ2つ以上・観光地あと1つ）の価値 = 投資額 × この値 */
  tradeProgressRate: 1.25,
  /** 土地の取引：相手が得をする戦略的な上乗せ分のうち、この割合を対価に求める */
  tradePremiumRate: 0.6,
  /** 土地の取引：相手の独占を完成させる土地を渡すとき、対価に求める倍率（見合う得がある取引なら課さない） */
  tradeBlockRate: 2.2,
  /** 土地の取引：すでに色グループの独占を持つ人に売るときの割増 */
  tradeRichRate: 1.8,
  /** 土地の取引：提示する側が手元に残す現金の下限（性格の reserve より優先） */
  tradeReserve: 500,
  /** 土地の取引：CPU が提示するとき、相手が受け入れそうな額にこの割合を上乗せする */
  tradeOfferRate: 1,
  /** 宝箱でもらえる額：min〜max の step 刻みからランダム。skew が 1 なら均等、大きいほど少ない額が出やすい */
  treasureMin: 200,
  treasureMax: 2000,
  treasureStep: 100,
  treasureSkew: 1,
  taxRate: 0.1,
} as const;
