# 配布とGitHub Pages公開

ユーザーのpush・公開依頼に基づき、アプリのソース・固定仕様・合成fixtureと配布用単一HTMLをmainへ反映する。端末内の面接記録、音源、バックアップ、スクリーンショットを含めない。

## 自動ビルド

`.github/workflows/pages.yml` はmainへのpushと手動起動に対応。

1. Node 24.19.0 / `npm ci` で固定依存を取得。
2. format / 契約テスト / 型検査を実行。
3. `/gpt-interview-practice/` をbaseとしてWeb版をビルド。
4. 単一HTMLを再生成し、リポジトリ直下の配布ファイルと比較。
5. Web版と単一HTMLをGitHub Pagesへデプロイ。

利用するGitHub公式Actionsはタグの実体SHAに固定。workflow tokenはbuildでcontents:read、deployでcontents:read / pages:write / id-token:writeのみ使用する。

## 初回のPages有効化

GitHub Pagesが未設定の場合、GitHubのリポジトリ **Settings → Pages → Build and deployment → Source → GitHub Actions** を選択する。次に **Actions → Deploy interview records to GitHub Pages → Run workflow** を実行する。

公開先:

- Web版: https://neimoasorao-dotcom.github.io/gpt-interview-practice/
- 単一HTML: https://neimoasorao-dotcom.github.io/gpt-interview-practice/eiken-pre1-records.html
- Pages設定に依存しない単一HTML配布: https://github.com/neimoasorao-dotcom/gpt-interview-practice/raw/refs/heads/main/eiken-pre1-records.html

URLを記載しただけでは公開成功を意味しない。Actionsのdeploy成功と公開URLのHTTP 200・ブラウザ表示を確認する。

## この環境の接続状況

GitHubのHTTPS Git proxyによるリポジトリ読取りは成功。公開リポジトリであることをGitHubのページで確認済み。

GitHub APIへの接続は `CONNECT tunnel failed, response 403` でネットワークに拒否されている。GH_TOKENの存在だけでAPI権限があるとは判断しない。新しい秘密値は要求していない。

公開設定・Actions結果の確認に必要な `api.github.com` と `neimoasorao-dotcom.github.io` を環境設定の許可先の下書きへ追加した。設定を保存して環境へ適用した後にAPIと公開先を再確認する。必要なら環境設定の変更を公開する。GitHub Pagesの有効化は上記のGitHub画面からも実施できる。

## 更新時

```sh
npm ci
npm run release:html
npm test
APP_BASE=/gpt-interview-practice/ npm run build
```

`eiken-pre1-records.html` とソースを同じcommitで更新する。配布HTMLに個人の記録は埋め込まない。サイト更新は端末内IndexedDBを外部へ送信しない。
