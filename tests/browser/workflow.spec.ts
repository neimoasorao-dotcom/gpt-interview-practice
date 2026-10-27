import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
});
test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page)).toEqual([]);
});
const fixture = "contracts/v1/examples/text-only-session.json";
const append = "contracts/v1/examples/append-rescore.json";
test("JSON→プレビュー→保存→全文→比較→書出し→再読込・復元", async ({
  page,
}, testInfo) => {
  const failures: string[] = [];
  page.on("pageerror", (e) => failures.push(e.message));
  const outbound: string[] = [];
  page.on("request", (req) => {
    if (
      !req.url().startsWith("http://127.0.0.1:4173") &&
      !req.url().startsWith("blob:")
    )
      outbound.push(req.url());
  });
  await page.goto("/");
  await expect(page.getByText("最初の記録を取り込みましょう")).toBeVisible();
  await page
    .getByLabel("JSONを取り込む", { exact: true })
    .setInputFiles(fixture);
  await expect(
    page.getByText("差分プレビュー", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("保存できません", { exact: false })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "差分を確認して保存" }).click();
  await expect(page.getByRole("status")).toContainText("保存しました");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /概要$/ })
    .click();
  await expect(page.getByText("最初の記録を取り込みましょう")).toBeVisible();
  await page.getByLabel("合成例を表示").check();
  await page.getByRole("button", { name: "全文・根拠を見る" }).click();
  await expect(page.getByRole("heading", { name: "双方の全文" })).toBeVisible();
  await expect(page.locator("#turn-demo-turn-04 .verbatim")).toContainText(
    "Some students leaves their bags",
  );
  await expect(
    page.locator(".index").filter({ hasText: "音声指数" }),
  ).toContainText("未取得 / 未評価");
  await expect(
    page.locator(".index").filter({ hasText: "文章指数" }),
  ).toContainText("未取得 / 未評価");
  await page
    .getByLabel("JSONを取り込む", { exact: true })
    .setInputFiles(fixture);
  await expect(page.getByText("記録の追加なし（同内容）")).toBeVisible();
  await page.getByRole("button", { name: "差分を確認して保存" }).click();
  await page
    .getByLabel("JSONを取り込む", { exact: true })
    .setInputFiles(append);
  await page.getByRole("button", { name: "差分を確認して保存" }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /面接詳細$/ })
    .click();
  await expect(
    page.getByLabel("評価版", { exact: true }).locator("option"),
  ).toHaveCount(2);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /比較$/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "同じ面接の再評価差" }),
  ).toBeVisible();
  await expect(
    page.getByText("能力向上の同条件比較として結論づけないでください。", {
      exact: false,
    }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /データ管理$/ })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "自己完結JSONを書出し" }).click();
  const d = await downloadPromise;
  expect(d.suggestedFilename()).toBe("demo-session-01.json");
  const exported = JSON.parse(readFileSync((await d.path())!, "utf8"));
  expect(exported.assessments).toHaveLength(2);
  expect(exported.transcripts[0].turns).toHaveLength(13);
  const backupPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSONのみバックアップ" }).click();
  const backup = await backupPromise;
  const backupPath = (await backup.path())!;
  await page.getByLabel("バックアップを検証", { exact: true }).setInputFiles({
    name: "backup.zip",
    mimeType: "application/zip",
    buffer: readFileSync(backupPath),
  });
  await expect(
    page.getByText("復元プレビュー:", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "検証結果を確認して復元" }).click();
  await expect(page.getByRole("status")).toContainText("復元しました");
  await page.reload();
  await page.getByLabel("合成例を表示").check();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /履歴$/ })
    .click();
  await expect(page.locator(".history-row")).toHaveCount(1);
  await page.screenshot({
    path: testInfo.outputPath("history.png"),
    fullPage: true,
  });
  await page.locator(".history-row").click();
  await page.screenshot({
    path: testInfo.outputPath("detail.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(failures).toEqual([]);
  expect(outbound).toEqual([]);
});
test("不正引用を拒否してデータを保存しない、HTMLはテキスト表示", async ({
  page,
}) => {
  await page.goto("/");
  const b = JSON.parse(readFileSync(fixture, "utf8"));
  b.assessments[0].findings[0].evidence_refs[0].quote =
    "<img src=x onerror=alert(1)>";
  await page.getByLabel("JSONを取り込む", { exact: true }).setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(b)),
  });
  await expect(page.getByRole("alert")).toContainText("引用が原文にありません");
  await expect(
    page.getByRole("button", { name: "差分を確認して保存" }),
  ).toHaveCount(0);
  await expect(page.locator("img")).toHaveCount(0);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /履歴$/ })
    .click();
  await expect(page.getByText("最初の記録を取り込みましょう")).toBeVisible();
});

test("Transcript新版・本人annotation・素材再生・素材付き削除復元", async ({
  page,
}) => {
  const { createHash } = await import("node:crypto");
  // A generated 0.5 second mono PCM WAV, never a person's voice.
  const wav = Buffer.alloc(44 + 8000);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(8000, 40);
  const b = JSON.parse(readFileSync(fixture, "utf8"));
  b.assets.push({
    asset_id: "synthetic-audio",
    kind: "audio",
    filename: "synthetic.wav",
    availability: "missing",
    path: null,
    sha256: createHash("sha256").update(wav).digest("hex"),
    mime_type: "audio/wav",
    duration_ms: 500,
    sample_rate_hz: 8000,
    channels: 1,
    speaker_coverage: "unknown",
    capture_tool: "generated-test",
    rights: "synthetic silence",
    notes: null,
  });
  const tr = structuredClone(b.transcripts[0]);
  tr.parent_transcript_id = tr.transcript_id;
  tr.transcript_id = "transcript-revised";
  for (const t of tr.turns) {
    t.previous_turn_ids = [t.turn_id];
    t.turn_id += "-revised";
  }
  tr.turns[3].text += " Japanese 日本語 and original words are retained.";
  b.transcripts.push(tr);
  await page.goto("/");
  await page.getByLabel("JSONを取り込む", { exact: true }).setInputFiles({
    name: "synthetic-revision.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(b)),
  });
  await page.getByRole("button", { name: "差分を確認して保存" }).click();
  await expect(page.getByRole("status")).toContainText("保存しました");
  await page.getByLabel("合成例を表示").check();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /面接詳細$/ })
    .click();
  await page
    .getByLabel("面接を選択", { exact: true })
    .selectOption("demo-session-01");
  await page
    .getByLabel("Transcript版", { exact: true })
    .selectOption("transcript-revised");
  await expect(
    page.getByText("表示中の本文と評価入力は別版です。", { exact: false }),
  ).toBeVisible();
  await expect(
    page.locator("#turn-demo-turn-04-revised .verbatim"),
  ).toContainText("日本語");
  await page
    .getByLabel("本人コメント", { exact: true })
    .fill("合成例の本人による異議");
  await page
    .locator(".finding")
    .filter({ has: page.getByRole("heading", { name: /mistake/ }) })
    .getByRole("button", { name: "本人が異議" })
    .click();
  await expect(page.getByRole("status")).toContainText("annotationを追記");
  await expect(
    page.getByText("有効レビュー: rejected", { exact: false }),
  ).toBeVisible();
  await page.locator(".asset input[type=file]").setInputFiles({
    name: "synthetic.wav",
    mimeType: "audio/wav",
    buffer: wav,
  });
  await expect(
    page.getByText("端末内添付済み", { exact: false }),
  ).toBeVisible();
  await page.locator("audio").evaluate(async (el: HTMLAudioElement) => {
    await el.play();
  });
  await expect
    .poll(() =>
      page.locator("audio").evaluate((el: HTMLAudioElement) => el.duration),
    )
    .toBe(0.5);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /データ管理$/ })
    .click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "素材込みバックアップ" }).click();
  const backup = await downloading;
  const bytes = readFileSync((await backup.path())!);
  await page.getByLabel("この面接のRAW", { exact: false }).check();
  await page.getByRole("button", { name: "指定した面接を削除" }).click();
  await expect(page.getByRole("status")).toContainText("削除しました");
  await page.getByLabel("バックアップを検証", { exact: true }).setInputFiles({
    name: "with-media.zip",
    mimeType: "application/zip",
    buffer: bytes,
  });
  await expect(page.getByText("素材 1件", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "検証結果を確認して復元" }).click();
  await expect(page.getByRole("status")).toContainText("復元しました");
  await page
    .getByLabel("面接を選択", { exact: true })
    .selectOption("demo-session-01");
  await expect(
    page.getByText("端末内添付済み", { exact: false }),
  ).toBeVisible();
});
