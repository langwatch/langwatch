import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { PROMPT_FRAGMENT_FILE } from "../features/content/compile/skill-prompts.ts";
import { readDocsConfig, type DocsItem } from "../features/navigation/compile/nav.ts";
import {
  isStaticRedirect,
  readBuiltRedirects,
  redirectTarget,
} from "../features/navigation/compile/redirects.ts";
import { docsRoot } from "../paths.ts";
import { pageTargets } from "./document.ts";
import { htmlMediaPaths, isHashedFile, isStableAsset } from "./hashed-assets.ts";

/** Slugs straight from docs.json, independent of the navigation compiler, in authored order. */
function configuredSlugs({ items }: { items: DocsItem[] }): string[] {
  return items.flatMap((item) =>
    typeof item === "string" ? [item] : configuredSlugs({ items: item?.pages ?? [] }),
  );
}

/** The published inventory matches the configuration: pages, redirects, exports, search. */
export async function assertBuild({ outDir }: { outDir: string }) {
  const anchors = readDocsConfig({ docsRoot }).navigation?.anchors ?? [];
  const slugs = [
    ...new Set(
      anchors.flatMap((anchor) =>
        configuredSlugs({ items: [...(anchor.groups ?? []), ...(anchor.pages ?? [])] }),
      ),
    ),
  ];
  const expectedHtml = ["404.html"];
  for (const slug of slugs) {
    await access(path.join(outDir, `${slug}.md`));
    expectedHtml.push(...pageTargets({ slug }));
  }
  const redirectPages = Object.keys(readBuiltRedirects({ outDir }))
    .filter((source) => isStaticRedirect({ source }))
    .map((source) => redirectTarget({ source }))
    .filter((target) => !expectedHtml.includes(target));
  expectedHtml.push(...redirectPages);
  const builtHtml = (await readdir(outDir, { recursive: true }))
    .filter((file) => file.endsWith(".html"))
    .map((file) => file.split(path.sep).join("/"));
  const actualHtml = builtHtml.filter((file) => !PROMPT_FRAGMENT_FILE.test(file));
  const fragments = builtHtml.filter((file) => PROMPT_FRAGMENT_FILE.test(file));
  const named = new Set<string>();
  const media = new Set<string>();
  for (const file of actualHtml) {
    const html = await readFile(path.join(outDir, file), "utf8");
    for (const match of html.matchAll(
      /\sdata-docs-prompt-fragment="[^"]*\/(assets\/skill-prompt-[0-9a-f]{16}\.html)"/g,
    ))
      named.add(match[1] ?? "");
    for (const sitePath of htmlMediaPaths({ html, basePath: "" })) media.add(sitePath);
  }
  assert.deepEqual(
    [...media].filter((sitePath) => !existsSync(path.join(outDir, sitePath))),
    [],
    "Every media file a page names must be published",
  );
  assert.deepEqual(
    [...media].filter((sitePath) => !isHashedFile({ sitePath }) && !isStableAsset({ sitePath })),
    [],
    "Every media file a page names must carry its content hash, or be a stable logo or social card",
  );
  assert.deepEqual(
    fragments.toSorted(),
    [...named].toSorted(),
    "Every skill prompt fragment must be named by a published page, and exist",
  );
  assert.deepEqual(
    actualHtml.toSorted(),
    expectedHtml.toSorted(),
    "Published HTML must match the configured inventory",
  );
  const search = z
    .array(z.object({ slug: z.string() }))
    .parse(JSON.parse(await readFile(path.join(outDir, "search-index.json"), "utf8")));
  assert.deepEqual(
    search.map((entry) => entry.slug),
    slugs,
    "Search must match the configured inventory in authored order",
  );
  assert.deepEqual(JSON.parse(await readFile(path.join(outDir, "skipped.json"), "utf8")), []);
  await access(path.join(outDir, "redirects.json"));
  await access(path.join(outDir, "llms.txt"));
}
