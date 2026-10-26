// ゲームのルール処理。画面のことは一切知らない純粋な関数だけで書く。
// applyAction(state, action) が新しい state を返す。元の state は変更しない。

import { BOARD, BOARD_SIZE, GroupId, GROUPS } from '../data/board';
import { CARD_LIST, CardId, CARDS } from '../data/cards';
import { CharacterId, CHARACTERS, StatId, TraitId } from '../data/characters';
import { CONFIG, LEVEL, LEVEL_NAMES } from '../data/config';
import { MISSION_LIST, MissionId, MISSIONS } from '../data/missions';
import { nextRandom, rollDie } from './rng';

export interface Player {
  id: number;
  name: string;
  color: string;
  money: number;
  position: number;
  bankrupt: boolean;
  /** スタートを1回以上通過したか（ホテルの建設はこれ以降） */
  lapped: boolean;
  /** スタートを通過した回数 */
  laps: number;
  /** 霧の孤島で、あと何手番動けないか（0 なら自由） */
  islandTurns: number;
  /** 転移の魔法陣に止まり、次の手番で好きなマスへ移動できる */
  travelPending: boolean;
  /** 手札（中身は本人にしか見えない前提。画面は他の人の枚数だけ出す） */
  hand: CardId[];
  /** キャラクター（なければステータスは標準・特性なし） */
  character: CharacterId | null;
  /** 天翔をもう使ったか（決まった周回数だけ始まりの門を通過すると戻る） */
  skyUsed: boolean;
  /** 天翔を使ってから通過した始まりの門の数 */
  skyLaps: number;
  /** 秘密の使命（本人にしか見えない前提。達成すると公開） */
  mission: MissionId | null;
  missionDone: boolean;
  /** 使命の判定に使う記録 */
  record: { buyouts: number; rentIn: number };
  /** 1周に1回の特性（旋風・操り糸）をこの周に使ったか。始まりの門を通過すると戻る */
  traitUsed: boolean;
}

/** 土地・観光地の所有情報。level は建物の段階（観光地は常に0） */
export interface Property {
  owner: number;
  level: number;
}

/** 守りのカードで割り込める場面 */
export type ReactContext =
  | { type: 'rent'; square: number; rent: number; owner: number }
  | { type: 'buyout'; square: number; raid?: boolean }
  | { type: 'earthquake'; square: number; attacker: number }
  | { type: 'seal'; target: number; attacker: number };

export type GuardCard = 'angel' | 'barrier' | 'mirror';

export type Phase =
  | { kind: 'roll' }
  /** 追い風の羽：振った出目を±1するか選ぶ（振った人が羽を持っているときだけ） */
  | { kind: 'adjust'; dice: [number, number]; sum: number }
  /** 操り糸（人形使い）：手番の人が振った出目 sum を、responder が±1するか選ぶ */
  | { kind: 'puppet'; responder: number; dice: [number, number]; sum: number }
  /** 剛腕：pusher が、同じマスにいる相手（targets）を押し出すか選ぶ */
  | { kind: 'push'; pusher: number; targets: number[] }
  /** 大勝負：通行料を払う前に、勝負するか選ぶ */
  | { kind: 'gamble'; square: number; rent: number; owner: number }
  | { kind: 'buy'; square: number }
  | { kind: 'build'; square: number }
  | { kind: 'buyout'; square: number }
  /** 守りのカードを使うか、responder（手番の人とは限らない）が選ぶ */
  | { kind: 'react'; responder: number; card: GuardCard; ctx: ReactContext }
  /** 運命の石碑でめくったカードから選ぶ（picks = あと何枚もらえるか） */
  | { kind: 'pick'; options: CardId[]; picks: number }
  /** 手札が上限を超えたので1枚捨てる。then = 捨て終わったら続ける処理 */
  | { kind: 'discard'; then: 'after' | 'end' }
  | { kind: 'festival' }
  | { kind: 'travel' }
  | { kind: 'blessing' }
  | { kind: 'liquidate'; debt: number; creditor: number | null }
  | { kind: 'gameover'; winner: number; reason: WinReason };

/** assets = 30ターン終了時の総資産、survivor = 最後の1人、triple = 色グループ3つ独占、tourist = 観光地すべて独占 */
export type WinReason = 'assets' | 'survivor' | 'triple' | 'tourist';

export interface LogEntry {
  turn: number;
  player: number | null;
  /** 全員に見える文 */
  text: string;
  /** player 本人にだけ見せる文（引いたカードの名前など）。あれば本人の画面では text の代わりに出す */
  secret?: string;
}

/** コマの動き。walk = 1マスずつ進む、warp = 直接移動 */
export interface Move {
  player: number;
  from: number;
  to: number;
  kind: 'walk' | 'warp';
}

/** 直近の通行料の支払い。次にサイコロが振られるまで画面に出す */
export interface Payment {
  payer: number;
  payee: number;
  amount: number;
  square: number;
}

export interface GameState {
  players: Player[];
  current: number;
  turn: number;
  maxTurns: number;
  properties: Record<number, Property>;
  phase: Phase;
  seed: number;
  /** 今の手番で続いているゾロ目の回数 */
  doublesInRow: number;
  /** 祭りが開かれている土地（なければ null） */
  /** 祭りが開かれている土地（古い順）。持ち主1人につき1か所まで（祭囃子は3か所） */
  festivals: number[];
  /** 直前の行動で振ったサイコロ（振っていなければ null） */
  rolled: [number, number] | null;
  /** 直前の行動で起きたコマの動き（順番どおり） */
  moves: Move[];
  lastPayment: Payment | null;
  /** 直近の、全員に見えるカードの出来事（使った・発動した・石碑でめくった）。次にサイコロが振られるまで表示 */
  lastCard: { player: number; card?: CardId; text: string; title?: string } | null;
  /** この手番で使った攻めのカードの枚数（ふつうは1回の手番に1枚まで） */
  cardsUsed: number;
  /** 直近に達成された使命。次にサイコロが振られるまで表示 */
  lastMission: { player: number; mission: MissionId } | null;
  /** 観光地を4つ揃え、守り切りを待っている人（次の自分の番まで4つとも持っていれば勝利） */
  touristClaim: number | null;
  log: LogEntry[];
}

export type Action =
  | { type: 'roll'; aim?: Aim }
  | { type: 'payEscape' }
  | { type: 'buy'; level: number }
  | { type: 'build'; level: number }
  | { type: 'buyout' }
  /** 攻めのカードを使う。square = 地震・祭りの対象、target = 封印の鎖の相手、sum = 運命の賽の出目 */
  | { type: 'useCard'; card: CardId; square?: number; target?: number; sum?: number }
  /** 追い風の羽：出目に delta（-1 か +1）を足す。0 なら使わない */
  | { type: 'adjust'; delta: -1 | 0 | 1 }
  /** 守りのカードを使うか */
  | { type: 'react'; use: boolean }
  /** 運命の石碑でめくったカードのうち index 番目をもらう */
  | { type: 'pick'; index: number }
  /** 手札の index 番目を捨てる */
  | { type: 'discard'; index: number }
  /** 天翔（ガルム）：サイコロの代わりに square へ飛ぶ */
  | { type: 'fly'; square: number }
  | { type: 'choose'; square: number }
  | { type: 'pass' }
  | { type: 'sell'; square: number }
  /** 操り糸：手番の人の出目に delta を足す（0 なら使わない） */
  | { type: 'puppet'; delta: -1 | 0 | 1 }
  /** 剛腕：target を dir マス押し出す（負なら戻る向き。±1か±2） */
  | { type: 'push'; target: number; dir: PushDir }
  /** 大勝負：勝負するか */
  | { type: 'gamble'; use: boolean };

export class GameError extends Error {}

/** 剛腕で押し出せる向きと距離 */
export type PushDir = -2 | -1 | 1 | 2;
export const PUSH_DIRS: PushDir[] = [-2, -1, 1, 2];

/** サイコロのゲージで狙うゾーン */
export type Aim = 'low' | 'mid' | 'high';

export const AIM_ZONES: Record<Aim, { name: string; min: number; max: number }> = {
  low: { name: '小', min: 2, max: 6 },
  mid: { name: '中', min: 5, max: 9 },
  high: { name: '大', min: 8, max: 12 },
};

/**
 * サイコロを2つ振る。狙いがあれば CONFIG.aimHitRate の確率でゾーン内の出目になる。
 * ゾーン内の出目は、普通に振ってゾーンに入るまで振り直して決めるので、
 * ゾーンの中での出目の偏りやゾロ目の出やすさは普通に振ったときとほぼ同じになる。
 */
export function rollDice(seed: number, aim?: Aim, hitRate: number = CONFIG.aimHitRate): [number, number, number] {
  let s = seed;
  let d1: number, d2: number;
  let useAim = false;
  if (aim) {
    let r: number;
    [r, s] = nextRandom(s);
    useAim = r < hitRate;
  }
  for (let tries = 0; ; tries++) {
    [d1, s] = rollDie(s);
    [d2, s] = rollDie(s);
    if (!useAim || tries >= 100) break;
    const sum = d1 + d2;
    if (sum >= AIM_ZONES[aim!].min && sum <= AIM_ZONES[aim!].max) break;
  }
  return [d1, d2, s];
}

export interface PlayerSetup {
  name: string;
  color: string;
  character?: CharacterId;
}

// ---------- キャラクター ----------

/** ステータスの補正（標準3との差 × 1段階の補正）。キャラがなければ 0 */
export function statMod(p: Player, stat: StatId): number {
  if (!p.character) return 0;
  return (CHARACTERS[p.character].stats[stat] - 3) * CONFIG.statStep[stat];
}

export function hasTrait(p: Player, trait: TraitId): boolean {
  return !!p.character && CHARACTERS[p.character].trait.id === trait;
}

/** ゲージで狙った出目になる確率（幸運で上下する） */
export function aimHitRateOf(p: Player): number {
  return Math.min(0.95, Math.max(0.2, CONFIG.aimHitRate + statMod(p, 'luck')));
}

/** 1回の手番に使える攻めのカードの枚数 */
export function cardLimitOf(p: Player): number {
  return hasTrait(p, 'quickhand') ? CONFIG.quickhandCards : 1;
}

/** 霧の孤島へ送られないか（霧読み） */
export function islandImmune(p: Player): boolean {
  return hasTrait(p, 'fogsight');
}

export const ISLAND = BOARD.findIndex((sq) => sq.kind === 'island');
export const TRAVEL = BOARD.findIndex((sq) => sq.kind === 'travel');

export function createGame(players: PlayerSetup[], seed = Date.now()): GameState {
  const s: GameState = {
    players: players.map((p, id) => ({
      id,
      name: p.name,
      color: p.color,
      money: CONFIG.initialMoney + (CONFIG.seatBonus[id] ?? 0),
      position: 0,
      bankrupt: false,
      lapped: false,
      laps: 0,
      islandTurns: 0,
      travelPending: false,
      hand: [],
      character: p.character ?? null,
      skyUsed: false,
      skyLaps: 0,
      mission: null,
      missionDone: false,
      record: { buyouts: 0, rentIn: 0 },
      traitUsed: false,
    })),
    current: 0,
    turn: 1,
    maxTurns: CONFIG.maxTurns,
    properties: {},
    phase: { kind: 'roll' },
    seed: seed >>> 0,
    doublesInRow: 0,
    festivals: [],
    rolled: null,
    moves: [],
    lastPayment: null,
    lastCard: null,
    cardsUsed: 0,
    lastMission: null,
    touristClaim: null,
    log: [{ turn: 1, player: null, text: `ゲーム開始。順番は ${players.map((p) => p.name).join(' → ')}（ターンごとに先頭が1人ずつずれる）` }],
  };
  // 秘密の使命を1人1枚ずつ、重ならないように配る
  const pool = MISSION_LIST.map((m) => m.id);
  for (const p of s.players) {
    let r: number;
    [r, s.seed] = nextRandom(s.seed);
    p.mission = pool.splice(Math.floor(r * pool.length), 1)[0] ?? null;
  }
  // 最初に手札を配る（損をするカードは配らない）
  for (const p of s.players) {
    for (let i = 0; i < CONFIG.startHand; i++) p.hand.push(drawFromDeck(s, false));
  }
  return s;
}

/** 山札から1枚引く（出やすさの重み付き）。withInstant = false なら損をするカードは出ない */
function drawFromDeck(s: GameState, withInstant: boolean): CardId {
  const pool = CARD_LIST.filter((c) => withInstant || c.kind !== 'instant');
  const total = pool.reduce((sum, c) => sum + c.weight, 0);
  let r: number;
  [r, s.seed] = nextRandom(s.seed);
  let x = r * total;
  for (const c of pool) {
    x -= c.weight;
    if (x < 0) return c.id;
  }
  return pool[pool.length - 1].id;
}

/** いま行動を決める人（守りのカードの割り込みでは、手番の人とは限らない） */
export function actorOf(s: GameState): number {
  if (s.phase.kind === 'react' || s.phase.kind === 'puppet') return s.phase.responder;
  if (s.phase.kind === 'push') return s.phase.pusher;
  return s.current;
}

/** 状態のシードから0以上1未満の乱数を1つ取る */
function rand(s: GameState): number {
  let r: number;
  [r, s.seed] = nextRandom(s.seed);
  return r;
}

// ---------- 計算 ----------

export const isLand = (square: number) => BOARD[square].kind === 'land';
export const isTourist = (square: number) => BOARD[square].kind === 'tourist';
export const isProperty = (square: number) => isLand(square) || isTourist(square);

/** 土地の価格（観光地も含む） */
export function landPrice(square: number): number {
  if (isTourist(square)) return CONFIG.touristPrice;
  const g = BOARD[square].group;
  if (!g) throw new GameError(`${BOARD[square].name} は買えるマスではありません`);
  return GROUPS[g].price;
}

/** 段階 from の状態から段階 to まで建てる費用（土地代は含まない） */
export function buildCost(square: number, from: number, to: number): number {
  let sum = 0;
  for (let lv = from + 1; lv <= to; lv++) sum += landPrice(square) * CONFIG.buildCostRate[lv];
  return Math.round(sum);
}

/** 土地と建物に投資した額の合計 */
export function investedValue(state: GameState, square: number): number {
  const prop = state.properties[square];
  if (!prop) return 0;
  return landPrice(square) + buildCost(square, 0, prop.level);
}

/** 土地の、段階ごとの基本の通行料（祭りの倍率は含まない） */
export function rentAt(square: number, level: number): number {
  return Math.round(landPrice(square) * CONFIG.rentRate[level]);
}

export function touristCount(state: GameState, playerId: number): number {
  return ownedSquares(state, playerId).filter(isTourist).length;
}

/** ラストスパート中かどうか（残り lastSpurtTurns ターン） */
export function isLastSpurt(state: GameState): boolean {
  return state.turn > state.maxTurns - CONFIG.lastSpurtTurns;
}

export function rentOf(state: GameState, square: number): number {
  const prop = state.properties[square];
  if (!prop) return 0;
  const owner = state.players[prop.owner];
  const prestige = 1 + statMod(owner, 'prestige');
  const spurt = isLastSpurt(state) ? CONFIG.lastSpurtRate : 1;
  if (isTourist(square)) return Math.round(CONFIG.touristRent[touristCount(state, prop.owner)] * prestige * spurt);
  let rent = rentAt(square, prop.level) * prestige;
  if (state.festivals.includes(square)) {
    rent *= hasTrait(owner, 'festival') ? CONFIG.mishaFestivalMultiplier : CONFIG.festivalMultiplier;
  }
  // 連続した土地のボーナス
  const chain = chainLength(state, square);
  const bonus = CONFIG.chainBonus[Math.min(chain, CONFIG.chainBonus.length - 1)] ?? 0;
  rent *= 1 + bonus;
  // 布陣：揃えた色グループの土地は通行料アップ
  const g = BOARD[square].group;
  if (g && hasTrait(owner, 'formation') && GROUP_SQUARES[g].every((sq) => state.properties[sq]?.owner === prop.owner)) {
    rent *= CONFIG.formationRate;
  }
  return Math.round(rent * spurt);
}

/** square を含む、同じ持ち主の土地が盤面で何マス続いているか（土地以外のマスで途切れる） */
export function chainLength(state: GameState, square: number): number {
  const prop = state.properties[square];
  if (!prop || !isLand(square)) return 0;
  const same = (sq: number) => isLand(sq) && state.properties[sq]?.owner === prop.owner;
  let n = 1;
  for (let i = square - 1; i >= 0 && same(i); i--) n++;
  for (let i = square + 1; i < BOARD_SIZE && same(i); i++) n++;
  return n;
}

/** 買収価格。buyer の交渉で安くなる（元の持ち主が受け取るのもこの額） */
export function buyoutPrice(state: GameState, square: number, buyer = state.current): number {
  const discount = 1 - statMod(state.players[buyer], 'deal');
  return Math.round(investedValue(state, square) * CONFIG.buyoutRate * discount);
}

/** 建設費の支払い額（建築で安くなる。土地代は変わらない） */
export function buildPayment(p: Player, listCost: number): number {
  return Math.round(listCost * (1 - statMod(p, 'build')));
}

export function canBuyout(state: GameState, square: number): boolean {
  const prop = state.properties[square];
  // 土地はランドマークが建つまで、観光地はいつでも買収できる
  return !!prop && isProperty(square) && prop.level < LEVEL.LANDMARK;
}

export function sellValue(state: GameState, square: number): number {
  return Math.floor(investedValue(state, square) * CONFIG.sellRate);
}

export function ownedSquares(state: GameState, playerId: number): number[] {
  return Object.entries(state.properties)
    .filter(([, p]) => p.owner === playerId)
    .map(([sq]) => Number(sq))
    .sort((a, b) => a - b);
}

/** 色グループごとの土地 */
export const GROUP_SQUARES: Record<GroupId, number[]> = Object.fromEntries(
  (Object.keys(GROUPS) as GroupId[]).map((g) => [g, BOARD.filter((sq) => sq.group === g).map((sq) => sq.index)]),
) as Record<GroupId, number[]>;

export const TOURIST_SQUARES = BOARD.filter((sq) => sq.kind === 'tourist').map((sq) => sq.index);

/** 独占勝利に必要な色グループの数 */
export const TRIPLE_GROUPS = 3;

/** プレイヤーが全部の土地を持っている色グループ */
export function completedGroups(state: GameState, playerId: number): GroupId[] {
  return (Object.keys(GROUP_SQUARES) as GroupId[]).filter((g) =>
    GROUP_SQUARES[g].every((sq) => state.properties[sq]?.owner === playerId),
  );
}

export function totalAssets(state: GameState, playerId: number): number {
  const p = state.players[playerId];
  if (p.bankrupt) return 0;
  const property = ownedSquares(state, playerId).reduce((sum, sq) => sum + investedValue(state, sq), 0);
  return p.money + Math.round(property * CONFIG.assetValueRate);
}

/**
 * 段階 from の土地に、プレイヤーが建てられる最高段階。
 * ホテルの上はランドマークだけ。1周目はビルまで。
 */
function maxLevel(player: Player, from: number): number {
  if (from >= LEVEL.HOTEL) return LEVEL.LANDMARK;
  return player.lapped ? LEVEL.HOTEL : (CONFIG.firstLapCap[player.id] ?? LEVEL.BUILDING);
}

export interface LevelOption {
  level: number;
  /** その段階まで建てるのに払う額（購入時は土地代込み） */
  cost: number;
  affordable: boolean;
}

/** 空き地を買うときの選択肢（土地だけ〜ホテルまで。観光地は土地だけ） */
export function buyOptions(state: GameState, square: number): LevelOption[] {
  const player = state.players[state.current];
  const price = landPrice(square);
  const top = isTourist(square) ? LEVEL.VACANT : maxLevel(player, LEVEL.VACANT);
  const opts: LevelOption[] = [];
  for (let lv = LEVEL.VACANT; lv <= top; lv++) {
    const cost = price + buildPayment(player, buildCost(square, 0, lv));
    opts.push({ level: lv, cost, affordable: player.money >= cost });
  }
  return opts;
}

/** 自分の土地に建て増すときの選択肢 */
export function buildOptions(state: GameState, square: number): LevelOption[] {
  const player = state.players[state.current];
  const prop = state.properties[square];
  if (!prop || prop.owner !== player.id || !isLand(square)) return [];
  const opts: LevelOption[] = [];
  for (let lv = prop.level + 1; lv <= maxLevel(player, prop.level); lv++) {
    const cost = buildPayment(player, buildCost(square, prop.level, lv));
    opts.push({ level: lv, cost, affordable: player.money >= cost });
  }
  return opts;
}

/** 祭りを開ける土地（現在のプレイヤーの土地） */
export function festivalTargets(state: GameState): number[] {
  return ownedSquares(state, state.current).filter((sq) => isLand(sq) && !state.festivals.includes(sq));
}

/** 持ち主が同時に開ける祭りの数 */
export function festivalLimit(p: Player): number {
  return hasTrait(p, 'festival') ? CONFIG.mishaFestivals : CONFIG.festivalsPerPlayer;
}

/** square（持ち主の土地）で祭りを開く。持ち主の祭りが上限を超えたら、いちばん古い祭りを終える */
function openFestival(s: GameState, square: number) {
  const owner = s.properties[square].owner;
  if (s.festivals.includes(square)) return;
  s.festivals.push(square);
  const mine = s.festivals.filter((sq) => s.properties[sq]?.owner === owner);
  if (mine.length > festivalLimit(s.players[owner])) {
    const oldest = mine[0];
    s.festivals = s.festivals.filter((sq) => sq !== oldest);
    log(s, owner, `${BOARD[oldest].name} の祭りが終わった`);
  }
}

/** 地震で壊せる土地（attacker 以外の人の、別荘〜ホテルが建っている土地） */
export function earthquakeTargets(state: GameState, attacker = state.current): number[] {
  return Object.entries(state.properties)
    .filter(([sq, p]) => p.owner !== attacker && isLand(Number(sq)) && p.level >= 1 && p.level < LEVEL.LANDMARK)
    .map(([sq]) => Number(sq))
    .sort((a, b) => a - b);
}

/** 世界旅行で行けるマス（転移の魔法陣以外のすべて） */
export function travelTargets(): number[] {
  return BOARD.map((sq) => sq.index).filter((i) => i !== TRAVEL);
}

/** 祝福の門で無料で1段階上げられる土地（現在のプレイヤーの土地で、まだ上げられるもの） */
export function blessingTargets(state: GameState): number[] {
  const p = state.players[state.current];
  return ownedSquares(state, p.id).filter((sq) => {
    if (!isLand(sq)) return false;
    const level = state.properties[sq].level;
    return level < LEVEL.LANDMARK && level + 1 <= maxLevel(p, level);
  });
}

/** 封印の鎖で送れる相手 */
export function sealTargets(state: GameState): number[] {
  return state.players.filter((p) => !p.bankrupt && p.id !== state.current && !islandImmune(p)).map((p) => p.id);
}

/** 略奪の令状の支払い額 */
export function raidPrice(state: GameState, square: number, buyer = state.current): number {
  return Math.round(buyoutPrice(state, square, buyer) * CONFIG.raidRate);
}

/** 略奪の令状で奪える土地（他人の、ランドマーク以外の土地と観光地。払えるものだけ） */
export function raidTargets(state: GameState): number[] {
  const me = state.players[state.current];
  return Object.entries(state.properties)
    .map(([sq, p]) => [Number(sq), p] as const)
    .filter(([sq, p]) => p.owner !== me.id && canBuyout(state, sq) && me.money >= raidPrice(state, sq))
    .map(([sq]) => sq)
    .sort((a, b) => a - b);
}

/** 天翔を今使えるか */
export function canFly(state: GameState): boolean {
  const p = state.players[state.current];
  return (
    state.phase.kind === 'roll' && hasTrait(p, 'skyride') && !p.skyUsed && p.islandTurns === 0 && p.money >= CONFIG.skyrideCost
  );
}

/** 天翔で飛べるマス（今いるマス以外） */
export function flyTargets(state: GameState): number[] {
  const here = state.players[state.current].position;
  return BOARD.map((sq) => sq.index).filter((i) => i !== here);
}

/** 攻めのカードを今使えるか。使えないときは理由を返す */
export function cardUsable(state: GameState, card: CardId): { ok: true } | { ok: false; why: string } {
  const p = state.players[state.current];
  if (CARDS[card].kind !== 'attack') return { ok: false, why: '守りのカードは使える場面で自動的に確認されます' };
  if (state.phase.kind !== 'roll') return { ok: false, why: 'サイコロを振る前に使えます' };
  if (state.cardsUsed >= cardLimitOf(p)) {
    return { ok: false, why: `攻めのカードは1回の手番に${cardLimitOf(p)}枚までです` };
  }
  if (!p.hand.includes(card)) return { ok: false, why: '手札にありません' };
  switch (card) {
    case 'tailwind':
      return { ok: false, why: 'サイコロを振ったあとに使えます' };
    case 'destiny':
      if (p.islandTurns > 0) return { ok: false, why: '霧の孤島では使えません' };
      if (p.money < CONFIG.destinyCost) return { ok: false, why: `${CONFIG.destinyCost}Gが必要です` };
      return { ok: true };
    case 'earthquake':
      return earthquakeTargets(state).length ? { ok: true } : { ok: false, why: '壊せる建物がありません' };
    case 'festival':
      return festivalTargets(state).length ? { ok: true } : { ok: false, why: '祭りを開ける土地がありません' };
    case 'growth':
      return blessingTargets(state).length ? { ok: true } : { ok: false, why: '上げられる土地がありません' };
    case 'raid':
      return raidTargets(state).length ? { ok: true } : { ok: false, why: '奪える土地がないか、お金が足りません' };
    case 'seal':
      return sealTargets(state).length ? { ok: true } : { ok: false, why: '送れる相手がいません' };
    default:
      return { ok: true };
  }
}

/** いまの場面で、マスを選んで実行できる候補 */
export function choiceTargets(state: GameState): number[] {
  switch (state.phase.kind) {
    case 'festival':
      return festivalTargets(state);
    case 'travel':
      return travelTargets();
    case 'blessing':
      return blessingTargets(state);
    default:
      return [];
  }
}

// ---------- 行動 ----------

export function applyAction(prev: GameState, action: Action): GameState {
  const s = structuredClone(prev);
  s.rolled = null;
  s.moves = [];
  switch (action.type) {
    case 'roll':
      expectPhase(s, 'roll');
      roll(s, action.aim);
      break;
    case 'payEscape':
      payEscape(s);
      break;
    case 'buy':
      buy(s, action.level);
      break;
    case 'build':
      build(s, action.level);
      break;
    case 'buyout':
      buyout(s);
      break;
    case 'useCard':
      useCard(s, action);
      break;
    case 'adjust':
      adjust(s, action.delta);
      break;
    case 'react':
      react(s, action.use);
      break;
    case 'pick':
      pick(s, action.index);
      break;
    case 'discard':
      discard(s, action.index);
      break;
    case 'fly':
      fly(s, action.square);
      break;
    case 'choose':
      choose(s, action.square);
      break;
    case 'pass':
      pass(s);
      break;
    case 'sell':
      sell(s, action.square);
      break;
    case 'puppet':
      puppet(s, action.delta);
      break;
    case 'push':
      push(s, action.target, action.dir);
      break;
    case 'gamble':
      gamble(s, action.use);
      break;
  }
  checkTouristClaim(s);
  checkMissions(s);
  return s;
}

function expectPhase(s: GameState, kind: Phase['kind']) {
  if (s.phase.kind !== kind) throw new GameError(`今は ${kind} の場面ではありません（現在: ${s.phase.kind}）`);
}

function log(s: GameState, player: number | null, text: string, secret?: string) {
  s.log.push(secret ? { turn: s.turn, player, text, secret } : { turn: s.turn, player, text });
}

function me(s: GameState): Player {
  return s.players[s.current];
}

/** steps マス進める。スタートを通過したら給料 */
function walk(s: GameState, steps: number) {
  const p = me(s);
  const from = p.position;
  const raw = from + steps;
  p.position = raw % BOARD_SIZE;
  s.moves.push({ player: p.id, from, to: p.position, kind: 'walk' });
  if (raw >= BOARD_SIZE) receiveSalary(s);
}

/** target へ前向きに一瞬で移動する。スタートを越えたら給料 */
function warpForward(s: GameState, target: number) {
  const p = me(s);
  const from = p.position;
  p.position = target;
  s.moves.push({ player: p.id, from, to: target, kind: 'warp' });
  if (target < from) receiveSalary(s);
}

/** 給料の内訳 */
export interface Salary {
  base: number;
  /** 領地収入（土地の数と建物の段階） */
  land: number;
  /** 収入ステータスの倍率 */
  income: number;
  /** 総資産が単独最下位のときの倍率（それ以外は 1） */
  rate: number;
  total: number;
}

/**
 * 給料 =（基本給 ＋ 領地収入）× 順位の倍率。
 * 領地収入は、土地1つごと・建物1段階ごとに決まった額。
 * 総資産が単独で最下位の人は倍率がかかる（同点の最下位にはかからない）。
 */
export function salaryFor(s: GameState, playerId: number): Salary {
  const lands = ownedSquares(s, playerId);
  const levels = lands.reduce((sum, sq) => sum + (s.properties[sq]?.level ?? 0), 0);
  const base = CONFIG.salary;
  const land = CONFIG.landIncomePerLand * lands.length + CONFIG.landIncomePerLevel * levels;
  let rate = 1;
  const rank = rankByAssets(s);
  if (rank.length > 1) {
    const fromBottom = rank.length - 1 - rank.indexOf(playerId);
    const above = rank[rank.length - 2 - fromBottom];
    // 1つ上の順位の人と同点なら倍率はかけない（全員同点の序盤など）
    const strictlyBelow = above !== undefined && totalAssets(s, playerId) < totalAssets(s, above);
    if (fromBottom < rank.length - 1 && strictlyBelow) rate = CONFIG.rankSalaryRates[fromBottom] ?? 1;
  }
  const income = 1 + statMod(s.players[playerId], 'income');
  return { base, land, income, rate, total: Math.round((base + land) * income * rate) };
}

/** 給料をもらう。ログには内訳を残す */
function paySalary(s: GameState, reason: string) {
  const p = me(s);
  const sal = salaryFor(s, p.id);
  p.money += sal.total;
  const parts = [`基本${sal.base}G`];
  if (sal.land > 0) parts.push(`領地${sal.land}G`);
  let extra = '';
  if (sal.income !== 1) extra += `、収入${sal.income > 1 ? '+' : ''}${Math.round((sal.income - 1) * 100)}%`;
  if (sal.rate !== 1) extra += `、最下位なので${sal.rate}倍`;
  log(s, p.id, `${reason} ${sal.total}G を受け取った（${parts.join('＋')}${extra}）`);
}

function receiveSalary(s: GameState) {
  const p = me(s);
  paySalary(s, '始まりの門を通過して給料');
  p.laps += 1;
  // 1周に1回の特性が戻る（旋風は gustEvery 周ごと）
  if (!hasTrait(p, 'gust') || p.laps % CONFIG.gustEvery === 0) p.traitUsed = false;
  if (p.skyUsed && ++p.skyLaps >= CONFIG.skyrideLaps) p.skyUsed = false;
  if (hasTrait(p, 'pioneer') && p.laps % CONFIG.pioneerLaps === 0) pioneer(s);
  // 祭囃子：まだ祭りのない、いちばん通行料の高い自分の土地で祭りが始まる
  if (hasTrait(p, 'festival')) {
    const cand = festivalTargets(s);
    if (cand.length) {
      const sq = cand.reduce((a, b) => (rentOf(s, b) > rentOf(s, a) ? b : a));
      openFestival(s, sq);
      log(s, p.id, `祭囃子で ${BOARD[sq].name} の祭りが始まった`);
      s.lastCard = { player: p.id, title: '祭囃子', text: `${BOARD[sq].name}で祭りが始まった` };
    }
  }
  // 祝福の声：通過しただけでも1段階（ぴったり止まったときは祝福の門で2段階）
  if (hasTrait(p, 'blessing') && p.position !== 0) {
    const cand = blessingTargets(s);
    if (cand.length) {
      const gain = (sq: number) => rentAt(sq, s.properties[sq].level + 1) - rentAt(sq, s.properties[sq].level);
      const sq = cand.reduce((a, b) => (gain(b) > gain(a) ? b : a));
      s.properties[sq].level += 1;
      log(s, p.id, `祝福の声で ${BOARD[sq].name} が${LEVEL_NAMES[s.properties[sq].level]}になった`);
      s.lastCard = { player: p.id, title: '祝福の声', text: `${BOARD[sq].name}が${LEVEL_NAMES[s.properties[sq].level]}に` };
    }
  }
  // 早業（クロウ）は2枚引く
  const draws = hasTrait(p, 'quickhand') && p.laps % CONFIG.quickhandEvery === 0 ? CONFIG.quickhandDraws : 1;
  for (let i = 0; i < draws; i++) {
    const card = drawFromDeck(s, false);
    p.hand.push(card);
    log(s, p.id, '始まりの門でカードを1枚引いた', `始まりの門でカード「${CARDS[card].name}」を引いた`);
  }
  if (!p.lapped) {
    p.lapped = true;
    log(s, p.id, 'ホテルが建てられるようになった');
  }
}

/** player を霧の孤島へ送る（給料なし）。手番は変えない */
function exile(s: GameState, playerId: number, reason: string) {
  const p = s.players[playerId];
  s.moves.push({ player: p.id, from: p.position, to: ISLAND, kind: 'warp' });
  p.position = ISLAND;
  p.islandTurns = CONFIG.islandTurns;
  log(s, p.id, `${reason}。${p.name} は ${BOARD[ISLAND].name} で最大${CONFIG.islandTurns}手番動けない`);
}

/** 手番の人を霧の孤島へ送る。手番は終わる（霧読みなら孤島へは行かない） */
function sendToIsland(s: GameState, reason: string) {
  s.doublesInRow = 0;
  const p = me(s);
  if (islandImmune(p)) log(s, p.id, `${reason}。でも霧読みで霧の孤島へは流されない`);
  else exile(s, s.current, reason);
  endTurn(s);
}

function roll(s: GameState, aim?: Aim) {
  const p = me(s);
  const [d1, d2, seed] = rollDice(s.seed, aim, aimHitRateOf(p));
  s.seed = seed;
  const aimText = aim ? `（狙い：${AIM_ZONES[aim].name}）` : '';
  s.rolled = [d1, d2];
  s.lastPayment = null;
  s.lastCard = null;
  s.lastMission = null;
  const double = d1 === d2;

  // 霧の孤島にいる：ゾロ目なら脱出してその目で進む（もう一度は振れない）
  if (p.islandTurns > 0) {
    if (double) {
      p.islandTurns = 0;
      s.doublesInRow = 0;
      log(s, p.id, `サイコロ ${d1}・${d2}。ゾロ目で ${BOARD[ISLAND].name} を脱出した`);
      walk(s, d1 + d2);
      log(s, p.id, `→ ${BOARD[p.position].name}`);
      resolveSquare(s);
    } else {
      p.islandTurns -= 1;
      const rest = p.islandTurns > 0 ? `あと${p.islandTurns}手番` : '次の手番から動ける';
      log(s, p.id, `サイコロ ${d1}・${d2}。脱出できなかった（${rest}）`);
      endTurn(s);
    }
    return;
  }

  if (double) {
    s.doublesInRow += 1;
    if (s.doublesInRow >= CONFIG.doublesToIsland) {
      sendToIsland(s, `サイコロ ${d1}・${d2}。ゾロ目が${CONFIG.doublesToIsland}回続いた`);
      return;
    }
  } else {
    s.doublesInRow = 0;
  }

  log(s, p.id, `サイコロ ${d1}・${d2}（${d1 + d2}）${aimText}`);
  // 操り糸：他のプレイヤーに人形使いがいれば、出目を±1するか聞く
  const puppeteer = s.players.find((x) => x.id !== p.id && !x.bankrupt && hasTrait(x, 'puppet') && !x.traitUsed);
  if (puppeteer) {
    s.phase = { kind: 'puppet', responder: puppeteer.id, dice: [d1, d2], sum: d1 + d2 };
    return;
  }
  tailwindOrMove(s, [d1, d2], d1 + d2);
}

/** 追い風の羽を持っていれば、動く前に出目を±1するか選ばせる。なければそのまま進む */
function tailwindOrMove(s: GameState, dice: [number, number], sum: number) {
  const p = me(s);
  if (s.cardsUsed < cardLimitOf(p) && p.hand.includes('tailwind')) {
    s.phase = { kind: 'adjust', dice, sum };
    return;
  }
  moveBy(s, sum);
}

function puppet(s: GameState, delta: -1 | 0 | 1) {
  if (s.phase.kind !== 'puppet') throw new GameError('今は出目を操れません');
  const { responder, dice, sum } = s.phase;
  const who = s.players[responder];
  let next = sum;
  if (delta !== 0) {
    next = Math.max(1, sum + delta);
    who.traitUsed = true;
    log(s, responder, `操り糸で ${me(s).name} の出目を${sum}から${next}にした`);
    s.lastCard = { player: responder, title: '操り糸', text: `${me(s).name}の出目を${sum}→${next}` };
  }
  tailwindOrMove(s, dice, next);
}

/** steps マス進んで、止まったマスの処理をする */
function moveBy(s: GameState, steps: number) {
  walk(s, steps);
  log(s, s.current, `→ ${BOARD[me(s).position].name}`);
  resolveSquare(s);
}

function adjust(s: GameState, delta: -1 | 0 | 1) {
  if (s.phase.kind !== 'adjust') throw new GameError('今は出目を変えられません');
  const base = s.phase.sum;
  const p = me(s);
  if (delta !== 0) {
    useFromHand(s, 'tailwind');
    mimic(s, 'tailwind');
    const sum = Math.max(1, base + delta);
    log(s, p.id, `追い風の羽で出目を${base}から${sum}にした`);
    s.lastCard = { player: p.id, card: 'tailwind', text: `出目を${base}→${sum}` };
    moveBy(s, sum);
  } else {
    moveBy(s, base);
  }
}

function payEscape(s: GameState) {
  expectPhase(s, 'roll');
  const p = me(s);
  if (p.islandTurns <= 0) throw new GameError('霧の孤島にいません');
  if (p.money < CONFIG.escapeFee) throw new GameError('脱出料が足りません');
  p.money -= CONFIG.escapeFee;
  p.islandTurns = 0;
  log(s, p.id, `脱出料 ${CONFIG.escapeFee}G を払って ${BOARD[ISLAND].name} を出た`);
}

/** 止まったマスの処理。special = false なら旋風・剛腕は起こさない（押し出し・吹き飛ばしのあと） */
function resolveSquare(s: GameState, special = true) {
  if (s.phase.kind === 'gameover') return;
  const p = me(s);
  const square = BOARD[p.position];

  if (special && square.kind !== 'island') {
    // 旋風：風の巫女のいるマスに止まると、巫女の通行料がいちばん高い土地へ吹き飛ばされる
    const gust = s.players.find((x) => x.id !== p.id && !x.bankrupt && hasTrait(x, 'gust') && !x.traitUsed && x.position === p.position);
    if (gust) {
      const lands = ownedSquares(s, gust.id);
      if (lands.length) {
        const target = lands.reduce((a, b) => (rentOf(s, b) > rentOf(s, a) ? b : a));
        if (target !== p.position) {
          gust.traitUsed = true;
          s.moves.push({ player: p.id, from: p.position, to: target, kind: 'warp' });
          p.position = target;
          log(s, gust.id, `旋風で ${p.name} を ${BOARD[target].name} へ吹き飛ばした`);
          s.lastCard = { player: gust.id, title: '旋風', text: `${p.name}を${BOARD[target].name}へ吹き飛ばした` };
          resolveSquare(s, false);
          return;
        }
      }
    }
    // 旋風（自分が止まったとき）：同じマスにいる相手のうち、いちばんお金を持っている人を吹き飛ばす
    if (hasTrait(p, 'gust') && !p.traitUsed) {
      const lands = ownedSquares(s, p.id);
      const victims = s.players.filter((x) => x.id !== p.id && !x.bankrupt && x.position === p.position);
      if (lands.length && victims.length) {
        const target = lands.reduce((a, b) => (rentOf(s, b) > rentOf(s, a) ? b : a));
        const v = victims.reduce((a, b) => (b.money > a.money ? b : a));
        if (target !== v.position) {
          p.traitUsed = true;
          s.moves.push({ player: v.id, from: v.position, to: target, kind: 'warp' });
          v.position = target;
          log(s, p.id, `旋風で ${v.name} を ${BOARD[target].name} へ吹き飛ばした`);
          s.lastCard = { player: p.id, title: '旋風', text: `${v.name}を${BOARD[target].name}へ吹き飛ばした` };
          forcePay(s, v.id, rentOf(s, target), p.id, target);
        }
      }
    }
    // 剛腕：同じマスにいる相手を押し出せる（自分が止まったときも、相手が止まってきたときも）
    const others = s.players.filter((x) => x.id !== p.id && !x.bankrupt && x.position === p.position);
    if (hasTrait(p, 'shove') && others.length) {
      s.phase = { kind: 'push', pusher: p.id, targets: others.map((x) => x.id) };
      return;
    }
    const shover = others.find((x) => hasTrait(x, 'shove'));
    if (shover) {
      s.phase = { kind: 'push', pusher: shover.id, targets: [p.id] };
      return;
    }
  }

  switch (square.kind) {
    case 'start':
      // 祝福の門：ぴったり止まったら、自分の土地を無料で1段階上げられる。なければ給料もう1回分
      if (blessingTargets(s).length > 0) {
        s.phase = { kind: 'blessing' };
        log(s, p.id, `${square.name}にぴったり止まった。祝福で土地を1つ無料で1段階上げられる`);
      } else {
        paySalary(s, `${square.name}にぴったり止まった。上げられる土地がないので、祝福として給料をもう1回分`);
        afterAction(s);
      }
      return;
    case 'island':
      if (islandImmune(p)) {
        // 霧渡り：次の手番で好きなマスへ
        p.travelPending = true;
        log(s, p.id, `${square.name}：霧読みで霧を渡る。次の手番で好きなマスへ移動できる`);
        s.lastCard = { player: p.id, title: '霧渡り', text: '次の手番で好きなマスへ' };
        afterAction(s);
        return;
      }
      s.doublesInRow = 0;
      sendToIsland(s, `${square.name} に流れ着いた`);
      return;
    case 'festival':
      if (festivalTargets(s).length > 0) {
        s.phase = { kind: 'festival' };
        log(s, p.id, `${square.name}：祭りを開く土地を選ぶ`);
      } else {
        log(s, p.id, `${square.name}：祭りを開ける土地を持っていない`);
        afterAction(s);
      }
      return;
    case 'travel':
      p.travelPending = true;
      s.doublesInRow = 0;
      log(s, p.id, `${square.name}：次の手番で好きなマスへ移動できる`);
      endTurn(s);
      return;
    case 'chance':
      revealChance(s);
      return;
    case 'land':
    case 'tourist':
      resolveProperty(s, square.index);
      return;
  }
}

function resolveProperty(s: GameState, square: number) {
  const p = me(s);
  const name = BOARD[square].name;
  const prop = s.properties[square];

  if (!prop) {
    if (buyOptions(s, square)[0].affordable) {
      s.phase = { kind: 'buy', square };
    } else {
      log(s, p.id, `${name}（${landPrice(square)}G）を買うお金が足りない`);
      afterAction(s);
    }
    return;
  }

  if (prop.owner === p.id) {
    if (isTourist(square)) {
      log(s, p.id, `自分の観光地 ${name} に止まった`);
      afterAction(s);
    } else {
      offerBuild(s, square, `自分の土地 ${name} に止まった`);
    }
    return;
  }

  const rent = rentOf(s, square);
  const fest = s.festivals.includes(square) ? '・祭り開催中' : '';
  log(s, p.id, `${s.players[prop.owner].name} の ${name} に止まった（通行料 ${rent}G${fest}）`);
  if (p.hand.includes('angel')) {
    s.phase = { kind: 'react', responder: p.id, card: 'angel', ctx: { type: 'rent', square, rent, owner: prop.owner } };
    return;
  }
  rentOrGamble(s, square, rent, prop.owner);
}

/** 大勝負を持っていれば勝負するか聞く。なければそのまま払う */
function rentOrGamble(s: GameState, square: number, rent: number, owner: number) {
  if (hasTrait(me(s), 'gamble')) {
    s.phase = { kind: 'gamble', square, rent, owner };
    return;
  }
  chargeRent(s, square, rent, owner);
}

function gamble(s: GameState, use: boolean) {
  if (s.phase.kind !== 'gamble') throw new GameError('今は勝負できません');
  const { square, rent, owner } = s.phase;
  const p = me(s);
  if (!use) {
    chargeRent(s, square, rent, owner);
    return;
  }
  let die: number;
  [die, s.seed] = rollDie(s.seed);
  const win = die >= CONFIG.gambleWinAt;
  const amount = Math.round(rent * (win ? CONFIG.gambleWin : CONFIG.gambleLose));
  log(s, p.id, `大勝負！ サイコロは${die}で${win ? '勝ち' : '負け'}。通行料は ${amount}G`);
  s.lastCard = { player: p.id, title: '大勝負', text: `出目${die}で${win ? '勝ち' : '負け'}。通行料${rent}G→${amount}G` };
  chargeRent(s, square, amount, owner);
}

/** 剛腕：target を1マス押し出し、押し出し先のマスの効果を起こす。そのあと自分のマスの処理 */
function push(s: GameState, target: number, dir: PushDir) {
  if (s.phase.kind !== 'push') throw new GameError('今は押し出せません');
  if (!s.phase.targets.includes(target) || !PUSH_DIRS.includes(dir)) throw new GameError('その相手は押し出せません');
  const pusher = s.phase.pusher;
  const t = s.players[target];
  const to = (t.position + dir + BOARD_SIZE) % BOARD_SIZE;
  s.moves.push({ player: t.id, from: t.position, to, kind: 'warp' });
  t.position = to;
  log(s, pusher, `剛腕で ${t.name} を ${BOARD[to].name} へ押し出した`);
  s.lastCard = { player: pusher, title: '剛腕', text: `${t.name}を${BOARD[to].name}へ押し出した` };
  if (CONFIG.shoveFee > 0) {
    const fee = Math.min(CONFIG.shoveFee, t.money);
    t.money -= fee;
    s.players[pusher].money += fee;
    if (fee > 0) log(s, pusher, `剛腕の手間賃として ${t.name} から ${fee}G を受け取った`);
  }
  // 手番の人が押し出されたなら、押し出し先がその人の止まったマスになる
  if (target !== s.current) pushedLands(s, target);
  resolveSquare(s, false);
}

/** 押し出された人に、押し出し先のマスの効果を起こす（本人の判断が要らない形で） */
function pushedLands(s: GameState, id: number) {
  const t = s.players[id];
  const sq = t.position;
  const square = BOARD[sq];
  const prop = s.properties[sq];
  if ((square.kind === 'land' || square.kind === 'tourist') && prop && prop.owner !== id) {
    forcePay(s, id, rentOf(s, sq), prop.owner, sq);
  } else if (square.kind === 'island') {
    if (islandImmune(t)) log(s, id, `${square.name}：霧読みで霧を抜けた`);
    else exile(s, id, `押し出されて ${square.name} に流れ着いた`);
  } else if (square.kind === 'chance') {
    const card = drawFromDeck(s, false);
    t.hand.push(card);
    log(s, id, `押し出された先の運命の石碑でカードを1枚引いた`, `押し出された先の運命の石碑で「${CARDS[card].name}」を引いた`);
  } else if (square.kind === 'travel') {
    t.travelPending = true;
    log(s, id, `${square.name}：次の手番で好きなマスへ移動できる`);
  }
}

/** 手番でない人に払わせる。足りなければ安い土地から自動で売り、それでも足りなければ破産 */
function forcePay(s: GameState, id: number, amount: number, creditor: number, square: number) {
  const t = s.players[id];
  while (t.money < amount) {
    const mine = ownedSquares(s, id);
    if (!mine.length) break;
    const cheapest = mine.reduce((a, b) => (sellValue(s, b) < sellValue(s, a) ? b : a));
    const value = sellValue(s, cheapest);
    removeProperty(s, cheapest);
    t.money += value;
    log(s, id, `${BOARD[cheapest].name} を銀行に ${value}G で売った`);
  }
  if (t.money >= amount) {
    t.money -= amount;
    s.players[creditor].money += amount;
    s.players[creditor].record.rentIn += amount;
    s.lastPayment = { payer: id, payee: creditor, amount, square };
    log(s, id, `${s.players[creditor].name} に ${amount}G を支払った`);
  } else {
    goBankrupt(s, creditor, id);
  }
}

/** 開拓：空き地をランダムに1つもらう。なければお金 */
function pioneer(s: GameState) {
  const p = me(s);
  const vacant = BOARD.filter((sq) => sq.kind === 'land' && !s.properties[sq.index]).map((sq) => sq.index);
  if (!vacant.length) {
    p.money += CONFIG.pioneerFallback;
    log(s, p.id, `開拓：空き地がないので ${CONFIG.pioneerFallback}G を受け取った`);
    return;
  }
  const sq = vacant[Math.floor(rand(s) * vacant.length)];
  s.properties[sq] = { owner: p.id, level: 0 };
  log(s, p.id, `開拓で ${BOARD[sq].name} を手に入れた`);
  s.lastCard = { player: p.id, title: '開拓', text: `${BOARD[sq].name}を手に入れた` };
  checkMonopoly(s, sq);
}

/** 写し身：他人が攻めのカードを使ったら、写し身のキャラが確率で同じカードをもらう */
function mimic(s: GameState, card: CardId) {
  for (const x of s.players) {
    if (x.id === s.current || x.bankrupt || !hasTrait(x, 'mimic')) continue;
    if (rand(s) >= CONFIG.mimicRate) continue;
    x.hand.push(card);
    log(s, x.id, `${x.name} は写し身でカードを1枚写し取った`, `写し身で「${CARDS[card].name}」を写し取った`);
  }
}

/** 建て増しできるなら build の場面へ、できなければ手番を進める */
function offerBuild(s: GameState, square: number, reason: string) {
  const opts = buildOptions(s, square);
  if (opts.some((o) => o.affordable)) {
    s.phase = { kind: 'build', square };
    return;
  }
  const prop = s.properties[square];
  const why =
    prop.level >= LEVEL.LANDMARK
      ? 'ランドマークが建っている'
      : opts.length === 0
        ? 'ホテルは2周目から建てられる'
        : '建てるお金が足りない';
  log(s, s.current, `${reason}（${why}）`);
  afterAction(s);
}

/** 運命の石碑：カードをめくり、損をするカードはその場で発動、残りから1枚もらう */
function revealChance(s: GameState) {
  const p = me(s);
  const revealed: CardId[] = [];
  const count = hasTrait(p, 'stargaze') ? CONFIG.stargazeReveal : CONFIG.chanceReveal;
  for (let i = 0; i < count; i++) revealed.push(drawFromDeck(s, true));
  const names = revealed.map((c) => `「${CARDS[c].name}」`).join('と');
  log(s, p.id, `運命の石碑で${names}がめくれた`);
  const keep = revealed.filter((c) => CARDS[c].kind !== 'instant');
  const instants = revealed.filter((c) => CARDS[c].kind === 'instant');
  s.lastCard = { player: p.id, card: revealed[0], text: `${names}がめくれた`, title: BOARD[p.position].name };

  // もらえる枚数より多くめくれていれば選ぶ。少なければ全部もらう
  const picks = hasTrait(p, 'stargaze') ? CONFIG.stargazePicks : 1;
  if (keep.length <= picks) {
    for (const c of keep) {
      p.hand.push(c);
      log(s, p.id, `「${CARDS[c].name}」を手札に加えた`);
    }
  }
  for (const c of instants) {
    if (applyInstant(s, c)) return; // 霧で手番が終わった
  }
  if (keep.length > picks) {
    s.phase = { kind: 'pick', options: keep, picks };
    return;
  }
  afterAction(s);
}

/** 損をするカードを発動する。手番が終わったら true */
function applyInstant(s: GameState, card: CardId): boolean {
  const p = me(s);
  if (card === 'tax') {
    const tax = Math.floor(p.money * CONFIG.taxRate);
    p.money -= tax;
    log(s, p.id, `王の徴税：銀行に ${tax}G を支払った`);
    s.lastCard = { player: p.id, card, text: `王の徴税で${tax}Gを支払った` };
    return false;
  }
  if (card === 'fog') {
    if (islandImmune(p)) {
      log(s, p.id, '迷いの霧：霧読みで迷わなかった');
      return false;
    }
    s.lastCard = { player: p.id, card, text: '迷いの霧で霧の孤島へ' };
    sendToIsland(s, '迷いの霧');
    return true;
  }
  return false;
}

function pick(s: GameState, index: number) {
  if (s.phase.kind !== 'pick') throw new GameError('今はカードを選べません');
  const card = s.phase.options[index];
  if (!card) throw new GameError('そのカードはありません');
  const p = me(s);
  p.hand.push(card);
  log(s, p.id, `「${CARDS[card].name}」を手札に加えた`);
  const rest = s.phase.options.filter((_, i) => i !== index);
  if (s.phase.picks > 1 && rest.length > 0) {
    s.phase = { kind: 'pick', options: rest, picks: s.phase.picks - 1 };
    return;
  }
  afterAction(s);
}

function discard(s: GameState, index: number) {
  if (s.phase.kind !== 'discard') throw new GameError('今はカードを捨てられません');
  const p = me(s);
  const card = p.hand[index];
  if (!card) throw new GameError('そのカードはありません');
  p.hand.splice(index, 1);
  log(s, p.id, 'カードを1枚捨てた', `「${CARDS[card].name}」を捨てた`);
  if (p.hand.length > CONFIG.handLimit) return;
  const then = s.phase.then;
  if (then === 'after') afterAction(s);
  else endTurn(s);
}

/** 手札からカードを1枚取り除く */
function useFromHand(s: GameState, card: CardId, playerId = s.current) {
  const hand = s.players[playerId].hand;
  const i = hand.indexOf(card);
  if (i < 0) throw new GameError('そのカードは手札にありません');
  hand.splice(i, 1);
}

function useCard(s: GameState, a: Extract<Action, { type: 'useCard' }>) {
  const check = cardUsable(s, a.card);
  if (!check.ok) throw new GameError(check.why);
  validateTarget(s, a);
  const p = me(s);
  const name = CARDS[a.card].name;
  mimic(s, a.card);

  switch (a.card) {
    case 'treasure': {
      useFromHand(s, a.card);
      s.cardsUsed += 1;
      const amount = rollTreasure(s);
      p.money += amount;
      log(s, p.id, `宝箱を開けて ${amount}G を受け取った`);
      s.lastCard = { player: p.id, card: a.card, text: `宝箱から${amount}G` };
      return;
    }

    case 'festival': {
      if (a.square === undefined || !festivalTargets(s).includes(a.square)) throw new GameError('祭りを開く土地を選んでください');
      useFromHand(s, a.card);
      s.cardsUsed += 1;
      openFestival(s, a.square);
      log(s, p.id, `祭りの招待状で ${BOARD[a.square].name} で祭りを開いた`);
      s.lastCard = { player: p.id, card: a.card, text: `${BOARD[a.square].name}で祭り` };
      return;
    }

    case 'growth': {
      if (a.square === undefined || !blessingTargets(s).includes(a.square)) throw new GameError('上げる土地を選んでください');
      useFromHand(s, a.card);
      s.cardsUsed += 1;
      const prop = s.properties[a.square];
      prop.level += 1;
      log(s, p.id, `築城の詔で ${BOARD[a.square].name} を無料で${LEVEL_NAMES[prop.level]}にした`);
      s.lastCard = { player: p.id, card: a.card, text: `${BOARD[a.square].name}が${LEVEL_NAMES[prop.level]}に` };
      return;
    }

    case 'raid': {
      if (a.square === undefined || !raidTargets(s).includes(a.square)) throw new GameError('奪う土地を選んでください');
      useFromHand(s, a.card);
      s.cardsUsed += 1;
      const owner = s.players[s.properties[a.square].owner];
      log(s, p.id, `${name}で ${owner.name} の ${BOARD[a.square].name} を奪おうとしている（${raidPrice(s, a.square)}G）`);
      s.lastCard = { player: p.id, card: a.card, text: `${owner.name}の${BOARD[a.square].name}を狙う` };
      const guard: GuardCard | null = owner.hand.includes('mirror') ? 'mirror' : owner.hand.includes('barrier') ? 'barrier' : null;
      if (guard) {
        s.phase = { kind: 'react', responder: owner.id, card: guard, ctx: { type: 'buyout', square: a.square, raid: true } };
        return;
      }
      doBuyout(s, a.square, true);
      return;
    }

    case 'earthquake': {
      if (a.square === undefined || !earthquakeTargets(s).includes(a.square)) throw new GameError('壊す土地を選んでください');
      useFromHand(s, a.card);
      s.cardsUsed += 1;
      const owner = s.properties[a.square].owner;
      log(s, p.id, `${name}を ${s.players[owner].name} の ${BOARD[a.square].name} に使った`);
      s.lastCard = { player: p.id, card: a.card, text: `${s.players[owner].name}の${BOARD[a.square].name}に地震` };
      if (s.players[owner].hand.includes('mirror')) {
        s.phase = { kind: 'react', responder: owner, card: 'mirror', ctx: { type: 'earthquake', square: a.square, attacker: p.id } };
        return;
      }
      quake(s, a.square);
      return;
    }

    case 'seal': {
      if (a.target === undefined || !sealTargets(s).includes(a.target)) throw new GameError('送る相手を選んでください');
      useFromHand(s, a.card);
      s.cardsUsed += 1;
      const target = s.players[a.target];
      log(s, p.id, `${name}を ${target.name} に使った`);
      s.lastCard = { player: p.id, card: a.card, text: `${target.name}に封印の鎖` };
      if (target.hand.includes('mirror')) {
        s.phase = { kind: 'react', responder: target.id, card: 'mirror', ctx: { type: 'seal', target: target.id, attacker: p.id } };
        return;
      }
      exile(s, target.id, '封印の鎖');
      return;
    }

    case 'destiny': {
      const sum = a.sum ?? 0;
      if (!Number.isInteger(sum) || sum < 2 || sum > 12) throw new GameError('出目は2〜12から選んでください');
      useFromHand(s, a.card);
      s.cardsUsed += 1;
      p.money -= CONFIG.destinyCost;
      s.lastPayment = null;
      s.doublesInRow = 0; // ゾロ目扱いにはならない
      log(s, p.id, `運命の賽（${CONFIG.destinyCost}G）で出目を${sum}に決めた`);
      s.lastCard = { player: p.id, card: a.card, text: `運命の賽で出目${sum}` };
      moveBy(s, sum);
      return;
    }
  }
}

/** 対象の選び間違いは、写し身より前にはじく（写し取ってから失敗しないように） */
function validateTarget(s: GameState, a: Extract<Action, { type: 'useCard' }>) {
  const bad = (msg: string) => {
    throw new GameError(msg);
  };
  switch (a.card) {
    case 'festival':
      if (a.square === undefined || !festivalTargets(s).includes(a.square)) bad('祭りを開く土地を選んでください');
      break;
    case 'growth':
      if (a.square === undefined || !blessingTargets(s).includes(a.square)) bad('上げる土地を選んでください');
      break;
    case 'raid':
      if (a.square === undefined || !raidTargets(s).includes(a.square)) bad('奪う土地を選んでください');
      break;
    case 'earthquake':
      if (a.square === undefined || !earthquakeTargets(s).includes(a.square)) bad('壊す土地を選んでください');
      break;
    case 'seal':
      if (a.target === undefined || !sealTargets(s).includes(a.target)) bad('送る相手を選んでください');
      break;
    case 'destiny': {
      const sum = a.sum ?? 0;
      if (!Number.isInteger(sum) || sum < 2 || sum > 12) bad('出目は2〜12から選んでください');
      break;
    }
  }
}

/** 宝箱の中身の額を決める */
function rollTreasure(s: GameState): number {
  let r: number;
  [r, s.seed] = nextRandom(s.seed);
  const steps = Math.floor((CONFIG.treasureMax - CONFIG.treasureMin) / CONFIG.treasureStep) + 1;
  return CONFIG.treasureMin + Math.floor(Math.pow(r, CONFIG.treasureSkew) * steps) * CONFIG.treasureStep;
}

/** 天翔：サイコロの代わりに好きなマスへ飛ぶ */
function fly(s: GameState, square: number) {
  if (!canFly(s)) throw new GameError('今は天翔を使えません');
  if (!flyTargets(s).includes(square)) throw new GameError('そのマスへは飛べません');
  const p = me(s);
  s.lastPayment = null;
  s.lastCard = null;
  s.doublesInRow = 0;
  p.money -= CONFIG.skyrideCost;
  warpForward(s, square);
  p.skyUsed = true; // 始まりの門を越えて戻った分も、この周で使ったことにする
  p.skyLaps = 0;
  log(s, p.id, `天翔で ${BOARD[square].name} へ飛んだ`);
  resolveSquare(s);
}

/** 地震：建物を1段階壊す */
function quake(s: GameState, square: number) {
  const prop = s.properties[square];
  prop.level -= 1;
  log(s, null, `地震で ${s.players[prop.owner].name} の ${BOARD[square].name} が${LEVEL_NAMES[prop.level]}になった`);
}

/** 守りのカードを使うかどうか（responder が決める） */
function react(s: GameState, use: boolean) {
  if (s.phase.kind !== 'react') throw new GameError('今は守りのカードを使う場面ではありません');
  const { responder, card, ctx } = s.phase;
  const who = s.players[responder];

  if (use) {
    useFromHand(s, card, responder);
    s.lastCard = { player: responder, card, text: `${who.name}が「${CARDS[card].name}」を使った` };
    // 破魔：守りのカードを向けられた相手が破魔の剣士なら、確率で無効
    const opponent = ctx.type === 'rent' ? ctx.owner : ctx.type === 'buyout' ? s.current : ctx.attacker;
    const foe = s.players[opponent];
    if (opponent !== responder && hasTrait(foe, 'pierce') && rand(s) < CONFIG.pierceRate) {
      log(s, opponent, `${foe.name} の破魔で「${CARDS[card].name}」が無効になった`);
      s.lastCard = { player: opponent, title: '破魔', text: `${who.name}の「${CARDS[card].name}」を無効にした` };
      use = false;
    }
  }

  switch (ctx.type) {
    case 'rent':
      if (use) {
        log(s, responder, '天使の加護を使い、通行料を払わずに済んだ');
        afterRent(s, ctx.square);
      } else {
        rentOrGamble(s, ctx.square, ctx.rent, ctx.owner);
      }
      return;

    case 'buyout':
      // 略奪の令状はサイコロを振る前なので、防がれたら振る場面に戻る
      const resume = () => (ctx.raid ? (s.phase = { kind: 'roll' }) : afterAction(s));
      if (use && card === 'barrier') {
        log(s, responder, `守護の結界で ${BOARD[ctx.square].name} の買収を防いだ`);
        resume();
      } else if (use) {
        // 鏡の盾：買収を跳ね返し、買収しようとした人に通行料をもう一度払わせる（払える分だけ）
        const amount = Math.min(rentOf(s, ctx.square), me(s).money);
        log(s, responder, `鏡の盾で ${BOARD[ctx.square].name} の買収を跳ね返した`);
        if (amount > 0) pay(s, amount, responder, ctx.square);
        resume();
      } else if (card === 'mirror' && who.hand.includes('barrier')) {
        s.phase = { kind: 'react', responder, card: 'barrier', ctx };
      } else {
        doBuyout(s, ctx.square, ctx.raid);
      }
      return;

    case 'earthquake':
      s.phase = { kind: 'roll' };
      if (use) {
        // 跳ね返す：使った人の土地のうち、いちばん通行料の高いものが壊れる
        const back = earthquakeTargets(s, responder).filter((sq) => s.properties[sq].owner === ctx.attacker);
        log(s, responder, '鏡の盾で地震を跳ね返した');
        if (back.length) quake(s, back.reduce((a, b) => (rentOf(s, b) > rentOf(s, a) ? b : a)));
        else log(s, null, `${s.players[ctx.attacker].name} には壊れる建物がなかった`);
      } else {
        quake(s, ctx.square);
      }
      return;

    case 'seal':
      if (use) {
        log(s, responder, '鏡の盾で封印の鎖を跳ね返した');
        if (islandImmune(me(s))) {
          s.phase = { kind: 'roll' };
          log(s, s.current, '跳ね返された封印の鎖は、霧読みで効かなかった');
          return;
        }
        // 使った本人（手番の人）が孤島へ。手番は終わる
        sendToIsland(s, '跳ね返された封印の鎖');
      } else {
        s.phase = { kind: 'roll' };
        exile(s, ctx.target, '封印の鎖');
      }
      return;
  }
}

function choose(s: GameState, square: number) {
  const ph = s.phase.kind;
  if (!choiceTargets(s).includes(square)) throw new GameError('そのマスは選べません');
  const p = me(s);
  const name = BOARD[square].name;

  if (ph === 'festival') {
    openFestival(s, square);
    log(s, p.id, `${name} で祭りを開いた（通行料アップ）`);
    afterAction(s);
  } else if (ph === 'blessing') {
    const prop = s.properties[square];
    prop.level += 1;
    // 祝福の声：もう1段階上げられるなら上げる
    if (hasTrait(p, 'blessing') && prop.level < LEVEL.LANDMARK && prop.level + 1 <= maxLevel(p, prop.level)) prop.level += 1;
    log(s, p.id, `祝福で ${name} が無料で${LEVEL_NAMES[prop.level]}になった`);
    afterAction(s);
  } else if (ph === 'travel') {
    p.travelPending = false;
    warpForward(s, square);
    log(s, p.id, `転移して ${name} へ移動した`);
    resolveSquare(s);
  }
}

function buy(s: GameState, level: number) {
  if (s.phase.kind !== 'buy') throw new GameError('今は購入できません');
  const sq = s.phase.square;
  const opt = buyOptions(s, sq).find((o) => o.level === level);
  if (!opt) throw new GameError('その段階までは建てられません');
  if (!opt.affordable) throw new GameError('所持金が足りません');
  const p = me(s);
  p.money -= opt.cost;
  s.properties[sq] = { owner: p.id, level };
  const what = level === LEVEL.VACANT ? '' : `、${LEVEL_NAMES[level]}まで建てた`;
  log(s, p.id, `${BOARD[sq].name} を ${opt.cost}G で購入${what}`);
  if (checkMonopoly(s, sq)) return;
  afterAction(s);
}

function build(s: GameState, level: number) {
  if (s.phase.kind !== 'build') throw new GameError('今は建設できません');
  const sq = s.phase.square;
  const opt = buildOptions(s, sq).find((o) => o.level === level);
  if (!opt) throw new GameError('その段階までは建てられません');
  if (!opt.affordable) throw new GameError('所持金が足りません');
  const p = me(s);
  p.money -= opt.cost;
  s.properties[sq].level = level;
  log(s, p.id, `${BOARD[sq].name} に ${opt.cost}G で${LEVEL_NAMES[level]}まで建てた`);
  afterAction(s);
}

function buyout(s: GameState) {
  if (s.phase.kind !== 'buyout') throw new GameError('今は買収できません');
  const sq = s.phase.square;
  const prop = s.properties[sq];
  const p = me(s);
  if (!canBuyout(s, sq)) throw new GameError('この土地は買収できません');
  if (p.money < buyoutPrice(s, sq)) throw new GameError('所持金が足りません');
  log(s, p.id, `${s.players[prop.owner].name} の ${BOARD[sq].name} を買収しようとしている`);
  // 持ち主が鏡の盾・守護の結界を持っていれば、使うか聞く（鏡の盾が先。断ったら結界を聞く）
  const owner = s.players[prop.owner];
  const guard: GuardCard | null = owner.hand.includes('mirror') ? 'mirror' : owner.hand.includes('barrier') ? 'barrier' : null;
  if (guard) {
    s.phase = { kind: 'react', responder: owner.id, card: guard, ctx: { type: 'buyout', square: sq } };
    return;
  }
  doBuyout(s, sq);
}

/** 買収する。raid = 略奪の令状（買収価格の上乗せ分は銀行へ。終わったらサイコロを振る場面に戻る） */
function doBuyout(s: GameState, sq: number, raid = false) {
  const prop = s.properties[sq];
  const p = me(s);
  const price = buyoutPrice(s, sq);
  const paid = raid ? raidPrice(s, sq) : price;
  const prevOwner = s.players[prop.owner];
  p.money -= paid;
  prevOwner.money += price;
  prop.owner = p.id;
  p.record.buyouts += 1;
  // 持ち主が変わったら祭りは終わる
  if (s.festivals.includes(sq)) {
    s.festivals = s.festivals.filter((x) => x !== sq);
    log(s, null, `${BOARD[sq].name} の祭りは持ち主が変わって終わった`);
  }
  const extra = raid ? `（${prevOwner.name} に ${price}G、銀行に ${paid - price}G）` : '';
  log(s, p.id, `${prevOwner.name} から ${BOARD[sq].name} を ${paid}G で買収した${extra}`);
  // 商魂：買収した土地をその場で1段階無料で建て増す
  if (hasTrait(p, 'merchant') && isLand(sq) && prop.level < LEVEL.LANDMARK && prop.level + 1 <= maxLevel(p, prop.level)) {
    prop.level += 1;
    log(s, p.id, `商魂で ${BOARD[sq].name} を無料で${LEVEL_NAMES[prop.level]}にした`);
  }
  if (checkMonopoly(s, sq)) return;
  if (raid) s.phase = { kind: 'roll' };
  else if (isTourist(sq)) afterAction(s);
  else offerBuild(s, sq, `${BOARD[sq].name} を買収した`);
}

/**
 * 土地を手に入れた直後に呼ぶ。色グループの独占をログに残し、
 * 独占勝利の条件を満たしたらゲームを終えて true を返す。
 */
function checkMonopoly(s: GameState, acquired: number): boolean {
  const p = me(s);
  const g = BOARD[acquired].group;
  if (g && GROUP_SQUARES[g].every((sq) => s.properties[sq]?.owner === p.id)) {
    log(s, p.id, `${GROUPS[g].name}の土地をすべて手に入れた（色グループ独占）`);
  }
  const groups = completedGroups(s, p.id);
  if (groups.length >= TRIPLE_GROUPS) {
    s.phase = { kind: 'gameover', winner: p.id, reason: 'triple' };
    const names = groups.map((x) => GROUPS[x].name).join('・');
    log(s, null, `${p.name} の勝利（色グループ3つ独占：${names}）`);
    return true;
  }
  if (isTourist(acquired) && ownsAllTourist(s, p.id) && s.touristClaim !== p.id) {
    s.touristClaim = p.id;
    log(s, p.id, `${p.name} が観光地を${TOURIST_SQUARES.length}つすべて揃えた。次の ${p.name} の番まで守り切れば勝利`);
  }
  return false;
}

export function ownsAllTourist(s: GameState, playerId: number): boolean {
  return TOURIST_SQUARES.every((sq) => s.properties[sq]?.owner === playerId);
}

/** 守り切りを待っている人が観光地を1つでも失ったら、守り切りは取り消し */
function checkTouristClaim(s: GameState) {
  const c = s.touristClaim;
  if (c === null || s.phase.kind === 'gameover') return;
  if (s.players[c].bankrupt || !ownsAllTourist(s, c)) {
    s.touristClaim = null;
    log(s, null, `${s.players[c].name} の観光地の独占が崩れた`);
  }
}

// ---------- 秘密の使命 ----------

/** 盤面の辺（0〜3）。角のマスは -1 */
const sideOf = (sq: number) => (sq % 8 === 0 ? -1 : Math.floor(sq / 8));

/** 使命の進み具合（now が goal 以上で達成） */
export function missionProgress(s: GameState, playerId: number, id: MissionId): { now: number; goal: number } {
  const p = s.players[playerId];
  const mine = ownedSquares(s, playerId);
  const goal = MISSIONS[id].goal;
  const levels = mine.filter(isLand).map((sq) => s.properties[sq].level);
  let now = 0;
  switch (id) {
    case 'frontier':
      now = new Set(mine.filter((sq) => isLand(sq) && s.properties[sq].level >= 1).map(sideOf)).size;
      break;
    case 'landmark':
      now = levels.filter((lv) => lv >= LEVEL.LANDMARK).length;
      break;
    case 'hotels':
      now = levels.filter((lv) => lv >= LEVEL.HOTEL).length;
      break;
    case 'tourist2':
      now = mine.filter(isTourist).length;
      break;
    case 'lands8':
      now = mine.length;
      break;
    case 'chain3':
      now = mine.filter((sq) => chainLength(s, sq) >= 2).length;
      break;
    case 'rich':
      now = p.money;
      break;
    case 'raider':
      now = p.record.buyouts;
      break;
    case 'toll':
      now = p.record.rentIn;
      break;
    case 'noble':
      now = mine.filter((sq) => BOARD[sq].group === 'G' || BOARD[sq].group === 'H').length;
      break;
  }
  return { now, goal };
}

/** 達成した使命の報酬を渡し、全員に公開する */
function checkMissions(s: GameState) {
  if (s.phase.kind === 'gameover') return;
  for (const p of s.players) {
    if (p.bankrupt || !p.mission || p.missionDone) continue;
    const { now, goal } = missionProgress(s, p.id, p.mission);
    if (now < goal) continue;
    const m = MISSIONS[p.mission];
    p.missionDone = true;
    p.money += m.reward;
    s.lastMission = { player: p.id, mission: m.id };
    log(s, p.id, `${p.name} が秘密の使命「${m.name}」（${m.text}）を達成し、${m.reward}G を受け取った`);
  }
}

function pass(s: GameState) {
  const ph = s.phase;
  if (ph.kind === 'buy') log(s, s.current, `${BOARD[ph.square].name} の購入を見送った`);
  else if (ph.kind === 'build') log(s, s.current, `${BOARD[ph.square].name} には建てなかった`);
  else if (ph.kind === 'buyout') log(s, s.current, `${BOARD[ph.square].name} の買収を見送った`);
  else if (ph.kind === 'push') {
    resolveSquare(s, false);
    return;
  } else throw new GameError('今は見送れません');
  afterAction(s);
}

/** 通行料を払う。払えたら買収の判定へ */
function chargeRent(s: GameState, square: number, rent: number, owner: number) {
  const payer = me(s);
  if (payer.money >= rent) {
    pay(s, rent, owner, square);
    afterRent(s, square);
    return;
  }
  raiseOrBankrupt(s, rent, owner);
}

/** 通行料の処理のあと：買収できるなら buyout の場面へ */
function afterRent(s: GameState, square: number) {
  if (canBuyout(s, square) && me(s).money >= buyoutPrice(s, square)) {
    s.phase = { kind: 'buyout', square };
  } else {
    afterAction(s);
  }
}

function raiseOrBankrupt(s: GameState, amount: number, creditor: number | null) {
  const payer = me(s);
  const canRaise = ownedSquares(s, payer.id).reduce((sum, sq) => sum + sellValue(s, sq), 0);
  if (payer.money + canRaise >= amount) {
    s.phase = { kind: 'liquidate', debt: amount, creditor };
    log(s, payer.id, `所持金が足りない。土地を売って ${amount}G を用意する必要がある`);
    return;
  }
  goBankrupt(s, creditor);
  afterAction(s);
}

function pay(s: GameState, amount: number, creditor: number | null, square?: number) {
  const payer = me(s);
  payer.money -= amount;
  if (creditor !== null) s.players[creditor].money += amount;
  if (creditor !== null && square !== undefined) {
    s.lastPayment = { payer: payer.id, payee: creditor, amount, square };
    s.players[creditor].record.rentIn += amount;
  }
  const to = creditor === null ? '銀行' : s.players[creditor].name;
  log(s, payer.id, `${to} に ${amount}G を支払った`);
}

function removeProperty(s: GameState, square: number) {
  delete s.properties[square];
  s.festivals = s.festivals.filter((x) => x !== square);
}

function sell(s: GameState, square: number) {
  if (s.phase.kind !== 'liquidate') throw new GameError('今は土地を売る場面ではありません');
  const p = me(s);
  const prop = s.properties[square];
  if (!prop || prop.owner !== p.id) throw new GameError('自分の土地ではありません');
  const value = sellValue(s, square);
  removeProperty(s, square);
  p.money += value;
  log(s, p.id, `${BOARD[square].name} を銀行に ${value}G で売った`);

  const { debt, creditor } = s.phase;
  if (p.money >= debt) {
    pay(s, debt, creditor, creditor !== null ? p.position : undefined);
    afterAction(s);
  }
}

function goBankrupt(s: GameState, creditor: number | null, playerId = s.current) {
  const p = s.players[playerId];
  if (creditor !== null && p.money > 0) {
    s.players[creditor].money += p.money;
    log(s, p.id, `残りの ${p.money}G を ${s.players[creditor].name} に渡した`);
  }
  p.money = 0;
  p.bankrupt = true;
  p.hand = [];
  for (const sq of ownedSquares(s, p.id)) removeProperty(s, sq);
  log(s, p.id, `${p.name} は破産した。持っていた土地は空き地に戻る`);

  const alive = s.players.filter((x) => !x.bankrupt);
  if (alive.length === 1) {
    s.phase = { kind: 'gameover', winner: alive[0].id, reason: 'survivor' };
    log(s, null, `${alive[0].name} の勝利（最後の1人）`);
  }
}

/** マスの処理が終わったあと：ゾロ目ならもう一度、そうでなければ次の人へ */
function afterAction(s: GameState) {
  if (s.phase.kind === 'gameover') return;
  const p = me(s);
  if (!p.bankrupt && p.hand.length > CONFIG.handLimit) {
    s.phase = { kind: 'discard', then: 'after' };
    return;
  }
  if (!p.bankrupt && s.doublesInRow > 0) {
    s.phase = { kind: 'roll' };
    log(s, p.id, 'ゾロ目なので、もう一度振れる');
    return;
  }
  endTurn(s);
}

function endTurn(s: GameState) {
  if (s.phase.kind === 'gameover') return;
  const p = me(s);
  if (!p.bankrupt && p.hand.length > CONFIG.handLimit) {
    s.phase = { kind: 'discard', then: 'end' };
    return;
  }
  s.doublesInRow = 0;
  s.cardsUsed = 0;
  const n = s.players.length;
  let order = roundOrder(s.turn, n);
  let k = order.indexOf(s.current);
  let wrapped = false;
  let i: number;
  do {
    k += 1;
    if (k >= n) {
      k = 0;
      wrapped = true;
      order = roundOrder(s.turn + 1, n);
    }
    i = order[k];
  } while (s.players[i].bankrupt);

  // 観光地の守り切り：揃えた人の番が回ってきたとき、まだ4つとも持っていれば勝利
  if (s.touristClaim === i && ownsAllTourist(s, i)) {
    s.phase = { kind: 'gameover', winner: i, reason: 'tourist' };
    log(s, null, `${s.players[i].name} の勝利（観光地をすべて守り切った）`);
    return;
  }

  if (wrapped) {
    if (s.turn >= s.maxTurns) {
      finishByAssets(s);
      return;
    }
    s.turn += 1;
    log(s, null, `ターン${s.turn}：順番は ${roundOrder(s.turn, n).filter((x) => !s.players[x].bankrupt).map((x) => s.players[x].name).join(' → ')}`);
    if (s.turn === s.maxTurns - CONFIG.lastSpurtTurns + 1) {
      log(s, null, `ラストスパート！ 残り${CONFIG.lastSpurtTurns}ターン、通行料が${CONFIG.lastSpurtRate}倍になった`);
    }
  }
  s.current = i;
  s.phase = s.players[i].travelPending ? { kind: 'travel' } : { kind: 'roll' };
}

/** そのターンの手番の順（プレイヤーID の並び） */
export function roundOrder(turn: number, n: number): number[] {
  const base = Array.from({ length: n }, (_, i) => i);
  if (CONFIG.turnOrder === 'rotate') {
    const r = (turn - 1) % n;
    return [...base.slice(r), ...base.slice(0, r)];
  }
  if (CONFIG.turnOrder === 'snake' && turn % 2 === 0) return base.reverse();
  return base;
}

/** 総資産で順位を決める。同額なら所持金が多い方 */
export function rankByAssets(s: GameState): number[] {
  return s.players
    .filter((p) => !p.bankrupt)
    .map((p) => p.id)
    .sort((a, b) => totalAssets(s, b) - totalAssets(s, a) || s.players[b].money - s.players[a].money);
}

function finishByAssets(s: GameState) {
  const winner = rankByAssets(s)[0];
  s.phase = { kind: 'gameover', winner, reason: 'assets' };
  log(s, null, `${s.maxTurns}ターン終了。${s.players[winner].name} の勝利（総資産 ${totalAssets(s, winner)}G）`);
}
