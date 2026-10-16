import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { withBasePath } from "../lib/site-path.ts";
import { appRoot } from "../paths.ts";
import { writeOutputFiles } from "./output-files.ts";

/* Both reading fonts version the cache; only Latin is precached, Latin-ext on first request. */
const READING_FONTS = [
  "/fonts/Inter-Variable-latin.woff2",
  "/fonts/Inter-Variable-latin-ext.woff2",
];
const PRECACHED_FONTS = ["/fonts/Inter-Variable-latin.woff2"];
/* Data the worker caches under the build version: a change to it alone must still move it. */
const VERSIONED_DATA = ["search-index.json"];
const BUILD_META = /name="docs-build" content="[^"]*"/;

/**
 * Versions every page by content, then writes each page once with that version, the offline
 * page and the precaching `sw.js`. `pages` holds HTML not yet written (output-relative path to
 * markup); any other HTML already in `outDir` is versioned in place.
 */
export async function writeServiceWorker({
  outDir,
  basePath = "",
  pages = new Map(),
}: {
  outDir: string;
  basePath?: string;
  pages?: ReadonlyMap<string, string>;
}) {
  const onDisk = (await readdir(outDir, { recursive: true })).filter(
    (file) => file.endsWith(".html") && !pages.has(file),
  );
  const html = new Map(pages);
  for (const file of onDisk) html.set(file, await readFile(path.join(outDir, file), "utf8"));
  const source = await readFile(path.join(appRoot, "worker/service-worker.js"), "utf8");
  const hash = createHash("sha256").update(source);
  for (const file of READING_FONTS) hash.update(await readFile(path.join(outDir, file)));
  for (const file of VERSIONED_DATA) {
    const data = await readFile(path.join(outDir, file)).catch(() => null);
    hash.update(`\0${file}\0`).update(data ?? "missing");
  }
  for (const file of [...html.keys()].toSorted()) hash.update(file).update(html.get(file) ?? "");
  const version = hash.digest("hex").slice(0, 16);
  const output = new Map<string, string>();
  for (const [file, markup] of html) {
    const versioned = markup.replace(BUILD_META, `name="docs-build" content="${version}"`);
    if (pages.has(file) || versioned !== markup) output.set(file, versioned);
  }
  const home = html.get("index.html") ?? "";
  const styles = [...home.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map((match) => match[1]);
  const scripts = [...home.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((match) => match[1]);
  const site = (sitePath: string) => withBasePath({ basePath, path: sitePath });
  output.set(
    "offline.html",
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Offline | LangWatch Docs</title>${styles.map((href) => `<link rel="stylesheet" href="${href}">`).join("")}</head><body><main class="docs-offline"><h1>You are offline</h1><p>Previously opened pages are available offline. Reconnect to open this page.</p><a href="${site("/introduction")}">Return to the documentation</a></main></body></html>`,
  );
  const precache = [...styles, ...scripts, ...[...PRECACHED_FONTS, "/offline.html"].map(site)];
  output.set(
    "sw.js",
    source
      .replace("__DOCS_VERSION__", version)
      .replace("const PRECACHE = [];", `const PRECACHE = ${JSON.stringify(precache)};`),
  );
  await writeOutputFiles({ root: outDir, files: output });
}
