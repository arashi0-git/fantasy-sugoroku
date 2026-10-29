import './ui/style.css';
import { BOARD_SIZE } from './data/board';
import { Action, actorOf, applyAction, createGame, GameError, GameState, rankByAssets } from './core/game';
import { decideCpu } from './ai/cpu';
import { cpuLine } from './ai/speech';
import { PERSONALITIES, Personality } from './ai/personality';
import { CHARACTER_LIST, CHARACTERS, CharacterId } from './data/characters';
import { NavTab, SpeedMode, View, ViewExtras } from './ui/view';
import { playForLog, setSoundEnabled, soundEnabled } from './ui/sound';
import { applyGameResult, levelOf, loadProfile, Profile, saveProfile } from './meta/profile';
import { drawGacha, seededRand } from './meta/gacha';
import { grownStats } from './meta/growth';

/** あなたのプロフィール（コイン・所持キャラ・経験値）。対戦が終わるたびに更新して保存する */
let profile: Profile = loadProfile();

// あなたの席（順番）はゲームごとにランダム。あなただけ人間が操作し、残りの3人はCPUが動かす
let HUMAN = 0;
/** 席ごとの色（キャラの色ではなく席で決める。1P 赤・2P 青・3P 黄・4P 緑） */
const SEAT_COLORS = ['#d8453a', '#3a74d8', '#e0ad1f', '#2f9e57'];
/** 席ごとの CPU の性格（人間の席は null）。キャラを選んだときに決まる */
let SEAT_PERSONALITY: (Personality | null)[] = [];

const STEP_MS = 170;
const ROLL_MS = 650;
const WARP_MS = 350;
/** CPU が1つ行動するまでの間（何をしたか目で追えるように） */
const CPU_THINK_MS = 1000;
/** CPU が一言しゃべったあと、読めるように待つ時間 */
const SPEECH_MS = 1400;
/** CPU の行動の結果（出来事の帯や通知）を読むための間 */
const CPU_RESULT_MS = 600;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** CPUの手番の速度（ふつう／速い／スキップ）。待ち時間を倍率で縮める */
const SPEED_FACTOR: Record<SpeedMode, number> = { normal: 1, fast: 0.35, skip: 0.02 };
let speedMode: SpeedMode = 'normal';
try {
  const saved = window.localStorage.getItem('fs-speed');
  if (saved === 'fast' || saved === 'skip') speedMode = saved;
} catch {
  /* 保存できない環境ではふつうのまま */
}
const wait = (ms: number) =>
  new Promise((r) => setTimeout(r, reducedMotion ? Math.min(ms * SPEED_FACTOR[speedMode], 120) : ms * SPEED_FACTOR[speedMode]));

let state: GameState;
let extras: ViewExtras;
/** ゲームを作り直したら増える。古いゲームの CPU 処理を止めるため */
let generation = 0;

const view = new View(
  document.getElementById('board')!,
  document.getElementById('center')!,
  document.getElementById('players')!,
  document.getElementById('log')!,
  document.getElementById('dock')!,
  document.getElementById('hand')!,
  {
    roll: (aim) => humanAct({ type: 'roll', aim }),
    reroll: (use) => humanAct({ type: 'reroll', use }),
    escape: () => humanAct({ type: 'payEscape' }),
    buy: (level) => humanAct({ type: 'buy', level }),
    build: (level) => humanAct({ type: 'build', level }),
    buyout: () => humanAct({ type: 'buyout' }),
    useCard: (action) => humanAct(action),
    adjust: (delta) => humanAct({ type: 'adjust', delta }),
    react: (use) => humanAct({ type: 'react', use }),
    pick: (index) => humanAct({ type: 'pick', index }),
    discard: (index) => humanAct({ type: 'discard', index }),
    choose: (square) => humanAct({ type: 'choose', square }),
    pass: () => humanAct({ type: 'pass' }),
    sell: (square) => humanAct({ type: 'sell', square }),
    fly: (square) => humanAct({ type: 'fly', square }),
    puppet: (delta) => humanAct({ type: 'puppet', delta }),
    push: (target, dir) => humanAct({ type: 'push', target, dir }),
    gamble: (use) => humanAct({ type: 'gamble', use }),
    tradeOffer: (offer) => humanAct({ type: 'offerTrade', ...offer }),
    tradeAnswer: (accept) => humanAct({ type: 'answerTrade', accept }),
    restart: () => goTo('select'),
  },
);

// 設定パネル（歯車ボタン）への受け口：対戦速度と効果音の実体は main／sound 側にあり、
// パネルの表示と操作はここ経由で行う。保存キー（fs-speed／fs-sound）は従来どおり。
view.setSettingsHooks({
  getSpeed: () => speedMode,
  setSpeed: (mode) => {
    speedMode = mode;
    try {
      window.localStorage.setItem('fs-speed', speedMode);
    } catch {
      /* 保存できなくても切り替え自体は有効 */
    }
  },
  getSound: () => soundEnabled(),
  setSound: (on) => setSoundEnabled(on),
});

// ---- 画面遷移とブラウザ履歴の連携 ----
// 画面は5つ：タイトル（ホーム）／キャラ選択／ガチャ／コレクション／対戦。
// 遷移はすべて goTo / requestNav を通し、履歴（pushState）と下部タブバーの状態を揃える。
type AppScreen = 'title' | 'select' | 'gacha' | 'collection' | 'game';
const SCREEN_NAMES: Record<AppScreen, string> = {
  title: 'ホーム',
  select: 'キャラ選択',
  gacha: 'ガチャ',
  collection: 'コレクション',
  game: '対戦',
};
let screen: AppScreen = 'title';
/** 対戦が存在するか（破棄したら false。履歴で「対戦」に戻っても復元はできない） */
let hasGame = false;
/**
 * 保留中の対戦開始リクエストの世代。画面遷移のたびに進め、
 * 先読み完了を待っている間に別の画面へ移ったら、古いリクエストを無効化する
 */
let startToken = 0;

function pushScreen(target: AppScreen) {
  try {
    history.pushState({ fsScreen: target }, '');
  } catch {
    /* 履歴に積めない環境でも画面遷移自体は続ける */
  }
}

function replaceScreen(target: AppScreen) {
  try {
    history.replaceState({ fsScreen: target }, '');
  } catch {
    /* 同上 */
  }
}

/** 現在のブラウザ履歴エントリが指している画面（履歴に積まれていない場合は null） */
function currentHistoryScreen(): AppScreen | null {
  try {
    return (history.state as { fsScreen?: AppScreen } | null)?.fsScreen ?? null;
  } catch {
    return null;
  }
}

/** タブバーの見た目を現在の画面に合わせる */
function syncNavBar() {
  const over = screen === 'game' && hasGame && state.phase.kind === 'gameover';
  view.setNavState({
    active: screen === 'title' ? 'home' : screen === 'gacha' ? 'gacha' : screen === 'collection' ? 'collection' : null,
    lockMeta: screen === 'game' && !over,
  });
}

/** 実際の画面切り替え。push=true ならブラウザ履歴に積む */
function goTo(target: AppScreen, push = true) {
  // どの画面へ移っても、保留中の開始リクエスト（先読み待ち）は無効になる
  startToken += 1;
  if (target === 'select') {
    // 対戦開始の可否は、この共通パスで一元的に強制する（入口がタイトルボタンでも
    // ブラウザ履歴でも、ここを通らない限りキャラ選択＝対戦開始には進めない）
    if (view.boardFailed) {
      // 3Dを表示できない環境では進ませない。履歴の指す先をタイトルに置き換え、
      // タイトルに留まってエラーを出す
      target = 'title';
      push = false;
      replaceScreen('title');
    } else if (view.boardPending) {
      // 先読みが終わるまで現在の画面に留まり、完了したら改めて選択画面へ進む。
      // その間に別の画面へ移っていたら（startToken が進んでいたら）取りやめる
      const token = startToken;
      void view.waitBoardReady().then(() => {
        if (token !== startToken) return;
        // 履歴経由の保留（push=false）は、適用する時点で現在の履歴エントリが
        // まだキャラ選択を指している場合にだけ進める。そのあと「進む」で
        // タイトルへ戻っていたら、履歴と画面が食い違うので取りやめる
        if (!push && currentHistoryScreen() !== 'select') return;
        goTo('select', push);
      });
      return;
    }
  }
  screen = target;
  if (push) pushScreen(target);
  // 3D盤面の描画ループは画面遷移に連動させる（対戦画面の間だけ回す）。
  // 履歴で終了済みの対戦へ戻る場合も、ここを通ることで盤面が再び動き出す
  view.setBoardWanted(target === 'game');
  const titleEl = document.getElementById('title')!;
  const selectEl = document.getElementById('select')!;
  if (target === 'title') {
    selectEl.hidden = true;
    showTitleScreen();
  } else if (target === 'gacha') {
    titleEl.hidden = true;
    openGacha();
  } else if (target === 'collection') {
    titleEl.hidden = true;
    openCollection();
  } else if (target === 'select') {
    titleEl.hidden = true;
    start();
  } else {
    // 対戦画面は .app そのもの。両方のオーバーレイを閉じて盤面を見せる
    titleEl.hidden = true;
    selectEl.hidden = true;
  }
  syncNavBar();
}

/** 対戦を破棄する（CPU の処理ループを止め、対戦が存在しない状態にする） */
function leaveGame() {
  generation += 1;
  hasGame = false;
}

/**
 * 遷移のリクエスト。対戦の途中から別の画面へ行くときは確認ダイアログを挟む。
 * fromPop=true はブラウザの戻る／進む経由：キャンセルされたら履歴を対戦に戻して帳尻を合わせる。
 */
async function requestNav(target: AppScreen, push = true, fromPop = false) {
  if (target === screen) return;
  if (target === 'game' && !hasGame) {
    // 破棄済みの対戦には戻れない。履歴の指す先をタイトルに置き換えてホームへ
    replaceScreen('title');
    goTo('title', false);
    return;
  }
  if (screen === 'game' && hasGame && state.phase.kind !== 'gameover') {
    const ok = await view.confirmDialog(
      `対戦の途中です。対戦をやめて、${SCREEN_NAMES[target]}へ移動しますか？`,
      '対戦をやめて移動する',
    );
    if (!ok) {
      if (fromPop) pushScreen('game');
      return;
    }
    leaveGame();
  }
  goTo(target, push);
}

// ブラウザの戻る／進む：履歴に積んだ画面へ、履歴を増やさずに戻る
window.addEventListener('popstate', (e) => {
  // 履歴が動いた時点で、先読み完了待ちの開始リクエストは古くなる。
  // 現在の画面と同じエントリへの移動（同画面 popstate）でも早期 return で
  // 取りこぼさないよう、遷移先の判定より前に必ず無効化する
  startToken += 1;
  const target = (e.state as { fsScreen?: AppScreen } | null)?.fsScreen;
  if (!target || target === screen) return;
  void requestNav(target, false, true);
});

// 下部タブバーからの遷移
view.setNavHandler((tab: NavTab) => {
  void requestNav(tab === 'home' ? 'title' : tab);
});

/** キャラ選びの画面を出し、選んだらゲームを始める */
function start() {
  generation += 1;
  view.showCharacterSelect(document.getElementById('select')!, begin, profile);
}

function begin(mine: CharacterId) {
  // CPU は残りの7人からランダムに3人
  const others = CHARACTER_LIST.map((c) => c.id).filter((id) => id !== mine);
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  // 最初の順番はゲームごとにランダム（ターンごとに先頭が1人ずつずれる）
  HUMAN = Math.floor(Math.random() * 4);
  const chars = others.slice(0, 3);
  chars.splice(HUMAN, 0, mine);
  const setup = chars.map((id, i) => ({
    name: CHARACTERS[id].name,
    color: SEAT_COLORS[i],
    character: id,
    // 育成の成長が効くのは、あなたのキャラだけ（CPU は素のステータス）
    ...(i === HUMAN ? { stats: grownStats(id, levelOf(profile, id)) } : {}),
  }));
  SEAT_PERSONALITY = chars.map((id, i) => (i === HUMAN ? null : PERSONALITIES[CHARACTERS[id].personality]));
  generation += 1;
  state = createGame(setup);
  screen = 'game';
  hasGame = true;
  pushScreen('game');
  extras = {
    shownPositions: state.players.map((p) => p.position),
    dice: null,
    rolling: false,
    busy: false,
    human: HUMAN,
    labels: SEAT_PERSONALITY.map(() => null),
    speech: null,
    sayLog: [],
    profile,
    reward: null,
  };
  // 対戦画面への入口は goTo を通らないので、描画ループの有効化もここで行う
  view.setBoardWanted(true);
  view.render(state, extras);
  syncNavBar();
  void runCpu();
}

async function humanAct(action: Action) {
  if (extras.busy || actorOf(state) !== HUMAN) return;
  // 前の手番の CPU の一言は、あなたが動いたら消す（割り込みで答えている間は残す）
  if (extras.speech && extras.speech.current !== state.current) extras.speech = null;
  await act(action);
  void runCpu();
}

/** CPU の手番が続くあいだ、1つずつ行動させる */
async function runCpu() {
  const gen = generation;
  while (gen === generation && state.phase.kind !== 'gameover' && actorOf(state) !== HUMAN) {
    await wait(CPU_THINK_MS);
    if (gen !== generation || extras.busy) return;
    const actor = actorOf(state);
    const pers = SEAT_PERSONALITY[actor]!;
    const action = decideCpu(state, pers, Math.random);
    const line = cpuLine(state, pers, action);
    if (line) {
      extras.speech = { player: actor, text: line, turn: state.turn, current: state.current };
      extras.sayLog.push({ at: state.log.length, player: actor, text: line });
      view.render(state, extras);
    } else if (extras.speech && (extras.speech.turn !== state.turn || extras.speech.current !== state.current)) {
      extras.speech = null;
    }
    await act(action);
    if (gen !== generation) return;
    // 行動の結果を読む間。一言があったときは吹き出し分、長めに待つ
    await wait(line ? SPEECH_MS : CPU_RESULT_MS);
  }
}

async function act(action: Action) {
  if (extras.busy) return;
  let next: GameState;
  try {
    next = applyAction(state, action);
  } catch (e) {
    if (e instanceof GameError) {
      console.warn(e.message);
      return;
    }
    throw e;
  }
  playForLog(next.log.slice(state.log.length).map((e) => e.text), action.type);
  const gen = generation;
  extras.busy = true;

  if (next.rolled) {
    // サイコロを振る演出
    extras.rolling = true;
    const spin = setInterval(() => {
      extras.dice = [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
      view.render(state, extras);
    }, 80);
    await wait(ROLL_MS);
    clearInterval(spin);
    extras.rolling = false;
    extras.dice = next.rolled;
    view.render(state, extras);
    // サイコロが止まる演出がまだ続いているので、終わってからコマを動かす
    // （出目が確定しないうちにピンが歩き出すと、出目が読み取りにくいため）。
    // スキップ時は待ちを最小化するため待たない
    if (speedMode !== 'skip') await view.diceSettled();
  }

  // コマの動き：walk は1マスずつ、warp は一瞬で
  for (const m of next.moves) {
    if (gen !== generation) return;
    if (m.kind === 'walk') {
      const steps = (m.to - m.from + BOARD_SIZE) % BOARD_SIZE;
      for (let k = 1; k <= steps; k++) {
        extras.shownPositions[m.player] = (m.from + k) % BOARD_SIZE;
        view.render(state, extras);
        await wait(STEP_MS);
      }
    } else {
      await wait(WARP_MS / 2);
      extras.shownPositions[m.player] = m.to;
      view.render(state, extras);
      await wait(WARP_MS / 2);
    }
  }

  if (gen !== generation) return;
  extras.busy = false;
  state = next;
  extras.shownPositions = state.players.map((p) => p.position);
  view.render(state, extras);
  settleReward();
  syncNavBar();
}

/** 対戦が終わっていたら、報酬（コイン・経験値）を1回だけ確定して保存する */
let rewardedState: GameState | null = null;
function settleReward() {
  if (state.phase.kind !== 'gameover' || rewardedState === state) return;
  rewardedState = state;
  const me = state.players[HUMAN];
  if (!me.character) return;
  const rank = me.bankrupt ? 4 : rankByAssets(state).indexOf(HUMAN) + 1;
  const { profile: next, reward } = applyGameResult(profile, me.character, {
    rank,
    won: state.phase.winner === HUMAN,
    reason: state.phase.reason,
  });
  profile = next;
  saveProfile(profile);
  extras.profile = profile;
  extras.reward = { ...reward, charName: CHARACTERS[me.character].name, rank };
  view.render(state, extras);
}

/** タイトル画面（コイン・称号・装備テーマを反映。ガチャ・コレクションへの導線は下部タブバー） */
function showTitleScreen() {
  view.showTitle(document.getElementById('title')!, () => void startFlow(), profile, view.boardFailed);
}

/**
 * 「ゲームをはじめる」の先。対戦開始の可否（3D盤面の先読みの成否）は、
 * 共通の遷移パスである goTo('select') が一元的に強制する：
 * 先読み中は完了まで遷移を保留し、失敗していたら対戦を始めずタイトルに留まって
 * エラーを出す（2Dへの代替表示はしない。通常のゲームと同様、表示できない環境では始めない）。
 * 入口ごとの個別チェックに頼らず、ここでは共通パスへ委ねるだけにする
 */
function startFlow() {
  goTo('select');
}

function openGacha() {
  view.showGacha(document.getElementById('select')!, profile, {
    draw: (count) => {
      const out = drawGacha(profile, count, seededRand(Date.now()));
      if (!out) return null;
      profile = out.profile;
      saveProfile(profile);
      return out;
    },
    back: () => goTo('title'),
  });
}

function openCollection() {
  view.showCollection(document.getElementById('select')!, profile, {
    equip: (kind, id) => {
      profile = { ...profile, equipped: { ...profile.equipped, [kind]: id } };
      saveProfile(profile);
      return profile;
    },
    back: () => goTo('title'),
  });
}

/** 起動直後はタイトル画面。「はじめる」を押したらキャラ選びへ */
function boot() {
  replaceScreen('title');
  // 3D盤面の先読みの成否が確定したら、失敗の場合だけタイトルにエラーを出す
  view.setBoardStatusHandler((ok) => {
    if (!ok && screen === 'title') showTitleScreen();
  });
  showTitleScreen();
  syncNavBar();
}

boot();
