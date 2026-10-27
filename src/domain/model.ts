import type { EikenPre1PracticeSessionExchangeBundleV100 } from "./contract";
export type Bundle = EikenPre1PracticeSessionExchangeBundleV100;
export type Assessment = Bundle["assessments"][number];
export type Transcript = Bundle["transcripts"][number];
export type Turn = Transcript["turns"][number];
export type Finding = Assessment["findings"][number];
export type Evidence = Finding["evidence_refs"][number];
export const collections = {
  assets: "asset_id",
  captures: "capture_id",
  question_sets: "question_set_id",
  transcripts: "transcript_id",
  events: "event_id",
  assessments: "assessment_id",
  annotations: "annotation_id",
} as const;
export type Collection = keyof typeof collections;
/** App-local logical comparison v1. Not a canonical JSON standard or file hash. */
export function fingerprint(x: unknown): string {
  if (Array.isArray(x)) return "[" + x.map(fingerprint).join(",") + "]";
  if (x && typeof x === "object")
    return (
      "{" +
      Object.entries(x)
        .sort(([a], [b]) => a.localeCompare(b, "en"))
        .map(([k, v]) => JSON.stringify(k) + ":" + fingerprint(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(x);
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export const encode = (x: unknown) =>
  new TextEncoder().encode(JSON.stringify(x, null, 2));
export function mergeBundle(incoming: Bundle, existing?: Bundle): Bundle {
  if (!existing) return structuredClone(incoming);
  if (fingerprint(incoming.session) !== fingerprint(existing.session))
    throw new Error(
      "/session: 同じ session_id の条件が衝突しています。既存条件を保持し、Workで訂正方法を確定してください。",
    );
  const out = structuredClone(existing);
  for (const [key, id] of Object.entries(collections) as [
    Collection,
    string,
  ][]) {
    const rows = out[key] as unknown as Record<string, unknown>[];
    for (const r of incoming[key] as unknown as Record<string, unknown>[]) {
      const old = rows.find((x) => x[id] === r[id]);
      if (old && fingerprint(old) !== fingerprint(r))
        throw new Error(`/${key}/${r[id]}: 同じIDの異内容は保存できません`);
      if (!old) rows.push(structuredClone(r));
    }
  }
  return out;
}
export const slots = ["narration", "q1", "q2", "q3", "q4"] as const;
export const textCriteria = [
  "task_response",
  "organization",
  "grammar",
  "vocabulary",
];
export const audioCriteria = ["intelligibility", "fluency"];
