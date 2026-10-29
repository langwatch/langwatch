import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { writeOutputFiles } from "./output-files.ts";

/* Data keyed by the build version: a change to it alone must still move it. */
const VERSIONED_DATA = ["search-index.json"];
const BUILD_META = /name="docs-build" content="[^"]*"/;

/**
 * Versions every page by content, then writes each page once with that version. `pages` holds
 * HTML not yet written (output-relative path to markup); other HTML in `outDir` is versioned in
 * place.
 */
export async function writeVersionedPages({
  outDir,
  pages = new Map(),
}: {
  outDir: string;
  pages?: ReadonlyMap<string, string>;
}) {
  const onDisk = (await readdir(outDir, { recursive: true })).filter(
    (file) => file.endsWith(".html") && !pages.has(file),
  );
  const html = new Map(pages);
  for (const file of onDisk) html.set(file, await readFile(path.join(outDir, file), "utf8"));
  const hash = createHash("sha256");
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
  await writeOutputFiles({ root: outDir, files: output });
}
