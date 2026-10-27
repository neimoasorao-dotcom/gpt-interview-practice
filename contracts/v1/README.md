# 英検準1級 Voice面接対策システム v1.0.0

方針調整Work・練習専用Chat/Voice・開発専用Codexを分離する設計一式。以前の38点方式は採用せず、公式の試験形式を確認して独自の学習診断を設計した推奨初版です。

## 読む順番

1. [全体設計](01-system-design.md) — 決定項目→選択肢→推奨案→データフロー→最終仕様。
2. [採点ルーブリック](02-rubric.md) — 7観点、0〜4のアンカー、未評価と音声根拠。
3. [Codex開発仕様](03-codex-development.md) — 画面、集計式、保存・取込、検証、受入条件。
4. [正式Schema](schemas/session-bundle.schema.json) / profiles / examples / validation。

## 新しい練習Chatで使う

`prompts/voice-chat.md`を最初に貼り付け、次の7資料を渡します：

* `02-rubric.md`
* `profiles/rubric.json`
* `profiles/taxonomy.json`
* `profiles/protocol.json`
* `schemas/session-bundle.schema.json`
* `prompts/post-interview.md`
* 記入した`prompts/start-ticket.md`と、その問題セット・4コマ画像

模擬面接が終わったら音声を停止し、同じChatのテキストで「面接後処理」と送ります。開発・仕様変更はこのChatで扱いません。画像・添付・原音声を参照できることは実機で事前に確認し、できない情報はnull/未評価とします。

## 新しいCodexで使う

この一式をリポジトリの仕様資料として渡し、`prompts/codex.md`を貼り付けます。CodexはWeb実装・テストの担当で、面接や採点の担当ではありません。サイトは今回まだ実装していません。

## 再採点

原資料と指定Transcript版をWebから書き出し、新しい練習/評価専用Chatに`prompts/rescore.md`を渡します。旧点・講評・修正版は採点前に見せません。結果は新assessmentとして追記します。音源を保存していない回は、後日発音や間を復元できません。

## 検証コード

Python 3.10以降を想定。コードは参照実装で、事実として正しい発話・採点かどうかの保証ではありません。Web移植時の全受入条件は開発仕様を確認してください。

```bash
python -m pip install -r validation/requirements.txt
python validation/validate_bundle.py examples/text-only-session.json
python validation/validate_bundle.py examples/append-rescore.json --context examples/text-only-session.json
python -m unittest discover -s validation -v
```

examplesはすべて架空の合成例で、ユーザーの実際の成績を表しません。音源なしの未評価、同じ原データへの追加評価を確認できます。

## 重要な前提

* プロンプトだけで「声の完全な逐語保存」「正確な秒数」「長期保存」「正しいJSON」を保証しません。
* 全ターンを保存すること、原音声と照合したこと、後から音源で検証できることは別です。
* 公式CSE 512/750とAI学習指数を換算しません。
* 原資料・Transcript各版・採点各回を分離します。
* 仕様の完成と、Voice実機検証・Web実装の完了は別です。
