import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";

const { values } = parseArgs({
  options: {
    "out-dir": { type: "string" },
    before: { type: "string" },
    report: { type: "string" },
  },
});
const outDir = path.resolve(values["out-dir"] ?? "dist");
async function directorySize({ directory }) {
  const files = await readdir(directory, { recursive: true });
  let bytes = 0;
  for (const file of files) {
    const info = await stat(path.join(directory, file));
    if (info.isFile()) bytes += info.size;
  }
  return bytes;
}
async function gzipFiles({ directory, files }) {
  let bytes = 0;
  for (const file of new Set(files))
    bytes += gzipSync(await readFile(path.join(directory, file))).length;
  return bytes;
}
async function measure({ directory }) {
  const manifest = JSON.parse(await readFile(path.join(directory, ".vite/manifest.json"), "utf8"));
  function entryFiles({ name }) {
    const found = Object.entries(manifest).find(
      ([, entry]) => entry.name === name && entry.isEntry,
    );
    if (!found) return [];
    const result = new Set();
    const collect = (key) => {
      const entry = manifest[key];
      if (!entry || result.has(entry.file)) return;
      result.add(entry.file);
      for (const child of entry.imports ?? []) collect(child);
    };
    collect(found[0]);
    return [...result];
  }
  const html = await readFile(path.join(directory, "index.html"), "utf8");
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].reduce(
    (sum, match) => sum + gzipSync(match[1]).length,
    0,
  );
  const worker = gzipSync(await readFile(path.join(directory, "sw.js"))).length;
  const initial = entryFiles({ name: "index" });
  /* Islands every page loads at idle without a reader action. */
  const idle = ["tabs", "toc", "reading"].flatMap((name) => entryFiles({ name }));
  const index = await readFile(path.join(directory, "search-index.json"));
  return {
    initialGzip: inline + (await gzipFiles({ directory, files: initial })),
    serviceWorkerGzip: worker,
    withIdleControlsGzip:
      inline + worker + (await gzipFiles({ directory, files: [...initial, ...idle] })),
    deferredReadingGzip: await gzipFiles({ directory, files: entryFiles({ name: "reading" }) }),
    simpleIslandsGzip: await gzipFiles({
      directory,
      files: [
        "controls",
        "copy",
        "tabs",
        "menus",
        "media",
        "toc",
        "disclosures",
        "reading",
      ].flatMap((name) => entryFiles({ name })),
    }),
    searchIndexBytes: index.length,
    searchIndexGzip: gzipSync(index).length,
    contextMenusInteractionGzip: await gzipFiles({
      directory,
      files: entryFiles({ name: "context-menus" }),
    }),
    searchInteractionGzip: await gzipFiles({ directory, files: entryFiles({ name: "search" }) }),
    playgroundInteractionGzip: await gzipFiles({
      directory,
      files: entryFiles({ name: "playground" }),
    }),
    assetsBytes: await directorySize({ directory: path.join(directory, "assets") }),
    totalBytes: await directorySize({ directory }),
  };
}
const after = await measure({ directory: outDir });
const before = values.before
  ? await measure({ directory: path.resolve(values.before) })
  : undefined;
const report = {
  before,
  after,
  pageTypes: ["home", "guide", "API reference"],
  note: "All page types share the same bootstrap. Idle controls are tabs, toc and reading, loaded on every page. Search index JSON is reported apart from search JS. Interaction sizes include shared React/Zod chunks once. Assets and total sizes are uncompressed.",
};
console.log(JSON.stringify(report, null, 2));
if (values.report) await writeFile(values.report, JSON.stringify(report, null, 2));
/* Budgets fail the run only after the full report is printed and written, for review. */
if (after.initialGzip > 3_000)
  throw new Error(`Initial reading budget exceeded: ${after.initialGzip}`);
if (after.withIdleControlsGzip >= 15_000)
  throw new Error(`Initial JS budget exceeded: ${after.withIdleControlsGzip}`);
