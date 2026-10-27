import { describe, it, expect } from "vitest";
import { compile } from "json-schema-to-typescript";
import { readFileSync } from "node:fs";
import schema from "../contracts/v1/schemas/session-bundle.schema.json";
import baseJson from "../contracts/v1/examples/text-only-session.json";
import appendJson from "../contracts/v1/examples/append-rescore.json";
import liveJson from "../contracts/v1/examples/live-audio-provisional.json";
import type { Bundle } from "../src/domain/model";
import { validate } from "../src/import/validate";
import {
  wordcount,
  indices,
  answerWords,
  selectDefault,
  seriesKey,
  strictSeries,
  countedFindings,
  effectiveReview,
  categoryStats,
  tokyoWeek,
} from "../src/domain/analysis";
const base = () => structuredClone(baseJson) as unknown as Bundle;
const live = () => structuredClone(liveJson) as unknown as Bundle;
const append = appendJson as unknown as Bundle;
const criterion = (b: Bundle) => b.assessments[0].task_results[0].criteria[0];
const finding = (b: Bundle) => b.assessments[0].findings[0];
const ref = (b: Bundle) => {
  const r = finding(b).evidence_refs[0];
  if (r.kind !== "turn") throw Error();
  return r;
};
describe("固定契約と本番意味検証", () => {
  it("生成型が正本Schemaに一致", async () => {
    expect(
      await compile(schema as Parameters<typeof compile>[0], schema.title),
    ).toBe(readFileSync("src/domain/contract.d.ts", "utf8"));
  });
  it.each([base(), live()])("合成fixtureは有効", (b) =>
    expect(validate(b).errors).toEqual([]),
  );
  it("appendは既存参照が必要", () => {
    expect(validate(append).errors.length).toBeGreaterThan(0);
    expect(validate(append, base()).errors).toEqual([]);
  });
  const bad: [string, (b: Bundle) => void][] = [
    ["未知の追加キー", (b) => Object.assign(b, { overall_cse: 700 })],
    [
      "不正日付",
      (b) => {
        b.session.started_at = "2026-02-30T10:00:00+09:00";
      },
    ],
    [
      "offsetなし",
      (b) => {
        b.session.started_at = "2026-10-27T10:00:00";
      },
    ],
    [
      "5点",
      (b) => {
        criterion(b).score = 5;
      },
    ],
    [
      "得点なしscored",
      (b) => {
        criterion(b).score = null;
      },
    ],
    [
      "欠測0",
      (b) => {
        b.assessments[0].task_results[0].criteria[4].score = 0;
      },
    ],
    [
      "存在しない引用",
      (b) => {
        ref(b).quote = "A sentence never spoken.";
      },
    ],
    [
      "引用位置",
      (b) => {
        ref(b).char_end!++;
      },
    ],
    [
      "位置片側",
      (b) => {
        ref(b).char_start = null;
      },
    ],
    [
      "存在しないturn",
      (b) => {
        ref(b).turn_id = "not-found";
      },
    ],
    [
      "異なるTranscript",
      (b) => {
        ref(b).transcript_id = "not-found";
      },
    ],
    [
      "観点重複",
      (b) => {
        b.assessments[0].task_results[0].criteria[1] = structuredClone(
          criterion(b),
        );
      },
    ],
    [
      "session観点不正",
      (b) => {
        b.assessments[0].session_criteria[0].criterion_id = "grammar";
      },
    ],
    [
      "未知taxonomy",
      (b) => {
        finding(b).taxonomy_id = "invented.taxonomy";
      },
    ],
    [
      "namespace不正",
      (b) => {
        finding(b).taxonomy_id = "strength.content.clear_position";
      },
    ],
    [
      "音声taxonomyに音源なし",
      (b) => {
        finding(b).taxonomy_id = "mistake.pronunciation.word_stress";
      },
    ],
    [
      "根拠なし",
      (b) => {
        criterion(b).evidence_refs = [];
      },
    ],
    [
      "音声の文字採点",
      (b) => {
        b.assessments[0].task_results[0].criteria[4] = {
          ...structuredClone(criterion(b)),
          criterion_id: "intelligibility",
        };
      },
    ],
    [
      "uncertain集計禁止",
      (b) => {
        finding(b).kind = "uncertain";
      },
    ],
    [
      "missing_captureは得点不可",
      (b) => {
        b.assessments[0].task_results[0].attempt_status = "missing_capture";
      },
    ],
    [
      "not_askedは得点不可",
      (b) => {
        b.assessments[0].task_results[0].attempt_status = "not_asked";
      },
    ],
    [
      "無回答は確認event必須",
      (b) => {
        b.assessments[0].task_results[0].attempt_status =
          "no_response_observed";
      },
    ],
    [
      "未対応profile",
      (b) => {
        b.assessments[0].versions.rubric = "99.0.0";
      },
    ],
    [
      "turn順",
      (b) => {
        b.transcripts[0].turns[1].sequence = 1;
      },
    ],
    [
      "Transcript循環",
      (b) => {
        b.transcripts[0].parent_transcript_id = b.transcripts[0].transcript_id;
      },
    ],
    [
      "turn循環",
      (b) => {
        b.transcripts[0].turns[0].previous_turn_ids = [
          b.transcripts[0].turns[0].turn_id,
        ];
      },
    ],
    [
      "slot重複",
      (b) => {
        b.question_sets[0].questions[1]!.slot = "narration";
      },
    ],
    [
      "capture重複",
      (b) => {
        b.captures.push(structuredClone(b.captures[0]));
      },
    ],
    [
      "5語未満の文法採点",
      (b) => {
        b.transcripts[0].turns[3].text = "Hi.";
      },
    ],
    [
      "event参照不在",
      (b) => {
        b.events.push({
          event_id: "bad-event",
          kind: "other",
          phase: "q1",
          turn_id: null,
          source_capture_id: "not-found",
          evidence_basis: "captured",
          offset_ms: null,
          detail: "synthetic",
        });
      },
    ],
    [
      "metric根拠なし",
      (b) => {
        b.assessments[0].metrics[0].value = 1000;
        b.assessments[0].metrics[0].null_reason = null;
      },
    ],
  ];
  it.each(bad)("%sを拒否", (_, mutate) => {
    const b = base();
    mutate(b);
    expect(validate(b).errors.length).toBeGreaterThan(0);
  });
  it("Unicode位置はUTF-16ではなくコードポイント", () => {
    const b = base();
    const t = b.transcripts[0].turns[3];
    t.text = "😀 Some students leaves their bags.";
    const a = b.assessments[0];
    const ev = {
      kind: "turn" as const,
      transcript_id: b.transcripts[0].transcript_id,
      turn_id: t.turn_id,
      quote: "Some students leaves",
      char_start: 2,
      char_end: 22,
    };
    for (const c of a.task_results[0].criteria.slice(0, 4))
      c.evidence_refs = [ev];
    finding(b).evidence_refs = [ev];
    expect(validate(b).errors).toEqual([]);
    ev.char_start = 3;
    expect(validate(b).errors.length).toBeGreaterThan(0);
  });
  it("live highと入力外観察を拒否", () => {
    const b = live();
    b.assessments[0].task_results[0].criteria[4].confidence = "high";
    expect(validate(b).errors.length).toBeGreaterThan(0);
    const c = live();
    c.assessments[0].input.live_capture_ids = [];
    expect(validate(c).errors.length).toBeGreaterThan(0);
  });
  it("音声の逆区間・種別・長さを検証", () => {
    const b = base();
    b.assets.push({
      asset_id: "audio-test",
      kind: "audio",
      filename: "synthetic.wav",
      availability: "missing",
      path: null,
      sha256: null,
      mime_type: "audio/wav",
      duration_ms: 1000,
      sample_rate_hz: null,
      channels: null,
      speaker_coverage: "both",
      capture_tool: null,
      rights: "synthetic",
      notes: null,
    });
    b.transcripts[0].turns[0].audio_segment = {
      asset_id: "audio-test",
      start_ms: 900,
      end_ms: 800,
    };
    expect(validate(b).errors.length).toBeGreaterThan(0);
    b.transcripts[0].turns[0].audio_segment.end_ms = 1100;
    expect(validate(b).errors.length).toBeGreaterThan(0);
    b.assets[0].duration_ms = null;
    b.transcripts[0].turns[0].audio_segment.start_ms = 0;
    expect(validate(b).warnings.join()).toContain("上限");
  });
  it("再評価日時は旧評価より前不可", () => {
    const b = base();
    b.assessments[0].created_at = "2026-10-27T20:00:00+09:00";
    const c = structuredClone(append);
    c.assessments[0].created_at = "2026-10-27T19:00:00+09:00";
    expect(validate(c, b).errors.join()).toContain("旧評価より前");
  });
});
describe("指数・欠測・集計契約", () => {
  it("wordcount-en-v1", () => {
    expect(wordcount("I'd use a part-time job in 2026.")).toBe(7);
    expect(wordcount("日本語 I’d go, um, at 8.30.")).toBe(5);
  });
  it("control・面接官・post_processingは数えない", () => {
    const b = base(),
      tr = b.transcripts[0];
    const count = answerWords(tr).words;
    tr.turns.push({
      ...tr.turns[3],
      turn_id: "control",
      turn_kind: "control",
      text: "More words here",
    });
    expect(answerWords(tr).words).toBe(count);
    tr.turns.push({
      ...tr.turns[3],
      turn_id: "post",
      phase: "post_processing",
      text: "More words here",
    });
    expect(answerWords(tr).words).toBe(count);
    tr.coverage = "partial";
    expect(answerWords(tr).words).toBeNull();
  });
  it("部分練習は課題指数のみ、音声なしはnull", () => {
    const b = base(),
      out = indices(b, b.assessments[0]);
    expect(out.text).toBeNull();
    expect(out.tasks[0].text).toBe(75);
    expect(out.audio).toBeNull();
    expect(out.tasks[0].audio).toBeNull();
  });
  it("模擬の重みと欠測・ゼロ", () => {
    const b = base();
    b.session.mode = "mock_interview";
    const a = b.assessments[0];
    for (const c of a.task_results[0].criteria.slice(0, 4)) c.score = 2;
    expect(indices(b, a).text).toBe(65);
    for (const c of a.task_results[0].criteria.slice(0, 4)) c.score = 0;
    expect(indices(b, a).text).toBe(45);
    criterion(b).status = "not_assessable";
    criterion(b).score = null;
    expect(indices(b, a).text).toBeNull();
    b.session.mode = "retry";
    expect(indices(b, a).text).toBeNull();
  });
  it("liveはprovisional・混在もprovisional", () => {
    const b = live();
    b.session.mode = "mock_interview";
    const a = b.assessments[0];
    expect(indices(b, a).audio_mode).toBe("provisional");
    for (const c of a.task_results[0].criteria.slice(4))
      c.evidence_mode = "archived_audio";
    expect(indices(b, a).audio_mode).toBe("provisional");
  });
  it("既定選択は初回、withdrawn除外、annotation優先", () => {
    const b = validate(append, base()).bundle!;
    expect(selectDefault(b)?.assessment_id).toBe("demo-assessment-v1");
    b.annotations.push({
      annotation_id: "select-default",
      created_at: null,
      target_type: "assessment",
      target_id: "demo-assessment-v2",
      action: "select_default",
      comment: "選択",
    });
    expect(selectDefault(b)?.assessment_id).toBe("demo-assessment-v2");
    b.assessments[1].status = "withdrawn";
    expect(selectDefault(b)?.assessment_id).toBe("demo-assessment-v1");
  });
  it("新版Transcriptでも旧評価参照は不変", () => {
    const b = base();
    const old = b.assessments[0].input.transcript_id;
    const t = structuredClone(b.transcripts[0]);
    t.parent_transcript_id = t.transcript_id;
    t.transcript_id = "transcript-v2";
    t.turns.forEach((x) => {
      x.previous_turn_ids = [x.turn_id];
      x.turn_id += "-v2";
    });
    t.turns[3].text += " Unchanged original retained.";
    b.transcripts.push(t);
    expect(validate(b).errors).toEqual([]);
    expect(b.assessments[0].input.transcript_id).toBe(old);
  });
  it("rubric/model/taxonomy/evidence差は別系列", () => {
    const b = base(),
      a = b.assessments[0];
    const key = seriesKey(b, a);
    for (const field of [
      "rubric",
      "taxonomy",
      "metrics",
      "evaluator_prompt",
    ] as const) {
      const c = structuredClone(a);
      c.versions[field] = "2.0.0";
      expect(seriesKey(b, c)).not.toBe(key);
    }
    const c = structuredClone(a);
    c.evaluator.model_id = "another-model";
    expect(seriesKey(b, c)).not.toBe(key);
    expect(seriesKey(live(), live().assessments[0])).not.toBe(key);
  });
  it("厳密系列はunknown/援助/部分/合成/親ありを除外", () => {
    const b = base();
    b.session.mode = "mock_interview";
    b.session.is_synthetic = false;
    b.session.conditions.question_seen_before = "no";
    expect(strictSeries(b)).toBe(true);
    for (const patch of [
      { mode: "retry" },
      { state: "partial" },
      { is_synthetic: true },
      { parent_session_id: "parent" },
    ]) {
      const c = structuredClone(b);
      Object.assign(c.session, patch);
      expect(strictSeries(c)).toBe(false);
    }
    b.session.conditions.assistance_used = "unknown";
    expect(strictSeries(b)).toBe(false);
  });
  it("ミスはgroupで重複排除し本人判断は追記順", () => {
    const b = base(),
      a = b.assessments[0],
      f = finding(b);
    a.findings.push({ ...structuredClone(f), finding_id: "same-occurrence" });
    expect(countedFindings(b, a).length).toBe(1);
    for (const kind of ["uncertain", "style_suggestion"] as const) {
      f.kind = kind;
      expect(countedFindings(b, a).map((f) => f.finding_id)).not.toContain(
        f.finding_id,
      );
    }
    f.kind = "mistake";
    f.resolved_in_turn = true;
    expect(countedFindings(b, a).map((f) => f.finding_id)).not.toContain(
      f.finding_id,
    );
    f.resolved_in_turn = false;
    b.annotations.push({
      annotation_id: "dispute",
      created_at: null,
      target_type: "finding",
      target_id: f.finding_id,
      action: "dispute",
      comment: "ASR疑い",
    });
    expect(effectiveReview(b, f)).toBe("rejected");
    b.annotations.push({
      ...b.annotations.at(-1)!,
      annotation_id: "confirm",
      action: "confirm",
    });
    expect(effectiveReview(b, f)).toBe("accepted");
    expect(f.review_state).toBe("unreviewed");
  });
  it("分類率は評価済み同範囲の語数を使う", () => {
    const b = base(),
      a = b.assessments[0];
    const s = categoryStats(b, a).find((s) => s.id === finding(b).taxonomy_id)!;
    expect(s.denominator).toBe(5);
    expect(s.answers).toBe(1);
    expect(s.per100).toBeGreaterThan(0);
    b.transcripts[0].coverage = "partial";
    expect(categoryStats(b, a)[0].per100).toBeNull();
  });
  it("週は東京・月曜開始、未知日時は補完しない", () => {
    expect(tokyoWeek("2026-10-25T15:30:00Z")).toBe("2026-10-26");
    expect(tokyoWeek(null)).toBeNull();
  });
});

describe("配布物の完全性", () => {
  it("manifest記載の全ファイルのSHA-256とsizeが一致", async () => {
    const { createHash } = await import("node:crypto");
    const manifest = JSON.parse(
      readFileSync("contracts/v1/release-manifest.json", "utf8"),
    );
    for (const f of manifest.files) {
      const bytes = readFileSync("contracts/v1/" + f.path);
      expect(bytes.length).toBe(f.size_bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(f.sha256);
    }
  });
});

describe("確認済みの無回答と時間", () => {
  it("確認済み無回答は内容0のみ、欠測と区別する", () => {
    const b = base(),
      a = b.assessments[0],
      task = a.task_results[0],
      turn = b.transcripts[0].turns[3];
    b.captures[0].content_text = b.captures[0].content_text!.replace(
      turn.text!,
      "[confirmed silence]",
    );
    turn.text = null;
    turn.content_status = "confirmed_silence";
    task.attempt_status = "no_response_observed";
    b.events.push({
      event_id: "silence-event",
      kind: "no_response_observed",
      phase: "narration",
      turn_id: turn.turn_id,
      source_capture_id: "demo-log",
      evidence_basis: "captured",
      offset_ms: null,
      detail: "Synthetic confirmed silence",
    });
    Object.assign(task.criteria[0], {
      score: 0,
      evidence_mode: "event",
      evidence_refs: [{ kind: "event", event_id: "silence-event" }],
    });
    for (const c of task.criteria.slice(1))
      Object.assign(c, {
        status: "not_assessable",
        score: null,
        evidence_mode: "none",
        evidence_refs: [],
        reason_code: "insufficient_sample",
        reason: "Confirmed silence",
      });
    a.findings = a.findings.filter((f) => f.question_id !== task.question_id);
    a.recommendations = [];
    expect(validate(b).errors).toEqual([]);
    expect(indices(b, a).tasks[0].text).toBeNull();
  });
  it("評価日時が練習開始より前なら拒否", () => {
    const b = base();
    b.assessments[0].created_at = "2026-10-26T00:00:00+09:00";
    expect(validate(b).errors.join()).toContain("練習開始より前");
  });
});
