import { describe, expect, it } from 'vitest';
import {
  applyGameResult,
  defaultProfile,
  gameReward,
  levelForXp,
  levelOf,
  levelThreshold,
  loadProfile,
  maxLevelFor,
  parseProfile,
  saveProfile,
  serializeProfile,
  STARTER_CHAR_IDS,
  unownedChars,
  xpProgress,
} from './profile';

describe('プロフィールの保存・読み込み', () => {
  it('デフォルトはスターター8人を持ち、コイン0', () => {
    const p = defaultProfile();
    expect(p.ownedCharIds).toEqual(STARTER_CHAR_IDS);
    expect(p.ownedCharIds).toHaveLength(8);
    expect(p.coins).toBe(0);
    expect(p.pity).toBe(0);
  });

  it('保存して読み戻すと中身が一致する', () => {
    const p = defaultProfile();
    p.coins = 350;
    p.ownedCharIds = [...STARTER_CHAR_IDS, 'chrono'];
    p.charXp = { bald: 12 };
    p.limitBreak = { chrono: 2 };
    p.pity = 7;
    p.ownedCosmetics = ['frame-gold'];
    p.equipped.frame = 'frame-gold';
    const back = parseProfile(serializeProfile(p));
    expect(back).toEqual(p);
  });

  it('壊れた JSON・空・版違いはデフォルトに戻る', () => {
    expect(parseProfile(null)).toEqual(defaultProfile());
    expect(parseProfile('{oops')).toEqual(defaultProfile());
    expect(parseProfile('"ただの文字列"')).toEqual(defaultProfile());
    expect(parseProfile(JSON.stringify({ version: 99, coins: 500 }))).toEqual(defaultProfile());
  });

  it('不正な値は丸められ、スターターは常に補われる', () => {
    const p = parseProfile(
      JSON.stringify({ version: 1, coins: -50, ownedCharIds: ['mors', '存在しない'], charXp: { mors: 3.9, xxx: 10 }, limitBreak: { mors: 99 } }),
    );
    expect(p.coins).toBe(0);
    expect(p.ownedCharIds).toContain('mors');
    expect(p.ownedCharIds).toContain('bald');
    expect(p.ownedCharIds).not.toContain('存在しない');
    expect(p.charXp.mors).toBe(3);
    expect(p.charXp).not.toHaveProperty('xxx');
    expect(p.limitBreak.mors).toBe(5);
  });

  it('装備は所持していないものを外す', () => {
    const p = parseProfile(JSON.stringify({ version: 1, ownedCosmetics: [], equipped: { frame: 'frame-gold', title: null, pawn: null, theme: null } }));
    expect(p.equipped.frame).toBeNull();
  });

  it('localStorage 経由の保存・読み込み（使えない環境ではデフォルト）', () => {
    saveProfile(defaultProfile()); // 例外にならないこと
    expect(loadProfile().ownedCharIds).toEqual(STARTER_CHAR_IDS);
  });
});

describe('レベル・経験値', () => {
  it('閾値は三角数（Lv2=1, Lv3=3, Lv10=45, Lv20=190）', () => {
    expect(levelThreshold(1)).toBe(0);
    expect(levelThreshold(2)).toBe(1);
    expect(levelThreshold(3)).toBe(3);
    expect(levelThreshold(10)).toBe(45);
    expect(levelThreshold(20)).toBe(190);
  });

  it('経験値からレベルを引ける', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(1)).toBe(2);
    expect(levelForXp(2)).toBe(2);
    expect(levelForXp(3)).toBe(3);
    expect(levelForXp(45)).toBe(10);
    expect(levelForXp(46)).toBe(10);
    expect(levelForXp(55)).toBe(11);
  });

  it('レベルの上限は限界突破で上がる（最大Lv20）', () => {
    const p = defaultProfile();
    expect(maxLevelFor(p, 'bald')).toBe(10);
    p.limitBreak.bald = 1;
    expect(maxLevelFor(p, 'bald')).toBe(12);
    p.limitBreak.bald = 5;
    expect(maxLevelFor(p, 'bald')).toBe(20);
    p.charXp.bald = 10000;
    expect(levelOf(p, 'bald')).toBe(20);
  });

  it('xpProgress は次のレベルまでの必要量を返す', () => {
    const p = defaultProfile();
    p.charXp.bald = 2;
    expect(xpProgress(p, 'bald')).toEqual({ level: 2, maxLevel: 10, xp: 2, nextAt: 3 });
  });
});

describe('対戦の報酬', () => {
  it('順位コインは 100/60/40/25', () => {
    const p = defaultProfile();
    expect(gameReward(p, 'bald', { rank: 1, won: true, reason: 'assets' }).rankCoins).toBe(100);
    expect(gameReward(p, 'bald', { rank: 2, won: false, reason: 'assets' }).rankCoins).toBe(60);
    expect(gameReward(p, 'bald', { rank: 3, won: false, reason: 'assets' }).rankCoins).toBe(40);
    expect(gameReward(p, 'bald', { rank: 4, won: false, reason: 'survivor' }).rankCoins).toBe(25);
  });

  it('独占勝利のときだけ +30 ボーナス', () => {
    const p = defaultProfile();
    expect(gameReward(p, 'bald', { rank: 1, won: true, reason: 'triple' }).bonus).toBe(30);
    expect(gameReward(p, 'bald', { rank: 1, won: true, reason: 'tourist' }).bonus).toBe(30);
    expect(gameReward(p, 'bald', { rank: 1, won: true, reason: 'assets' }).bonus).toBe(0);
    expect(gameReward(p, 'bald', { rank: 2, won: false, reason: 'triple' }).bonus).toBe(0);
  });

  it('経験値は参加で+1、勝利でさらに+1', () => {
    const { profile, reward } = applyGameResult(defaultProfile(), 'bald', { rank: 1, won: true, reason: 'assets' });
    expect(reward.xp).toBe(2);
    expect(profile.charXp.bald).toBe(2);
    expect(profile.coins).toBe(100);
    const lose = applyGameResult(defaultProfile(), 'bald', { rank: 3, won: false, reason: 'assets' });
    expect(lose.reward.xp).toBe(1);
    expect(lose.profile.coins).toBe(40);
  });

  it('レベルアップが報酬に反映される', () => {
    const p = defaultProfile();
    const { reward } = applyGameResult(p, 'bald', { rank: 1, won: true, reason: 'assets' });
    expect(reward.levelBefore).toBe(1);
    expect(reward.levelAfter).toBe(2);
  });

  it('未所持キャラの一覧が引ける', () => {
    const p = defaultProfile();
    expect(unownedChars(p)).toEqual(['verre', 'rosso', 'tsumuji', 'azuma', 'noel', 'garou', 'karuta', 'kugutsu', 'echo', 'chrono', 'mors']);
  });
});
