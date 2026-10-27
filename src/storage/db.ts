import { openDB, type IDBPDatabase } from "idb";
import manifest from "../../contracts/v1/release-manifest.json";
import rubric from "../../contracts/v1/profiles/rubric.json";
import taxonomy from "../../contracts/v1/profiles/taxonomy.json";
import metrics from "../../contracts/v1/profiles/metrics.json";
import protocol from "../../contracts/v1/profiles/protocol.json";
import {
  type Bundle,
  type Collection,
  collections,
  fingerprint,
  sha256,
  encode,
} from "../domain/model";
import { validate, VALIDATOR_VERSION } from "../import/validate";
export interface ImportLog {
  key: string;
  session_id: string;
  export_id: string;
  hash: string;
  filename: string;
  imported_at: string;
  validator_version: string;
  warnings: string[];
  bytes: Uint8Array;
}
export interface Media {
  key: string;
  session_id: string;
  asset_id: string;
  hash: string;
  filename: string;
  bytes: Uint8Array;
  mime: string;
}
export const stores = [
  "sessions",
  ...Object.keys(collections),
  "imports",
  "releases",
  "derived_cache",
  "media",
] as const;
export const releaseFiles = { manifest, rubric, taxonomy, metrics, protocol };
export function openDatabase(name = "eiken-records-v1") {
  return openDB(name, 1, {
    upgrade(db) {
      for (const name of stores) db.createObjectStore(name, { keyPath: "key" });
    },
  });
}
export function recordsFor(
  rows: { session_id: string; order?: number; value: unknown }[],
  sid: string,
) {
  return rows
    .filter((r) => r.session_id === sid)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((r) => r.value);
}
export async function loadBundles(db: IDBPDatabase): Promise<Bundle[]> {
  const tx = db.transaction(
    ["sessions", ...Object.keys(collections)],
    "readonly",
  );
  const sessions = await tx.objectStore("sessions").getAll();
  const all = Object.fromEntries(
    await Promise.all(
      Object.keys(collections).map(async (k) => [
        k,
        await tx.objectStore(k).getAll(),
      ]),
    ),
  );
  return sessions.map((r) => {
    const b = { ...r.envelope } as Bundle;
    for (const k of Object.keys(collections) as Collection[])
      Object.assign(b, {
        [k]: recordsFor(all[k], r.key),
      });
    return b;
  });
}
export interface Preview {
  file: File;
  bytes: Uint8Array;
  hash: string;
  input?: Bundle;
  merged?: Bundle;
  errors: string[];
  warnings: string[];
  changes: { collection: string; added: number; reused: number }[];
  duplicates: string[];
  noOp: boolean;
}
export async function prepare(
  file: File,
  existing: Bundle[],
  originals: ImportLog[] = [],
): Promise<Preview> {
  if (file.size > 10 * 1024 * 1024)
    return {
      file,
      bytes: new Uint8Array(),
      hash: "",
      errors: [
        "JSONは10MiBまでです。切り捨てず原資料とappendに分割してください。",
      ],
      warnings: [],
      changes: [],
      duplicates: [],
      noOp: false,
    };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = await sha256(bytes);
  const p: Preview = {
    file,
    bytes,
    hash,
    errors: [],
    warnings: [],
    changes: [],
    duplicates: [],
    noOp: false,
  };
  if (bytes.length > 10 * 1024 * 1024) {
    p.errors.push(
      "JSONは10MiBまでです。切り捨てず原資料とappendに分割してください。",
    );
    return p;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    p.errors.push(
      "JSON構文またはUTF-8が不正です。元ファイルを修正せず、新しいファイルを受け取ってください。",
    );
    return p;
  }
  const sid = (raw as Bundle)?.session?.session_id;
  const previous = existing.find((b) => b.session.session_id === sid);
  const v = validate(raw, previous);
  p.errors = v.errors;
  p.warnings = v.warnings;
  if (!v.bundle) return p;
  const input = raw as Bundle;
  if (
    originals.some(
      (l) =>
        l.export_id === input.export_id &&
        fingerprint(JSON.parse(new TextDecoder().decode(l.bytes))) !==
          fingerprint(input),
    )
  )
    p.errors.push("/export_id: 同じexport_idの異内容は保存できません");
  p.input = input;
  p.merged = v.bundle;
  if (
    input.session.parent_session_id &&
    !existing.some(
      (b) => b.session.session_id === input.session.parent_session_id,
    )
  )
    p.warnings.push(
      "/session/parent_session_id: 親面接は端末内にありません。関係を検証できません",
    );
  const graph = new Map(
    [...existing.filter((b) => b.session.session_id !== sid), v.bundle].map(
      (b) => [b.session.session_id, b.session.parent_session_id],
    ),
  );
  let parent = graph.get(sid);
  const chain = new Set<string>([sid]);
  while (parent) {
    if (chain.has(parent)) {
      p.errors.push("/session/parent_session_id: 面接の循環参照");
      break;
    }
    chain.add(parent);
    parent = graph.get(parent);
  }
  for (const asset of input.assets)
    p.warnings.push(
      "/assets/" +
        asset.asset_id +
        ": JSONだけでは素材bytesを検証できません。添付時にhashを照合します",
    );
  for (const other of existing) {
    for (const q of input.question_sets) {
      const old = other.question_sets.find(
        (o) => o.question_set_id === q.question_set_id,
      );
      if (old && fingerprint(old) !== fingerprint(q))
        p.errors.push(
          "/question_sets: 共有ID/版の内容が衝突 " + q.question_set_id,
        );
    }
    if (
      other.session.session_id !== sid &&
      fingerprint(other.captures.map((c) => c.content_text)) ===
        fingerprint(v.bundle.captures.map((c) => c.content_text))
    )
      p.duplicates.push(other.session.session_id);
  }
  p.changes = Object.entries(collections).map(([k, id]) => {
    const key = k as Collection;
    const old = previous?.[key] as unknown as
      Record<string, unknown>[] | undefined;
    const rows = input[key] as unknown as Record<string, unknown>[];
    const reused = rows.filter((r) => old?.some((o) => o[id] === r[id])).length;
    return { collection: k, added: rows.length - reused, reused };
  });
  p.noOp = !!previous && p.changes.every((c) => c.added === 0);
  return p;
}
function envelope(b: Bundle) {
  const out = structuredClone(b);
  for (const k of Object.keys(collections)) Reflect.deleteProperty(out, k);
  return out;
}
export async function commit(db: IDBPDatabase, p: Preview) {
  if (!p.input || p.errors.length)
    throw new Error("検証エラーがあるため保存できません");
  // The write transaction serializes concurrent tabs; revalidate against its current snapshot.
  const tx = db.transaction([...stores], "readwrite");
  try {
    const saved = await tx.objectStore("sessions").getAll();
    const all = Object.fromEntries(
      await Promise.all(
        Object.keys(collections).map(async (k) => [
          k,
          await tx.objectStore(k).getAll(),
        ]),
      ),
    );
    const context: Bundle[] = saved.map((r) => {
      const b = { ...r.envelope } as Bundle;
      for (const k of Object.keys(collections))
        Object.assign(b, {
          [k]: recordsFor(all[k], r.key),
        });
      return b;
    });
    const current = context.find(
      (b) => b.session.session_id === p.input!.session.session_id,
    );
    const v = validate(p.input, current);
    if (v.errors.length) throw new Error(v.errors.join("\n"));
    const b = v.bundle!,
      sid = b.session.session_id;
    const parentGraph = new Map(
      [...context.filter((x) => x.session.session_id !== sid), b].map((x) => [
        x.session.session_id,
        x.session.parent_session_id,
      ]),
    );
    let parent = parentGraph.get(sid);
    const seenParents = new Set<string>([sid]);
    while (parent) {
      if (seenParents.has(parent)) throw new Error("親面接の循環参照");
      seenParents.add(parent);
      parent = parentGraph.get(parent);
    }
    for (const other of context)
      for (const q of b.question_sets) {
        const old = other.question_sets.find(
          (o) => o.question_set_id === q.question_set_id,
        );
        if (old && fingerprint(old) !== fingerprint(q))
          throw new Error("共有問題ID衝突");
      }
    const logs: ImportLog[] = await tx.objectStore("imports").getAll();
    if (
      logs.some(
        (l) =>
          l.export_id === p.input!.export_id &&
          fingerprint(JSON.parse(new TextDecoder().decode(l.bytes))) !==
            fingerprint(p.input),
      )
    )
      throw new Error("export_idの異内容衝突");
    await tx.objectStore("sessions").put({ key: sid, envelope: envelope(b) });
    for (const [key, id] of Object.entries(collections))
      for (const [order, r] of (
        b[key as Collection] as unknown as Record<string, unknown>[]
      ).entries())
        await tx.objectStore(key).put({
          key: JSON.stringify([sid, r[id]]),
          session_id: sid,
          order,
          value: r,
        });
    const log: ImportLog = {
      key: p.input.export_id + ":" + p.hash,
      session_id: sid,
      export_id: p.input.export_id,
      hash: p.hash,
      filename: p.file.name,
      imported_at: new Date().toISOString(),
      validator_version: VALIDATOR_VERSION,
      warnings: [...new Set([...p.warnings, ...v.warnings])],
      bytes: p.bytes,
    };
    if (!(await tx.objectStore("imports").get(log.key)))
      await tx.objectStore("imports").add(log);
    const savedRelease = await tx.objectStore("releases").get("1.0.0");
    if (
      savedRelease &&
      fingerprint(savedRelease.files) !== fingerprint(releaseFiles)
    )
      throw new Error("同じrelease ID/版の内容が衝突しています");
    if (!savedRelease)
      await tx
        .objectStore("releases")
        .add({ key: "1.0.0", files: releaseFiles });
    await tx.done;
  } catch (e) {
    try {
      tx.abort();
    } catch {
      /* already aborted */
    }
    await tx.done.catch(() => {});
    throw e;
  }
}
export function selfContained(b: Bundle): Bundle {
  return {
    ...structuredClone(b),
    export_id: "web-" + crypto.randomUUID(),
    created_at: new Date().toISOString(),
    bundle_mode: "self_contained",
  };
}
export async function annotate(
  db: IDBPDatabase,
  b: Bundle,
  n: Bundle["annotations"][number],
) {
  const input: Bundle = {
    ...b,
    export_id: "annotation-" + crypto.randomUUID(),
    created_at: new Date().toISOString(),
    bundle_mode: "append",
    assets: [],
    captures: [],
    question_sets: [],
    transcripts: [],
    events: [],
    assessments: [],
    annotations: [n],
  };
  const p = await prepare(
    new File([encode(input)], "annotation.json"),
    await loadBundles(db),
  );
  await commit(db, p);
}
export async function attachMedia(
  db: IDBPDatabase,
  b: Bundle,
  assetId: string,
  file: File,
) {
  const asset = b.assets.find((a) => a.asset_id === assetId);
  if (!asset) throw new Error("素材IDが存在しません");
  if (file.size > 100 * 1024 * 1024)
    throw new Error("素材は個別100MiBまでです");
  const bytes = new Uint8Array(await file.arrayBuffer()),
    hash = await sha256(bytes);
  if (asset.sha256 !== null && asset.sha256 !== hash)
    throw new Error("素材のSHA-256が一致しません");
  const key = JSON.stringify([b.session.session_id, assetId]);
  const tx = db.transaction("media", "readwrite"),
    old: Media | undefined = await tx.store.get(key);
  if (old && old.hash !== hash) {
    tx.abort();
    await tx.done.catch(() => {});
    throw new Error("同じ素材IDに異なるbytesは保存できません");
  }
  await tx.store.put({
    key,
    session_id: b.session.session_id,
    asset_id: assetId,
    hash,
    bytes,
    filename: file.name,
    mime: file.type,
  } satisfies Media);
  await tx.done;
}
export async function deleteSession(db: IDBPDatabase, sid: string) {
  const tx = db.transaction([...stores], "readwrite");
  await tx.objectStore("sessions").delete(sid);
  for (const name of [
    ...Object.keys(collections),
    "imports",
    "media",
    "derived_cache",
  ])
    for (const row of await tx.objectStore(name).getAll())
      if (row.session_id === sid) await tx.objectStore(name).delete(row.key);
  await tx.done;
}
