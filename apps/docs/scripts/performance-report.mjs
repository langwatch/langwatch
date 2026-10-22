import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";

import {
  INTERACTION_BUDGETS,
  entryFiles as manifestEntryFiles,
  gzipFiles,
  interactionSizes,
  readManifest,
} from "./interaction-sizes.mjs";

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
async function measure({ directory }) {
  const manifest = await readManifest({ directory });
  const entryFiles = ({ name }) => manifestEntryFiles({ manifest, name });
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
    ...(await interactionSizes({ directory, manifest })),
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
  note: "All page types share the same bootstrap. Idle controls are tabs, toc and reading, loaded on every page. Search index JSON is reported apart from search JS. Interaction sizes are first-click downloads: the island entry and every chunk it imports, shared runtime chunks once. Assets and total sizes are uncompressed.",
};
console.log(JSON.stringify(report, null, 2));
if (values.report) await writeFile(values.report, JSON.stringify(report, null, 2));
/* Budgets fail the run only after the full report is printed and written, for review. */
if (after.initialGzip > 3_000)
  throw new Error(`Initial reading budget exceeded: ${after.initialGzip}`);
if (after.withIdleControlsGzip >= 15_000)
  throw new Error(`Initial JS budget exceeded: ${after.withIdleControlsGzip}`);
for (const [field, limit] of Object.entries(INTERACTION_BUDGETS))
  if (after[field] > limit) throw new Error(`${field} budget exceeded: ${after[field]} > ${limit}`);
