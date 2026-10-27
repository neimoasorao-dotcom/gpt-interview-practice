import { copyFile } from "node:fs/promises";
await copyFile(
  new URL("../standalone/eiken-pre1-records.html", import.meta.url),
  new URL("../eiken-pre1-records.html", import.meta.url),
);
console.log("Updated the distributable eiken-pre1-records.html");
