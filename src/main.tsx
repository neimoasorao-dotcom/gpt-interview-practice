import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { IDBPDatabase } from "idb";
import { type Bundle, encode } from "./domain/model";
import {
  indices,
  selectDefault,
  display,
  tokyoDate,
  tokyoWeek,
  strictSeries,
  seriesKey,
  answerWords,
  countedFindings,
  effectiveReview,
  categoryStats,
  recurrence,
} from "./domain/analysis";
import { terms } from "./import/validate";
import {
  openDatabase,
  loadBundles,
  prepare,
  commit,
  annotate,
  selfContained,
  attachMedia,
  deleteSession,
  type Preview,
  type Media,
  type ImportLog,
} from "./storage/db";
import type { RestorePlan } from "./storage/backup";
import rubric from "../contracts/v1/profiles/rubric.json";
import {
  Json,
  Notice,
  EvidenceView,
  Scores,
  MediaView,
  Empty,
  SessionMeta,
  SessionPicker,
  Comparison,
} from "./ui/components";
import "./style.css";
const nav = [
  "概要",
  "履歴",
  "面接詳細",
  "比較",
  "ミスと強み",
  "データ管理",
] as const;
type Page = (typeof nav)[number];
function download(bytes: Uint8Array, name: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function App() {
  const [db, setDb] = useState<IDBPDatabase>(),
    [bundles, setBundles] = useState<Bundle[]>([]),
    [media, setMedia] = useState<Media[]>([]),
    [logs, setLogs] = useState<ImportLog[]>([]);
  const [page, setPage] = useState<Page>("概要"),
    [sid, setSid] = useState(""),
    [aid, setAid] = useState(""),
    [tid, setTid] = useState("");
  const [previews, setPreviews] = useState<Preview[]>([]),
    [restorePlan, setRestorePlan] = useState<RestorePlan>(),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [synthetic, setSynthetic] = useState(false),
    [search, setSearch] = useState(""),
    [mode, setMode] = useState(""),
    [sort, setSort] = useState("newest"),
    [strict, setStrict] = useState(true),
    [left, setLeft] = useState(""),
    [right, setRight] = useState("");
  const [focusId, setFocusId] = useState("");
  useEffect(() => {
    if (!focusId) return;
    const timer = setTimeout(() => {
      const target = document.getElementById(focusId);
      if (target) {
        let node: HTMLElement | null = target;
        while (node) {
          if (node instanceof HTMLDetailsElement) node.open = true;
          node = node.parentElement;
        }
        target.scrollIntoView({ block: "center" });
        target.classList.add("focused-evidence");
      }
      setFocusId("");
    }, 40);
    return () => clearTimeout(timer);
  }, [focusId, page, bundles]);
  const [note, setNote] = useState(""),
    [deleteConfirm, setDeleteConfirm] = useState(false),
    [usage, setUsage] = useState<string>("未取得");
  const refresh = async (d: IDBPDatabase) => {
    const rows = await loadBundles(d);
    setBundles(rows);
    setMedia(await d.getAll("media"));
    setLogs(await d.getAll("imports"));
    const u = await navigator.storage?.estimate();
    if (u)
      setUsage(
        `${((u.usage || 0) / 1048576).toFixed(1)} MiB / ${((u.quota || 0) / 1048576).toFixed(0)} MiB`,
      );
  };
  useEffect(() => {
    let mounted = true;
    openDatabase()
      .then(async (d) => {
        if (!mounted) {
          d.close();
          return;
        }
        setDb(d);
        await refresh(d);
      })
      .catch((e) => setError("保存領域を開けません: " + String(e)));
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    setAid("");
    if (!focusId) setTid("");
    setDeleteConfirm(false);
  }, [sid]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const b = bundles.find((b) => b.session.session_id === sid);
  const a =
    b?.assessments.find((a) => a.assessment_id === aid) ||
    (b ? selectDefault(b) : undefined);
  const tr =
    b?.transcripts.find(
      (t) => t.transcript_id === (tid || a?.input.transcript_id),
    ) || b?.transcripts[0];
  const visible = bundles
    .filter(
      (b) =>
        (synthetic || !b.session.is_synthetic) &&
        (!mode || b.session.mode === mode) &&
        (!search ||
          JSON.stringify([
            b.session,
            b.question_sets,
            b.assessments.map((a) => ({
              id: a.assessment_id,
              versions: a.versions,
              model: a.evaluator,
            })),
          ])
            .toLocaleLowerCase()
            .includes(search.toLocaleLowerCase())),
    )
    .sort((a, b) =>
      sort === "oldest"
        ? (a.session.started_at || "9999").localeCompare(
            b.session.started_at || "9999",
          )
        : (b.session.started_at || "").localeCompare(
            a.session.started_at || "",
          ),
    );
  const open = (b: Bundle) => {
    setSid(b.session.session_id);
    setPage("面接詳細");
  };
  const importFiles = async (files: File[]) =>
    run(async () => {
      if (!db) return;
      const results: Preview[] = [];
      let context = await loadBundles(db);
      for (const f of files) {
        if (f.size > 10 * 1024 * 1024) {
          results.push({
            file: f,
            bytes: new Uint8Array(),
            hash: "",
            errors: ["JSONは10MiBまでです。原資料とappendへ分割してください。"],
            warnings: [],
            changes: [],
            duplicates: [],
            noOp: false,
          });
          continue;
        }
        const p = await prepare(f, context, await db.getAll("imports"));
        results.push(p);
        if (p.merged && !p.errors.length)
          context = [
            ...context.filter(
              (b) => b.session.session_id !== p.merged!.session.session_id,
            ),
            p.merged,
          ];
      }
      setPreviews(results);
      setPage("データ管理");
    });
  const savePreview = async (i: number) =>
    run(async () => {
      if (!db) return;
      await commit(db, previews[i]);
      await refresh(db);
      setPreviews((p) => p.filter((_, j) => i !== j));
      setMessage("保存しました。同内容の記録は再利用しました。");
    });
  const addAnnotation = async (
    target_type: Bundle["annotations"][number]["target_type"],
    target_id: string,
    action: Bundle["annotations"][number]["action"],
  ) =>
    run(async () => {
      if (!db || !b) return;
      if (!note.trim() && action !== "select_default")
        throw new Error("本人コメントを入力してください");
      await annotate(db, b, {
        annotation_id: "user-" + crypto.randomUUID(),
        created_at: new Date().toISOString(),
        target_type,
        target_id,
        action,
        comment: note.trim() || "本人が既定評価として選択",
      });
      setNote("");
      await refresh(db);
      setMessage("本人annotationを追記しました。元の評価は保持しています。");
    });
  const selectedOptions = bundles
    .filter((b) => synthetic || !b.session.is_synthetic)
    .flatMap((b) =>
      b.assessments.map((a) => ({
        key: JSON.stringify([b.session.session_id, a.assessment_id]),
        b,
        a,
      })),
    );
  const l =
    selectedOptions.find((x) => x.key === left) ||
    selectedOptions.find((x) => x.b.session.session_id === sid) ||
    selectedOptions[0];
  const r =
    selectedOptions.find((x) => x.key === right) ||
    selectedOptions.find((x) => x.key !== l?.key);
  return (
    <div className="app">
      <aside>
        <div className="brand">
          <span className="brand-icon">記</span>
          <div>
            面接の記録<small>英検準1級 · 学習ノート</small>
          </div>
        </div>
        <nav>
          {nav.map((n, i) => (
            <button
              key={n}
              className={page === n ? "active" : ""}
              onClick={() => setPage(n)}
            >
              <span>0{i + 1}</span>
              {n}
            </button>
          ))}
        </nav>
        <div className="privacy">
          端末内に保存
          <br />
          <small>自動同期・採点は行いません</small>
        </div>
      </aside>
      <main
        onClickCapture={(e) => {
          const link = (e.target as HTMLElement).closest("a");
          const href = link?.getAttribute("href");
          if (!href?.startsWith("#")) return;
          const id = href.slice(1);
          const owner = bundles.find(
            (x) =>
              x.transcripts.some((t) =>
                t.turns.some((t) => "turn-" + t.turn_id === id),
              ) ||
              x.captures.some((c) => "capture-" + c.capture_id === id) ||
              x.events.some((e) => "event-" + e.event_id === id) ||
              x.assets.some((a) => "asset-" + a.asset_id === id),
          );
          if (!owner) return;
          e.preventDefault();
          setSid(owner.session.session_id);
          const transcript = owner.transcripts.find((t) =>
            t.turns.some((turn) => "turn-" + turn.turn_id === id),
          );
          if (transcript) setTid(transcript.transcript_id);
          setPage("面接詳細");
          setFocusId(id);
        }}
      >
        <header>
          <div>
            <small className="eyebrow">PRACTICE RECORDS</small>
            <h1>{page}</h1>
          </div>
          <label className="primary file-button">
            JSONを取り込む
            <input
              aria-label="JSONを取り込む"
              type="file"
              accept="application/json,.json"
              multiple
              disabled={busy || !db}
              onChange={(e) => {
                void importFiles(Array.from(e.target.files || []));
                e.target.value = "";
              }}
            />
          </label>
        </header>
        <div className="local-note">
          ブラウザ内保存 · バックアップを別の場所にも保管してください{" "}
          <label>
            <input
              type="checkbox"
              checked={synthetic}
              onChange={(e) => setSynthetic(e.target.checked)}
            />
            合成例を表示
          </label>
        </div>
        {busy && <Notice>処理中です…</Notice>}
        {!db && !error && <Notice>保存領域を読み込んでいます…</Notice>}
        {error && <Notice error>{error}</Notice>}
        {message && (
          <div className="success" role="status">
            {message}
          </div>
        )}
        {page === "概要" && (
          <>
            <section className="hero">
              <small>RECORD → REVIEW → PRACTICE</small>
              <h2>
                根拠をたどって、
                <br />
                次の練習へ。
              </h2>
              <p>声と文章を分けて、練習の条件と評価の各版を残します。</p>
              <div className="pills">
                <span>
                  {bundles.filter((b) => !b.session.is_synthetic).length}{" "}
                  件の記録
                </span>
                <span>
                  {bundles.filter(strictSeries).length} 件の厳密系列候補
                </span>
              </div>
            </section>
            {visible.length ? (
              <section>
                <div className="section-title">
                  <h2>直近の練習</h2>
                  <button onClick={() => open(visible[0])}>
                    全文・根拠を見る →
                  </button>
                </div>
                <SessionMeta b={visible[0]} />
                <Scores b={visible[0]} a={selectDefault(visible[0])} />
                <h3>次の重点</h3>
                {selectDefault(visible[0])
                  ?.recommendations.slice()
                  .sort((a, b) => a.priority - b.priority)
                  .map((r) => (
                    <article className="recommendation" key={r.priority}>
                      <span>{r.priority}</span>
                      <div>
                        <strong>{r.task}</strong>
                        <p>{r.success_criterion}</p>
                      </div>
                    </article>
                  )) || <p>評価の提案はまだありません。</p>}
              </section>
            ) : (
              <Empty onImport={() => setPage("データ管理")} />
            )}
          </>
        )}
        {page === "履歴" && (
          <>
            <div className="filters">
              <input
                aria-label="履歴を検索"
                placeholder="問題・条件・版・IDで検索"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                aria-label="モードで絞込"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
              >
                <option value="">すべてのモード</option>
                {[
                  "mock_interview",
                  "focused_drill",
                  "coached_practice",
                  "text_scenario_drill",
                  "retry",
                ].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <select
                aria-label="並び順"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="newest">新しい順（日時不明は末尾）</option>
                <option value="oldest">古い順（日時不明は末尾）</option>
              </select>
            </div>
            {!visible.length ? (
              <Empty onImport={() => setPage("データ管理")} />
            ) : (
              visible.map((row) => (
                <button
                  className="history-row"
                  key={row.session.session_id}
                  onClick={() => open(row)}
                >
                  <div>
                    <strong>{tokyoDate(row.session.started_at)}</strong>
                    <small>
                      {row.session.session_id} ·{" "}
                      {row.question_sets
                        .map((q) => q.question_set_id)
                        .join(", ")}
                    </small>
                    <small>
                      {row.session.mode} ·{" "}
                      {row.session.parent_session_id
                        ? "再回答"
                        : "初回 / 親なし"}{" "}
                      · {row.session.state}
                    </small>
                  </div>
                  <div>
                    <span>
                      {row.session.is_synthetic
                        ? "合成例"
                        : strictSeries(row)
                          ? "厳密系列候補"
                          : "別条件"}
                    </span>
                    <small>
                      {selectDefault(row)?.assessment_id || "未評価"} · 評価{" "}
                      {row.assessments.length}版
                    </small>
                  </div>
                  <span>→</span>
                </button>
              ))
            )}
          </>
        )}
        {page === "面接詳細" &&
          (!b ? (
            <>
              <SessionPicker
                bundles={bundles.filter(
                  (x) => synthetic || !x.session.is_synthetic,
                )}
                sid={sid}
                setSid={setSid}
              />
              <Notice>
                履歴から面接を選ぶと、双方の全文・評価・取得元を参照できます。
              </Notice>
            </>
          ) : (
            <>
              <SessionPicker
                bundles={bundles.filter(
                  (x) => synthetic || !x.session.is_synthetic,
                )}
                sid={sid}
                setSid={setSid}
              />
              <SessionMeta b={b} />
              <section>
                <div className="section-title">
                  <h2>評価と入力の版</h2>
                  <button
                    onClick={() =>
                      download(
                        encode(selfContained(b)),
                        b.session.session_id + ".json",
                      )
                    }
                  >
                    自己完結JSONを書出し
                  </button>
                </div>
                <label>
                  評価版{" "}
                  <select
                    aria-label="評価版"
                    value={a?.assessment_id || ""}
                    onChange={(e) => {
                      setAid(e.target.value);
                      setTid("");
                    }}
                  >
                    {b.assessments.length === 0 && <option>未評価</option>}
                    {b.assessments.map((a) => (
                      <option key={a.assessment_id} value={a.assessment_id}>
                        {a.assessment_id} · {a.kind} · {a.status}
                      </option>
                    ))}
                  </select>
                </label>
                {a && (
                  <>
                    <p>
                      評価日: {tokyoDate(a.created_at)} · モデル:{" "}
                      {a.evaluator.model_id || "モデル不明"}（表示名:{" "}
                      {a.evaluator.model_reported || "不明"}）
                    </p>
                    <p className="muted">{a.summary}</p>
                    <Json
                      value={{
                        versions: a.versions,
                        evaluator: a.evaluator,
                        input: a.input,
                        blind_to_prior_scores: a.blind_to_prior_scores,
                        limitations: a.limitations,
                      }}
                      label="基準・モデル・prompt・音声入力の詳細"
                    />
                    <button
                      disabled={a.status === "withdrawn" || busy}
                      onClick={() =>
                        void addAnnotation(
                          "assessment",
                          a.assessment_id,
                          "select_default",
                        )
                      }
                    >
                      この版を既定にする
                    </button>
                    <Scores b={b} a={a} />
                    {a.task_results.map((t) => (
                      <details key={t.question_id}>
                        <summary>
                          {t.question_id} · 観点ごとの理由と根拠
                        </summary>
                        {t.criteria.map((c) => (
                          <article key={c.criterion_id}>
                            <h4>
                              {
                                rubric.criteria.find(
                                  (x) => x.id === c.criterion_id,
                                )?.label_ja
                              }{" "}
                              · {c.score ?? "未評価"}
                            </h4>
                            <p>{c.reason}</p>
                            <small>
                              {c.status} / {c.reason_code} / {c.evidence_mode} /
                              confidence: {c.confidence}
                            </small>
                            <EvidenceView refs={c.evidence_refs} b={b} />
                          </article>
                        ))}
                      </details>
                    ))}
                    <details>
                      <summary>
                        取込済み音声メトリクス（能力分析から除外）
                      </summary>
                      <Notice>
                        初版Schemaでは区間・hash・検出器版の全条件を機械検証できません。数値の新規生成・補完は行いません。応答遅延には通信/システム遅延が含まれ得ます。
                      </Notice>
                      <Json value={a.metrics} />
                    </details>
                    <details>
                      <summary>対話維持の理由と根拠</summary>
                      <p>{a.session_criteria[0].reason}</p>
                      <EvidenceView
                        refs={a.session_criteria[0].evidence_refs}
                        b={b}
                      />
                    </details>
                  </>
                )}
              </section>
              <section>
                <h2>問題・出典</h2>
                {b.question_sets.map((q) => (
                  <article key={q.question_set_id}>
                    <strong>
                      {q.question_set_id} / {q.version}
                    </strong>
                    <p>{q.source_description}</p>
                    <p className="verbatim">{q.intro}</p>
                    <p>{q.opening_sentence}</p>
                    {q.questions.map((q) => (
                      <p className="verbatim" key={q.question_id}>
                        <b>{q.slot}</b> {q.prompt}
                      </p>
                    ))}
                  </article>
                ))}
              </section>
              <section>
                <div className="section-title">
                  <h2>双方の全文</h2>
                  <label>
                    Transcript版{" "}
                    <select
                      aria-label="Transcript版"
                      value={tr?.transcript_id || ""}
                      onChange={(e) => setTid(e.target.value)}
                    >
                      {b.transcripts.map((t) => (
                        <option key={t.transcript_id}>{t.transcript_id}</option>
                      ))}
                    </select>
                  </label>
                </div>
                {tr && (
                  <>
                    <p>
                      {tr.kind} · coverage: {tr.coverage} · 親版:{" "}
                      {tr.parent_transcript_id || "なし"}
                    </p>
                    <Notice>
                      {tr.kind === "human_verified"
                        ? "人による音源照合版です。"
                        : "表示文の記録です。coverage=completeでも実発話の完全逐語性は保証しません。"}{" "}
                      語数: {answerWords(tr).words ?? "不明"}（観測できた英語{" "}
                      {answerWords(tr).observed} 語 / 日本語{" "}
                      {answerWords(tr).japanese} 文字）
                    </Notice>
                    {a && a.input.transcript_id !== tr.transcript_id && (
                      <Notice>
                        表示中の本文と評価入力は別版です。上の得点・引用は{" "}
                        {a.input.transcript_id} を参照し続けます。
                        <button onClick={() => setTid(a.input.transcript_id)}>
                          評価入力を表示
                        </button>
                      </Notice>
                    )}
                    {tr.turns.map((t) => (
                      <article
                        id={"turn-" + t.turn_id}
                        key={t.turn_id}
                        className={"turn " + t.speaker}
                      >
                        <div>
                          <span className="badge">
                            {t.speaker === "learner"
                              ? "本人"
                              : t.speaker === "examiner"
                                ? "AI"
                                : "システム"}
                          </span>
                          <small>
                            #{t.sequence} · {t.phase} · {t.turn_kind}
                          </small>
                        </div>
                        <p className="verbatim">
                          {t.text ?? `［${t.content_status}：本文未取得］`}
                        </p>
                        <details>
                          <summary>取得元・系譜・音声区間</summary>
                          <Json value={t} />
                        </details>
                      </article>
                    ))}
                  </>
                )}
                {a && a.input.transcript_id !== tr?.transcript_id && (
                  <details>
                    <summary>
                      旧評価の入力全文（{a.input.transcript_id}）
                    </summary>
                    {b.transcripts
                      .find((t) => t.transcript_id === a.input.transcript_id)
                      ?.turns.map((t) => (
                        <article id={"turn-" + t.turn_id} key={t.turn_id}>
                          <small>
                            {t.sequence} · {t.speaker}
                          </small>
                          <p className="verbatim">
                            {t.text ?? t.content_status}
                          </p>
                        </article>
                      ))}
                  </details>
                )}
              </section>
              {a && (
                <section>
                  <h2>ミス・強み・改善版</h2>
                  <label>
                    本人コメント
                    <textarea
                      aria-label="本人コメント"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="異議・確認の理由を記録"
                    />
                  </label>
                  {a.findings.map((f) => (
                    <article className="finding" key={f.finding_id}>
                      <h3>
                        {f.kind} ·{" "}
                        {terms.get(f.taxonomy_id || "")?.label_ja ||
                          "分類未確定"}
                      </h3>
                      <p>{f.description}</p>
                      <small>
                        {f.severity} · 有効レビュー: {effectiveReview(b, f)} ·
                        自己修復: {f.resolved_in_turn ? "済" : "なし"}
                      </small>
                      <p>記録された訂正: {f.correction || "なし"}</p>
                      <EvidenceView refs={f.evidence_refs} b={b} />
                      <div className="actions">
                        <button
                          disabled={busy}
                          onClick={() =>
                            void addAnnotation(
                              "finding",
                              f.finding_id,
                              "confirm",
                            )
                          }
                        >
                          本人が確認
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void addAnnotation(
                              "finding",
                              f.finding_id,
                              "dispute",
                            )
                          }
                        >
                          本人が異議
                        </button>
                      </div>
                    </article>
                  ))}
                  {a.rewrites.map((r) => (
                    <details key={r.question_id}>
                      <summary>
                        {r.question_id} · 原文 / 最小訂正 / 改善版
                      </summary>
                      <h4>原文（評価入力版）</h4>
                      {b.transcripts
                        .find((t) => t.transcript_id === a.input.transcript_id)
                        ?.turns.filter(
                          (t) =>
                            t.question_id === r.question_id &&
                            t.turn_kind === "answer",
                        )
                        .map((t) => (
                          <p className="verbatim" key={t.turn_id}>
                            {t.text ?? t.content_status}
                          </p>
                        ))}
                      <h4>最小訂正版</h4>
                      <p className="verbatim">{r.minimal_correction}</p>
                      <h4>改善版</h4>
                      <p className="verbatim">{r.improved_answer}</p>
                      <p>{r.teaching_note}</p>
                      <small>
                        新しい内容の追加:{" "}
                        {r.new_content_added ? "あり" : "なし"}
                      </small>
                    </details>
                  ))}
                  <h3>次の重点（評価内の最大3件）</h3>
                  {a.recommendations.map((r) => (
                    <p key={r.priority}>
                      {r.priority}. {r.task} — {r.success_criterion}
                    </p>
                  ))}
                </section>
              )}
              <section>
                <h2>RAW・イベント・本人annotation</h2>
                <label>
                  本人の追加メモ
                  <textarea
                    aria-label="本人の追加メモ"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="採点とは別に残す本人の記録"
                  />
                </label>
                <div className="actions">
                  {tr && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void addAnnotation(
                          "transcript",
                          tr.transcript_id,
                          "note",
                        )
                      }
                    >
                      表示中のTranscriptにメモを追記
                    </button>
                  )}
                  {a && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void addAnnotation(
                          "assessment",
                          a.assessment_id,
                          "note",
                        )
                      }
                    >
                      表示中の評価にメモを追記
                    </button>
                  )}
                </div>
                {b.captures.map((c) => (
                  <details id={"capture-" + c.capture_id} key={c.capture_id}>
                    <summary>
                      {c.capture_id} · {c.kind} · {c.scope}
                    </summary>
                    <pre>{c.content_text ?? "本文なし（素材参照）"}</pre>
                    <Json value={c} />
                  </details>
                ))}
                {b.events.map((e) => (
                  <article id={"event-" + e.event_id} key={e.event_id}>
                    <strong>{e.kind}</strong>
                    <p>{e.detail}</p>
                    <Json value={e} />
                  </article>
                ))}
                <Json
                  value={b.annotations}
                  label="本人判断の全履歴（追記順）"
                />
              </section>
              <section>
                <h2>音源・画像・取得資料</h2>
                <MediaView
                  b={b}
                  media={media}
                  onAttach={(id, f) =>
                    void run(async () => {
                      await attachMedia(db!, b, id, f);
                      await refresh(db!);
                      setMessage("素材を照合し保存しました。");
                    })
                  }
                />
              </section>
            </>
          ))}
        {page === "比較" && (
          <>
            <Notice>
              同じ面接の再評価差と、別日の推移を区別します。モデル不明の評価を統制済み比較とは扱いません。
            </Notice>
            <section>
              <h2>2つの評価を比較</h2>
              <div className="compare-select">
                {[true, false].map((isLeft) => (
                  <label key={String(isLeft)}>
                    {isLeft ? "比較元" : "比較先"}
                    <select
                      aria-label={isLeft ? "比較元" : "比較先"}
                      value={(isLeft ? l : r)?.key || ""}
                      onChange={(e) =>
                        isLeft
                          ? setLeft(e.target.value)
                          : setRight(e.target.value)
                      }
                    >
                      <option value="">評価を選択</option>
                      {selectedOptions.map((x) => (
                        <option key={x.key} value={x.key}>
                          {x.b.session.session_id} / {x.a.assessment_id}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              {l && r ? (
                <Comparison left={l} right={r} />
              ) : (
                <p>
                  比較する評価が2つ必要です。再採点JSONを追記しても過去評価は残ります。
                </p>
              )}
            </section>
            <section>
              <div className="section-title">
                <h2>練習日の推移</h2>
                <label>
                  <input
                    type="checkbox"
                    checked={strict}
                    onChange={(e) => setStrict(e.target.checked)}
                  />
                  厳密系列の条件のみ
                </label>
              </div>
              <p className="muted">
                Asia/Tokyo · 月曜始まり ·
                欠測は補完せず、線で結びません。合成例・部分練習・再回答・援助あり・条件不明は既定で除外。
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>練習日 / 週</th>
                      <th>文章</th>
                      <th>音声</th>
                      <th>系列と条件</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bundles
                      .filter(
                        (b) =>
                          (synthetic || !b.session.is_synthetic) &&
                          (!strict || strictSeries(b)),
                      )
                      .sort((a, b) =>
                        (a.session.started_at || "9999").localeCompare(
                          b.session.started_at || "9999",
                        ),
                      )
                      .map((b) => {
                        const a = selectDefault(b),
                          ix = indices(b, a);
                        return (
                          <tr key={b.session.session_id}>
                            <td>
                              <button onClick={() => open(b)}>
                                {tokyoDate(b.session.started_at)}
                              </button>
                              <small>
                                {tokyoWeek(b.session.started_at) || "週不明"}
                              </small>
                            </td>
                            <td>{display(ix.text)}</td>
                            <td>
                              {display(ix.audio)}
                              <small>{ix.audio_mode}</small>
                            </td>
                            <td>
                              {a ? (
                                <details>
                                  <summary>
                                    {a.evaluator.model_id || "モデル不明"} /{" "}
                                    {b.session.mode}
                                  </summary>
                                  <pre>{seriesKey(b, a)}</pre>
                                </details>
                              ) : (
                                "未評価"
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
        {page === "ミスと強み" && (
          <>
            <Notice>
              選択された既定評価を1面接1回で集計します。分類の補助タグは重複し得ます。強みの記録なしは「苦手」を意味しません。
            </Notice>
            {visible.length > 0 && (
              <section>
                <h2>分類の再発（評価系列ごと）</h2>
                <p className="muted">
                  モデル・基準・prompt・分類・metrics・証拠モード・練習モードごとに分離。再発は観測件数です。1回見られないだけで克服とは扱いません。
                </p>
                {recurrence(visible).map((group, i) => (
                  <details key={group.key} open>
                    <summary>
                      系列 {i + 1} · {group.model || "モデル不明・非統制"} ·{" "}
                      {group.mode} · {group.sessions}面接
                    </summary>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>分類</th>
                            <th>発生群</th>
                            <th>観測面接数</th>
                            <th>回答数 / 評価対象</th>
                            <th>重大度</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.terms.map((t) => (
                            <tr key={t.id}>
                              <th>{t.label}</th>
                              <td>{t.count}</td>
                              <td>
                                {t.observedSessions}/{group.sessions}
                                {t.observedSessions > 1 ? " · 再発を観測" : ""}
                              </td>
                              <td>
                                {t.answers}/{t.denominator}
                              </td>
                              <td>{t.severity}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                ))}
              </section>
            )}
            {!visible.length ? (
              <Empty onImport={() => setPage("データ管理")} />
            ) : (
              visible.map((b) => {
                const a = selectDefault(b);
                if (!a)
                  return (
                    <section key={b.session.session_id}>
                      {b.session.session_id} · 未評価
                    </section>
                  );
                return (
                  <section key={b.session.session_id}>
                    <div className="section-title">
                      <h2>{b.session.session_id}</h2>
                      <button onClick={() => open(b)}>根拠へ →</button>
                    </div>
                    <p>
                      未修正ミス {countedFindings(b, a).length} 件 · 強み{" "}
                      {countedFindings(b, a, "strength").length} 件
                    </p>
                    <small>
                      除外:{" "}
                      {
                        a.findings.filter(
                          (f) =>
                            f.kind !== "mistake" ||
                            !f.countable ||
                            f.resolved_in_turn ||
                            effectiveReview(b, f) === "rejected",
                        ).length
                      }
                      件（非ミス・不確実・提案・自己修復・拒否など）
                    </small>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>分類</th>
                            <th>発生群</th>
                            <th>回答出現率（分母）</th>
                            <th>100語あたり</th>
                            <th>重大度</th>
                          </tr>
                        </thead>
                        <tbody>
                          {categoryStats(b, a).map((s) => (
                            <tr key={s.id}>
                              <th>{s.label}</th>
                              <td>{s.count}</td>
                              <td>
                                {s.rate === null
                                  ? "不明"
                                  : Math.round(s.rate * 100) + "%"}{" "}
                                ({s.answers}/{s.denominator})
                              </td>
                              <td>
                                {s.per100 === null
                                  ? "対象外 / 不明"
                                  : s.per100.toFixed(1)}
                                <small>計数可能語数 {s.words ?? "不明"}</small>
                              </td>
                              <td>{s.severity}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <h3>強みの実例</h3>
                    {countedFindings(b, a, "strength").map((f) => (
                      <article key={f.finding_id}>
                        <strong>{terms.get(f.taxonomy_id!)?.label_ja}</strong>
                        <p>{f.description}</p>
                        <EvidenceView refs={f.evidence_refs} b={b} />
                      </article>
                    ))}
                    <details>
                      <summary>
                        トピック・質問型の分布（複数タグ、合計は100%を超え得ます）
                      </summary>
                      {[
                        ...new Set(
                          a.task_results.flatMap((t) => [
                            ...t.topic_ids,
                            ...t.question_type_ids,
                          ]),
                        ),
                      ].map((id) => (
                        <p key={id}>
                          {terms.get(id)?.label_ja}:{" "}
                          {
                            a.task_results.filter((t) =>
                              [...t.topic_ids, ...t.question_type_ids].includes(
                                id,
                              ),
                            ).length
                          }
                          /{a.task_results.length} 課題
                        </p>
                      ))}
                    </details>
                  </section>
                );
              })
            )}
          </>
        )}
        {page === "データ管理" && (
          <>
            <section
              className="drop"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void importFiles(Array.from(e.dataTransfer.files));
              }}
            >
              <h2>JSONを選択、またはここにドロップ</h2>
              <p>1ファイル10MiBまで。検証後の差分を確認してから保存します。</p>
              <small>
                未知のSchema版は保存せず、エラーと原文の隔離表示に留めます。
              </small>
            </section>
            {previews.map((p, i) => (
              <section key={i}>
                <h2>{p.file.name}</h2>
                {p.errors.length ? (
                  <Notice error>
                    <strong>保存できません（書込みゼロ）</strong>
                    <ul>
                      {p.errors.map((e, j) => (
                        <li key={j}>{e}</li>
                      ))}
                    </ul>
                    <details>
                      <summary>隔離表示：原文（保存されません）</summary>
                      <pre>{new TextDecoder().decode(p.bytes)}</pre>
                    </details>
                  </Notice>
                ) : (
                  <>
                    <p>
                      {p.input?.session.session_id} ·{" "}
                      {p.noOp ? "記録の追加なし（同内容）" : "差分プレビュー"}
                    </p>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>層</th>
                            <th>追加</th>
                            <th>再利用</th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.changes.map((c) => (
                            <tr key={c.collection}>
                              <th>{c.collection}</th>
                              <td>{c.added}</td>
                              <td>{c.reused}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {p.duplicates.length > 0 && (
                      <Notice>
                        別IDの重複候補: {p.duplicates.join(", ")}
                        。自動削除しません。
                      </Notice>
                    )}
                    {p.input?.session.is_synthetic && (
                      <Notice>
                        合成fixtureです。保存後も「合成例を表示」を選ばない限り実履歴に表示しません。
                      </Notice>
                    )}
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => void savePreview(i)}
                    >
                      差分を確認して保存
                    </button>
                  </>
                )}
                {p.warnings.length > 0 && (
                  <details open>
                    <summary>warning {p.warnings.length}件</summary>
                    <ul>
                      {p.warnings.map((w, j) => (
                        <li key={j}>{w}</li>
                      ))}
                    </ul>
                  </details>
                )}
                <button
                  disabled={busy}
                  onClick={() =>
                    setPreviews((rows) => rows.filter((_, j) => j !== i))
                  }
                >
                  閉じる
                </button>
              </section>
            ))}
            <section>
              <h2>バックアップ・復元</h2>
              <p>
                端末間の移動は手動です。復元は既存記録への追記として検証し、衝突があれば全件保存しません。
              </p>
              <div className="actions">
                <button
                  disabled={!db || busy}
                  onClick={() =>
                    void run(async () =>
                      download(
                        await (
                          await import("./storage/backup")
                        ).makeBackup(db!, false),
                        "eiken-json-backup.zip",
                        "application/zip",
                      ),
                    )
                  }
                >
                  JSONのみバックアップ
                </button>
                <button
                  disabled={!db || busy}
                  onClick={() =>
                    void run(async () =>
                      download(
                        await (
                          await import("./storage/backup")
                        ).makeBackup(db!, true),
                        "eiken-media-backup.zip",
                        "application/zip",
                      ),
                    )
                  }
                >
                  素材込みバックアップ
                </button>
                <label className="file-button">
                  バックアップを検証
                  <input
                    aria-label="バックアップを検証"
                    type="file"
                    accept=".zip"
                    disabled={busy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f)
                        void run(async () => {
                          if (f.size > 256 * 1024 * 1024)
                            throw new Error("ZIPは256MiBまで");
                          setRestorePlan(
                            await (
                              await import("./storage/backup")
                            ).inspectBackup(
                              new Uint8Array(await f.arrayBuffer()),
                            ),
                          );
                        });
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
              {restorePlan && (
                <Notice>
                  <p>
                    復元プレビュー: {restorePlan.bundles.length}面接、原取込ログ{" "}
                    {restorePlan.logs.length}件、素材 {restorePlan.media.length}
                    件
                  </p>
                  <details>
                    <summary>警告 {restorePlan.warnings.length}件</summary>
                    <ul>
                      {restorePlan.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </details>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await (
                          await import("./storage/backup")
                        ).restore(db!, restorePlan);
                        await refresh(db!);
                        setRestorePlan(undefined);
                        setMessage(
                          "復元しました。参照とファイルhashを検証済みです。",
                        );
                      })
                    }
                  >
                    検証結果を確認して復元
                  </button>
                </Notice>
              )}
            </section>
            <section>
              <h2>面接の書出し・素材・削除</h2>
              <SessionPicker bundles={bundles} sid={sid} setSid={setSid} />
              {b && (
                <>
                  <div className="actions">
                    <button
                      onClick={() =>
                        download(
                          encode(selfContained(b)),
                          b.session.session_id + ".json",
                        )
                      }
                    >
                      自己完結JSONを書出し
                    </button>
                    <button
                      disabled={!tr || !b.question_sets.length}
                      onClick={() =>
                        void run(async () => {
                          download(
                            encode(
                              (await import("./storage/backup")).rescoreInput(
                                b,
                                tr!.transcript_id,
                                a?.input.question_set_id ||
                                  b.question_sets[0].question_set_id,
                              ),
                            ),
                            b.session.session_id + "-rescore-view.json",
                          );
                        })
                      }
                    >
                      再採点入力view（基準1.0.0）
                    </button>
                    <button onClick={() => open(b)}>
                      詳細で入力版・素材を選ぶ
                    </button>
                  </div>
                  <p className="muted">
                    JSON書出しに音源bytesは含みません。再採点viewは表示中のTranscript版、評価入力の問題セット（未評価なら最初のセット）を使用。旧評価・改善版を除外します。
                  </p>
                  <MediaView
                    b={b}
                    media={media}
                    onAttach={(id, f) =>
                      void run(async () => {
                        await attachMedia(db!, b, id, f);
                        await refresh(db!);
                      })
                    }
                  />
                  <label>
                    <input
                      type="checkbox"
                      checked={deleteConfirm}
                      onChange={(e) => setDeleteConfirm(e.target.checked)}
                    />
                    この面接のRAW・全Transcript・全評価・本人annotation・取込原本・素材・派生データを端末から削除する
                  </label>
                  <button
                    className="danger"
                    disabled={!deleteConfirm || busy}
                    onClick={() =>
                      void run(async () => {
                        await deleteSession(db!, b.session.session_id);
                        setSid("");
                        await refresh(db!);
                        setMessage(
                          "指定面接と関連データを削除しました。共有の固定仕様は保持しています。",
                        );
                      })
                    }
                  >
                    指定した面接を削除
                  </button>
                </>
              )}
            </section>
            <section>
              <h2>取込履歴と保存領域</h2>
              <p>使用量（ブラウザ推定）: {usage}</p>
              <p>
                Schema / rubric / taxonomy / metrics: 1.0.0 · 検証器 web-1.0.0
              </p>
              {!logs.length && <p>取込履歴はまだありません。</p>}
              {logs.map((log) => (
                <details key={log.key}>
                  <summary>
                    {log.filename} · {tokyoDate(log.imported_at)}
                  </summary>
                  <p>
                    {log.session_id} / {log.export_id}
                  </p>
                  <small>
                    SHA-256: {log.hash} · {log.bytes.length} bytes ·{" "}
                    {log.validator_version}
                  </small>
                  <ul>
                    {log.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                  <button onClick={() => download(log.bytes, log.filename)}>
                    原ファイルをそのまま書出し
                  </button>
                </details>
              ))}
            </section>
          </>
        )}
        <footer>
          英検公式の採点・CSE換算・合格予測は行いません。保存データを外部送信する機能はありません。
        </footer>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
