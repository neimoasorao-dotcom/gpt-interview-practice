# Codex開発仕様 v1.0.0

## 目的と役割

1面接ごとのJSONを検証して保存し、全文・根拠・評価の各版を参照しながら学習の変化を確かめる個人用Webアプリ。Codexは実装とテストを担当する。面接・採点・採点方針の決定は行わない。必要な方針変更は理由と影響をWorkへ戻す。ユーザーの英語答案を実装の都合で補完・書換えしない。

初版の入力はschemas/session-bundle.schema.json準拠のJSON、原ログ、問題画像、任意の音源。出力は画面表示、原JSON書出し、再採点用入力、全データバックアップ。最初からアカウント・クラウド同期・OpenAI API・録音機能は実装しない。新しい外部サービスや費用を伴う機能は別の変更仕様とする。

## 技術構成

React＋TypeScript＋Vite、IndexedDB、CSS、チャートライブラリは必要最小限。実装時に公式ドキュメントで現在の対応版を確認し、package-lock等に固定する。JSON Schema Draft 2020-12対応バリデータと日付formatの検証を使う。JSON Schemaの内容をTypeScriptの独自推測で置き換えない。型は生成または契約との一致チェックを行う。

GitHubに置くのはアプリのコード、固定仕様、合成fixture、テスト。実面接JSON・音源・市販/公式画像は初期データにしない。バックアップや保存領域を自動でGitに同期しない。静的ホスティングに対応し、base pathをリポジトリルート以外でも設定可能にする。

推奨ディレクトリ：src/domain（参照・集計・比較）、src/import（構造/意味検証・差分・取込）、src/storage、src/features、src/ui、contracts（Schema/profiles）、tests。UIから直接JSONを書換えず、domain操作経由で保存する。

## 保存モデルと取込

DBにはsessions、assets、captures、question_sets、transcripts、events、assessments、annotations、imports、releases、derived_cacheを設ける。IDは少なくともsession_idを含む複合スコープで管理する。問題セットやreleaseは別セッション間の共有が可能だが、同じID・versionの異なる内容は衝突。capture/turn/finding等の参照も面接内の存在確認を行う。

原JSONのbytes・ファイル名・SHA-256・取込日時・検証器版・warningをimportsへ保存する。hashは実際のbytesからWeb Crypto等で計算。初版ではAIが提示したhashを未検証のまま確定値にしない。元ファイルhashと論理オブジェクトの比較用fingerprintは目的が異なる。

取込はドラッグ＆ドロップとファイル選択。構文→Schema→意味→差分プレビュー→確定。エラー時は書込ゼロ、warning時は一覧を表示して保存できる。大量取込はファイルごとの結果を返す。同じID・同じ内容は再利用、同じID・違う内容は停止。新しいassessmentだけの追記も許可するが、その入力参照先がローカルDBに存在する必要がある。参照が単一パッケージに閉じる自己完結型の再書出しも提供する。

取込の再実行で記録数・点数・回数が増えないこと。同じ内容でも別session_idなら候補として表示し、勝手に重複削除しない。別export_idでも内容が既存と同じならno-opにできるが原取込ログは残す。sessionの条件訂正が競合した場合はプレビューと明示的な解決操作が必要。新版Transcript・評価は追記する。

ファイル名・パス・JSON内の文字列は信頼しない。HTMLとして描画せずテキストとして表示。任意の外部URLを自動fetchしない。メディアはユーザーが取り込んだファイルと一致させて再生し、missing/externalは未添付表示。ZIPバックアップの展開ではパストラバーサル、重複path、解凍後サイズを検証する。

## 画面

| 画面 | 必須内容 | 主要操作 |
|---|---|---|
| Dashboard | 直近の練習、課題別・7観点、文章/音声の指数、証拠範囲、重点最大3件 | 新しいJSON取込、直近詳細へ |
| 履歴 | 日時・モード・初回/再回答・問題・評価版・未評価状態 | 並替、検索、条件絞込 |
| 面接詳細 | 問題、双方の全文、ターン単位の根拠、ミス・強み、音声、修正版 | 評価/Transcript版の切替、異議の記録 |
| 比較 | 同面接の再評価差、別日推移、初回とretryの対 | 同条件フィルタ、入力差・モデル差表示 |
| 弱点・強み | 分類・トピック・質問型別の分布、再発、実例 | 根拠へ戻る、次の練習条件を参照 |
| データ管理 | 取込履歴、warnings、未添付素材、版一覧、使用量 | 書出し、再採点入力生成、バックアップ、復元、削除 |

表示言語は日本語、英文は原文のまま。スマホでは下部ナビまたは同程度に少ない操作、PCではコンパクトなサイド/上部ナビ。落ち着いたニュートラルに緑を軸とし、役割で色を使い分ける。色だけで得点・ミスを区別しない。長いTranscriptは折り畳み可だが、全文を失わない。原文・最小訂正・改善版の3つを明確に表示する。

空状態、読込中、正常、warning、エラー、未評価、未実施、音源なし、部分面接、評価版不明、モデル不明を設計する。見栄えのためにデモの成績や仮点を本番画面へ混ぜない。合成例はテスト/デモ表示に限り、実履歴から既定で除外する。

## 既定の評価選択

1つの面接につきグラフに使うassessmentは1つ。select_default annotationがあればそれを優先し、withdrawnは対象外。未指定なら「初回の非withdrawn評価」を暫定既定にし、created_atが不明なら保存時の安定した挿入順で選ぶ。この選択はモデルの新しさ・点数の高さで変えない。複数評価を持つ面接はアイコンと切替を表示する。

評価単位は常にassessment_id。Transcriptの表示を新版へ変えても、過去評価の証拠はそのinput.transcript_idを表示する。画面上で新版本文に旧点を自動的に貼り替えない。比較時には入力、基準、モデル、prompt、音声利用の差を並べる。

## 集計関数の契約

### 課題とセッションの指数

text_index(task) = 25 × mean(task_response, organization, grammar, vocabulary)。4観点全てstatus=scoredのときだけ数値。それ以外はnull。

audio_index(task) = 25 × mean(intelligibility, fluency)。両方scoredのときだけ数値。どちらかがlive_audioならprovisional。2観点ともarchived_audioの場合のみarchived。

session_index = .40 × narration_index + .15 × (q1_index+q2_index+q3_index+q4_index)。5課題全てに指数がある場合だけ計算。focused/retry等の部分面接は課題別のみ。liveとarchivedの混在はprovisional扱いで、その内訳も表示する。文章と音声を足した総合点を作らない。未評価を0や全体の平均で補わない。

内部の数値は丸めず保存/計算し、表示時に四捨五入して整数。差分は丸め前の値から計算し、表示は整数。interactionは0〜4単独。0とnullは異なる。レーダーを使う場合はnullの軸を0にせず欠測と明示し、折線を閉じないか表形式を使う。

### 時系列と比較

既定の対象：mode=mock_interview、completed、assistance=no、question_seen_before=no、is_synthetic=false、parent_session_id=null。条件unknownは既定の厳密系列から外し、表示で戻せる。selected assessmentのrubric/prompt/metrics/model identity/evidence modeごとに系列を分ける。モデル名が不明な評価群は「モデル不明」とし、同一モデルでの統制済み比較とは扱わない。

週表示はAsia/Tokyo・月曜始まり。started_at=nullの面接を取込日に勝手に割り当てない。評価日と練習日を分離する。横軸が日付のグラフでは欠測を繋ぐかどうか明示し、既定は繋がない。移動平均を実装するなら直近5件の同条件有効データの平均とし、件数を必ず表示する。初版の平均は単純記述統計で信頼区間や因果効果を示さない。

### 語数

wordcount-en-v1を使う。英字語を基本に、内部アポストロフィとハイフンを含む単語は1語、数値も1語。Unicodeのアポストロフィを計数用コピーで通常のアポストロフィへ寄せ、原文は変えない。例："I'd use a part-time job in 2026." → 7語。日本語は英語語数に含めず別の文字数情報にする。フィラーはUIに記録されていれば語数に含める。制御発話・面接官・post_processingは集計しない。空欄やunintelligible区間の語数は不明。

語数率を出すのは対象課題でcapturedな学習者答案を全て取得し、coverage=completeで重大な不明区間がない場合のみ。UI Transcriptは表示文ベースの語数であることを明示する。

### ミス・強み

対象finding：kind=mistake、countable=true、review_state!=rejected、resolved_in_turn=false。occurrence_group_idが同じものは同一assessment内で1件とする。補助タグに同じ誤りを数え直さない。style_suggestion/uncertainを除外する。自己修復済みは別の件数として表示できる。

review_stateは評価作成時のスナップショット。後のconfirm/dispute annotationは、そのtarget findingに対する有効レビュー状態をaccepted/rejectedへ変える。原assessmentは変更しない。競合する場合は保存時の安定した追記順で最後の本人判断を採用し、過去判断も表示できる。上記の集計ではこの有効状態を使う。

回答あたりの出現率：その分類を持つ回答数 / 評価済みの対象回答数。分母の「評価済み」はその分類に必要な観点がscoredかつ根拠が適合する回答。未評価・not_asked・missing_captureを除く。100語あたり：当該テキストミス数 / 同じ対象回答の計数可能な英語語数×100。語数が不足・不明・0ならnull。音声ミスは100語あたりへ混ぜない。カテゴリ別の合計は多重タグの有無を表示し、全ミス件数と混同しない。

強みも根拠のある出現として集計するが「強みタグがない＝苦手」とはしない。Topic/Questionは複数タグを許可し、合計が100%を超えることがあると明示する。未出題トピックを苦手と判定しない。

### 音声指標

metrics.jsonに従う。WebがAIの印象から秒数・WPMを生成してはいけない。区間開始終了・音源hash・計測methodがない値はwarningにし、能力グラフから除外する。未取得を0にしない。response_latencyはネットワーク/会話システム遅延を含みうるため、本番の応答力と同一視しない。

### 優先課題

selected assessmentのrecommendations最大3件を表示する。初版で独自の「合格までの距離」や優先度AI判定を作らない。頻出ミスは回数だけでなくseverityと回答数を併記する。解消済み表示は本人のannotationと後続根拠を区別し、1回見られなかっただけで克服認定しない。

## 構造以外の必須検証

参照実装validation/validate_bundle.pyに加え、本番では以下を実装する。

* 全IDの一意性・参照整合。transcriptのparentとturnのprevious参照は循環禁止。
* question_setはslot重複不可。completed mockにはnarrationとq1〜q4をちょうど1つずつ。課題順序の逸脱はwarning/条件に記録。
* 得点観点はtaskで6種ちょうど1回ずつ、sessionでinteractionだけ1回。未評価も要素を残す。
* evidenceの引用が当該Transcript・turnに一致し、文字位置も一致する。位置を片方だけ指定しない。
* audio参照はkind=audio、start<end、区間内。assetのlengthが不明なら範囲上限の検証不能warning。
* archived_audioは評価のinput.asset_idsにあり、実際に採点へ渡した音源。live_audioはinput.live_capture_idsにある観察。音源が置いてあるだけでは使用済みにならない。
* scoredには根拠必須。音声2観点をtextのみで採点しない。live_audioのconfidence=highは禁止。
* taxonomy ID・namespace・requires_audioの一致。不明IDはエラー、廃止IDは当該旧版で読めるようにする。
* no_responseとmissing_captureを分ける。無回答に内容0を付けるには確認イベント。missing_capture/not_askedは得点不可。
* 日付formatとoffset、null理由、メトリクス単位・計測方法、原資料の存在/取得元の矛盾。
* is_syntheticは実履歴から除外。assistance/画像/録音等の条件矛盾を表示。

重い音声はJSON内にBase64で埋め込まない。JSON上限の初期値は10MiB、音声は個別取込とする。文字列上限を超える場合は切り捨てず、適切な分割・バックアップ方法を案内する。この上限は運用設定でありデータ仕様の意味を変更しない。

## バックアップ・移行

JSONのみ書出し、素材込み書出し、再採点書出しを分ける。素材込みではrelative path・hash・size一覧を備える。復元後に参照とhashを検証する。音源を含めない場合は音源が別途必要なことを表示する。再採点書出しは原資料と指定ルーブリックだけを含め、旧assessment/rewrites/講評は既定で外す。始めから元ログに講評が混ざっていれば、その部分を新しい入力viewで除外して元データは保持する。

旧schemaを勝手に最新扱いしない。migrationはpure functionとしてテストし、before/after・migration_id・warningsを残す。旧ファイルを保持し、移行コピーを検証して保存する。分類IDの曖昧な変換は手動確認へ戻す。

## 実装段階と受入条件

1. 契約の読込、Schema/意味検証、DB、import/exportを先に実装。
2. Transcript・問題・根拠・評価版を参照できる詳細画面。
3. 指数・履歴・比較・分類集計。欠測条件を先に実装する。
4. スマホの画面、素材リンク、バックアップ/復元。
5. 合成fixtureで自動検証し、実ブラウザで主要導線を操作。サイト起動・表示停止・空画面も確認。

完了には以下の意味のあるテストが必要。

| ケース | 合格条件 |
|---|---|
| 全文 | AI/本人の原文、言い直し、順序、非英語も欠落しない |
| 欠測 | 音源なしの例で発音・流暢さと音声指数がnull表示 |
| 参照 | 原文にない引用、存在しないturn、時間逆転を拒否 |
| 再取込 | 同じファイルを2回入れても面接数・ミス数が不変 |
| 追記 | 再採点が2つ目のassessmentとして残る |
| 入力修正 | Transcript新版を追加しても旧評価の参照先が不変 |
| 異版 | 基準・モデルの変更を成長の同一系列へ混ぜない |
| 単語数 | contraction / hyphen / 数値 / 日本語 / 制御発話を定義通り扱う |
| 集計 | 0とnull、partial、retry、assisted、syntheticを条件通り扱う |
| 分類 | uncertain・style・拒否済み・自己修復を未修正ミスから除外 |
| 復元 | 素材あり/なし両方の書出しを復元でき、欠落を表示 |
| UI | iPhone相当とPCで取込→詳細→比較→書出しが操作可能 |

実装の完了報告は、何が動いたか、テスト結果、残る制約、起動方法を簡潔に記す。未実装機能や推測の採点を「完成」に含めない。GitHubへの実push・公開・本番同期はユーザーの具体的な依頼範囲に従う。
