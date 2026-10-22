import { defineConfig, Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * 公開用ビルド（GitHub Pages）にだけ、コンテンツセキュリティポリシーを入れる。
 * 読み込めるのは自分のサイトのスクリプト・スタイルと Google Fonts だけ。外への通信・フォーム送信・埋め込みは禁止。
 * （1ファイル版はスクリプトを HTML に埋め込むので、このポリシーは入れない）
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function securityHeaders(): Plugin {
  return {
    name: 'security-meta',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
      { tag: 'meta', attrs: { name: 'referrer', content: 'no-referrer' }, injectTo: 'head' },
    ],
  };
}

// `npm run build` は通常のビルド（GitHub Pages 用）。
// `npm run build:single` は1つのHTMLにまとめたビルド（試遊版の配布用）。
export default defineConfig(({ mode }) => ({
  base: './',
  test: {
    // npm run sim のときはバランス確認用の自動対戦（*.sim.ts）だけを実行する
    // npm run tune のときは CPU の数値を自動対戦で調整する（*.tune.ts）
    include: process.env.TUNE ? ['src/**/*.tune.ts'] : process.env.SIM ? ['src/**/*.sim.ts'] : ['src/**/*.test.ts'],
  },
  plugins: mode === 'single' ? [viteSingleFile()] : [securityHeaders()],
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist' },
}));
