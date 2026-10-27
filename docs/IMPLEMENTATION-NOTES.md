# 実装契約・既知の制約

採点は行わず、取込済み評価だけを表示する。添付release 1.0.0を `contracts/v1/` にバイト単位で保存。manifestのstatusは元資料の表記のままであり、今回のユーザー指示で実装対象が確定したことと区別する。仕様・Schema・taxonomyは改変していない。

## Workへ戻す具体的な差と最小修正案

| 差 / 不足 | 具体例・影響 | 今回の動作 / 最小修正案 |
|---|---|---|
| 参照validatorのセッション指数と03の部分練習条件 | `text-only-session.json` は `text_scenario_drill`。参照 `derive_indices` は全体75を返すが、03は部分練習を課題別のみと指定 | ユーザーが指定した03に従い、課題75・セッションnull。参照関数と参照テストを次releaseでmode/state条件付きにする案。固定ファイルは変更しない |
| 音声metricの検証に必要な構造がない | Schemaのmetricには計測区間、検出器版、休止閾値専用欄がない。自由文method_idとsource_turn_idsだけで全条件を証明できない | 非null値はwarning付きで保持・表示し、能力分析から除外。次Schemaで測定区間・asset hash・detector name/version/threshold・時計と遅延条件を構造化する案。Webが秒数/WPMを推測しない |
| 条件訂正と同ID異内容拒否 | 同じsession_idでassistance_usedを訂正したJSONは衝突 | 上書きせず保存拒否。条件訂正の専用履歴を次Schemaで定義し、その承認後に明示的解決UIを追加する案。今回は勝手に新sessionに付け替えない |
| retryの外部セッション関係 | 自己完結bundleにparent_session_idはあるが親面接本体を同梱する欄がない | 親が端末内にない場合はwarning。自分自身と、端末内で解決する親系列の循環は拒否。親を含む複数bundleのバックアップで保持できる。外部関係の許容方針を次releaseで明記する案 |
| 再採点用入力の交換形式 | bundleのself_containedは原capture必須。一方、mixed captureに旧講評が含まれると盲検入力に原capture全文を入れられない | 原本は保存したまま、独立した `eiken_rescore_input_view` (アプリ版1.0.0) を生成。interview captureとpost_processing以外のTranscriptのみ使用し、旧assessment/rewritesは含めない。exchange bundleと称さず取込も不可。次releaseで入力viewの正本Schemaを追加する案 |

## データと安全性

- DB v1: sessions / assets / captures / question_sets / transcripts / events / assessments / annotations / imports / releases / derived_cache、および実ファイル用media。
- 取得元・評価・本人判断は別ストア。IDキーはsession scope。共有question_setは別面接でも同ID異内容を拒否。UIの操作はdomain/storage関数を介する。
- 元JSON bytes、ファイル名、bytesのSHA-256、取込日時、validator版、warningを保存。アプリ内fingerprint-v1はキーをソートした論理比較用であり、標準正準化hashとは称さない。配列の順は保持する。
- プレビューは無書込。保存時には同一readwriteトランザクション内で現在状態に再検証し、別タブとの衝突も拒否。同一bytes/同一exportは取込ログも増やさず、別exportまたは空白だけ異なるファイルは記録を再利用し原取込ログを残す。
- 合成例は本番データへ自動投入しない。実履歴から既定で除外。「合成例を表示」でのみ表示。
- ZIPはアプリ独自バックアップ形式v1。相対path/hash/sizeをmanifestへ記録。展開前に中央ディレクトリでpath/重複/サイズを検査。ZIP64未対応。合計256MiB、素材1件100MiB、JSON1件10MiB。上限超過は切り捨てず拒否。複数appendの合計で1面接の自己完結JSONが10MiBを超えた場合もZIP生成を停止し、取込原本と素材の個別保管を案内（大規模bundle分割復元は未実装）。
- 復元は別の一時DBで全件検証後、本DBへ単一トランザクションでマージ。新しい取込の間に変更があればやり直し。上書き復元はしない。
- 素材は明示的にユーザーが添付し、申告hashがあれば照合。不明hashはローカル計算値を別保存し元assetを変更しない。素材がJSONのsaved状態でも端末内bytesがなければ「未添付」。任意URLは取得しない。
- HTML文字列はテキスト描画。画像プレビューはPNG/JPEG/WebP/GIFのみ。SVG/HTMLは実行しない。Voice/API/自動同期・採点・録音機能はない。
- バックアップは暗号化しない。ダウンロード先・端末のアクセス権は本人が管理する。保存領域はorigin単位で、プライベートモード・ブラウザ削除等で失われ得る。

## 分析の範囲

- 4観点/2観点が全てscoredのときのみ課題指数。completed mockだけ5課題の加重指数。interactionは独立。内部値を丸めず、差も丸め前から算出。
- 暫定liveと保存音源は区別。音声の証拠種別が違う指数差は比較不可。
- 推移は欠測をつながない表。練習日不明を取込日へ代入しない。Asia/Tokyo・月曜始まり。移動平均や因果推論は未実装。
- モデル・rubric・prompt・taxonomy・metrics・evidence/mode/既見条件のキーを表示。モデル不明は非統制と明示。1面接1既定assessment。基準変更に未対応の版は隔離表示し、新版へ自動変換しない。
- ミス集計は有効な本人判断（追記順）を適用。occurrence_groupで重複排除。分類別は主/補助タグが重複し得る。分母は当該分類に必要な観点がtext/音声の適合根拠でscoredな回答。対話など回答単位で分母を確定できないものは率を作らない。音声ミスは100語率に含めない。
- 語数はwordcount-en-v1の表示文ベース。capturedの本人answerのみ、control/面接官/post_processing除外。coverage不足または不明区間は率を出さない。
- 再発は分類/評価系列ごとの記述的な観測件数。強みタグの欠落や一度の未観測を能力不足/克服認定に使わない。

## 残る検証範囲

実データ・実機Voice運用、iOS Safari実機の保存制限/音声形式、数百MiBの実音源負荷、未知Schemaのmigrationは未検証/未実装。UIはChromiumのPCとiPhone相当viewportで検証する。画像やTranscriptの事実性・採点妥当性をWebが証明することはできない。初版検証時点ではpush/公開を行っていない。後続のユーザー依頼によるpushと公開設定は DEPLOYMENT.md に記録する。
