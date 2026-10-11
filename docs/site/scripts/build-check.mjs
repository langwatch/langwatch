import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pageTargets } from "../docs-output.mjs";

function configuredSlugs({ node }) {
  if (typeof node === "string") return [node];
  return [...(node.groups ?? []), ...(node.pages ?? [])].flatMap((child) =>
    configuredSlugs({ node: child }),
  );
}

export async function checkBuild({ outDir }) {
  const docsRoot = fileURLToPath(new URL("../..", import.meta.url));
  const config = JSON.parse(await readFile(path.join(docsRoot, "docs.json"), "utf8"));
  const slugs = [
    ...new Set(config.navigation.anchors.flatMap((node) => configuredSlugs({ node }))),
  ];
  const expectedHtml = ["404.html"];
  for (const slug of slugs) {
    await access(path.join(outDir, `${slug}.md`));
    expectedHtml.push(...pageTargets({ slug }));
  }
  const actualHtml = (await readdir(outDir, { recursive: true })).filter((file) =>
    file.endsWith(".html"),
  );
  assert.deepEqual(
    actualHtml.toSorted(),
    expectedHtml.toSorted(),
    "Published HTML must match the configured inventory",
  );
  const search = JSON.parse(await readFile(path.join(outDir, "search-index.json"), "utf8"));
  assert.deepEqual(
    search.map((entry) => entry.slug),
    slugs,
    "Search must match the configured inventory in authored order",
  );
  assert.deepEqual(JSON.parse(await readFile(path.join(outDir, "skipped.json"), "utf8")), []);
  await access(path.join(outDir, "redirects.json"));
  await access(path.join(outDir, "llms.txt"));
}
