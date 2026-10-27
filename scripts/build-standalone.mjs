import { build } from "vite";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const result = await build({
  configFile: false,
  root,
  base: "./",
  publicDir: false,
  build: {
    write: false,
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    rolldownOptions: { output: { codeSplitting: false } },
  },
});
const outputs = (Array.isArray(result) ? result : [result]).flatMap(
  (bundle) => bundle.output,
);
const chunks = outputs.filter((file) => file.type === "chunk");
const styles = outputs.filter((file) => file.fileName.endsWith(".css"));
const index = outputs.find((file) => file.fileName === "index.html");
if (!index || chunks.length !== 1 || styles.length !== 1) {
  throw new Error("Expected one HTML, one inline script, and one stylesheet");
}
// Rolldown may report an inlined dynamic import as a reference to this same chunk.
if (
  [...chunks[0].imports, ...chunks[0].dynamicImports].some(
    (name) => name !== chunks[0].fileName,
  )
) {
  throw new Error(
    "The standalone script still has external chunk dependencies",
  );
}
const icon = await readFile(path.join(root, "public/favicon.svg"));
const js = chunks[0].code.replace(/<\/script/gi, "<\\/script");
const css = String(styles[0].source).replace(/<\/style/gi, "<\\/style");
let html = String(index.source)
  .replace(
    /<script\b[^>]*\bsrc="[^"]+"[^>]*><\/script>/g,
    () => `<script type="module">${js}</script>`,
  )
  .replace(
    /<link\b[^>]*\brel="stylesheet"[^>]*>/g,
    () => `<style>${css}</style>`,
  )
  .replace(/<link\b[^>]*\brel="modulepreload"[^>]*>/g, "")
  .replace(
    /<link\b[^>]*\brel="icon"[^>]*>/g,
    () =>
      `<link rel="icon" href="data:image/svg+xml;base64,${icon.toString("base64")}">`,
  );
if (/<script\b[^>]*\bsrc=|<link\b[^>]*\bhref="(?!data:)/i.test(html)) {
  throw new Error("HTML contains an external resource reference");
}
const target = path.join(root, "standalone/eiken-pre1-records.html");
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, html);
console.log(`Standalone HTML: ${target} (${Buffer.byteLength(html)} bytes)`);
