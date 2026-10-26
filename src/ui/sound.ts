// 効果音：WebAudioで合成する小さな音だけ（音声ファイルは持たない）。
// ブラウザの自動再生ポリシーにより、ユーザーの操作（クリックなど）があるまで鳴らない。

let ctx: AudioContext | null = null;
let enabled = true;
try {
  enabled = window.localStorage.getItem('fs-sound') !== 'off';
} catch {
  /* 保存できない環境では既定のオン */
}

export function soundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(on: boolean) {
  enabled = on;
  try {
    window.localStorage.setItem('fs-sound', on ? 'on' : 'off');
  } catch {
    /* 保存できなくても切り替え自体は有効 */
  }
}

function ac(): AudioContext | null {
  if (!enabled) return null;
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** 短い音を1つ鳴らす */
function tone(freq: number, at: number, dur: number, type: OscillatorType, vol: number) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/** サイコロを振る音：短い打撃を3つ */
export function playDice() {
  tone(220 + Math.random() * 60, 0, 0.07, 'square', 0.05);
  tone(190 + Math.random() * 60, 0.09, 0.07, 'square', 0.05);
  tone(240 + Math.random() * 60, 0.18, 0.09, 'square', 0.05);
}

/** お金が動く音：コインの2音 */
export function playCoin() {
  tone(1320, 0, 0.09, 'sine', 0.08);
  tone(1760, 0.07, 0.16, 'sine', 0.08);
}

/** 購入・建設の音：上がっていく3音 */
export function playBuild() {
  tone(523, 0, 0.1, 'triangle', 0.09);
  tone(659, 0.08, 0.1, 'triangle', 0.09);
  tone(784, 0.16, 0.16, 'triangle', 0.09);
}

/** カードを引く・使う音：短い1音 */
export function playCard() {
  tone(880, 0, 0.08, 'triangle', 0.06);
  tone(1174, 0.05, 0.1, 'triangle', 0.05);
}

/** 破産の音：下がっていく3音 */
export function playBankrupt() {
  tone(392, 0, 0.18, 'sawtooth', 0.05);
  tone(330, 0.16, 0.18, 'sawtooth', 0.05);
  tone(262, 0.32, 0.3, 'sawtooth', 0.05);
}

/** 勝利のファンファーレ */
export function playFanfare() {
  const seq = [523, 523, 523, 659, 784, 659, 784];
  seq.forEach((f, i) => tone(f, i * 0.11, i === seq.length - 1 ? 0.4 : 0.14, 'triangle', 0.1));
}

/** 行動の結果（新しいログ）を見て、ふさわしい効果音を1つ選んで鳴らす */
export function playForLog(texts: string[], actionType: string) {
  if (!enabled) return;
  const joined = texts.join('\n');
  if (/の勝利|優勝/.test(joined)) return playFanfare();
  if (/破産/.test(joined)) return playBankrupt();
  if (actionType === 'roll') playDice();
  if (/通行料/.test(joined)) return playCoin();
  if (/買収/.test(joined)) return playCoin();
  if (/建てた|購入|給料/.test(joined)) return playBuild();
  if (/カード|手札/.test(joined)) return playCard();
}
