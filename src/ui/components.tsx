import React, { useEffect, useState } from "react";
import type { Bundle, Assessment, Evidence } from "../domain/model";
import type { Media } from "../storage/db";
import { indices, display, tokyoDate, seriesKey } from "../domain/analysis";
import rubric from "../../contracts/v1/profiles/rubric.json";
export function Json({
  value,
  label = "データを表示",
}: {
  value: unknown;
  label?: string;
}) {
  return (
    <details>
      <summary>{label}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

export function Notice({
  children,
  error = false,
}: {
  children: React.ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={"notice " + (error ? "error" : "")}
      role={error ? "alert" : undefined}
    >
      {children}
    </div>
  );
}

export function EvidenceView({ refs, b }: { refs: Evidence[]; b: Bundle }) {
  return (
    <div className="evidence">
      {refs.map((e, i) => (
        <div key={i}>
          {e.kind === "turn" ? (
            <>
              <a href={"#turn-" + e.turn_id}>{e.turn_id}</a>
              <small>
                Transcript: {e.transcript_id} · 文字位置{" "}
                {e.char_start ?? "不明"}–{e.char_end ?? "不明"}
              </small>
              <blockquote>{e.quote ?? "引用なし（参照先を確認）"}</blockquote>
            </>
          ) : e.kind === "capture" ? (
            <>
              <a href={"#capture-" + e.capture_id}>{e.capture_id}</a>
              <blockquote>{e.quote ?? "引用なし"}</blockquote>
            </>
          ) : e.kind === "event" ? (
            <>
              <a href={"#event-" + e.event_id}>{e.event_id}</a>{" "}
              {b.events.find((x) => x.event_id === e.event_id)?.detail}
            </>
          ) : (
            <>
              <a href={"#asset-" + e.asset_id}>{e.asset_id}</a> {e.start_ms}–
              {e.end_ms} ms{" "}
              <button
                onClick={() => {
                  const el = document.getElementById(
                    "audio-" + e.asset_id,
                  ) as HTMLAudioElement | null;
                  if (!el) return;
                  el.currentTime = e.start_ms / 1000;
                  const stop = () => {
                    if (el.currentTime >= e.end_ms / 1000) {
                      el.pause();
                      el.ontimeupdate = null;
                    }
                  };
                  el.ontimeupdate = stop;
                  void el.play().catch(() => {
                    el.ontimeupdate = null;
                  });
                }}
              >
                区間再生（添付時）
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

export function Scores({ b, a }: { b: Bundle; a?: Assessment }) {
  if (!a)
    return (
      <Notice>
        未評価です。評価JSONを取り込むと、根拠付きの結果を確認できます。
      </Notice>
    );
  const out = indices(b, a);
  return (
    <>
      <div className="index-grid">
        <div className="index">
          <span>文章指数</span>
          <strong>{display(out.text)}</strong>
          <small>5課題が揃う通し模擬のみ</small>
        </div>
        <div className="index">
          <span>音声指数</span>
          <strong>{display(out.audio)}</strong>
          <small>
            {out.audio_mode === "provisional"
              ? "暫定 live音声（保存音源と別系列）"
              : out.audio_mode === "archived"
                ? "保存音源に基づく評価"
                : "音源なし / 必要な観点が未評価"}
          </small>
        </div>
        <div className="index">
          <span>対話維持</span>
          <strong>
            {a.session_criteria[0].status === "scored"
              ? a.session_criteria[0].score + " / 4"
              : "未評価"}
          </strong>
          <small>{a.session_criteria[0].evidence_mode} 根拠の範囲</small>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <caption>課題別・7観点（0と未評価は別）</caption>
          <thead>
            <tr>
              <th>課題</th>
              {rubric.criteria.slice(0, 6).map((c) => (
                <th key={c.id}>{c.label_ja}</th>
              ))}
              <th>文章</th>
              <th>音声</th>
            </tr>
          </thead>
          <tbody>
            {a.task_results.map((t) => {
              const d = out.tasks.find((x) => x.question_id === t.question_id)!;
              return (
                <tr key={t.question_id}>
                  <th>
                    {d.slot}
                    <small>{t.attempt_status}</small>
                  </th>
                  {t.criteria.map((c) => (
                    <td key={c.criterion_id} title={c.reason}>
                      {c.status === "scored" ? (
                        c.score
                      ) : (
                        <span className="muted">未評価</span>
                      )}
                    </td>
                  ))}
                  <td>{display(d.text)}</td>
                  <td>
                    {display(d.audio)}
                    <small>
                      {d.audio_mode === "provisional"
                        ? "暫定 live"
                        : d.audio_mode === "archived"
                          ? "保存音源"
                          : ""}
                    </small>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted">
        学習用の記述的な指数です。文章と音声は合算しません。部分練習は課題別のみ表示します。
      </p>
    </>
  );
}

export function MediaView({
  b,
  media,
  onAttach,
}: {
  b: Bundle;
  media: Media[];
  onAttach: (id: string, f: File) => void;
}) {
  return (
    <>
      {!b.assets.length && (
        <p className="muted">音源・画像の登録はありません。</p>
      )}
      {b.assets.map((a) => (
        <Asset
          key={a.asset_id}
          asset={a}
          media={media.find(
            (m) =>
              m.session_id === b.session.session_id &&
              m.asset_id === a.asset_id,
          )}
          onAttach={(f) => onAttach(a.asset_id, f)}
        />
      ))}
    </>
  );
}

export function Asset({
  asset: a,
  media,
  onAttach,
}: {
  asset: Bundle["assets"][number];
  media?: Media;
  onAttach: (f: File) => void;
}) {
  const [url, setUrl] = useState("");
  const [mediaError, setMediaError] = useState(false);
  useEffect(() => {
    setMediaError(false);
    if (!media) {
      setUrl("");
      return;
    }
    const u = URL.createObjectURL(
      new Blob([new Uint8Array(media.bytes)], { type: media.mime }),
    );
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [media]);
  const safeImage = [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
  ].includes(media?.mime || "");
  return (
    <article className="asset" id={"asset-" + a.asset_id}>
      <strong>{a.filename}</strong>
      <small>
        {a.asset_id} · {a.kind} · {a.rights}
      </small>
      {!media ? (
        <Notice>
          未添付 · JSON内の状態: {a.availability}。外部URLは自動取得しません。
        </Notice>
      ) : (
        <>
          <p>
            端末内添付済み · SHA-256検証済み
            {a.sha256 === null ? "（申告hashなし。元bytesの一致は未確認）" : ""}
          </p>
          {a.kind === "audio" && media.mime.startsWith("audio/") ? (
            <audio
              id={"audio-" + a.asset_id}
              controls
              src={url || undefined}
              onError={() => setMediaError(true)}
            />
          ) : safeImage ? (
            <img
              src={url || undefined}
              alt={a.filename}
              onError={() => setMediaError(true)}
            />
          ) : (
            <p>プレビュー対象外の素材です。</p>
          )}
        </>
      )}
      {mediaError && (
        <Notice error>
          このブラウザで素材を再生・表示できません。bytesは保持しています。形式またはファイルを確認してください。
        </Notice>
      )}
      <label className="file-button">
        素材を照合して添付
        <input
          type="file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onAttach(f);
            e.target.value = "";
          }}
        />
      </label>
    </article>
  );
}

export function Empty({ onImport }: { onImport: () => void }) {
  return (
    <section className="empty">
      <span className="empty-icon">＋</span>
      <h2>最初の記録を取り込みましょう</h2>
      <p>
        面接は別のChat / Voiceで。ここでは記録と分析を行います。
        <br />
        得点がない記録も、原文のまま保存できます。
      </p>
      <button onClick={onImport}>データ管理を開く</button>
    </section>
  );
}

export function SessionMeta({ b }: { b: Bundle }) {
  return (
    <div className="session-meta">
      <strong>{tokyoDate(b.session.started_at)}</strong>
      <div className="pills">
        <span>{b.session.mode}</span>
        <span>{b.session.state}</span>
        {b.session.is_synthetic && <span>合成例・実履歴外</span>}
        <span>援助: {b.session.conditions.assistance_used}</span>
        <span>既見: {b.session.conditions.question_seen_before}</span>
        <span>
          {b.session.parent_session_id
            ? "再回答 → " + b.session.parent_session_id
            : "初回 / 親なし"}
        </span>
      </div>
      <small>{b.session.session_id}</small>
      <Json value={b.session} label="面接条件をすべて確認" />
    </div>
  );
}

export function SessionPicker({
  bundles,
  sid,
  setSid,
}: {
  bundles: Bundle[];
  sid: string;
  setSid: (s: string) => void;
}) {
  return (
    <label className="session-picker">
      面接を選択
      <select
        aria-label="面接を選択"
        value={sid}
        onChange={(e) => setSid(e.target.value)}
      >
        <option value="">面接を選んでください</option>
        {bundles.map((b) => (
          <option key={b.session.session_id} value={b.session.session_id}>
            {b.session.session_id} · {b.session.is_synthetic ? "合成例 · " : ""}
            {tokyoDate(b.session.started_at)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Comparison({
  left: l,
  right: r,
}: {
  left: { b: Bundle; a: Assessment };
  right: { b: Bundle; a: Assessment };
}) {
  const ix = indices(l.b, l.a),
    iy = indices(r.b, r.a);
  const same =
    seriesKey(l.b, l.a) === seriesKey(r.b, r.a) &&
    !!l.a.evaluator.model_id &&
    !!r.a.evaluator.model_id;
  return (
    <>
      <h3>
        {l.b.session.session_id === r.b.session.session_id
          ? "同じ面接の再評価差"
          : l.b.session.parent_session_id === r.b.session.session_id ||
              r.b.session.parent_session_id === l.b.session.session_id
            ? "初回と再回答の対"
            : "別面接・別日の比較"}
      </h3>
      {!same && (
        <Notice>
          系列・モデル・証拠条件の差、またはモデル不明があります。能力向上の同条件比較として結論づけないでください。
        </Notice>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>比較項目</th>
              <th>比較元</th>
              <th>比較先</th>
              <th>差（先−元）</th>
            </tr>
          </thead>
          <tbody>
            {(["text", "audio"] as const).map((k) => (
              <tr key={k}>
                <th>{k === "text" ? "文章指数" : "音声指数"}</th>
                <td>{display(ix[k])}</td>
                <td>{display(iy[k])}</td>
                <td>
                  {ix[k] !== null &&
                  iy[k] !== null &&
                  (k === "text" || ix.audio_mode === iy.audio_mode)
                    ? Math.round(iy[k]! - ix[k]!)
                    : "比較不可"}
                </td>
              </tr>
            ))}
            {ix.tasks.map((t) => {
              const u = iy.tasks.find((u) => u.slot === t.slot);
              return (
                <tr key={t.question_id}>
                  <th>{t.slot} 文章</th>
                  <td>{display(t.text)}</td>
                  <td>{display(u?.text)}</td>
                  <td>
                    {t.text !== null && u?.text != null
                      ? Math.round(u.text - t.text)
                      : "比較不可"}
                  </td>
                </tr>
              );
            })}
            {l.a.task_results.flatMap((t) => {
              const slot = l.b.question_sets
                .find((q) => q.question_set_id === l.a.input.question_set_id)
                ?.questions.find((q) => q.question_id === t.question_id)?.slot;
              const qid = r.b.question_sets
                .find((q) => q.question_set_id === r.a.input.question_set_id)
                ?.questions.find((q) => q.slot === slot)?.question_id;
              const task = r.a.task_results.find((t) => t.question_id === qid);
              return t.criteria.map((c) => {
                const d = task?.criteria.find(
                  (d) => d.criterion_id === c.criterion_id,
                );
                const audio =
                  c.criterion_id === "intelligibility" ||
                  c.criterion_id === "fluency";
                return (
                  <tr key={t.question_id + c.criterion_id}>
                    <th>
                      {slot} ·{" "}
                      {
                        rubric.criteria.find((x) => x.id === c.criterion_id)
                          ?.label_ja
                      }
                    </th>
                    <td>{c.score ?? "未評価"}</td>
                    <td>{d?.score ?? "未評価"}</td>
                    <td>
                      {c.status === "scored" &&
                      d?.status === "scored" &&
                      (!audio || c.evidence_mode === d.evidence_mode)
                        ? d.score! - c.score!
                        : "比較不可"}
                    </td>
                  </tr>
                );
              });
            })}
            {[
              [
                "対話維持",
                l.a.session_criteria[0].score === null
                  ? "未評価"
                  : String(l.a.session_criteria[0].score),
                r.a.session_criteria[0].score === null
                  ? "未評価"
                  : String(r.a.session_criteria[0].score),
              ],
              ["Transcript", l.a.input.transcript_id, r.a.input.transcript_id],
              [
                "問題セット",
                l.a.input.question_set_id,
                r.a.input.question_set_id,
              ],
              [
                "基準/prompt/分類/metrics",
                JSON.stringify(l.a.versions),
                JSON.stringify(r.a.versions),
              ],
              [
                "モデル",
                JSON.stringify(l.a.evaluator),
                JSON.stringify(r.a.evaluator),
              ],
              [
                "音声入力",
                JSON.stringify({
                  assets: l.a.input.asset_ids,
                  live: l.a.input.live_capture_ids,
                }),
                JSON.stringify({
                  assets: r.a.input.asset_ids,
                  live: r.a.input.live_capture_ids,
                }),
              ],
              ["評価日", tokyoDate(l.a.created_at), tokyoDate(r.a.created_at)],
            ].map(([name, x, y]) => (
              <tr key={name}>
                <th>{name}</th>
                <td>{x}</td>
                <td>{y}</td>
                <td>{x === y ? "同じ" : "差あり"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
