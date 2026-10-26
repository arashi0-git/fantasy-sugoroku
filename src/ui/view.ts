// 画面の描画。GameState を受け取って DOM を作るだけで、ルールは持たない。

import { BOARD, GROUPS, Square, SquareKind } from '../data/board';
import { CardId, CARDS } from '../data/cards';
import { CHARACTER_LIST, CHARACTERS, CharacterId, STAT_NAMES, STAT_ORDER, STAT_TEXT } from '../data/characters';
import { CONFIG, LEVEL, LEVEL_NAMES } from '../data/config';
import { MISSIONS } from '../data/missions';
import {
  Action,
  actorOf,
  aimHitRateOf,
  canFly,
  chainLength,
  flyTargets,
  buildOptions,
  cardUsable,
  earthquakeTargets,
  festivalLimit,
  festivalTargets,
  sealTargets,
  Aim,
  AIM_ZONES,
  blessingTargets,
  buyOptions,
  buyoutPrice,
  choiceTargets,
  completedGroups,
  GameState,
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
  rentAt,
  rentOf,
  salaryFor,
  sellValue,
  totalAssets,
  touristCount,
  TOURIST_SQUARES,
  TRIPLE_GROUPS,
  WinReason,
} from '../core/game';

export interface ViewHandlers {
  roll(aim?: Aim): void;
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
  restart(): void;
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
      const tile = el('div', `tile side-${side}`);
      tile.style.gridRow = String(row);
      tile.style.gridColumn = String(col);
      if (sq.kind !== 'land') tile.classList.add('special');
      if (isCorner(sq)) tile.classList.add('corner');
      if (sq.group) tile.style.setProperty('--band', GROUPS[sq.group].color);
      const fest = el('span', 'fest-badge', '祭');
      fest.title = '祭り開催中（通行料2倍）';
      tile.append(el('div', 'band'), el('div', 'name', sq.name), el('div', 'sub'), el('div', 'lv'), fest, el('div', 'tokens'));
      tile.addEventListener('click', () => {
        if (tile.classList.contains('selectable')) this.onTileClick?.(sq.index);
      });
      tile.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && tile.classList.contains('selectable')) {
          e.preventDefault();
          this.onTileClick?.(sq.index);
        }
      });
      this.tiles.push(tile);
      this.boardEl.append(tile);
    }
    requestAnimationFrame(this.tickGauge);
  }

  private human = 0;
  /** 盤面がこの幅（px）より小さいときは、操作パネルを盤面の中に収めず、横の列（スマホでは盤面の下）に出す */
  private static readonly COMPACT_BOARD = 760;
  private compact = false;
  private last: [GameState, ViewExtras] | null = null;

  /** 使おうとしている攻めのカード（対象を選んでいる途中）。場面が変わったら取り消す */
  private pendingCard: CardId | null = null;
  /** 天翔の行き先を選んでいる途中 */
  private pendingFly = false;
  private pendingKey = '';

  render(s: GameState, x: ViewExtras) {
    this.last = [s, x];
    this.human = x.human;
    // いま決めるのがあなたか（守りのカードの割り込みでは、相手の手番でもあなたが決めることがある）
    const myTurn = actorOf(s) === x.human && s.phase.kind !== 'gameover' && !x.busy;
    const key = `${s.turn}:${s.current}:${s.phase.kind}:${s.cardsUsed}`;
    if (key !== this.pendingKey || !myTurn) {
      this.pendingCard = null;
      this.pendingFly = false;
    }
    this.pendingKey = key;
    this.renderTiles(s, x, myTurn);
    this.renderCenter(s, x, myTurn);
    this.renderHand(s, x, myTurn);
    this.renderPlayers(s, x);
    this.renderLog(s, x);
  }

  /** 手札のカードを使う。対象が必要なカードは、対象選びの画面にする */
  private startCard(card: CardId) {
    if (card === 'treasure') {
      this.h.useCard({ type: 'useCard', card });
      return;
    }
    this.pendingCard = card;
    if (this.last) this.render(...this.last);
  }

  private cancelCard = () => {
    this.pendingCard = null;
    this.pendingFly = false;
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
    const targets = choiceTargets(s);
    if (targets.length) return { targets: new Set(targets), onPick: (sq) => this.h.choose(sq) };
    return null;
  }

  private renderTiles(s: GameState, x: ViewExtras, myTurn: boolean) {
    const sel = this.selectable(s, myTurn);
    this.onTileClick = sel?.onPick ?? null;
    const ph = s.phase;
    const highlight = (ph.kind === 'buy' || ph.kind === 'build' || ph.kind === 'buyout') && !x.busy ? ph.square : -1;

    BOARD.forEach((sq, i) => {
      const tile = this.tiles[i];
      const sub = tile.querySelector('.sub')!;
      const prop = s.properties[i];

      if (sq.kind === 'land' || sq.kind === 'tourist') {
        sub.textContent = prop ? `${s.players[prop.owner].name}・${fmt(rentOf(s, i))}` : fmt(landPrice(i));
      } else if (!isCorner(sq)) {
        sub.textContent = KIND_LABEL[sq.kind];
      }

      const lv = tile.querySelector('.lv')!;
      lv.replaceChildren(
        ...(prop && prop.level > 0
          ? Array.from({ length: prop.level }, () => el('span', prop.level === LEVEL.LANDMARK ? 'mark' : ''))
          : []),
      );

      tile.classList.toggle('owned', !!prop);
      if (prop) tile.style.setProperty('--owner', s.players[prop.owner].color);
      tile.classList.toggle('festival-on', s.festivals.includes(i));
      const pickable = !!sel?.targets.has(i);
      tile.classList.toggle('selectable', pickable);
      tile.classList.toggle('danger', pickable && (ph.kind === 'liquidate' || this.pendingCard === 'earthquake' || this.pendingCard === 'raid'));
      if (pickable) {
        tile.tabIndex = 0;
        tile.setAttribute('role', 'button');
      } else {
        tile.removeAttribute('tabindex');
        tile.removeAttribute('role');
      }
      tile.classList.toggle('highlight', highlight === i);
      tile.title = this.tileTitle(s, sq);

      const tokens = tile.querySelector('.tokens')!;
      tokens.replaceChildren(
        ...s.players
          .filter((p) => !p.bankrupt && x.shownPositions[p.id] === i)
          .map((p) => {
            const t = el('span', 'token' + (p.id === s.current ? ' active' : ''));
            t.style.setProperty('--c', p.color);
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
      return `${sq.name}（観光地）\n価格 ${fmt(CONFIG.touristPrice)} / ${owner}\n通行料は持っている観光地の数で上がる`;
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
    const chain = prop ? chainLength(s, sq.index) : 0;
    const bonus = CONFIG.chainBonus[Math.min(chain, CONFIG.chainBonus.length - 1)] ?? 0;
    const chainText = bonus > 0 ? `\n${chain}マス連続で通行料+${Math.round(bonus * 100)}%` : '';
    return `${sq.name}（${g.name}）\n価格 ${fmt(g.price)} / ${owner}${fest}${chainText}`;
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
      host.append(this.resultPanel(s));
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
    if (x.speech && !this.pendingCard && !this.pendingFly) host.append(this.speechBubble(s, x.speech, merged ? s.lastCard : null));

    // 観光地の守り切り中は、ずっと知らせる
    if (s.touristClaim !== null && !this.pendingCard && !this.pendingFly) {
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

    // 直前の出来事（カード・支払い・ゾロ目）。カードの対象を選んでいる間は、場所を空けるために出さない
    if (!x.busy && !this.pendingCard && !this.pendingFly) {
      const ph = s.phase.kind;
      if (s.lastMission) host.append(this.missionNotice(s));
      if (s.lastCard && !merged) host.append(this.cardNotice(s));
      if (s.lastPayment && ph !== 'buyout') host.append(this.paymentNotice(s));
      if (ph === 'roll' && s.doublesInRow > 0) host.append(el('p', 'notice', 'ゾロ目！ もう一度振れます'));
    }

    const panel = this.pendingFly
      ? this.flyPanel()
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
      wrap.append(actions);
      wrap.append(el('p', 'hint', `止めたゾーンの出目が出やすくなります（${Math.round(aimHitRateOf(me) * 100)}%）`));
      if (myTurn) queueMicrotask(() => b.focus());
      return wrap;
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
      p.append(' 足りない。売る土地を選んでください（売値は投資額の半分）。');
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

  private paymentNotice(s: GameState): HTMLElement {
    const pay = s.lastPayment!;
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

  private resultPanel(s: GameState): HTMLElement {
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
        else name.append(el('span', 'cpu-tag you', 'あなた'));
        row.append(name, el('span', 'money', p.bankrupt ? '破産' : fmt(p.money)));
        li.append(row);
        if (p.character) {
          const c = CHARACTERS[p.character];
          const trait = el('div', 'trait');
          trait.append(el('span', 'trait-name', `${c.title}・${c.trait.name}`));
          if (c.rare) trait.append(el('span', 'rare-badge small', 'レア'));
          trait.append(` ${c.trait.text}`);
          li.append(trait);
          li.append(this.statRow(p.character));
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

  /** ステータスの小さな表示（収入●●●○○ …） */
  private statRow(id: CharacterId, big = false): HTMLElement {
    const row = el('dl', big ? 'stats big' : 'stats');
    for (const st of STAT_ORDER) {
      const v = CHARACTERS[id].stats[st];
      const item = el('div', `stat ${v > 3 ? 'up' : v < 3 ? 'down' : ''}`);
      item.title = `${STAT_NAMES[st]} ${v}：${STAT_TEXT[st]}`;
      const pips = el('dd', 'pips');
      for (let i = 1; i <= 5; i++) pips.append(el('span', i <= v ? 'on' : ''));
      item.append(el('dt', '', STAT_NAMES[st]), pips);
      row.append(item);
    }
    return row;
  }

  /** 起動直後のタイトル画面。「はじめる」でキャラ選びへ進む */
  showTitle(host: HTMLElement, onStart: () => void) {
    host.replaceChildren();
    host.hidden = false;
    const wrap = el('div', 'title-wrap');
    wrap.append(el('p', 'title-kicker', 'すごろく型・資産ゲーム'));
    wrap.append(el('h1', 'title-logo', 'ファンタジーすごろく'));
    wrap.append(el('p', 'title-tagline', '土地を買って、建てて、独占を狙え。'));
    const icons = el('p', 'title-icons');
    icons.append(el('span', '', '🎲'), el('span', '', '🏰'), el('span', '', '🪙'));
    wrap.append(icons);
    const startBtn = el('button', 'title-start', 'ゲームをはじめる');
    startBtn.addEventListener('click', () => {
      host.hidden = true;
      onStart();
    });
    wrap.append(startBtn);
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

  /** ゲーム開始前のキャラ選び */
  showCharacterSelect(host: HTMLElement, onPick: (id: CharacterId) => void) {
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
    for (const c of CHARACTER_LIST) {
      const li = el('li');
      const card = el('button', 'char-card' + (c.rare ? ' rare' : ''));
      card.style.setProperty('--c', c.color);
      const head = el('div', 'char-head');
      head.append(el('span', 'char-title', c.title), el('span', 'char-name', c.name));
      if (c.rare) head.append(el('span', 'rare-badge', 'レア'));
      const trait = el('div', 'char-trait');
      trait.append(el('span', 'trait-name', c.trait.name), el('span', 'trait-text', c.trait.text));
      card.append(head, this.statRow(c.id, true), trait);
      card.addEventListener('click', () => {
        host.hidden = true;
        onPick(c.id);
      });
      li.append(card);
      (c.rare ? rareGrid : grid).append(li);
    }
    wrap.append(grid);
    const rareHead = el('div', 'select-rare-head');
    rareHead.append(el('h2', '', 'レアキャラ'), el('p', '', '特性が強く、ほかのプレイヤーに直接手を出せるキャラです。CPUとして出てくることもあります。'));
    wrap.append(rareHead, rareGrid);
    host.append(wrap);
    queueMicrotask(() => (grid.querySelector('button') as HTMLButtonElement | null)?.focus());
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
