import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "../../contracts/v1/schemas/session-bundle.schema.json";
import taxonomy from "../../contracts/v1/profiles/taxonomy.json";
import {
  collections,
  slots,
  textCriteria,
  audioCriteria,
  mergeBundle,
  type Bundle,
  type Assessment,
  type Evidence,
  type Turn,
} from "../domain/model";
import { wordcount } from "../domain/analysis";
export const VALIDATOR_VERSION = "web-1.0.0";
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv, { mode: "full" });
const structure = ajv.compile<Bundle>(schema);
export const terms = new Map(taxonomy.terms.map((t) => [t.id, t]));
export interface Validation {
  errors: string[];
  warnings: string[];
  bundle?: Bundle;
}
export function validate(data: unknown, context?: Bundle): Validation {
  const errors: string[] = [],
    warnings: string[] = [];
  const err = (p: string, m: string) => {
    errors.push(`${p}: ${m}`);
  };
  const warn = (p: string, m: string) => {
    warnings.push(`${p}: ${m}`);
  };
  if (!structure(data))
    return {
      errors: (structure.errors || []).map(
        (e) =>
          `${e.instancePath || "/"}: ${e.message} ${JSON.stringify(e.params)}`,
      ),
      warnings,
    };
  const input = data;
  if (context && input.bundle_mode === "self_contained") {
    const standalone = validate(input);
    if (standalone.errors.length) return standalone;
  }

  for (const [key, id] of Object.entries(collections)) {
    const seen = new Set();
    for (const row of input[
      key as keyof typeof collections
    ] as unknown as Record<string, unknown>[]) {
      if (seen.has(row[id])) err("/" + key, "ID重複 " + row[id]);
      seen.add(row[id]);
    }
  }
  let b: Bundle;
  try {
    b = mergeBundle(input, context);
  } catch (e) {
    return { errors: [String(e)], warnings };
  }
  if (input.bundle_mode === "append" && !context)
    err("/bundle_mode", "append は既存面接が必要です");
  const assets = new Map(b.assets.map((x) => [x.asset_id, x]));
  const captures = new Map(b.captures.map((x) => [x.capture_id, x]));
  const trs = new Map(b.transcripts.map((x) => [x.transcript_id, x]));
  const sets = new Map(b.question_sets.map((x) => [x.question_set_id, x]));
  const events = new Map(b.events.map((x) => [x.event_id, x]));
  const assessments = new Map(b.assessments.map((x) => [x.assessment_id, x]));
  const turns = new Map<string, { tr: string; t: Turn }>();
  const questions = new Map<
    string,
    Bundle["question_sets"][number]["questions"][number]
  >();
  const findings = new Map<string, Assessment["findings"][number]>();
  function need<T>(map: Map<string, T>, id: string, p: string): T | undefined {
    const v = map.get(id);
    if (!v) err(p, "参照が存在しません " + id);
    return v;
  }
  function cycles(nodes: Map<string, string[]>, p: string) {
    const done = new Set<string>(),
      active = new Set<string>();
    function visit(id: string) {
      if (active.has(id)) {
        err(p, "循環参照 " + id);
        return;
      }
      if (done.has(id)) return;
      active.add(id);
      for (const x of nodes.get(id) || []) visit(x);
      active.delete(id);
      done.add(id);
    }
    for (const id of nodes.keys()) visit(id);
  }
  function segment(
    seg: { asset_id: string; start_ms: number; end_ms: number },
    p: string,
  ) {
    const a = need(assets, seg.asset_id, p);
    if (a?.kind !== "audio") err(p, "音声参照は kind=audio が必要");
    if (seg.start_ms >= seg.end_ms)
      err(p, "開始時刻は終了時刻より前である必要があります");
    if (a?.duration_ms != null && seg.end_ms > a.duration_ms)
      err(p, "音源区間を超えています");
    if (a?.duration_ms == null)
      warn(p, "音源長が不明なため区間の上限を検証できません");
  }
  for (const a of b.assets) {
    if (a.sha256 === null)
      warn("/assets/" + a.asset_id, "元ファイルhash未検証");
    if (a.availability === "saved" && !a.path)
      err("/assets/" + a.asset_id, "saved 素材にpathがありません");
    if (a.availability !== "saved")
      warn(
        "/assets/" + a.asset_id,
        "素材は未添付または外部参照です。自動取得しません",
      );
  }
  for (const c of b.captures) {
    const p = "/captures/" + c.capture_id;
    if (!c.content_text && !c.asset_id)
      err(p, "取得元の本文またはasset参照が必要");
    if (c.asset_id) need(assets, c.asset_id, p);
    if (
      c.kind === "audio_recording" &&
      assets.get(c.asset_id || "")?.kind !== "audio"
    )
      err(p, "録音には音声素材が必要");
    if (c.kind === "model_reconstruction" && c.verified_by !== "none")
      err(p, "再構成を検証済みRAWにはできません");
  }
  for (const qs of b.question_sets) {
    const p = "/question_sets/" + qs.question_set_id;
    const seen = new Set<string>();
    for (const id of qs.asset_ids) need(assets, id, p);
    for (const q of qs.questions) {
      if (seen.has(q.slot)) err(p, "slot重複 " + q.slot);
      seen.add(q.slot);
      if (questions.has(q.question_id))
        err(p, "question ID重複 " + q.question_id);
      questions.set(q.question_id, q);
    }
    if (
      b.session.mode === "mock_interview" &&
      b.session.state === "completed" &&
      (seen.size !== 5 || slots.some((s) => !seen.has(s)))
    )
      err(p, "completed mock は5課題がちょうど1つずつ必要");
  }
  for (const tr of b.transcripts) {
    const p = "/transcripts/" + tr.transcript_id;
    if (tr.parent_transcript_id) need(trs, tr.parent_transcript_id, p);
    for (const id of tr.source_capture_ids) need(captures, id, p);
    if (tr.kind === "reconstruction")
      warn(p, "再構成文です。元の逐語記録とは異なります");
    if (tr.coverage !== "complete") warn(p, "取得範囲は " + tr.coverage);
    if (
      tr.kind === "human_verified" &&
      (!tr.source_capture_ids.some(
        (id) => captures.get(id)?.kind === "audio_recording",
      ) ||
        !tr.source_capture_ids.some((id) =>
          ["human", "learner"].includes(captures.get(id)?.verified_by || ""),
        ))
    )
      err(p, "音源と人による確認記録が必要");
    let previousPhase = -1;
    const lastEnd = new Map<string, number>();
    const phases = [
      "setup",
      "warmup",
      "preparation",
      ...slots,
      "closing",
      "post_processing",
    ];
    tr.turns.forEach((t, i) => {
      const tp = p + "/" + t.turn_id;
      if (turns.has(t.turn_id))
        err(tp, "turn IDは全Transcript版で一意にしてください");
      turns.set(t.turn_id, { tr: tr.transcript_id, t });
      if (t.sequence !== i + 1) err(tp, "sequence は記録順の連続する1..N");
      for (const id of t.source_capture_ids) need(captures, id, tp);
      if (t.question_id) {
        const q = need(questions, t.question_id, tp);
        if (
          q &&
          slots.includes(t.phase as (typeof slots)[number]) &&
          q.slot !== t.phase
        )
          err(tp, "課題とphaseが一致しません");
      }
      if (t.turn_kind === "answer" && t.speaker !== "learner")
        err(tp, "answerは学習者の発話が必要");
      const phase = phases.indexOf(t.phase);
      if (phase < previousPhase) warn(tp, "課題の進行順が逆転しています");
      previousPhase = phase;
      if (t.audio_segment) {
        segment(t.audio_segment, tp);
        const key = t.audio_segment.asset_id + ":" + t.speaker;
        if (t.audio_segment.start_ms < (lastEnd.get(key) ?? 0))
          err(tp, "同一話者の音声区間の時間順が逆転/重複");
        lastEnd.set(key, t.audio_segment.end_ms);
      }
    });
    if (
      tr.parent_transcript_id &&
      tr.created_at &&
      trs.get(tr.parent_transcript_id)?.created_at &&
      Date.parse(tr.created_at) <
        Date.parse(trs.get(tr.parent_transcript_id)!.created_at!)
    )
      err(p, "新版Transcriptの作成日時が親より前です");
  }
  for (const { tr, t } of turns.values())
    for (const id of t.previous_turn_ids) {
      const prev = need(turns, id, "/turns/" + t.turn_id);
      if (prev?.tr === tr)
        err(
          "/turns/" + t.turn_id,
          "previous_turn は旧Transcript版を参照してください",
        );
    }
  cycles(
    new Map(
      b.transcripts.map((t) => [
        t.transcript_id,
        t.parent_transcript_id ? [t.parent_transcript_id] : [],
      ]),
    ),
    "/transcripts",
  );
  cycles(
    new Map([...turns].map(([id, { t }]) => [id, t.previous_turn_ids])),
    "/turns",
  );
  let eventOffset = -1;
  for (const e of b.events) {
    const p = "/events/" + e.event_id;
    need(captures, e.source_capture_id, p);
    if (e.turn_id) {
      const t = need(turns, e.turn_id, p)?.t;
      if (t && e.phase !== t.phase) err(p, "event と turn のphaseが不一致");
    }
    if (e.offset_ms !== null) {
      if (e.offset_ms < eventOffset) warn(p, "イベント時刻の記録順が逆転");
      eventOffset = e.offset_ms;
    }
  }
  function evidence(
    refs: Evidence[],
    a: Assessment,
    p: string,
    qid?: string | null,
  ) {
    for (const e of refs) {
      if (e.kind === "turn") {
        need(trs, e.transcript_id, p);
        const t = need(turns, e.turn_id, p);
        if (e.transcript_id !== a.input.transcript_id)
          err(p, "評価入力と異なるTranscriptの根拠です");
        if (t) {
          if (t.tr !== e.transcript_id) err(p, "turnとTranscriptが不一致");
          if (qid && t.t.question_id !== qid) err(p, "別課題の根拠です");
          const text = t.t.text || "";
          const chars = Array.from(text);
          if (e.quote !== null && !text.includes(e.quote))
            err(p, "引用が原文にありません");
          if ((e.char_start === null) !== (e.char_end === null))
            err(p, "文字位置の両端が必要");
          if (e.char_start !== null && e.char_end !== null) {
            if (e.char_start >= e.char_end || e.char_end > chars.length)
              err(p, "Unicodeコードポイント範囲が不正");
            else if (
              e.quote !== null &&
              chars.slice(e.char_start, e.char_end).join("") !== e.quote
            )
              err(p, "文字位置と引用が一致しません");
          }
        }
      } else if (e.kind === "audio") {
        segment(e, p);
        if (!a.input.asset_ids.includes(e.asset_id))
          err(p, "評価入力に含まれない音源");
        if (qid) {
          const tr = trs.get(a.input.transcript_id);
          const ranges =
            tr?.turns
              .filter(
                (t) =>
                  t.question_id === qid &&
                  t.audio_segment?.asset_id === e.asset_id,
              )
              .map((t) => t.audio_segment!) || [];
          if (
            ranges.length &&
            !ranges.some(
              (s) => e.start_ms >= s.start_ms && e.end_ms <= s.end_ms,
            )
          )
            err(p, "音声根拠が当該課題区間の外です");
          if (!ranges.length) warn(p, "課題と音声区間の対応を検証できません");
        }
      } else if (e.kind === "capture") {
        const c = need(captures, e.capture_id, p);
        if (c && e.quote !== null && !(c.content_text || "").includes(e.quote))
          err(p, "capture引用が一致しません");
        if (
          c?.kind === "live_observation" &&
          !a.input.live_capture_ids.includes(c.capture_id)
        )
          err(p, "評価入力外のlive観察");
      } else {
        const event = need(events, e.event_id, p);
        if (
          qid &&
          event?.turn_id &&
          turns.get(event.turn_id)?.t.question_id !== qid
        )
          err(p, "別課題のイベント根拠");
      }
    }
  }
  function criteria(
    items: Assessment["session_criteria"][number][],
    a: Assessment,
    p: string,
    ids: string[],
    task?: Assessment["task_results"][number],
  ) {
    if (
      new Set(items.map((c) => c.criterion_id)).size !== ids.length ||
      items.some((c) => !ids.includes(c.criterion_id))
    )
      err(p, "観点は指定された種類を各1回ずつ記録してください");
    for (const c of items) {
      const cp = p + "/" + c.criterion_id;
      evidence(c.evidence_refs, a, cp, task?.question_id);
      if (c.status !== "scored") continue;
      const kinds = c.evidence_refs.map((e) => e.kind);
      if (
        audioCriteria.includes(c.criterion_id) &&
        !["archived_audio", "live_audio"].includes(c.evidence_mode)
      )
        err(cp, "明瞭さ・流暢さには実音声の根拠が必要");
      if (c.evidence_mode === "text" && !kinds.includes("turn"))
        err(cp, "text採点にはturn根拠が必要");
      if (c.evidence_mode === "archived_audio" && !kinds.includes("audio"))
        err(cp, "保存音源区間の根拠が必要");
      if (c.evidence_mode === "event" && !kinds.includes("event"))
        err(cp, "event根拠が必要");
      if (c.evidence_mode === "live_audio") {
        if (c.confidence === "high")
          err(cp, "live音声のconfidenceは最大medium");
        const live = c.evidence_refs.filter((e) => e.kind === "capture");
        if (
          !live.length ||
          live.some(
            (e) =>
              !a.input.live_capture_ids.includes(e.capture_id) ||
              captures.get(e.capture_id)?.kind !== "live_observation",
          )
        )
          err(cp, "入力に含まれるlive観察が必要");
      }
      if (!task) continue;
      if (["missing_capture", "not_asked"].includes(task.attempt_status))
        err(cp, "未取得・未出題は得点化できません");
      if (task.attempt_status === "no_response_observed") {
        if (c.criterion_id !== "task_response" || c.score !== 0)
          err(cp, "無回答はtask_response=0のみ");
        if (
          !c.evidence_refs.some(
            (e) =>
              e.kind === "event" &&
              events.get(e.event_id)?.kind === "no_response_observed" &&
              events.get(e.event_id)?.phase ===
                questions.get(task.question_id)?.slot,
          )
        )
          err(cp, "当該課題の無回答確認イベントが必要");
      }
      if (
        c.evidence_mode === "text" &&
        textCriteria.includes(c.criterion_id) &&
        !c.evidence_refs.some(
          (e) =>
            e.kind === "turn" &&
            turns.get(e.turn_id)?.t.speaker === "learner" &&
            turns.get(e.turn_id)?.t.turn_kind === "answer" &&
            turns.get(e.turn_id)?.t.content_status === "captured" &&
            turns.get(e.turn_id)?.t.phase !== "post_processing",
        )
      )
        err(cp, "取得済み学習者答案の根拠が必要");
      const answers =
        trs
          .get(a.input.transcript_id)
          ?.turns.filter(
            (t) =>
              t.question_id === task.question_id &&
              t.speaker === "learner" &&
              t.turn_kind === "answer" &&
              t.phase !== "post_processing" &&
              t.content_status === "captured",
          ) || [];
      if (
        ["grammar", "vocabulary"].includes(c.criterion_id) &&
        answers.reduce((s, t) => s + wordcount(t.text || ""), 0) < 5
      )
        err(cp, "文法・語彙には英語5語以上の観測が必要");
      if (
        c.criterion_id === "task_response" &&
        b.session.mode === "mock_interview" &&
        ["narration", "q1"].includes(
          questions.get(task.question_id)?.slot || "",
        ) &&
        (b.session.conditions.image_available !== "yes" ||
          !sets
            .get(a.input.question_set_id)
            ?.asset_ids.some(
              (id) =>
                assets.get(id)?.kind === "image" &&
                a.input.asset_ids.includes(id),
            ))
      )
        err(cp, "画像が必要な内容評価に入力画像がありません");
    }
  }
  for (const a of b.assessments) {
    const p = "/assessments/" + a.assessment_id;
    if (
      a.created_at &&
      b.session.started_at &&
      Date.parse(a.created_at) < Date.parse(b.session.started_at)
    )
      err(p, "評価日時が練習開始より前です");
    const tr = need(trs, a.input.transcript_id, p),
      qs = need(sets, a.input.question_set_id, p);
    for (const [k, v] of Object.entries(a.versions))
      if (v !== "1.0.0")
        err(p, "未対応の版 " + k + " " + v + "。旧版を最新扱いしません");
    for (const id of a.input.asset_ids) need(assets, id, p);
    for (const id of a.input.live_capture_ids)
      if (need(captures, id, p)?.kind !== "live_observation")
        err(p, "live入力はlive_observationが必要");
    if (!a.evaluator.model_id)
      warn(p, "モデル不明。同一モデルで統制された比較とは扱いません");
    if (a.input.input_manifest_sha256)
      warn(
        p,
        "入力manifestの正準化契約がないため申告hashを確定値として使いません",
      );
    if (a.supersedes_assessment_id) {
      const old = need(assessments, a.supersedes_assessment_id, p);
      if (
        a.created_at &&
        old?.created_at &&
        Date.parse(a.created_at) < Date.parse(old.created_at)
      )
        err(p, "再採点日時が旧評価より前");
    }
    if (
      a.created_at &&
      tr?.created_at &&
      Date.parse(a.created_at) < Date.parse(tr.created_at)
    )
      err(p, "評価日時が入力版の作成より前");
    const taskIds = a.task_results.map((t) => t.question_id);
    if (new Set(taskIds).size !== taskIds.length) err(p, "課題評価の重複");
    const qids = qs?.questions.map((q) => q.question_id) || [];
    if (taskIds.some((id) => !qids.includes(id)))
      err(p, "入力問題セットにない課題");
    if (
      b.session.mode === "mock_interview" &&
      b.session.state === "completed" &&
      qids.some((id) => !taskIds.includes(id))
    )
      err(p, "completed mock は未評価を含め全課題結果が必要");
    for (const task of a.task_results) {
      criteria(
        task.criteria,
        a,
        p + "/" + task.question_id,
        [...textCriteria, ...audioCriteria],
        task,
      );
      for (const [ns, termsList] of [
        ["topic", task.topic_ids],
        ["question", task.question_type_ids],
      ] as const)
        for (const id of termsList)
          if (terms.get(id)?.namespace !== ns)
            err(p, "taxonomyのID/namespace不一致 " + id);
    }
    criteria(a.session_criteria, a, p + "/session", ["interaction"]);
    for (const f of a.findings) {
      const fp = p + "/" + f.finding_id;
      if (findings.has(f.finding_id)) err(fp, "finding ID重複");
      findings.set(f.finding_id, f);
      if (f.question_id && !qids.includes(f.question_id))
        err(fp, "入力問題セット外のfinding");
      evidence(f.evidence_refs, a, fp, f.question_id);
      if (["uncertain", "style_suggestion"].includes(f.kind) && f.countable)
        err(fp, "不確実・スタイル提案は集計対象にできません");
      if (["mistake", "strength"].includes(f.kind) && !f.taxonomy_id)
        err(fp, "確定findingはtaxonomyが必要");
      if (f.kind === "mistake" && !f.severity) err(fp, "ミスには重大度が必要");
      for (const id of [f.taxonomy_id, ...f.secondary_taxonomy_ids].filter(
        (x): x is string => !!x,
      )) {
        const term = terms.get(id);
        if (!term) {
          err(fp, "未知taxonomy " + id);
          continue;
        }
        if (
          ["mistake", "strength"].includes(f.kind) &&
          term.namespace !== f.kind
        )
          err(fp, "finding namespace不一致");
        if (
          term.requires_audio &&
          !f.evidence_refs.some(
            (e) =>
              e.kind === "audio" ||
              (e.kind === "capture" &&
                a.input.live_capture_ids.includes(e.capture_id) &&
                captures.get(e.capture_id)?.kind === "live_observation"),
          )
        )
          err(fp, "音声taxonomyには実音声根拠が必要");
      }
    }
    for (const r of a.rewrites)
      if (!qids.includes(r.question_id)) err(p, "入力外のrewrite課題");
    if (
      new Set(a.recommendations.map((r) => r.priority)).size !==
      a.recommendations.length
    )
      err(p, "重点priorityが重複");
    for (const r of a.recommendations)
      for (const id of r.related_finding_ids)
        if (!a.findings.some((f) => f.finding_id === id))
          err(p, "別評価または不明のfindingを重点が参照");
    const units = {
      duration_ms: "ms",
      response_latency_ms: "ms",
      wpm: "words_per_minute",
      long_pause_count: "count",
    };
    for (const m of a.metrics) {
      const mp = p + "/metrics/" + m.metric_id;
      if (m.unit !== units[m.metric_id]) err(mp, "メトリクス単位不一致");
      if (m.question_id && !qids.includes(m.question_id))
        err(mp, "入力外のmetric課題");
      for (const id of m.source_asset_ids) need(assets, id, mp);
      for (const id of m.source_turn_ids) {
        const t = need(turns, id, mp);
        if (
          t &&
          (t.tr !== a.input.transcript_id ||
            (m.question_id && t.t.question_id !== m.question_id))
        )
          err(mp, "metricのturnが入力/課題と不一致");
      }
      if (m.source_capture_id) need(captures, m.source_capture_id, mp);
      if (m.value === null) {
        if (!m.null_reason) err(mp, "欠測理由が必要");
        continue;
      }
      if (m.null_reason !== null || m.evidence_mode === "none")
        err(mp, "観測値は根拠が必要でnull理由は不可");
      if (
        m.evidence_mode === "archived_audio" &&
        (!m.source_asset_ids.length ||
          m.source_asset_ids.some(
            (id) =>
              assets.get(id)?.kind !== "audio" ||
              !a.input.asset_ids.includes(id),
          ))
      )
        err(mp, "入力音源が必要");
      if (
        m.evidence_mode === "measurement_log" &&
        captures.get(m.source_capture_id || "")?.kind !== "measurement_log"
      )
        err(mp, "計測ログが必要");
      if (m.metric_id === "long_pause_count" && !Number.isInteger(m.value))
        err(mp, "休止回数は整数");
      warn(
        mp,
        "区間・音源hash・検出器/版の全てを専用構造で検証できないため、能力分析から除外します",
      );
    }
  }
  cycles(
    new Map(
      b.assessments.map((a) => [
        a.assessment_id,
        a.supersedes_assessment_id ? [a.supersedes_assessment_id] : [],
      ]),
    ),
    "/assessments",
  );
  for (const n of b.annotations) {
    const maps = {
      assessment: assessments,
      finding: findings,
      transcript: trs,
      turn: turns,
    };
    if (!maps[n.target_type].has(n.target_id))
      err("/annotations/" + n.annotation_id, "対象参照がありません");
    if (
      n.action === "select_default" &&
      (n.target_type !== "assessment" ||
        assessments.get(n.target_id)?.status === "withdrawn")
    )
      err(
        "/annotations/" + n.annotation_id,
        "既定評価は非withdrawnのassessmentを指定",
      );
  }
  if (
    b.session.conditions.assistance_used === "no" &&
    (b.events.some((e) => e.kind === "assistance") ||
      b.assessments.some((a) =>
        a.task_results.some((t) => t.attempt_status === "assisted"),
      ))
  )
    warn("/session/conditions", "援助なし条件と援助記録が矛盾");
  if (
    b.session.mode === "mock_interview" &&
    b.session.conditions.image_available !== "yes"
  )
    warn("/session/conditions", "模擬面接の画像条件が不足");
  if (
    b.session.conditions.recording_status === "none" &&
    b.captures.some((c) => c.kind === "audio_recording")
  )
    warn("/session/conditions", "録音なし条件と音源記録が矛盾");
  if (b.session.parent_session_id === b.session.session_id)
    err("/session", "parent_sessionは自分自身を参照できません");
  for (const [k, v] of Object.entries(b.release))
    if (v !== "1.0.0") err("/release", "未対応のrelease " + k + " " + v);
  return {
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    bundle: errors.length ? undefined : b,
  };
}
