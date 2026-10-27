# 英検準1級 面接の記録

React / TypeScript / Vite / IndexedDBによる、端末内の記録・分析アプリ。面接と採点は別のChat / Voiceで実施し、このアプリは手動JSONの検証・保存・参照・集計だけを行います。

## 配布・Web公開

- [単一HTMLのダウンロード](https://github.com/neimoasorao-dotcom/gpt-interview-practice/raw/refs/heads/main/eiken-pre1-records.html)
- GitHub Pagesの公開先（Pages有効化・deploy成功後）: https://neimoasorao-dotcom.github.io/gpt-interview-practice/
- 公開サイト上の単一HTML: https://neimoasorao-dotcom.github.io/gpt-interview-practice/eiken-pre1-records.html

mainへのpushで検証とビルドを行うGitHub Actionsを設定しています。公開の初回設定・確認方法は [DEPLOYMENT.md](docs/DEPLOYMENT.md) を参照してください。リポジトリ直下の `eiken-pre1-records.html` は配布用生成物です。変更時は `npm run release:html` で再生成します。CIでも元コードから再生成し、一致を検査します。

## 起動

Node **24.19.0**（検証版）、npmを使用します。

```sh
cd /workspace/gpt-interview-practice
npm ci
npm run dev
```

ビルドは `npm run build`、静的ビルドの確認は `npm run preview`。公開時は生成された `dist/` を使用します。サブパスは `APP_BASE=/gpt-interview-practice/ npm run build` で指定可能。既定は相対baseです。

## 単一HTML版

`standalone/eiken-pre1-records.html` はJavaScript・CSS・アイコンを埋め込んだ配布用ファイルです。このHTMLだけをコピーし、PCのブラウザで直接開けます。サーバー・npm・インターネット接続は利用時に不要です。取込、端末内保存、全文・版別評価、比較、JSON書出し、ZIPバックアップ/復元を使用できます。

生成とオフライン検証：

```sh
npm run build:standalone
npm run test:standalone
# file:// が管理ポリシーで禁止されている環境の代替検証
npm run test:standalone -- --http
```

データはHTML自身ではなくブラウザのIndexedDBに保存されます。通常Web版とは保存領域が異なるため、データを移す場合はバックアップ/復元を使ってください。`file://` の保存領域の扱いはブラウザ・ファイル場所に依存するため、バックアップも保管してください。この開発環境ではブラウザ管理ポリシーがfile://を禁止しているため、HTML一個だけをローカルHTTP経由で読み込み、その後オフラインで主要操作を検証しています。直接ファイル起動とiOSのファイルプレビュー、Safari実機の動作は未検証です。

## 使い方

1. JSONを選択またはデータ管理へドロップ。
2. 構造/意味検証・warning・追加/再利用件数を確認して保存。
3. 履歴から詳細へ。評価版とTranscript版は別に選択でき、旧評価の証拠は旧入力に固定。
4. 比較で同面接の再評価と別日の差を確認。文章/音声・基準/モデルの条件を区別。
5. 自己完結JSON、元bytes、再採点入力view、素材あり/なしZIPをそれぞれ書出し。

初回は空状態です。動作を試す場合は `contracts/v1/examples/text-only-session.json` を取り込み、「合成例を表示」を選んでください。`append-rescore.json` はその後に追記します。合成得点を実履歴へ自動投入しません。実面接や音源をリポジトリへ置かず、ダウンロードしたバックアップをGitに追加しないでください。

## 検証

```sh
npm test
npm run build
npm run test:e2e
```

E2EはPC幅1440pxとiPhone相当390pxのChromiumで実行。既定実行ファイルは `/usr/bin/chromium`。別環境では `CHROMIUM_PATH=/path/to/chromium npm run test:e2e` を指定してください。Playwright互換ブラウザを利用します。自動テストは合成データだけを使用。

固定された参照Pythonテストは任意で `python -m unittest discover -s contracts/v1/validation -v`（`jsonschema`が必要）。Web本番検証はこの参照実装より追加の制約を検証します。

## 実装資料

- [仕様との差・制約とWorkへの最小修正案](docs/IMPLEMENTATION-NOTES.md)
- [依存版と公式資料](docs/DEPENDENCIES.md)
- [実行した検証](docs/VALIDATION.md)
- 固定正本: `contracts/v1/`（添付releaseを改変せず保存）

データはブラウザのorigin単位です。自動同期されません。保存領域を唯一のバックアップにしないでください。未知版のmigration、Voice/API/録音、自動採点は実装していません。CSE変換・38点方式・合格確率は提供しません。
