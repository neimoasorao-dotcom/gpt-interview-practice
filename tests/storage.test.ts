import { selectDefault, effectiveReview } from "../src/domain/analysis";
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { deleteDB, type IDBPDatabase } from "idb";
import { zipSync, unzipSync } from "fflate";
import baseJson from "../contracts/v1/examples/text-only-session.json";
import appendJson from "../contracts/v1/examples/append-rescore.json";
import { type Bundle, encode, sha256 } from "../src/domain/model";
import {
  openDatabase,
  loadBundles,
  prepare,
  commit,
  attachMedia,
  annotate,
  type ImportLog,
} from "../src/storage/db";
import {
  makeBackup,
  inspectBackup,
  restore,
  rescoreInput,
} from "../src/storage/backup";
const dbs: IDBPDatabase[] = [];
async function database() {
  const db = await openDatabase("test-" + crypto.randomUUID());
  dbs.push(db);
  return db;
}
afterEach(async () => {
  for (const db of dbs) {
    const name = db.name;
    db.close();
    await deleteDB(name);
  }
  dbs.length = 0;
});
function base() {
  return structuredClone(baseJson) as unknown as Bundle;
}
const file = (value: unknown, name = "synthetic.json") =>
  new File([encode(value)], name, { type: "application/json" });
async function ingest(db: IDBPDatabase, value: unknown) {
  const p = await prepare(file(value), await loadBundles(db));
  await commit(db, p);
  return p;
}
describe("追記型IndexedDB・原bytes・衝突", () => {
  it("再取込で面接/評価/ミス/取込件数を増やさない", async () => {
    const db = await database();
    const p = await ingest(db, base());
    expect(p.errors).toEqual([]);
    expect((await ingest(db, base())).noOp).toBe(true);
    const rows = await loadBundles(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].assessments).toHaveLength(1);
    expect(await db.count("imports")).toBe(1);
    expect(await db.count("assessments")).toBe(1);
  });
  it("元bytesは空白を含めて書出し可能、論理一致はno-op", async () => {
    const db = await database();
    await ingest(db, base());
    const bytes = new TextEncoder().encode(" \n" + JSON.stringify(base()));
    const p = await prepare(
      new File([bytes], "spaces.json"),
      await loadBundles(db),
    );
    expect(p.noOp).toBe(true);
    await commit(db, p);
    const logs: ImportLog[] = await db.getAll("imports");
    expect(logs).toHaveLength(2);
    expect(logs.find((l) => l.filename === "spaces.json")?.bytes).toEqual(
      bytes,
    );
    expect(await db.count("sessions")).toBe(1);
  });
  it("ID異内容は保存ゼロ、既存データ不変", async () => {
    const db = await database();
    await ingest(db, base());
    const b = base();
    b.captures[0].content_text += "Changed";
    const p = await prepare(file(b), await loadBundles(db));
    expect(p.errors.length).toBeGreaterThan(0);
    await expect(commit(db, p)).rejects.toThrow();
    expect(await db.count("imports")).toBe(1);
    expect((await loadBundles(db))[0].captures[0].content_text).toBe(
      base().captures[0].content_text,
    );
  });
  it("プレビュー後の別タブ競合でもatomicに拒否", async () => {
    const db = await database();
    await ingest(db, base());
    const x = structuredClone(appendJson) as unknown as Bundle,
      y = structuredClone(x);
    x.assessments[0].summary = "first";
    y.assessments[0].summary = "different";
    const p = await prepare(file(x), await loadBundles(db)),
      q = await prepare(file(y), await loadBundles(db));
    await commit(db, p);
    await expect(commit(db, q)).rejects.toThrow();
    expect(await db.count("assessments")).toBe(2);
    expect(await db.count("imports")).toBe(2);
  });
  it("再採点とTranscript訂正は独立、本人判断は別ストア", async () => {
    const db = await database();
    await ingest(db, base());
    await ingest(db, appendJson);
    const b = (await loadBundles(db))[0],
      tr = structuredClone(b.transcripts[0]);
    tr.parent_transcript_id = tr.transcript_id;
    tr.transcript_id = "demo-transcript-v2";
    tr.turns.forEach((t) => {
      t.previous_turn_ids = [t.turn_id];
      t.turn_id += "-v2";
    });
    const next = {
      ...b,
      bundle_mode: "append",
      export_id: "corrected-view",
      transcripts: [tr],
      assets: [],
      captures: [],
      question_sets: [],
      events: [],
      assessments: [],
      annotations: [],
    };
    await ingest(db, next);
    const saved = (await loadBundles(db))[0];
    expect(saved.transcripts).toHaveLength(2);
    expect(
      saved.assessments.every(
        (a) => a.input.transcript_id === "demo-transcript-v1",
      ),
    ).toBe(true);
    await annotate(db, saved, {
      annotation_id: "annotation-test",
      created_at: null,
      target_type: "finding",
      target_id: saved.assessments[0].findings[0].finding_id,
      action: "dispute",
      comment: "ASR確認待ち",
    });
    expect(await db.count("annotations")).toBe(1);
    expect(saved.assessments[0].findings[0].review_state).toBe("unreviewed");
  });
  it("別sessionの同内容は重複候補・削除しない", async () => {
    const db = await database();
    await ingest(db, base());
    const b = base();
    b.export_id = "another-export";
    b.session.session_id = "another-session";
    const p = await prepare(file(b), await loadBundles(db));
    expect(p.duplicates).toContain("demo-session-01");
    await commit(db, p);
    expect(await db.count("sessions")).toBe(2);
  });
  it("共有question_set同ID異内容を拒否", async () => {
    const db = await database();
    await ingest(db, base());
    const b = base();
    b.export_id = "different-export";
    b.session.session_id = "another-session";
    b.question_sets[0].source_description = "changed";
    const p = await prepare(file(b), await loadBundles(db));
    expect(p.errors.join()).toContain("共有ID");
  });
  it("export_id異内容の衝突は全体rollback", async () => {
    const db = await database();
    await ingest(db, base());
    const b = base();
    b.session.session_id = "another-session";
    const p = await prepare(file(b), await loadBundles(db));
    await expect(commit(db, p)).rejects.toThrow("export_id");
    expect(await db.count("sessions")).toBe(1);
  });
  it("UTF-8・JSON不正とサイズを拒否", async () => {
    expect(
      (await prepare(new File(["{"], "bad.json"), [])).errors.length,
    ).toBeGreaterThan(0);
    expect(
      (
        await prepare(
          new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.json"),
          [],
        )
      ).errors.length,
    ).toBeGreaterThan(0);
  });
});
describe("バックアップ・復元・素材", () => {
  it("原ログと追加評価をJSONのみ復元、再復元でも件数不変", async () => {
    const source = await database(),
      dest = await database();
    await ingest(source, base());
    await ingest(source, appendJson);
    const plan = await inspectBackup(await makeBackup(source, false));
    expect(plan.warnings.join()).toContain("別途必要");
    await restore(dest, plan);
    expect((await loadBundles(dest))[0].assessments).toHaveLength(2);
    const count = await dest.count("imports");
    await restore(dest, plan);
    expect(await dest.count("imports")).toBe(count);
    expect(await dest.count("sessions")).toBe(1);
  });
  it("素材bytes/hash/sizeの復元と同ID異bytes拒否", async () => {
    const db = await database(),
      dest = await database(),
      b = base(),
      bytes = new TextEncoder().encode("synthetic media, not real audio");
    const hash = await sha256(bytes);
    b.assets.push({
      asset_id: "demo-audio",
      kind: "audio",
      filename: "synthetic.wav",
      availability: "missing",
      path: null,
      sha256: hash,
      mime_type: "audio/wav",
      duration_ms: null,
      sample_rate_hz: null,
      channels: null,
      speaker_coverage: "both",
      capture_tool: null,
      rights: "synthetic fixture",
      notes: null,
    });
    await ingest(db, b);
    await attachMedia(
      db,
      b,
      "demo-audio",
      new File([bytes], "synthetic.wav", { type: "audio/wav" }),
    );
    await expect(
      attachMedia(db, b, "demo-audio", new File(["bad"], "bad.wav")),
    ).rejects.toThrow("SHA");
    const plan = await inspectBackup(await makeBackup(db, true));
    await restore(dest, plan);
    expect((await dest.getAll("media"))[0].bytes).toEqual(bytes);
  });
  it("復元時の1件衝突は他面接も含め書込みゼロ", async () => {
    const db = await database(),
      dest = await database();
    await ingest(db, base());
    const b = base();
    b.captures[0].notes = "conflicting";
    await ingest(dest, b);
    const plan = await inspectBackup(await makeBackup(db, false));
    await expect(restore(dest, plan)).rejects.toThrow();
    expect(await dest.count("sessions")).toBe(1);
    expect(await dest.count("imports")).toBe(1);
  });
  it("hash改ざんを拒否", async () => {
    const db = await database();
    await ingest(db, base());
    const zip = unzipSync(await makeBackup(db, false));
    zip["bundles/0.json"][10] ^= 1;
    await expect(inspectBackup(zipSync(zip))).rejects.toThrow("hash");
  });
  it("path traversalとmanifest未記載pathを拒否", async () => {
    await expect(
      inspectBackup(zipSync({ "../attack": new Uint8Array() })),
    ).rejects.toThrow("path");
    const db = await database();
    const zip = unzipSync(await makeBackup(db, false));
    zip["media/7.bin"] = new Uint8Array();
    await expect(inspectBackup(zipSync(zip))).rejects.toThrow("manifest");
  });
  it("再採点viewは旧評価とmixed原ログを含めない", () => {
    const b = base();
    b.captures.push({
      ...b.captures[0],
      capture_id: "mixed-capture",
      scope: "mixed",
      content_text: "SECRET OLD SCORE",
    });
    const view = rescoreInput(
      b,
      b.transcripts[0].transcript_id,
      b.question_sets[0].question_set_id,
    );
    expect(view).not.toHaveProperty("assessments");
    expect(JSON.stringify(view)).not.toContain("SECRET OLD SCORE");
    expect(view.rubric.version).toBe("1.0.0");
  });
});

describe("自己完結・関係の追加検証", () => {
  it("自己完結を称する欠落bundleをローカル参照で救済しない", async () => {
    const db = await database();
    await ingest(db, base());
    const b = base();
    b.export_id = "not-self-contained";
    b.captures = [];
    const p = await prepare(file(b), await loadBundles(db));
    expect(p.errors.length).toBeGreaterThan(0);
  });
  it("親面接の循環を拒否、外部親は警告", async () => {
    const db = await database();
    const b = base();
    b.session.parent_session_id = "another-session";
    const first = await ingest(db, b);
    expect(first.warnings.join()).toContain("親面接");
    const c = base();
    c.export_id = "parent-export";
    c.session.session_id = "another-session";
    c.session.parent_session_id = b.session.session_id;
    const p = await prepare(file(c), await loadBundles(db));
    expect(p.errors.join()).toContain("循環");
  });
});

describe("ZIP展開前の境界検証", () => {
  it("重複pathを拒否", async () => {
    const zip = zipSync({
      "media/0.bin": new Uint8Array(),
      "media/1.bin": new Uint8Array(),
    });
    const text = new TextDecoder().decode(zip);
    const needle = new TextEncoder().encode("media/1.bin");
    for (let i = 0; i < zip.length - needle.length; i++)
      if (needle.every((v, j) => zip[i + j] === v))
        zip[i + 6] = "0".charCodeAt(0);
    expect(text).toContain("media/1.bin");
    await expect(inspectBackup(zip)).rejects.toThrow("重複");
  });
  it("解凍後サイズ上限を展開前に拒否", async () => {
    const zip = zipSync({ "media/0.bin": new Uint8Array() });
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    for (let i = 0; i < zip.length - 46; i++)
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 300 * 1024 * 1024, true);
        break;
      }
    await expect(inspectBackup(zip)).rejects.toThrow("展開後");
  });
});

describe("プレビュー後のIDと関係の再検証", () => {
  it("export_id衝突をプレビューで表示", async () => {
    const db = await database();
    await ingest(db, base());
    const b = base();
    b.session.session_id = "another-session";
    const p = await prepare(
      file(b),
      await loadBundles(db),
      await db.getAll("imports"),
    );
    expect(p.errors.join()).toContain("export_id");
  });
  it("別タブで作られた親面接の循環も保存時に拒否", async () => {
    const db = await database(),
      a = base(),
      b = base();
    a.session.parent_session_id = "parent-b";
    b.session.session_id = "parent-b";
    b.session.parent_session_id = a.session.session_id;
    b.export_id = "parent-export";
    const p = await prepare(file(a), []),
      q = await prepare(file(b), []);
    await commit(db, p);
    await expect(commit(db, q)).rejects.toThrow("循環");
    expect(await db.count("sessions")).toBe(1);
  });
});

describe("固定releaseの衝突", () => {
  it("同版の異なるreleaseは上書きせずトランザクションを戻す", async () => {
    const db = await database();
    await db.put("releases", { key: "1.0.0", files: { different: true } });
    const p = await prepare(file(base()), []);
    await expect(commit(db, p)).rejects.toThrow("release");
    expect(await db.count("sessions")).toBe(0);
    expect(await db.count("imports")).toBe(0);
    expect((await db.get("releases", "1.0.0")).files).toEqual({
      different: true,
    });
  });
});

describe("保存時の安定した追記順", () => {
  it("IDの辞書順で評価/本人判断を並べ替えず、復元後も順序を保持", async () => {
    const db = await database(),
      dest = await database(),
      b = base();
    b.assessments[0].assessment_id = "zzz-initial";
    await ingest(db, b);
    const append = structuredClone(appendJson) as unknown as Bundle;
    append.assessments[0].assessment_id = "aaa-rescore";
    append.assessments[0].supersedes_assessment_id = "zzz-initial";
    await ingest(db, append);
    let saved = (await loadBundles(db))[0];
    expect(selectDefault(saved)?.assessment_id).toBe("zzz-initial");
    const id = saved.assessments[0].findings[0].finding_id;
    await annotate(db, saved, {
      annotation_id: "zzz-confirm",
      created_at: null,
      target_type: "finding",
      target_id: id,
      action: "confirm",
      comment: "first",
    });
    saved = (await loadBundles(db))[0];
    await annotate(db, saved, {
      annotation_id: "aaa-dispute",
      created_at: null,
      target_type: "finding",
      target_id: id,
      action: "dispute",
      comment: "last",
    });
    saved = (await loadBundles(db))[0];
    expect(effectiveReview(saved, saved.assessments[0].findings[0])).toBe(
      "rejected",
    );
    const plan = await inspectBackup(await makeBackup(db, false));
    await restore(dest, plan);
    saved = (await loadBundles(dest))[0];
    expect(selectDefault(saved)?.assessment_id).toBe("zzz-initial");
    expect(saved.annotations.map((n) => n.annotation_id)).toEqual([
      "zzz-confirm",
      "aaa-dispute",
    ]);
    expect(effectiveReview(saved, saved.assessments[0].findings[0])).toBe(
      "rejected",
    );
  });
});
