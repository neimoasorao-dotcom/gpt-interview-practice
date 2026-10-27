# 検証結果

2026-10-27、日本時間。同梱合成fixtureとテスト内生成データのみを使用。実面接・実音声・市販/公式問題画像は使用していない。

| 実行 | 結果 |
|---|---|
| `npm ci` | クリーンインストール成功（lockfile固定、Node 24.19.0 / npm 11.9.0） |
| `npm test` | **77件成功**、2ファイル。ゼロ件実行・skip・expected failureなし |
| `python -m unittest discover -s contracts/v1/validation -v` | 配布された参照テスト **36件成功**。参照ファイルは変更なし |
| `npm run build` | TypeScript型検査＋Vite本番ビルド成功。依存を分割し、chunk-size警告なし |
| `APP_BASE=/practice/ npm run build` | サブパス用ビルド成功。相対baseの本番ビルドも `/practice/` 配下でブラウザ操作確認済み |
| `npm run test:e2e` | **6件成功**。PC幅1440×1000、iPhone相当390×844。Chromium 154.0.8037.57。全テストでconsole.error / pageerrorがないことを検査 |
| `node scripts/check-production.mjs` | previewの `/practice/` でHTTP 200、空状態、JSON取込→保存→遅延ロードされるZIP書出し、幅超過なし、ブラウザエラーなし |
| 開発サーバー（5173） | 起動成功。HTTP応答に正しいタイトルとReactエントリーを確認 |
| `npm run format:check` / `git diff --check` | 成功 |
| manifest照合 | 記載21ファイルのbytes長・SHA-256がすべて一致 |
| `npm audit --omit=dev --audit-level=high` | 実行時依存の既知脆弱性0件（実行時点のregistry結果） |

## 契約テストの要所

- 不正JSON/UTF-8、10MiB上限、未知キー/版、不正な実在日/offset、0/nullの区別。
- 幻の引用、位置片側指定、UnicodeコードポイントとUTF-16の違い、別Transcript/課題、存在しないturn、欠けた参照。
- 観点6+1の完全性・一意性、全ID、slot重複、親/previous/supersedesの循環、既知日時の逆転。
- 音声なしでの採点、live high、入力外live観察・音声taxonomy、逆区間/音源長超過/上限不明warning。
- missing_capture / not_asked と、確認eventを伴うno_responseの0点を区別。英語5語未満の文法/語彙採点を拒否。
- 部分/retryは課題別のみ、.40/.15の重み、欠測伝播、live/archivedの系列、0とnull、丸め前値。
- contraction・ハイフン・数値・Unicode apostrophe・日本語・control/面接官/post_processingの語数。
- mistakeのみの集計、uncertain/style/自己修復/拒否済みの除外、occurrence_groupの重複排除、有効レビューの追記順。
- 同一bytesの再取込、空白だけ違う原ファイル、別export no-op、ID/共有問題/releaseの異内容衝突、保存時の再検証とrollback。
- IDの辞書順が追記順と逆でも、初回評価・最後の本人判断を保持。バックアップ復元後も保持。
- 新Transcriptの追加で旧assessment.inputを変えず、再採点は2つ目のassessmentとして保持。
- ZIPのhash/size改ざん、path traversal、重複path、展開後上限を拒否。素材あり/なし復元と衝突時全件rollback。
- 再採点viewから旧評価・mixed講評を除外。

## 実ブラウザで操作したこと

1. 空状態→JSON選択→Schema/意味検証→warning/差分プレビュー→確定保存。
2. 合成例の既定除外と明示表示、双方13ターンの原文、文法誤りの保持、文章/音声欠測表示。
3. 同ファイル再取込で面接数不変、再採点追記で評価2版、比較画面、自己完結JSONの実ダウンロードと内容検査。
4. JSONバックアップ→検証→復元→再読込後も1面接。PC/スマホとも横のページはみ出しなし。
5. 幻の引用とHTML風文字列の拒否、書込みゼロ、画像タグが実行/描画されないこと。
6. Transcript修正版表示と旧評価入力の別版warning、本人異議の追記と有効レビュー変更。
7. テスト内生成の0.5秒mono PCM WAVをhash照合して添付・再生。素材込みZIP→明示削除→復元後の素材存在確認。
8. PC/スマホのスクリーンショットを目視し、スマホヘッダー余白を調整。画像は `test-results/`（Git対象外）。

## 検証していないこと

iOS Safari実機、実際のVoiceログ取得/両話者録音、実音源の長時間負荷、未知Schemaへのmigration、実採点の事実性/妥当性。大規模bundleの自動分割復元は未実装。これらを完成とは扱わない。詳細とWorkへの変更案は IMPLEMENTATION-NOTES.md。

この初版検証時点では公開・push・外部同期は実行していない。後続の公開依頼に対する作業は DEPLOYMENT.md を参照。環境の `install_script` と `start_skill` は下書きに保存済みで、公開版や新タスクでの復元成功を意味しない。

## 単一HTML版の追加検証

- `npm run build:standalone`: JavaScript・CSS・アイコンを埋め込んだ `standalone/eiken-pre1-records.html` を生成（537,667 bytes）。追加の配布ファイル、CDN、npm、開発サーバーは利用時に不要。
- `node scripts/check-standalone.mjs --http`: HTMLだけを一時フォルダーへコピーし、PC幅1440px・スマホ幅390pxで検証。ローカルHTTPによる初回読込後はブラウザをofflineにして、取込→差分確認→保存→原文詳細→再採点追記→比較→JSON書出し→ZIPバックアップ/復元を操作。再読込後のIndexedDB保持と重複なし、ブラウザエラーなし、外部リクエストなしを確認。
- 直接 `file://` で開く試行は、検証環境のChromium管理ポリシー（URLBlocklist）が `ERR_BLOCKED_BY_ADMINISTRATOR` を返した。直接ファイル起動の成功とは報告しない。管理ポリシーは変更していない。制限のない環境では `npm run test:standalone` がfile://で同じ導線を検証する。
