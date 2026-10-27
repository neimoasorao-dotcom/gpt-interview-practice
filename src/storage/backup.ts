import evaluatorPrompt from "../../contracts/v1/prompts/post-interview.md?raw";
import { zipSync, unzipSync } from "fflate";
import { deleteDB, type IDBPDatabase } from "idb";
import { type Bundle, encode, sha256, fingerprint } from "../domain/model";
import {
  commit,
  loadBundles,
  openDatabase,
  prepare,
  selfContained,
  stores,
  type ImportLog,
  type Media,
  releaseFiles,
  recordsFor,
} from "./db";
const MAX = 256 * 1024 * 1024;
interface Entry {
  path: string;
  sha256: string;
  size: number;
  kind: "bundle" | "original" | "media";
  metadata?: Omit<ImportLog, "bytes"> | Omit<Media, "bytes">;
}
interface Manifest {
  format: "eiken-local-backup";
  version: 1;
  created_at: string;
  includes_media: boolean;
  entries: Entry[];
}
export async function makeBackup(db: IDBPDatabase, includeMedia: boolean) {
  const files: Record<string, Uint8Array> = {},
    entries: Entry[] = [];
  const add = async (
    path: string,
    bytes: Uint8Array,
    kind: Entry["kind"],
    metadata?: Entry["metadata"],
  ) => {
    files[path] = bytes;
    entries.push({
      path,
      sha256: await sha256(bytes),
      size: bytes.length,
      kind,
      metadata,
    });
  };
  const tx = db.transaction([...stores], "readonly");
  const rows = Object.fromEntries(
    await Promise.all(
      stores.map(async (s) => [s, await tx.objectStore(s).getAll()]),
    ),
  );
  await tx.done;
  // Use a consistent DB snapshot for every bundle and original.
  for (const [i, r] of rows.sessions.entries()) {
    const b = { ...r.envelope } as Bundle;
    for (const k of [
      "assets",
      "captures",
      "question_sets",
      "transcripts",
      "events",
      "assessments",
      "annotations",
    ] as const)
      Object.assign(b, {
        [k]: recordsFor(rows[k], r.key),
      });
    const serialized = encode(selfContained(b));
    if (serialized.length > 10 * 1024 * 1024)
      throw new Error(
        "面接 " +
          b.session.session_id +
          " の自己完結JSONが10MiBを超えます。データを削除せず、取込履歴から各原JSONをそのまま書出し、素材を別に保管してください。大規模bundleの分割復元は次版の対象です",
      );
    await add(`bundles/${i}.json`, serialized, "bundle");
  }
  for (const [i, r] of (rows.imports as ImportLog[]).entries()) {
    const { bytes, ...meta } = r;
    await add(`originals/${i}.json`, bytes, "original", meta);
  }
  if (includeMedia)
    for (const [i, r] of (rows.media as Media[]).entries()) {
      const { bytes, ...meta } = r;
      await add(`media/${i}.bin`, bytes, "media", meta);
    }
  const manifest: Manifest = {
    format: "eiken-local-backup",
    version: 1,
    created_at: new Date().toISOString(),
    includes_media: includeMedia,
    entries,
  };
  files["manifest.json"] = encode(manifest);
  if (Object.values(files).reduce((n, b) => n + b.length, 0) > MAX)
    throw new Error(
      "バックアップ展開後上限256MiBを超えます。端末の元ファイルも別に保管してください",
    );
  return zipSync(files, { level: 0 });
}
function safeZip(bytes: Uint8Array) {
  if (bytes.length > MAX) throw new Error("ZIPは256MiBまでです");
  // Inspect the central directory before decompression (including duplicate names and ZIP64).
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error("ZIP終端が不正");
  const count = view.getUint16(eocd + 10, true),
    offset = view.getUint32(eocd + 16, true);
  if (count === 65535 || offset === 0xffffffff || count > 10000)
    throw new Error("ZIP64または過大なZIPは未対応");
  let pos = offset,
    total = 0;
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (pos + 46 > bytes.length || view.getUint32(pos, true) !== 0x02014b50)
      throw new Error("ZIPディレクトリが不正");
    const size = view.getUint32(pos + 24, true),
      len = view.getUint16(pos + 28, true);
    const name = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(pos + 46, pos + 46 + len),
    );
    if (
      !/^(manifest\.json|(?:bundles|originals)\/\d+\.json|media\/\d+\.bin)$/.test(
        name,
      ) ||
      names.has(name)
    )
      throw new Error("不正または重複ZIP path: " + name);
    names.add(name);
    total += size;
    if (total > MAX) throw new Error("ZIP展開後の合計は256MiBまで");
    pos +=
      46 +
      len +
      view.getUint16(pos + 30, true) +
      view.getUint16(pos + 32, true);
  }
  const out = unzipSync(bytes, {
    filter: (f) => {
      if (f.originalSize > MAX) throw new Error("ZIPの展開上限");
      return true;
    },
  });
  if (Object.keys(out).length !== count)
    throw new Error("ZIP path件数が不一致");
  return out;
}
export interface RestorePlan {
  bundles: Bundle[];
  logs: ImportLog[];
  media: Media[];
  includesMedia: boolean;
  warnings: string[];
}
export async function inspectBackup(bytes: Uint8Array): Promise<RestorePlan> {
  const files = safeZip(bytes);
  if (!files["manifest.json"]) throw new Error("manifestがありません");
  const m = JSON.parse(
    new TextDecoder().decode(files["manifest.json"]),
  ) as Manifest;
  if (
    m.format !== "eiken-local-backup" ||
    m.version !== 1 ||
    !Array.isArray(m.entries) ||
    typeof m.includes_media !== "boolean"
  )
    throw new Error("未対応のバックアップ版");
  const bundles: Bundle[] = [],
    logs: ImportLog[] = [],
    media: Media[] = [],
    seen = new Set<string>(),
    warnings: string[] = [];
  for (const e of m.entries) {
    if (seen.has(e.path) || e.path === "manifest.json" || !files[e.path])
      throw new Error("manifestのpath重複または欠落");
    seen.add(e.path);
    const bytes = files[e.path];
    if (bytes.length !== e.size || (await sha256(bytes)) !== e.sha256)
      throw new Error("バックアップhash/size不一致 " + e.path);
    if (e.kind === "bundle") {
      if (!e.path.startsWith("bundles/")) throw new Error("bundle path不一致");
      const p = await prepare(
        new File([new Uint8Array(bytes)], e.path),
        bundles,
      );
      if (p.errors.length) throw new Error(p.errors.join("\n"));
      if (
        bundles.some(
          (b) => b.session.session_id === p.merged!.session.session_id,
        )
      )
        throw new Error("バックアップ面接重複");
      bundles.push(p.merged!);
      warnings.push(...p.warnings);
    } else if (e.kind === "original") {
      const meta = e.metadata as Omit<ImportLog, "bytes">;
      if (
        !e.path.startsWith("originals/") ||
        meta?.hash !== e.sha256 ||
        typeof meta.filename !== "string" ||
        typeof meta.imported_at !== "string" ||
        !Array.isArray(meta.warnings)
      )
        throw new Error("原ファイルmetadata不正");
      logs.push({ ...meta, bytes });
    } else if (e.kind === "media") {
      const meta = e.metadata as Omit<Media, "bytes">;
      if (
        !e.path.startsWith("media/") ||
        meta?.hash !== e.sha256 ||
        !m.includes_media ||
        typeof meta.mime !== "string"
      )
        throw new Error("素材metadata不正");
      media.push({ ...meta, bytes });
    } else throw new Error("不明backup要素");
  }
  if (seen.size + 1 !== Object.keys(files).length)
    throw new Error("manifestにないZIP要素");
  for (const l of logs) {
    const p = await prepare(
      new File([new Uint8Array(l.bytes)], l.filename),
      bundles,
    );
    if (
      p.errors.length ||
      p.input?.session.session_id !== l.session_id ||
      p.input?.export_id !== l.export_id ||
      l.key !== l.export_id + ":" + l.hash
    )
      throw new Error("原取込ログの参照/内容不一致");
    // Every raw record must be represented in the restored self-contained data.
    if (
      fingerprint(p.merged) !==
      fingerprint(bundles.find((b) => b.session.session_id === l.session_id))
    )
      throw new Error("原取込ログと復元データが不一致");
  }
  for (const r of media) {
    const asset = bundles
      .find((b) => b.session.session_id === r.session_id)
      ?.assets.find((a) => a.asset_id === r.asset_id);
    if (
      !asset ||
      r.key !== JSON.stringify([r.session_id, r.asset_id]) ||
      (asset.sha256 && asset.sha256 !== r.hash)
    )
      throw new Error("復元素材の参照/hash不一致");
  }
  if (!m.includes_media)
    warnings.push("素材を含まないバックアップです。音源・画像は別途必要です");
  return { bundles, logs, media, includesMedia: m.includes_media, warnings };
}
export async function restore(db: IDBPDatabase, plan: RestorePlan) {
  const stageName = "eiken-restore-" + crypto.randomUUID();
  const stage = await openDatabase(stageName);
  try {
    const source = db.transaction([...stores], "readonly");
    const baseline = Object.fromEntries(
      await Promise.all(
        stores.map(async (s) => [s, await source.objectStore(s).getAll()]),
      ),
    );
    await source.done;
    const init = stage.transaction([...stores], "readwrite");
    for (const s of stores)
      for (const row of baseline[s]) await init.objectStore(s).put(row);
    await init.done;
    for (const b of plan.bundles) {
      const p = await prepare(
        new File([encode(b)], "restored-bundle.json"),
        await loadBundles(stage),
      );
      await commit(stage, p);
    }
    const extras = stage.transaction(["imports", "media"], "readwrite");
    for (const log of plan.logs)
      if (!(await extras.objectStore("imports").get(log.key)))
        await extras.objectStore("imports").add(log);
    for (const r of plan.media) {
      const old = await extras.objectStore("media").get(r.key);
      if (old && old.hash !== r.hash) throw new Error("復元素材が既存IDと衝突");
      await extras.objectStore("media").put(r);
    }
    await extras.done;
    const all = Object.fromEntries(
      await Promise.all(stores.map(async (s) => [s, await stage.getAll(s)])),
    );
    const tx = db.transaction([...stores], "readwrite");
    try {
      for (const s of stores) {
        if (
          fingerprint(await tx.objectStore(s).getAll()) !==
          fingerprint(baseline[s])
        )
          throw new Error(
            "別タブでデータが更新されました。復元プレビューをやり直してください",
          );
        for (const row of all[s]) await tx.objectStore(s).put(row);
      }
      await tx.done;
    } catch (e) {
      try {
        tx.abort();
      } catch {}
      await tx.done.catch(() => {});
      throw e;
    }
  } finally {
    stage.close();
    await deleteDB(stageName);
  }
}
export function rescoreInput(
  b: Bundle,
  transcriptId: string,
  questionSetId: string,
) {
  const tr = b.transcripts.find((t) => t.transcript_id === transcriptId),
    qs = b.question_sets.find((q) => q.question_set_id === questionSetId);
  if (!tr || !qs) throw new Error("入力版を選んでください");
  const safeIds = new Set(
    b.captures.filter((c) => c.scope === "interview").map((c) => c.capture_id),
  );
  const safeAssets = new Set(
    b.captures
      .filter((c) => c.scope === "interview" && c.asset_id)
      .map((c) => c.asset_id),
  );
  return {
    format: "eiken_rescore_input_view",
    version: "1.0.0",
    session: b.session,
    question_set: qs,
    transcript: {
      ...tr,
      turns: tr.turns.filter((t) => t.phase !== "post_processing"),
      source_capture_ids: tr.source_capture_ids.filter((id) => safeIds.has(id)),
    },
    captures: b.captures.filter((c) => safeIds.has(c.capture_id)),
    assets: b.assets.filter(
      (a) => qs.asset_ids.includes(a.asset_id) || safeAssets.has(a.asset_id),
    ),
    evaluator_prompt: { version: "1.0.0", text: evaluatorPrompt },
    rubric: releaseFiles.rubric,
    taxonomy: releaseFiles.taxonomy,
    metrics: releaseFiles.metrics,
    warnings: [
      "採点は外部Chatで実施してください。旧評価・修正版・講評は含みません。",
      "mixed/setup/post_feedbackの元ログ・素材は漏洩を防ぐため除外。元データは端末内に保持。",
      "これは交換bundleではなく再採点入力viewです。音声bytesは別途渡してください。",
    ],
  };
}
