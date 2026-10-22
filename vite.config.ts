import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` は通常のビルド（GitHub Pages 用）。
// `npm run build:single` は1つのHTMLにまとめたビルド（試遊版の配布用）。
export default defineConfig(({ mode }) => ({
  base: './',
  test: {
    // npm run sim のときはバランス確認用の自動対戦（*.sim.ts）だけを実行する
    // npm run tune のときは CPU の数値を自動対戦で調整する（*.tune.ts）
    include: process.env.TUNE ? ['src/**/*.tune.ts'] : process.env.SIM ? ['src/**/*.sim.ts'] : ['src/**/*.test.ts'],
  },
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist' },
}));
