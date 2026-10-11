import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { render } from "../app/entry-server.tsx";
import { SPEC_FILES } from "../features/api-reference/compile/openapi.ts";
import {
  discoveryFiles,
  PAGE_EXPORT_EXTENSIONS,
} from "../features/discovery/compile/discovery-files.ts";
import { pageMarkdown } from "../features/discovery/compile/markdown-export.ts";
import { pageHead } from "../features/discovery/compile/page-head.ts";
import { buildNav } from "../features/navigation/compile/nav.ts";
import {
  isStaticRedirect,
  readRedirects,
  redirectPage,
  redirectTarget,
} from "../features/navigation/compile/redirects.ts";
import { searchEntry } from "../features/search/compile/search-index.ts";
import type { PublishedSearchEntry } from "../features/search/model/search-entry.ts";
import { docsRoot, readBuildOptions } from "../paths.ts";
import {
  composeDocument,
  islandHead,
  NOT_FOUND_HEAD,
  pageTargets,
  STATIC_DIRS,
  STATIC_FILES,
  extractStyles,
} from "./document.ts";

/* Runs as the SSR bundle (see build.ts) after the client build: renders every
   configured page into the client output, beside its hashed assets. */
const STYLE_PLACEHOLDER = "/assets/prerender.css";
const HERO_PRELOAD =
  '<link rel="preload" as="image" href="/images/coding-agents/optimized/session-detail-1024.webp" imagesrcset="/images/coding-agents/optimized/session-detail-640.webp 640w, /images/coding-agents/optimized/session-detail-1024.webp 1024w, /images/coding-agents/optimized/session-detail-1560.webp 1560w" imagesizes="(min-width: 1280px) calc(100vw - 620px), (min-width: 1024px) calc(100vw - 380px), calc(100vw - 40px)">';
const manifestSchema = z.record(
  z.string(),
  z.looseObject({ file: z.string(), name: z.string().optional(), isEntry: z.boolean().optional() }),
);

const { outDir: dist } = readBuildOptions();
const manifestText = await readFile(path.join(dist, ".vite/manifest.json"), "utf8");
const sources = Object.fromEntries(
  Object.values(manifestSchema.parse(JSON.parse(manifestText)))
    .filter((entry) => entry.isEntry && entry.name && entry.name !== "index")
    .map((entry) => [entry.name, `/${entry.file}`]),
);
const islands = islandHead({
  sources,
  build: createHash("sha256").update(manifestText).digest("hex").slice(0, 16),
});
const template = await readFile(path.join(dist, "index.html"), "utf8");
const nav = buildNav({ docsRoot });
const styles = new Set<string>();
const htmlTargets: string[] = [];

/** Collects a page's design-system CSS into the shared stylesheet and returns its markup. */
function staticPage({ html }: { html: string }) {
  const result = extractStyles({ html });
  for (const rule of result.rules) styles.add(rule);
  return result.html;
}

async function write({ target, contents }: { target: string; contents: string }) {
  await mkdir(path.dirname(path.join(dist, target)), { recursive: true });
  await writeFile(path.join(dist, target), contents);
}

async function writeExports({ slug }: { slug: string }) {
  const markdown = pageMarkdown({ docsRoot, slug });
  for (const extension of PAGE_EXPORT_EXTENSIONS) {
    await write({ target: `${slug}.${extension}`, contents: markdown });
    if (slug === "introduction") await write({ target: `index.${extension}`, contents: markdown });
  }
}

const redirects = readRedirects({ docsRoot });
await writeFile(path.join(dist, "redirects.json"), JSON.stringify(redirects));
for (const [name, contents] of Object.entries(discoveryFiles({ nav }))) {
  await writeFile(path.join(dist, name), contents);
}

const searchIndex: PublishedSearchEntry[] = [];
const skipped: { slug: string; reason: string }[] = [];
let compiled = 0;
for (const slug of Object.keys(nav.pages)) {
  try {
    const { html, title, description, operation, headings } = await render({ slug });
    const preload = slug === "coding-agents/overview" ? HERO_PRELOAD : "";
    const page = composeDocument({
      template,
      islands,
      head: `${preload}${pageHead({ slug, title, description })}<link data-docs-style rel="stylesheet" href="${STYLE_PLACEHOLDER}">`,
      app: staticPage({ html }),
      slug,
      operation,
    });
    searchIndex.push(searchEntry({ nav, slug, html, headings }));
    await writeExports({ slug });
    for (const target of pageTargets({ slug })) {
      await write({ target, contents: page });
      htmlTargets.push(target);
    }
    compiled += 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    skipped.push({ slug, reason: `render: ${message.split("\n")[0]}` });
  }
}
await writeFile(path.join(dist, "search-index.json"), JSON.stringify(searchIndex));

const missing = await render({ slug: "404" });
await write({
  target: "404.html",
  contents: composeDocument({
    template,
    islands,
    head: `${NOT_FOUND_HEAD}<link data-docs-style rel="stylesheet" href="${STYLE_PLACEHOLDER}">`,
    app: staticPage({ html: missing.html }),
    slug: "404",
    operation: null,
  }),
});
htmlTargets.push("404.html");

/* One content-hashed stylesheet for every page, deduplicated in encounter order. */
const css = [...styles].join("\n");
const cssHref = `/assets/prerender-${createHash("sha256").update(css).digest("hex").slice(0, 16)}.css`;
await writeFile(path.join(dist, cssHref), css);
for (const target of htmlTargets) {
  const file = path.join(dist, target);
  await writeFile(file, (await readFile(file, "utf8")).replace(STYLE_PLACEHOLDER, cssHref));
}

/* After every page: a configured page always wins over a redirect page at the same path. */
for (const [source, destination] of Object.entries(redirects)) {
  const target = redirectTarget({ source });
  const published = existsSync(path.join(dist, target));
  if (published || !isStaticRedirect({ source })) continue;
  await write({ target, contents: redirectPage({ destination }) });
}

for (const name of [...STATIC_DIRS, ...STATIC_FILES]) {
  if (existsSync(path.join(docsRoot, name)))
    await cp(path.join(docsRoot, name), path.join(dist, name), { recursive: true });
}
for (const file of SPEC_FILES) {
  await mkdir(path.dirname(path.join(dist, file)), { recursive: true });
  await cp(path.join(docsRoot, file), path.join(dist, file));
}

const reasons = new Map<string, { count: number; example: string }>();
for (const { slug, reason } of skipped) {
  const entry = reasons.get(reason) ?? { count: 0, example: slug };
  entry.count += 1;
  reasons.set(reason, entry);
}
console.log(`\n[docs-site] compiled: ${compiled}, skipped: ${skipped.length}`);
for (const [reason, { count, example }] of [...reasons]
  .toSorted((a, b) => b[1].count - a[1].count)
  .slice(0, 15)) {
  console.log(`  ${count}x ${reason} (e.g. ${example}.mdx)`);
}
await writeFile(path.join(dist, "skipped.json"), JSON.stringify(skipped, null, 2));
if (skipped.length > 0)
  throw new Error(`Documentation rendering failed for ${skipped.length} pages`);
