// 3D盤面（Three.js による表示専用モジュール）。GameState を立体で映すだけで、ルールは持たない。
// view.ts から動的 import される（3D表示を選んだときだけ読み込む）。
// マスの選択は Raycaster で拾い、view.ts のタイルタップと同じ入口へ渡す。

import * as THREE from 'three';
import { BOARD, GROUPS, Square } from '../data/board';
import type { GameState } from '../core/game';

/** view.ts から渡される同期情報（DOMタイルの選択可否・強調と同じ状態） */
export interface Board3DHighlight {
  /** いま選べるマス（対象選択フェーズの候補） */
  selectable: ReadonlySet<number>;
  /** 強調するマス（購入・建設の対象など。なければ -1） */
  highlight: number;
}

/** マスの中心間隔と1マスの大きさ（3D空間の単位） */
const STEP = 1.12;
const TILE = 1.04;
/** マスの厚み */
const TILE_H = 0.16;
/** カメラの基本距離。盤面の1辺（約10単位）がほぼ収まる距離にして、寄りすぎないようにする */
const CAM_DIST = 12.3;
/** カメラの基本の見下ろし角（真上から測った角度）。浅すぎず深すぎない斜め見下ろし */
const CAM_POLAR = 0.94;
/** 手番のコマへの追従の強さ。コマを画面中央に固定せず、盤面の文脈が残るよう中心へ少し引き戻す */
const FOLLOW_PULL = 0.5;

/** 9×9 グリッドの行・列 → 3D座標。2D盤面と同じく、行9が手前（南）、列9が右（東） */
function cellToXZ(row: number, col: number): { x: number; z: number } {
  return { x: (col - 5) * STEP, z: (row - 5) * STEP };
}

/** マスの上面の色。土地は色グループの色、特殊マスは種類で見分けられる色にする */
function tileColor(sq: Square): string {
  switch (sq.kind) {
    case 'land':
      return GROUPS[sq.group!].color;
    case 'tourist':
      return '#d9a92c'; // 観光地は金
    case 'start':
      return '#c9a227'; // 始まりの門は真鍮色
    case 'chance':
      return '#9aa3b5'; // 運命の石碑は灰青の石
    case 'island':
      return '#66727f'; // 霧の孤島は暗い岩色
    case 'festival':
      return '#dd8340'; // 収穫祭は橙
    case 'travel':
      return '#8b6bc2'; // 転移の魔法陣は紫
  }
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, opts?: { roughness?: number; metalness?: number; emissive?: string; emissiveIntensity?: number }): THREE.MeshStandardMaterial {
  const key = `${color}|${opts?.roughness ?? ''}|${opts?.metalness ?? ''}|${opts?.emissive ?? ''}|${opts?.emissiveIntensity ?? ''}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: opts?.roughness ?? 0.85,
      metalness: opts?.metalness ?? 0.05,
      ...(opts?.emissive ? { emissive: new THREE.Color(opts.emissive), emissiveIntensity: opts.emissiveIntensity ?? 0.35 } : {}),
    });
    matCache.set(key, m);
  }
  return m;
}

function shade(hex: string, rate: number): string {
  const c = new THREE.Color(hex).multiplyScalar(rate);
  return `#${c.getHexString()}`;
}

function box(w: number, h: number, d: number, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

/** 建物（レベルで形が変わる）。屋根・帯は持ち主の色で塗る */
function buildBuilding(level: number, ownerColor: string): THREE.Group {
  const g = new THREE.Group();
  const wall = mat('#f2ead6');
  const roof = mat(ownerColor);
  const gold = mat('#d9a92c', { metalness: 0.45, roughness: 0.4 });
  if (level === 1) {
    // 別荘：小さな家＋三角屋根
    g.add(box(0.52, 0.3, 0.46, wall, 0, TILE_H + 0.15, 0));
    const r = new THREE.Mesh(new THREE.ConeGeometry(0.46, 0.34, 4), roof);
    r.position.y = TILE_H + 0.3 + 0.17;
    r.rotation.y = Math.PI / 4;
    g.add(r);
  } else if (level === 2) {
    // ビル：高い箱＋持ち主色の帯
    g.add(box(0.56, 0.74, 0.56, wall, 0, TILE_H + 0.37, 0));
    g.add(box(0.66, 0.09, 0.66, roof, 0, TILE_H + 0.74 + 0.045, 0));
    g.add(box(0.34, 0.16, 0.34, wall, 0, TILE_H + 0.83 + 0.08, 0));
  } else if (level === 3) {
    // ホテル：広い1階＋細い2階、間に持ち主色の帯
    g.add(box(0.74, 0.32, 0.74, wall, 0, TILE_H + 0.16, 0));
    g.add(box(0.8, 0.07, 0.8, roof, 0, TILE_H + 0.32 + 0.035, 0));
    g.add(box(0.5, 0.44, 0.5, wall, 0, TILE_H + 0.39 + 0.22, 0));
    g.add(box(0.58, 0.07, 0.58, roof, 0, TILE_H + 0.83 + 0.035, 0));
  } else if (level === 4) {
    // ランドマーク：城。中央塔＋四隅の小塔、金の飾り
    g.add(box(0.8, 0.26, 0.8, mat('#e8d9ae'), 0, TILE_H + 0.13, 0));
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.64, 12), wall);
    tower.position.y = TILE_H + 0.26 + 0.32;
    g.add(tower);
    const tr = new THREE.Mesh(new THREE.ConeGeometry(0.27, 0.32, 12), roof);
    tr.position.y = TILE_H + 0.9 + 0.16;
    g.add(tr);
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), gold);
    finial.position.y = TILE_H + 1.22 + 0.05;
    g.add(finial);
    for (const [sx, sz] of [
      [-0.31, -0.31],
      [0.31, -0.31],
      [-0.31, 0.31],
      [0.31, 0.31],
    ] as const) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.52, 8), wall);
      t.position.set(sx, TILE_H + 0.26, sz);
      g.add(t);
      const cr = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.22, 8), roof);
      cr.position.set(sx, TILE_H + 0.52 + 0.11, sz);
      g.add(cr);
    }
  }
  return g;
}

/** 特殊マスの小さな造形（種類を見分けられるようにする） */
function buildMonument(sq: Square): THREE.Group | null {
  const g = new THREE.Group();
  const brass = mat('#c79a3b', { metalness: 0.4, roughness: 0.45 });
  const gold = mat('#d9a92c', { metalness: 0.5, roughness: 0.35 });
  switch (sq.kind) {
    case 'start': {
      // 鳥居風の門
      g.add(box(0.1, 0.62, 0.1, brass, -0.29, TILE_H + 0.31, 0));
      g.add(box(0.1, 0.62, 0.1, brass, 0.29, TILE_H + 0.31, 0));
      g.add(box(0.84, 0.11, 0.17, brass, 0, TILE_H + 0.64, 0));
      g.add(box(0.62, 0.08, 0.13, brass, 0, TILE_H + 0.47, 0));
      return g;
    }
    case 'tourist': {
      // 金のオベリスク
      g.add(box(0.36, 0.14, 0.36, mat('#8a744a'), 0, TILE_H + 0.07, 0));
      const ob = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.68, 4), gold);
      ob.position.y = TILE_H + 0.14 + 0.34;
      ob.rotation.y = Math.PI / 4;
      g.add(ob);
      return g;
    }
    case 'island': {
      // 岩
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.37, 0), mat('#7a8794', { roughness: 1 }));
      rock.scale.set(1, 0.72, 1);
      rock.position.y = TILE_H + 0.2;
      rock.rotation.y = 0.7;
      g.add(rock);
      const small = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), mat('#66727f', { roughness: 1 }));
      small.scale.set(1, 0.7, 1);
      small.position.set(0.3, TILE_H + 0.1, 0.24);
      g.add(small);
      return g;
    }
    case 'chance': {
      // 石碑
      const tablet = box(0.44, 0.62, 0.1, mat('#aeb6c4'), 0, TILE_H + 0.33, 0);
      tablet.rotation.x = -0.1;
      g.add(tablet);
      g.add(box(0.54, 0.09, 0.24, mat('#8a90a0'), 0, TILE_H + 0.045, 0));
      return g;
    }
    case 'festival': {
      // 太鼓
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.27, 0.3, 14), mat('#b3502e'));
      drum.position.y = TILE_H + 0.15;
      g.add(drum);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.235, 0.04, 14), mat('#f2ead6'));
      top.position.y = TILE_H + 0.31;
      g.add(top);
      return g;
    }
    case 'travel': {
      // 魔法陣の二重リング
      const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.05, 10, 28), mat('#8b6bc2', { emissive: '#8b6bc2' }));
      ring1.rotation.x = Math.PI / 2;
      ring1.position.y = TILE_H + 0.04;
      g.add(ring1);
      const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 10, 24), mat('#b79ce0', { emissive: '#8b6bc2' }));
      ring2.rotation.x = Math.PI / 2;
      ring2.position.y = TILE_H + 0.04;
      g.add(ring2);
      return g;
    }
    default:
      return null;
  }
}

/** 祭り開催中の印（提灯のついた柱）。土地のマスに重ねて出す */
function buildFestivalMark(): THREE.Group {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.66, 8), mat('#7a5c14'));
  pole.position.set(-0.4, TILE_H + 0.33, -0.4);
  g.add(pole);
  const bar = box(0.36, 0.045, 0.045, mat('#7a5c14'), -0.4 + 0.14, TILE_H + 0.62, -0.4);
  g.add(bar);
  const l1 = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), mat('#e2574c', { emissive: '#e2574c', emissiveIntensity: 0.25 }));
  l1.position.set(-0.33, TILE_H + 0.52, -0.4);
  g.add(l1);
  const l2 = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), mat('#f0a13c', { emissive: '#f0a13c', emissiveIntensity: 0.25 }));
  l2.position.set(-0.19, TILE_H + 0.52, -0.4);
  g.add(l2);
  return g;
}

/** マス名のラベル（常にカメラを向くスプライト）。フォント読込後に描き直せるよう、作り直し関数も返す */
function makeLabel(text: string): { sprite: THREE.Sprite; redraw: () => void } {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const redraw = () => {
    const g = canvas.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, canvas.width, canvas.height);
    let size = 31;
    g.font = `700 ${size}px "Zen Kaku Gothic New", "Hiragino Sans", sans-serif`;
    while (g.measureText(text).width > 196 && size > 17) {
      size -= 2;
      g.font = `700 ${size}px "Zen Kaku Gothic New", "Hiragino Sans", sans-serif`;
    }
    const w = Math.min(248, g.measureText(text).width + 30);
    const x = (canvas.width - w) / 2;
    g.beginPath();
    g.roundRect(x, 11, w, 42, 12);
    g.fillStyle = 'rgba(14, 20, 38, 0.58)';
    g.fill();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    g.fillText(text, canvas.width / 2, 33);
    tex.needsUpdate = true;
  };
  redraw();
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(1.34, 0.335, 1);
  return { sprite, redraw };
}

/** プレイヤーのコマ（土台＋カプセル型の体） */
function buildToken(color: string): THREE.Group {
  const g = new THREE.Group();
  const body = mat(color, { roughness: 0.55 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.26, 0.09, 20), body);
  base.position.y = 0.045;
  g.add(base);
  const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(0.155, 0.3, 6, 16), body);
  capsule.position.y = 0.09 + 0.15 + 0.15;
  g.add(capsule);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.215, 0.022, 8, 24), mat('#ffffff', { roughness: 0.4 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.095;
  g.add(rim);
  return g;
}

/** 同じマスに複数コマがいる場合のずらし（最大4人） */
const TOKEN_OFFSETS: [number, number][] = [
  [-0.24, -0.24],
  [0.24, -0.24],
  [-0.24, 0.24],
  [0.24, 0.24],
];

interface TileParts {
  group: THREE.Group;
  top: THREE.Mesh;
  frame: THREE.Mesh;
  selectRing: THREE.Mesh;
  highlightRing: THREE.Mesh;
  festivalMark: THREE.Group;
  building: THREE.Group | null;
  buildingKey: string;
}

export class Board3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private tiles: TileParts[] = [];
  private pickMeshes: THREE.Mesh[] = [];
  private tokens = new Map<number, { group: THREE.Group; target: THREE.Vector3 }>();
  private marker: THREE.Mesh;
  private markerTarget = new THREE.Vector3();
  private markerVisible = false;
  private follow = new THREE.Vector3();
  private followInit = false;
  private lastFollowSquare = -1;
  /** ドラッグによる視点のずれ（目標値と現在値） */
  private az = 0;
  private azT = 0;
  private polar = CAM_POLAR;
  private polarT = CAM_POLAR;
  private active = false;
  private raf = 0;
  private lastTime = 0;
  private raycaster = new THREE.Raycaster();
  private drag: { x: number; y: number; az: number; polar: number; moved: boolean; at: number } | null = null;
  private suppressTapUntil = 0;
  private labelRedraws: (() => void)[] = [];
  private inView = true;

  constructor(
    private holder: HTMLElement,
    cells: { row: number; col: number }[],
    private onTap: (square: number) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.domElement.classList.add('board-3d-canvas');
    holder.append(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.scene.background = new THREE.Color('#26334d');
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x33415e, 1.05));
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.position.set(6, 13, 5);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xbcd0ff, 0.5);
    fill.position.set(-7, 8, -6);
    this.scene.add(fill);

    // 盤面の台
    const base = box(9 * STEP + 0.9, 0.34, 9 * STEP + 0.9, mat('#1d2a44', { roughness: 0.95 }), 0, -0.17, 0);
    this.scene.add(base);

    BOARD.forEach((sq, i) => {
      const { x, z } = cellToXZ(cells[i].row, cells[i].col);
      const group = new THREE.Group();
      group.position.set(x, 0, z);
      const topColor = tileColor(sq);
      const side = mat(shade(topColor, 0.62));
      const top = new THREE.Mesh(
        new THREE.BoxGeometry(TILE, TILE_H, TILE),
        [side, side, mat(topColor), mat(shade(topColor, 0.5)), side, side],
      );
      top.position.y = TILE_H / 2;
      top.userData.square = i;
      group.add(top);
      this.pickMeshes.push(top);

      // 所有者の枠（所有されたらマスの縁に持ち主色の板を出す）
      const frame = box(TILE + 0.12, 0.05, TILE + 0.12, mat('#ffffff'), 0, TILE_H + 0.026, 0);
      frame.visible = false;
      group.add(frame);

      // 選択候補・強調のリング
      const ringGeo = new THREE.RingGeometry(0.36, 0.5, 32);
      const selectRing = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({ color: '#ffd94d', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
      );
      selectRing.rotation.x = -Math.PI / 2;
      selectRing.position.y = TILE_H + 0.07;
      selectRing.visible = false;
      group.add(selectRing);
      const highlightRing = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
      );
      highlightRing.rotation.x = -Math.PI / 2;
      highlightRing.position.y = TILE_H + 0.08;
      highlightRing.visible = false;
      group.add(highlightRing);

      const monument = buildMonument(sq);
      if (monument) group.add(monument);
      const festivalMark = buildFestivalMark();
      festivalMark.visible = false;
      group.add(festivalMark);

      // 土地と観光地には名前ラベル（常にカメラ向きで読める）
      if (sq.kind === 'land' || sq.kind === 'tourist') {
        const { sprite, redraw } = makeLabel(sq.name);
        sprite.position.set(0, 1.48, 0);
        group.add(sprite);
        this.labelRedraws.push(redraw);
      }

      this.scene.add(group);
      this.tiles.push({ group, top, frame, selectRing, highlightRing, festivalMark, building: null, buildingKey: '' });
    });

    // 手番の人のコマの上に浮かぶ目印
    this.marker = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.26, 4),
      mat('#ffd94d', { emissive: '#c79a3b', emissiveIntensity: 0.5, metalness: 0.3, roughness: 0.4 }),
    );
    this.marker.rotation.x = Math.PI;
    this.marker.visible = false;
    this.scene.add(this.marker);

    // Webフォントが届いたらラベルを描き直す（読み込み前は代替フォントで描かれているため）
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      void document.fonts.ready.then(() => this.labelRedraws.forEach((f) => f()));
    }

    this.initPointer();
    new ResizeObserver(() => this.resize()).observe(holder);
    new IntersectionObserver((es) => {
      this.inView = es.some((e) => e.isIntersecting);
    }).observe(holder);
    this.resize();

    // テスト・検証用に holder からインスタンスを辿れるようにしておく
    (holder as unknown as { __board3d?: Board3D }).__board3d = this;
  }

  /** 表示中だけ描画ループを回す */
  setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    if (on) {
      this.resize();
      this.lastTime = performance.now();
      const loop = (t: number) => {
        if (!this.active) return;
        this.tick(t);
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    } else {
      cancelAnimationFrame(this.raf);
    }
  }

  /** GameState の変化を3Dへ反映する（view.ts の render から毎回呼ばれる） */
  sync(s: GameState, shownPositions: number[], hl: Board3DHighlight) {
    BOARD.forEach((sq, i) => {
      const parts = this.tiles[i];
      const prop = s.properties[i];
      // 所有者の枠
      if (prop) {
        (parts.frame.material as THREE.MeshStandardMaterial).color.set(s.players[prop.owner].color);
        parts.frame.visible = true;
      } else {
        parts.frame.visible = false;
      }
      // 建物（持ち主とレベルが変わったときだけ作り直す）
      const key = prop && sq.kind === 'land' ? `${prop.owner}:${prop.level}` : '';
      if (key !== parts.buildingKey) {
        parts.buildingKey = key;
        if (parts.building) {
          parts.group.remove(parts.building);
          parts.building = null;
        }
        if (key) {
          parts.building = buildBuilding(prop!.level, s.players[prop!.owner].color);
          parts.group.add(parts.building);
        }
      }
      parts.festivalMark.visible = s.festivals.includes(i);
      parts.selectRing.visible = hl.selectable.has(i);
      parts.highlightRing.visible = hl.highlight === i;
    });

    // コマの行き先（同じマスでは少しずらす）
    const seen = new Map<number, number>();
    for (const p of s.players) {
      let token = this.tokens.get(p.id);
      if (!token) {
        const group = buildToken(p.color);
        this.scene.add(group);
        token = { group, target: new THREE.Vector3() };
        const start = this.tileXZ(shownPositions[p.id] ?? p.position);
        group.position.set(start.x, TILE_H + 0.05, start.z);
        this.tokens.set(p.id, token);
      }
      token.group.visible = !p.bankrupt;
      if (p.bankrupt) continue;
      const sq = shownPositions[p.id] ?? p.position;
      const order = seen.get(sq) ?? 0;
      seen.set(sq, order + 1);
      const base = this.tileXZ(sq);
      const solo = seenCount(shownPositions, s.players, sq) === 1;
      const [ox, oz] = solo ? [0, 0] : TOKEN_OFFSETS[order % TOKEN_OFFSETS.length];
      token.target.set(base.x + ox, TILE_H + 0.05, base.z + oz);
    }

    // 追従先は手番の人のコマ。コマが別のマスへ移ったら、ドラッグのずれは捨てて追尾へ戻る
    const cur = s.players[s.current];
    const followSq = cur && !cur.bankrupt ? (shownPositions[s.current] ?? cur.position) : -1;
    if (followSq >= 0) {
      const t = this.tileXZ(followSq);
      this.follow.set(t.x, 0, t.z);
      this.markerTarget.copy(this.follow);
      this.markerVisible = true;
      if (!this.followInit) this.followInit = true;
      if (followSq !== this.lastFollowSquare) {
        this.lastFollowSquare = followSq;
        this.azT = 0;
        this.polarT = CAM_POLAR;
      }
    } else {
      this.markerVisible = false;
    }
  }

  private tileXZ(i: number): { x: number; z: number } {
    const p = this.tiles[i].group.position;
    return { x: p.x, z: p.z };
  }

  private tick(now: number) {
    const dt = Math.min(0.05, (now - this.lastTime) / 1000 || 0.016);
    this.lastTime = now;
    if (this.holder.hidden || !this.inView) return;

    // コマを滑らかに追わせる
    const kToken = 1 - Math.exp(-dt * 13);
    for (const token of this.tokens.values()) {
      token.group.position.lerp(token.target, kToken);
    }
    // 目印（手番コマの上の三角）：ふわりと上下させながらコマに追従
    if (this.markerVisible) {
      this.marker.visible = true;
      const mp = this.marker.position;
      mp.x += (this.markerTarget.x - mp.x) * kToken;
      mp.z += (this.markerTarget.z - mp.z) * kToken;
      mp.y = TILE_H + 1.32 + Math.sin(now / 320) * 0.06;
      this.marker.rotation.y = now / 600;
    } else {
      this.marker.visible = false;
    }
    // 選択リングの明滅
    const pulse = 0.55 + 0.35 * Math.sin(now / 240);
    for (const t of this.tiles) {
      if (t.selectRing.visible) (t.selectRing.material as THREE.MeshBasicMaterial).opacity = pulse;
    }

    // カメラ：ドラッグのずれを滑らかに反映しつつ、手番コマ（盤面中心へ少し引き戻した点）を見る
    const kCam = 1 - Math.exp(-dt * 5);
    this.az += (this.azT - this.az) * kCam;
    this.polar += (this.polarT - this.polar) * kCam;
    const look = new THREE.Vector3(this.follow.x * FOLLOW_PULL, 0.15, this.follow.z * FOLLOW_PULL);
    const sp = Math.sin(this.polar);
    const off = new THREE.Vector3(
      CAM_DIST * sp * Math.sin(this.az),
      CAM_DIST * Math.cos(this.polar),
      CAM_DIST * sp * Math.cos(this.az),
    );
    this.camera.position.copy(look).add(off);
    this.camera.lookAt(look);
    this.renderer.render(this.scene, this.camera);
  }

  private resize() {
    const w = this.holder.clientWidth;
    const h = this.holder.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** マス中心の画面座標（検証用）。盤面の外なら null */
  project(square: number): { x: number; y: number } | null {
    const t = this.tileXZ(square);
    const v = new THREE.Vector3(t.x, 0.5, t.z).project(this.camera);
    if (v.z > 1) return null;
    const rect = this.holder.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  private initPointer() {
    const canvas = this.renderer.domElement;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, y: e.clientY, az: this.azT, polar: this.polarT, moved: false, at: performance.now() };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 7) return;
      d.moved = true;
      this.azT = THREE.MathUtils.clamp(d.az + dx * 0.005, -0.9, 0.9);
      this.polarT = THREE.MathUtils.clamp(d.polar + dy * 0.003, 0.58, 1.28);
    });
    const end = (e: PointerEvent) => {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      if (d.moved) {
        // ドラッグ直後のタップ誤認を防ぐ
        this.suppressTapUntil = performance.now() + 250;
        return;
      }
      if (performance.now() < this.suppressTapUntil) return;
      this.tapAt(e.clientX, e.clientY);
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', () => {
      this.drag = null;
    });
  }

  /** タップ位置のマスを Raycaster で拾って view へ渡す */
  private tapAt(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickMeshes, false);
    const sq = hits[0]?.object.userData.square as number | undefined;
    if (sq !== undefined) this.onTap(sq);
  }
}

/** そのマスにいる（破産していない）プレイヤー数。コマをずらすかどうかの判定に使う */
function seenCount(shownPositions: number[], players: GameState['players'], sq: number): number {
  return players.filter((p) => !p.bankrupt && (shownPositions[p.id] ?? p.position) === sq).length;
}
