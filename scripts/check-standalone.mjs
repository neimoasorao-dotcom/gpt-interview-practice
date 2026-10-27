import { createServer } from "node:http";
import { chromium } from "@playwright/test";
import { mkdtemp, copyFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const folder = await mkdtemp(path.join(tmpdir(), "eiken-single-html-"));
const target = path.join(folder, "eiken-pre1-records.html");
await copyFile(path.join(root, "standalone/eiken-pre1-records.html"), target);
const httpMode = process.argv.includes("--http");
const server = httpMode
  ? createServer(async (req, res) => {
      if (req.url !== "/eiken-pre1-records.html") {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(await readFile(target));
    })
  : null;
if (server)
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = server
  ? `http://127.0.0.1:${server.address().port}/eiken-pre1-records.html`
  : pathToFileURL(target).href;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      offline: !httpMode,
    });
    const page = await context.newPage();
    const errors = [],
      remote = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("request", (r) => {
      if (/^https?:/i.test(r.url()) && r.url() !== url) remote.push(r.url());
    });
    await page.goto(url);
    await context.setOffline(true);
    await page
      .getByRole("heading", { name: "最初の記録を取り込みましょう" })
      .waitFor();
    await page
      .getByLabel("JSONを取り込む", { exact: true })
      .setInputFiles(
        path.join(root, "contracts/v1/examples/text-only-session.json"),
      );
    await page.getByRole("button", { name: "差分を確認して保存" }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "保存しました" })
      .waitFor();
    await page.getByLabel("合成例を表示").check();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: /概要$/ })
      .click();
    await page.getByRole("button", { name: "全文・根拠を見る" }).click();
    await page.getByRole("heading", { name: "双方の全文" }).waitFor();
    if (
      !(
        await page.locator("#turn-demo-turn-04 .verbatim").textContent()
      ).includes("Some students leaves")
    )
      throw Error("Original transcript changed");
    await page
      .getByLabel("JSONを取り込む", { exact: true })
      .setInputFiles(
        path.join(root, "contracts/v1/examples/append-rescore.json"),
      );
    await page.getByRole("button", { name: "差分を確認して保存" }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "保存しました" })
      .waitFor();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: /比較$/ })
      .click();
    await page.getByRole("heading", { name: "同じ面接の再評価差" }).waitFor();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: /データ管理$/ })
      .click();
    const exported = page.waitForEvent("download");
    await page.getByRole("button", { name: "自己完結JSONを書出し" }).click();
    const data = JSON.parse(
      await readFile(await (await exported).path(), "utf8"),
    );
    if (data.assessments.length !== 2)
      throw Error("Assessment versions not preserved");
    const backingUp = page.waitForEvent("download");
    await page.getByRole("button", { name: "JSONのみバックアップ" }).click();
    const backup = await readFile(await (await backingUp).path());
    await page.getByLabel("バックアップを検証", { exact: true }).setInputFiles({
      name: "backup.zip",
      mimeType: "application/zip",
      buffer: backup,
    });
    await page.getByRole("button", { name: "検証結果を確認して復元" }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "復元しました" })
      .waitFor();
    if (httpMode) await context.setOffline(false);
    await page.reload();
    await context.setOffline(true);
    await page.getByLabel("合成例を表示").check();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: /履歴$/ })
      .click();
    await page.locator(".history-row").waitFor();
    if ((await page.locator(".history-row").count()) !== 1)
      throw Error("Persistence or deduplication failed");
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw Error("Horizontal viewport overflow");
    if (errors.length || remote.length)
      throw Error(JSON.stringify({ errors, remote }));
    console.log(
      `Offline single HTML (${httpMode ? "HTTP load, then offline" : "file://"}, ${width}px): import, detail, compare, export, backup/restore, reload persistence passed; no external requests`,
    );
    await context.close();
  }
  if ((await readdir(folder)).length !== 1)
    throw Error("Test directory has dependencies besides the HTML");
} finally {
  await browser.close();
  if (server)
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  await rm(folder, { recursive: true, force: true });
}
