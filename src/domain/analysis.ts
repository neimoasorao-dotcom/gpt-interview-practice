import {
  type Assessment,
  type Bundle,
  type Finding,
  type Transcript,
  textCriteria,
  audioCriteria,
  slots,
  fingerprint,
} from "./model";
import taxonomy from "../../contracts/v1/profiles/taxonomy.json";
export function wordcount(text: string) {
  return (
    text
      .replace(/[’‘]/g, "'")
      .match(/[A-Za-z]+(?:['-][A-Za-z]+)*|[0-9]+(?:[.,][0-9]+)*/g) || []
  ).length;
}
export function answerWords(tr: Transcript, qid?: string) {
  const turns = tr.turns.filter(
    (t) =>
      t.speaker === "learner" &&
      t.turn_kind === "answer" &&
      t.phase !== "post_processing" &&
      (!qid || t.question_id === qid),
  );
  const known =
    tr.coverage === "complete" &&
    turns.length > 0 &&
    turns.every((t) => t.content_status === "captured" && t.text !== null);
  return {
    words: known ? turns.reduce((n, t) => n + wordcount(t.text!), 0) : null,
    observed: turns.reduce(
      (n, t) =>
        n + (t.content_status === "captured" ? wordcount(t.text || "") : 0),
      0,
    ),
    japanese: turns.reduce(
      (n, t) =>
        n +
        (
          t.text?.match(
            /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu,
          ) || []
        ).length,
      0,
    ),
  };
}
export function selectDefault(b: Bundle): Assessment | undefined {
  const allowed = b.assessments.filter((a) => a.status !== "withdrawn");
  const selected = b.annotations
    .filter(
      (n) => n.action === "select_default" && n.target_type === "assessment",
    )
    .at(-1);
  if (selected) {
    const a = allowed.find((a) => a.assessment_id === selected.target_id);
    if (a) return a;
  }
  // If any timestamp is unknown, preserve stable insertion order rather than inventing a date.
  return allowed.every((a) => a.created_at !== null)
    ? allowed
        .slice()
        .sort(
          (a, c) => Date.parse(a.created_at!) - Date.parse(c.created_at!),
        )[0]
    : allowed[0];
}
export function indices(b: Bundle, a?: Assessment) {
  const qs = b.question_sets.find(
    (q) => q.question_set_id === a?.input.question_set_id,
  );
  const tasks = (a?.task_results || []).map((task) => {
    const mean = (ids: string[]) =>
      ids.every(
        (id) =>
          task.criteria.find((c) => c.criterion_id === id)?.status === "scored",
      )
        ? (25 *
            ids.reduce(
              (s, id) =>
                s + task.criteria.find((c) => c.criterion_id === id)!.score!,
              0,
            )) /
          ids.length
        : null;
    const audio = mean(audioCriteria);
    return {
      question_id: task.question_id,
      slot: qs?.questions.find((q) => q.question_id === task.question_id)?.slot,
      text: mean(textCriteria),
      audio,
      audio_mode:
        audio === null
          ? null
          : task.criteria.some(
                (c) =>
                  audioCriteria.includes(c.criterion_id) &&
                  c.evidence_mode === "live_audio",
              )
            ? "provisional"
            : "archived",
    };
  });
  const whole =
    b.session.mode === "mock_interview" && b.session.state === "completed";
  const total = (kind: "text" | "audio") =>
    whole && slots.every((s) => tasks.find((t) => t.slot === s)?.[kind] != null)
      ? slots.reduce(
          (n, s, i) =>
            n +
            tasks.find((t) => t.slot === s)![kind]! * (i === 0 ? 0.4 : 0.15),
          0,
        )
      : null;
  const audio = total("audio");
  return {
    tasks,
    text: total("text"),
    audio,
    audio_mode:
      audio === null
        ? null
        : tasks.some((t) => t.audio_mode === "provisional")
          ? "provisional"
          : "archived",
  };
}
export const display = (x: number | null | undefined) =>
  x == null ? "未取得 / 未評価" : String(Math.round(x));
export function strictSeries(b: Bundle) {
  const s = b.session;
  return (
    s.mode === "mock_interview" &&
    s.state === "completed" &&
    !s.is_synthetic &&
    s.parent_session_id === null &&
    s.conditions.assistance_used === "no" &&
    s.conditions.question_seen_before === "no" &&
    !b.events.some((e) => e.kind === "assistance") &&
    !b.assessments.some((a) =>
      a.task_results.some((t) => t.attempt_status === "assisted"),
    )
  );
}
export function seriesKey(b: Bundle, a: Assessment) {
  return fingerprint({
    versions: a.versions,
    model: {
      provider: a.evaluator.provider,
      id: a.evaluator.model_id,
      reported: a.evaluator.model_reported,
      runtime: a.evaluator.runtime,
      settings: a.evaluator.settings_text,
    },
    mode: b.session.mode,
    assistance: b.session.conditions.assistance_used,
    state: b.session.state,
    synthetic: b.session.is_synthetic,
    attempt: b.session.parent_session_id === null ? "initial" : "retry",
    seen: b.session.conditions.question_seen_before,
    evidence: [
      ...new Set(
        [...a.task_results.flatMap((t) => t.criteria), ...a.session_criteria]
          .filter((c) => c.status === "scored")
          .map((c) => c.evidence_mode),
      ),
    ].sort(),
  });
}
export function tokyoDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "日時不明";
}
export function tokyoWeek(value: string | null) {
  if (!value) return null;
  const d = new Date(new Date(value).getTime() + 9 * 3600000);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
  return d.toISOString().slice(0, 10);
}
export function effectiveReview(b: Bundle, f: Finding) {
  let state = f.review_state;
  for (const n of b.annotations)
    if (n.target_type === "finding" && n.target_id === f.finding_id) {
      if (n.action === "confirm") state = "accepted";
      if (n.action === "dispute") state = "rejected";
    }
  return state;
}
export function countedFindings(
  b: Bundle,
  a: Assessment,
  kind: "mistake" | "strength" = "mistake",
) {
  const groups = new Set<string>();
  return a.findings.filter((f) => {
    if (
      f.kind !== kind ||
      !f.countable ||
      effectiveReview(b, f) === "rejected" ||
      f.resolved_in_turn
    )
      return false;
    if (groups.has(f.occurrence_group_id)) return false;
    groups.add(f.occurrence_group_id);
    return true;
  });
}
const terms = new Map(taxonomy.terms.map((t) => [t.id, t]));
export function categoryStats(
  b: Bundle,
  a: Assessment,
  requestedIds?: string[],
) {
  const tr = b.transcripts.find(
    (t) => t.transcript_id === a.input.transcript_id,
  )!;
  const active = a.findings.filter(
    (f) =>
      f.kind === "mistake" &&
      f.countable &&
      !f.resolved_in_turn &&
      effectiveReview(b, f) !== "rejected",
  );
  const ids = requestedIds || [
    ...new Set(
      active.flatMap((f) => [f.taxonomy_id!, ...f.secondary_taxonomy_ids]),
    ),
  ];
  const criterionFor = (id: string) =>
    ({
      grammar: "grammar",
      vocabulary: "vocabulary",
      content: "task_response",
      organization: "organization",
      pronunciation: "intelligibility",
      fluency: "fluency",
      interaction: "interaction",
    })[id.split(".")[1]];
  return ids.map((id) => {
    const required = criterionFor(id),
      term = terms.get(id);
    const eligible = a.task_results.filter(
      (t) =>
        !["not_asked", "missing_capture"].includes(t.attempt_status) &&
        t.criteria.some(
          (c) =>
            c.criterion_id === required &&
            c.status === "scored" &&
            c.evidence_refs.length > 0 &&
            (term?.requires_audio
              ? ["live_audio", "archived_audio"].includes(c.evidence_mode)
              : c.evidence_mode !== "none"),
        ),
    );
    const eligibleIds = new Set(eligible.map((t) => t.question_id));
    const matched = active.filter(
      (f) => f.taxonomy_id === id || f.secondary_taxonomy_ids.includes(id),
    );
    const relevant = matched.filter(
      (f) => !!f.question_id && eligibleIds.has(f.question_id),
    );
    const count = new Set(matched.map((f) => f.occurrence_group_id)).size;
    const textCount = new Set(
      relevant
        .filter((f) => f.evidence_refs.some((e) => e.kind === "turn"))
        .map((f) => f.occurrence_group_id),
    ).size;
    const answers = new Set(relevant.map((f) => f.question_id)).size;
    const counts = eligible.map((t) => answerWords(tr, t.question_id).words);
    const words = counts.every((c) => c !== null)
      ? counts.reduce<number>((s, c) => s + c!, 0)
      : null;
    return {
      id,
      label: term?.label_ja || id,
      count,
      answers,
      denominator: eligible.length,
      rate: eligible.length ? answers / eligible.length : null,
      words,
      per100:
        !term?.requires_audio && words && counts.length
          ? (textCount / words) * 100
          : null,
      severity: [...new Set(matched.map((f) => f.severity))].join(" / "),
    };
  });
}

export function recurrence(bundles: Bundle[]) {
  const groups = new Map<string, { b: Bundle; a: Assessment }[]>();
  for (const b of bundles) {
    const a = selectDefault(b);
    if (!a) continue;
    const key = seriesKey(b, a);
    groups.set(key, [...(groups.get(key) || []), { b, a }]);
  }
  return [...groups].map(([key, rows]) => {
    const ids = [
      ...new Set(
        rows.flatMap(({ b, a }) =>
          countedFindings(b, a).flatMap((f) => [
            f.taxonomy_id!,
            ...f.secondary_taxonomy_ids,
          ]),
        ),
      ),
    ];
    return {
      key,
      model: rows[0].a.evaluator.model_id,
      mode: rows[0].b.session.mode,
      sessions: rows.length,
      terms: ids.map((id) => {
        const stats = rows.map(({ b, a }) => categoryStats(b, a, [id])[0]);
        const count = stats.reduce((s, x) => s + x.count, 0),
          answers = stats.reduce((s, x) => s + x.answers, 0),
          denominator = stats.reduce((s, x) => s + x.denominator, 0);
        return {
          id,
          label: terms.get(id)?.label_ja || id,
          count,
          answers,
          denominator,
          observedSessions: stats.filter((x) => x.count > 0).length,
          severity: [
            ...new Set(
              stats.flatMap((x) => x.severity.split(" / ")).filter(Boolean),
            ),
          ].join(" / "),
        };
      }),
    };
  });
}
