# 依存版の確認

2026-10-27に公式資料と公式npmパッケージのmetadataを取得。直接依存はpackage.jsonのexact version、推移依存はpackage-lock.jsonに固定。Node v24.19.0 / npm 11.9.0で実行。

- React公式: https://github.com/reactjs/react.dev/blob/main/src/content/learn/build-a-react-app-from-scratch.md — Viteによるクライアントアプリ構成を確認。
- Vite公式: https://github.com/vitejs/vite/blob/main/docs/guide/index.md — Node 20.19+/22.12+、TypeScript/React構成。npmのvite@8.3.5のengineも確認。
- Ajv公式: https://github.com/ajv-validator/ajv/blob/master/docs/json-schema.md — Draft 2020-12専用Ajv2020クラスを使用。ajv-formats fullモードで日付offset・実在日を検証。
- 正確な版は `npm view <package> version engines --json` で公式registry.npmjs.orgの配布metadataを確認。React 19.3.1、Vite 8.3.5、TypeScript 7.0.2、Vitest 5.0.5、Playwright 1.64.1。全一覧はpackage.json。
- TypeScript型はjson-schema-to-typescript 16.0.0で固定Schemaから生成し、一致テストで独自推測を防止。
- インストール時のTLS/パッケージintegrity検証は無効化していない。キャッシュは書込み可能な/tmpへ配置。
