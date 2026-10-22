// シード付き乱数（mulberry32）。状態は数値1つなので GameState にそのまま持てる。

export function nextRandom(seed: number): [value: number, nextSeed: number] {
  let t = (seed + 0x6d2b79f5) | 0;
  const nextSeed = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, nextSeed];
}

/** 1〜6 のサイコロを1つ振る */
export function rollDie(seed: number): [value: number, nextSeed: number] {
  const [r, next] = nextRandom(seed);
  return [Math.floor(r * 6) + 1, next];
}
