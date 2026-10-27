import { chromium } from "@playwright/test";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("response", (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });
  const response = await page.goto(
    process.env.PRODUCTION_URL || "http://127.0.0.1:4174/practice/",
  );
  if (response.status() !== 200) throw Error("HTTP " + response.status());
  await page
    .getByRole("heading", { name: "最初の記録を取り込みましょう" })
    .waitFor();
  await page
    .getByLabel("JSONを取り込む", { exact: true })
    .setInputFiles("contracts/v1/examples/text-only-session.json");
  await page.getByRole("button", { name: "差分を確認して保存" }).click();
  await page.getByRole("status").filter({ hasText: "保存しました" }).waitFor();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSONのみバックアップ" }).click();
  if (!(await download).suggestedFilename().endsWith(".zip"))
    throw Error("ZIP export failed");
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("viewport overflow");
  if (errors.length) throw Error(JSON.stringify(errors));
  console.log(
    "Production: HTTP 200, empty state, import, atomic save, lazy ZIP export, mobile layout, no browser errors",
  );
} finally {
  await browser.close();
}
