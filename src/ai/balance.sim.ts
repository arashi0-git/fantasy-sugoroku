// バランス確認用の自動対戦。`npm run sim` で実行する（普段のテストには含めない）。
// VARIANTS に設定の上書きを並べると、それぞれ同じ条件で N ゲームずつ対戦させて比べられる。

import { it } from 'vitest';

declare const process: { env: Record<string, string | undefined> };
import { actorOf, applyAction, createGame, GameState, rankByAssets, totalAssets } from '../core/game';
import { nextRandom } from '../core/rng';
import { CharacterId, CHARACTER_LIST, CHARACTERS } from '../data/characters';
import { CARDS } from '../data/cards';
import { BOARD } from '../data/board';
import { GROUP_SQUARES, isTourist, landPrice } from '../core/game';
const GROUP_PRICE = landPrice;
import { CONFIG } from '../data/config';
import { MISSIONS } from '../data/missions';
import { decideCpu } from './cpu';
import { PersonalityId, PERSONALITIES } from './personality';

const N = Number(process.env.SIM_N ?? 300);
/** 別の試合セットで確かめたいときは SIM_SEED=300 のようにずらす */
const SEED_OFFSET = Number(process.env.SIM_SEED ?? 0);
/** ゲームごとに8人から4人を選ぶ（USE_CHARS=0 ならキャラなし） */
function charsFor(seed: number): CharacterId[] {
  const ids = CHARACTER_LIST.map((c) => c.id);
  let r = seed * 7907;
  for (let i = ids.length - 1; i > 0; i--) {
    let v: number;
    [v, r] = nextRandom(r);
    const j = Math.floor(v * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, 4);
}
const IDS: PersonalityId[] = ['bold', 'careful', 'schemer'];

const VARIANTS: Record<string, Record<string, unknown>> = {
  いまの設定: {},
};

for (const [vname, overrides] of Object.entries(VARIANTS)) {
  it(vname, () => {
    const saved = { ...CONFIG };
    const savedPers = structuredClone(PERSONALITIES);
    const savedChars = structuredClone(CHARACTERS);
    const { _pers, _chars, _cards, _missions, ...configOverrides } = overrides as {
      _pers?: Record<string, object>;
      _chars?: Record<string, object>;
      _cards?: Record<string, object>;
      _missions?: Record<string, object>;
    };
    const savedMissions = structuredClone(MISSIONS);
    for (const [id, o] of Object.entries(_missions ?? {})) Object.assign(MISSIONS[id as keyof typeof MISSIONS], o);
    const savedCards = structuredClone(CARDS);
    for (const [id, o] of Object.entries(_cards ?? {})) Object.assign(CARDS[id as keyof typeof CARDS], o);
    Object.assign(CONFIG as Record<string, unknown>, configOverrides);
    for (const [id, o] of Object.entries(_pers ?? {})) Object.assign(PERSONALITIES[id as PersonalityId], o);
    for (const [id, o] of Object.entries(_chars ?? {})) Object.assign(CHARACTERS[id as CharacterId], o);

    const reasons = { assets: 0, survivor: 0, triple: 0, tourist: 0 };
    const reasonByPers: Record<string, Record<string, number>> = {};
    const wins: Record<PersonalityId, number> = { bold: 0, careful: 0, schemer: 0 };
    const seen: Record<PersonalityId, number> = { bold: 0, careful: 0, schemer: 0 };
    const seatWins = [0, 0, 0, 0];
    const cash = Array(31).fill(0), cashN = Array(31).fill(0);
    const builds = Array(31).fill(0);
    const lastAt: Record<number, [number, number]> = { 10: [0, 0], 15: [0, 0], 20: [0, 0] };
    let bankrupt = 0, blessings = 0, liquidations = 0;
    const rents: number[] = [];
    const rentRatio: number[] = []; // 払った通行料 ÷ 払う前の所持金
    const laps: Record<PersonalityId, number> = { bold: 0, careful: 0, schemer: 0 };
    const lands10: Record<PersonalityId, number> = { bold: 0, careful: 0, schemer: 0 };
    const levels20: Record<PersonalityId, number> = { bold: 0, careful: 0, schemer: 0 };
    const passes: Record<string, number> = {};
    const cardUse: Record<string, number> = {};
    const aims: Record<string, number> = {};
    // カードごとの一生：手に入れた・使った・捨てた・ゲーム終了時に残っていた・破産で消えた、守りは聞かれた回数
    const life: Record<string, { got: number; used: number; discarded: number; left: number; lost: number; asked: number; held: number }> = {};
    const L = (c: string) => (life[c] ??= { got: 0, used: 0, discarded: 0, left: 0, lost: 0, asked: 0, held: 0 });
    const countOf = (hand: string[]) => hand.reduce<Record<string, number>>((m, c) => ((m[c] = (m[c] ?? 0) + 1), m), {});

    // 使命：配られた数・達成数・達成ターンの合計、達成した人／しなかった人の勝ち数
    const mis: Record<string, { dealt: number; done: number; turnSum: number }> = {};
    const misWin = { doneWin: 0, doneN: 0, notWin: 0, notN: 0 };
    let claims = 0, buyoutsDone = 0;
    let tradesOffered = 0, tradesDone = 0, tradesTourist = 0;
    const claimBy: Record<string, number> = {};
    // 固有特性の発動：キャラごとの回数。聞かれた回数（ask）と使った回数（use）も数える
    const traitHits: Record<string, number> = {};
    const traitAsk: Record<string, { ask: number; use: number; win: number }> = {};
    // キャラごとの破産・最終資産、商魂と破魔の1回あたりの得
    const charBankrupt: Record<string, number> = {};
    const charAssets: Record<string, number> = {};
    const merchantGain: number[] = [];
    const pierceKind: Record<string, number> = {};
    const pierceGain: number[] = [];
    const TRAIT_LOG: [RegExp, string][] = [
      [/商魂で/, 'merchant'], [/霧読みで/, 'fogsight'], [/祝福で .* が無料で/, 'blessing'], [/運命の石碑で.*がめくれた/, 'stargaze'],
      [/天翔で/, 'skyride'], [/旋風で/, 'gust'], [/破魔で/, 'pierce'], [/開拓/, 'pioneer'], [/剛腕で/, 'shove'],
      [/大勝負！/, 'gamble'], [/操り糸で/, 'puppet'], [/写し身で/, 'mimic'],
      [/巻き戻しで/, 'rewind'], [/魂の抵当で/, 'soulpact'],
    ];
    // 席順の分析：ターンごとの土地の数・総資産、勝ち方ごとの勝ち数、最初の5ターンで買った土地の数
    const seatLands: Record<number, number[]> = { 3: [0, 0, 0, 0], 5: [0, 0, 0, 0], 10: [0, 0, 0, 0], 20: [0, 0, 0, 0] };
    const seatAssets: Record<number, number[]> = { 10: [0, 0, 0, 0], 20: [0, 0, 0, 0] };
    const seatReason: Record<string, number[]> = {};
    const seatRentPaid = [0, 0, 0, 0], seatRentGot = [0, 0, 0, 0];
    const BUCKETS: [number, number][] = [[1, 3], [4, 6], [7, 10], [11, 20], [21, 30]];
    const seatRentBucket = BUCKETS.map(() => [0, 0, 0, 0]);
    const charWins: Record<string, number> = {};
    const charSeen: Record<string, number> = {};
    for (let seed = 1 + SEED_OFFSET; seed <= N + SEED_OFFSET; seed++) {
      const chars = charsFor(seed);
      const seats = chars.map((c) => CHARACTERS[c].personality);
      chars.forEach((c) => (charSeen[c] = (charSeen[c] ?? 0) + 1));
      seats.forEach((id) => seen[id]++);
      let r = seed * 31;
      const rand = () => {
        let v: number;
        [v, r] = nextRandom(r);
        return v;
      };
      let s: GameState = createGame(chars.map((c) => ({ name: c, color: '#000', character: c })), seed);
      s.players.forEach((p) => p.hand.forEach((c) => L(c).got++));
      const lastPlace: Record<number, number> = {};
      let prevTurn = 1;
      while (s.phase.kind !== 'gameover') {
        const a = decideCpu(s, PERSONALITIES[seats[actorOf(s)]], rand);
        if (a.type === 'build' || (a.type === 'buy' && a.level > 0)) builds[s.turn]++;
        if (s.phase.kind === 'blessing') blessings++;
        if (a.type === 'useCard') cardUse[a.card] = (cardUse[a.card] ?? 0) + 1;
        if (a.type === 'adjust' && a.delta !== 0) cardUse.tailwind = (cardUse.tailwind ?? 0) + 1;
        if (a.type === 'react' && a.use && s.phase.kind === 'react') cardUse[s.phase.card] = (cardUse[s.phase.card] ?? 0) + 1;
        if (a.type === 'buyout') { const k = seats[s.current] + ':buyout'; passes[k] = (passes[k] ?? 0) + 1; }
        if (a.type === 'pass') { const k = seats[s.current] + ':' + s.phase.kind; passes[k] = (passes[k] ?? 0) + 1; }
        if (a.type === 'roll' && a.aim) aims[seats[s.current] + ':' + a.aim] = (aims[seats[s.current] + ':' + a.aim] ?? 0) + 1;
        if (s.phase.kind === 'react') L(s.phase.card).asked++;
        const next = applyAction(s, a);
        for (const e of next.log.slice(s.log.length)) {
          if (/に取引を持ちかけた/.test(e.text)) tradesOffered++;
          if (/^取引成立/.test(e.text)) tradesDone++;
          if (e.player !== null && /商魂で/.test(e.text) && s.phase.kind === 'buyout') {
            const sq = s.phase.square;
            const lv = next.properties[sq]?.level ?? 0;
            merchantGain.push(Math.round(GROUP_PRICE(sq) * CONFIG.buildCostRate[lv]));
          }
          if (e.player !== null && /破魔で/.test(e.text) && s.phase.kind === 'react') {
            const ctx = s.phase.ctx;
            pierceKind[ctx.type + ':' + s.phase.card] = (pierceKind[ctx.type + ':' + s.phase.card] ?? 0) + 1;
            if (ctx.type === 'rent') pierceGain.push(ctx.rent);
          }
          if (e.player === null) continue;
          const c = chars[e.player];
          for (const [re, t] of TRAIT_LOG) if (re.test(e.text) && CHARACTERS[c].trait.id === t) traitHits[c] = (traitHits[c] ?? 0) + 1;
        }
        const ask = (c: string, used: boolean, win = false) => {
          const x = (traitAsk[c] ??= { ask: 0, use: 0, win: 0 });
          x.ask++;
          if (used) x.use++;
          if (win) x.win++;
        };
        if (s.phase.kind === 'puppet' && a.type === 'puppet') ask(chars[s.phase.responder], a.delta !== 0);
        if (s.phase.kind === 'push') ask(chars[s.phase.pusher], a.type === 'push');
        if (s.phase.kind === 'gamble' && a.type === 'gamble') ask(chars[s.current], a.use, a.use && next.log.some((e, i) => i >= s.log.length && /で勝ち/.test(e.text)));
        if (a.type === 'useCard' && s.cardsUsed === 1 && CHARACTERS[chars[s.current]].trait.id === 'quickhand') traitHits[chars[s.current]] = (traitHits[chars[s.current]] ?? 0) + 1;
        const np = next.lastPayment;
        if (np && np !== s.lastPayment && JSON.stringify(np) !== JSON.stringify(s.lastPayment)) {
          seatRentPaid[np.payer] += np.amount;
          seatRentGot[np.payee] += np.amount;
          const b = BUCKETS.findIndex(([lo, hi]) => s.turn >= lo && s.turn <= hi);
          if (b >= 0) {
            seatRentBucket[b][np.payee] += np.amount;
            seatRentBucket[b][np.payer] -= np.amount;
          }
          const owner = chars[np.payee];
          const t = CHARACTERS[owner].trait.id;
          const g = BOARD[np.square].group;
          if (t === 'festival' && s.festivals.includes(np.square)) traitHits[owner] = (traitHits[owner] ?? 0) + 1;
          if (t === 'formation' && g && GROUP_SQUARES[g].every((x) => next.properties[x]?.owner === np.payee)) traitHits[owner] = (traitHits[owner] ?? 0) + 1;
        }
        if (next.touristClaim !== null && s.touristClaim === null) {
          claims++;
          claimBy[a.type] = (claimBy[a.type] ?? 0) + 1;
        }
        if (a.type === 'answerTrade' && a.accept && s.phase.kind === 'trade' && isTourist(s.phase.offer.want)) tradesTourist++;
        next.players.forEach((p, i) => {
          if (p.missionDone && !s.players[i].missionDone) {
            const m = (mis[p.mission!] ??= { dealt: 0, done: 0, turnSum: 0 });
            m.done++;
            m.turnSum += next.turn;
          }
        });
        if (next.phase.kind === 'liquidate' && s.phase.kind !== 'liquidate') liquidations++;
        if (next.lastPayment && next.lastPayment !== s.lastPayment && JSON.stringify(next.lastPayment) !== JSON.stringify(s.lastPayment)) {
          rents.push(next.lastPayment.amount);
          const before = s.players[next.lastPayment.payer].money;
          if (before > 0) rentRatio.push(next.lastPayment.amount / before);
        }
        for (let i = 0; i < s.players.length; i++) {
          const before = countOf(s.players[i].hand);
          const after = countOf(next.players[i].hand);
          for (const c of new Set([...Object.keys(before), ...Object.keys(after)])) {
            const d = (after[c] ?? 0) - (before[c] ?? 0);
            if (d > 0) L(c).got += d;
            if (d < 0) {
              const kind = next.players[i].bankrupt && !s.players[i].bankrupt ? 'lost' : a.type === 'discard' ? 'discarded' : 'used';
              L(c)[kind] += -d;
            }
          }
          // 手札に持っていたターン数（各手番の終わりに数える）
        }
        if (next.turn !== prevTurn && next.phase.kind !== 'gameover') {
          for (const p of next.players) if (!p.bankrupt) { cash[prevTurn] += p.money; cashN[prevTurn]++; }
          if (seatLands[prevTurn]) next.players.forEach((p, i) => (seatLands[prevTurn][i] += Object.values(next.properties).filter((x) => x.owner === p.id).length));
          if (seatAssets[prevTurn]) next.players.forEach((p, i) => (seatAssets[prevTurn][i] += totalAssets(next, p.id)));
          if (prevTurn === 10) next.players.forEach((p, i) => (lands10[seats[i]] += Object.values(next.properties).filter((x) => x.owner === p.id).length));
          if (prevTurn === 20) next.players.forEach((p, i) => (levels20[seats[i]] += Object.values(next.properties).filter((x) => x.owner === p.id).reduce((a, x) => a + x.level, 0)));
          if (lastAt[prevTurn]) {
            const rank = rankByAssets(next);
            lastPlace[prevTurn] = rank[rank.length - 1];
          }
          next.players.forEach((p) => p.hand.forEach((c) => L(c).held++));
          prevTurn = next.turn;
        }
        s = next;
      }
      if (s.phase.kind !== 'gameover') continue;
      s.players.forEach((p) => p.hand.forEach((c) => L(c).left++));
      for (const p of s.players) {
        (mis[p.mission!] ??= { dealt: 0, done: 0, turnSum: 0 }).dealt++;
        const won = s.phase.winner === p.id ? 1 : 0;
        if (p.missionDone) { misWin.doneN++; misWin.doneWin += won; } else { misWin.notN++; misWin.notWin += won; }
      }
      reasons[s.phase.reason]++;
      (reasonByPers[seats[s.phase.winner]] ??= {})[s.phase.reason] = ((reasonByPers[seats[s.phase.winner]] ?? {})[s.phase.reason] ?? 0) + 1;
      (seatReason[s.phase.reason] ??= [0, 0, 0, 0])[s.phase.winner]++;
      wins[seats[s.phase.winner]]++;
      charWins[chars[s.phase.winner]] = (charWins[chars[s.phase.winner]] ?? 0) + 1;
      seatWins[s.phase.winner]++;
      bankrupt += s.players.filter((p) => p.bankrupt).length;
      s.players.forEach((p, i) => {
        if (p.bankrupt) charBankrupt[chars[i]] = (charBankrupt[chars[i]] ?? 0) + 1;
        charAssets[chars[i]] = (charAssets[chars[i]] ?? 0) + totalAssets(s, p.id);
      });
      buyoutsDone += s.players.reduce((a, p) => a + p.record.buyouts, 0);
      s.players.forEach((p, i) => (laps[seats[i]] += p.laps));
      for (const t of [10, 15, 20]) {
        if (lastPlace[t] === undefined) continue;
        lastAt[t][1]++;
        if (s.phase.winner === lastPlace[t]) lastAt[t][0]++;
      }
    }

    const pct = (a: number, b: number) => `${((100 * a) / b).toFixed(1)}%`;
    const avg = (i: number) => Math.round(cash[i] / Math.max(1, cashN[i]));
    const sum = (a: number, b: number) => builds.slice(a, b + 1).reduce((x: number, y: number) => x + y, 0);
    console.log(`==== ${vname}（${N}ゲーム）`);
    console.log('勝ち方', reasons, '1ゲームの破産者', (bankrupt / N).toFixed(2), '土地を売る場面', (liquidations / N).toFixed(2));
    console.log('勝ち方×性格', JSON.stringify(reasonByPers));
    rents.sort((x, y) => x - y);
    rentRatio.sort((x, y) => x - y);
    const q = (arr: number[], f: number) => arr[Math.floor(arr.length * f)] ?? 0;
    console.log(
      '通行料（1回あたり） 中央値',
      q(rents, 0.5),
      '上位10%',
      q(rents, 0.9),
      '上位1%',
      q(rents, 0.99),
      '／ 所持金に対する割合 中央値',
      (q(rentRatio, 0.5) * 100).toFixed(0) + '%',
      '上位10%',
      (q(rentRatio, 0.9) * 100).toFixed(0) + '%',
      '／ 1ゲームの支払い回数',
      (rents.length / N).toFixed(1),
    );
    console.log('性格ごとの勝率（出場1回あたり、公平なら25%）', IDS.map((id) => `${id} ${pct(wins[id], seen[id])}`).join(' / '));
    console.log('キャラごとの勝率（出場1回あたり、公平なら25%）');
    for (const c of CHARACTER_LIST) console.log(`  ${CHARACTERS[c.id].name.padEnd(5, '　')} ${pct(charWins[c.id] ?? 0, charSeen[c.id] ?? 1).padStart(6)}（${charSeen[c.id] ?? 0}回出場）`);
    console.log('CHARJSON', JSON.stringify({ variant: vname, wins: charWins, seen: charSeen, pers: { wins, seen } }));
    console.log('固有特性の発動（1出場あたり）  ／ 聞かれた場面で使った割合・勝負の勝率');
    for (const c of CHARACTER_LIST) {
      const n = charSeen[c.id] ?? 1;
      const x = traitAsk[c.id];
      const extra = x ? `  ／ ${x.ask}回中${x.use}回使用（${pct(x.use, x.ask)}）${c.trait.id === 'gamble' ? `・勝ち ${pct(x.win, x.use)}` : ''}` : '';
      console.log(`  ${c.name.padEnd(5, '　')} ${c.trait.name.padEnd(4, '　')} ${((traitHits[c.id] ?? 0) / n).toFixed(2)}回${extra}`);
    }
    console.log('席順の分析（1番手 / 2番手 / 3番手 / 4番手）');
    for (const t of [3, 5, 10, 20]) console.log(`  ターン${t}の土地の数`, seatLands[t].map((v) => (v / N).toFixed(2)).join(' / '));
    for (const t of [10, 20]) console.log(`  ターン${t}の総資産`, seatAssets[t].map((v) => Math.round(v / N)).join(' / '));
    console.log('  通行料の受け取り−支払い（1ゲーム）', seatRentGot.map((v, i) => Math.round((v - seatRentPaid[i]) / N)).join(' / '));
    BUCKETS.forEach(([lo, hi], b) => console.log(`  通行料の差し引き ターン${lo}〜${hi}`, seatRentBucket[b].map((v) => Math.round(v / N)).join(' / ')));
    for (const [r, v] of Object.entries(seatReason)) console.log(`  ${r} での勝ち`, v.join(' / '));
    console.log('キャラごとの破産率 / 最後の総資産（平均）');
    for (const c of CHARACTER_LIST) {
      const n = charSeen[c.id] ?? 1;
      console.log(`  ${c.name.padEnd(5, '　')} ${pct(charBankrupt[c.id] ?? 0, n).padStart(6)} / ${Math.round((charAssets[c.id] ?? 0) / n)}G`);
    }
    const avgOf = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
    console.log('商魂の1回あたりの得（無料の建設費）', avgOf(merchantGain), 'G');
    console.log('破魔が無効にした場面', JSON.stringify(pierceKind), '／ 天使の加護を破ったときの通行料（平均）', avgOf(pierceGain), 'G');
    console.log('席順ごとの勝率', seatWins.map((w, i) => `${i + 1}番手 ${pct(w, N)}`).join(' / '));
    console.log('平均所持金 ターン1,10,20,29', [1, 10, 20, 29].map(avg).join(' / '));
    console.log('建設回数 1-10/11-20/21-30', [sum(1, 10), sum(11, 20), sum(21, 30)].map((v) => (v / N).toFixed(1)).join(' / '));
    console.log('最下位からの勝率 ターン10/15/20', [10, 15, 20].map((t) => pct(lastAt[t][0], lastAt[t][1])).join(' / '));
    console.log('カードの使用（1ゲームあたり）', JSON.stringify(Object.fromEntries(Object.entries(cardUse).map(([k, v]) => [k, +(v / N).toFixed(2)]))));
    console.log('カード別（1ゲーム・4人合計）  手に入れた / 使った / 使用率 / 捨てた / 最後まで残った / 平均保持ターン / 守りは聞かれた回数');
    for (const [c, v] of Object.entries(life).sort((x, y) => y[1].got - x[1].got)) {
      console.log(`  ${c.padEnd(10)} ${(v.got / N).toFixed(2).padStart(5)} / ${(v.used / N).toFixed(2).padStart(5)} / ${pct(v.used, v.got).padStart(6)} / ${(v.discarded / N).toFixed(2)} / ${(v.left / N).toFixed(2)} / ${(v.held / Math.max(1, v.got)).toFixed(1)} / ${(v.asked / N).toFixed(2)}`);
    }
    console.log('祝福の門 1ゲームあたり', (blessings / N).toFixed(2));
    console.log('ターン10の土地数', IDS.map((id) => `${id} ${(lands10[id] / seen[id]).toFixed(1)}`).join(' / '));
    console.log('ターン20の建物段階の合計', IDS.map((id) => `${id} ${(levels20[id] / seen[id]).toFixed(1)}`).join(' / '));
    console.log('見送り・買収（1出場あたり）', JSON.stringify(Object.fromEntries(Object.entries(passes).map(([k, v]) => [k, +(v / seen[k.split(':')[0] as PersonalityId]).toFixed(1)]))));
    console.log('秘密の使命  達成率 / 平均達成ターン');
    for (const [id, m] of Object.entries(mis)) console.log(`  ${MISSIONS[id as keyof typeof MISSIONS].name.padEnd(6, '　')} ${pct(m.done, m.dealt).padStart(6)} / ${(m.turnSum / Math.max(1, m.done)).toFixed(1)}`);
    console.log('使命を達成した人の勝率', pct(misWin.doneWin, misWin.doneN), '／ しなかった人', pct(misWin.notWin, misWin.notN), '／ 1人あたり達成率', pct(misWin.doneN, misWin.doneN + misWin.notN));
    console.log('観光地の守り切り 挑戦', claims, '成功', reasons.tourist, 'きっかけ', JSON.stringify(claimBy));
    console.log('成功した買収（1ゲームあたり、令状を含む）', (buyoutsDone / N).toFixed(2));
    console.log('土地の取引（1ゲームあたり） 提示', (tradesOffered / N).toFixed(2), '成立', (tradesDone / N).toFixed(2), '（うち観光地ねらいの成立', tradesTourist, '件）');
    console.log('1ゲームあたりの周回数', IDS.map((id) => `${id} ${(laps[id] / seen[id]).toFixed(2)}`).join(' / '));

    Object.assign(CONFIG as Record<string, unknown>, saved);
    for (const id of IDS) Object.assign(PERSONALITIES[id], savedPers[id]);
    for (const c of CHARACTER_LIST) Object.assign(CHARACTERS[c.id], savedChars[c.id]);
    for (const k of Object.keys(savedMissions)) Object.assign(MISSIONS[k as keyof typeof MISSIONS], savedMissions[k as keyof typeof MISSIONS]);
    for (const k of Object.keys(savedCards)) Object.assign(CARDS[k as keyof typeof CARDS], savedCards[k as keyof typeof CARDS]);
  }, 600000);
}
