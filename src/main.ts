import './ui/style.css';
import { BOARD_SIZE } from './data/board';
import { Action, actorOf, applyAction, createGame, GameError, GameState } from './core/game';
import { decideCpu } from './ai/cpu';
import { cpuLine } from './ai/speech';
import { PERSONALITIES, Personality } from './ai/personality';
import { CHARACTER_LIST, CHARACTERS, CharacterId } from './data/characters';
import { View, ViewExtras } from './ui/view';

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
const wait = (ms: number) => new Promise((r) => setTimeout(r, reducedMotion ? Math.min(ms, 120) : ms));

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
    restart: () => start(),
  },
);

/** キャラ選びの画面を出し、選んだらゲームを始める */
function start() {
  generation += 1;
  view.showCharacterSelect(document.getElementById('select')!, begin);
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
  }));
  SEAT_PERSONALITY = chars.map((id, i) => (i === HUMAN ? null : PERSONALITIES[CHARACTERS[id].personality]));
  generation += 1;
  state = createGame(setup);
  extras = {
    shownPositions: state.players.map((p) => p.position),
    dice: null,
    rolling: false,
    busy: false,
    human: HUMAN,
    labels: SEAT_PERSONALITY.map(() => null),
    speech: null,
    sayLog: [],
  };
  view.render(state, extras);
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
}

/** 起動直後はタイトル画面。「はじめる」を押したらキャラ選びへ */
function boot() {
  view.showTitle(document.getElementById('title')!, start);
}

boot();
