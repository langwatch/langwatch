import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, workerData } from "node:worker_threads";

import { z } from "zod";

import { render } from "../app/entry-server.tsx";
import { SPEC_FILES } from "../features/api-reference/compile/openapi.ts";
import {
  discoveryFiles,
  llmsFull,
  PAGE_EXPORT_EXTENSIONS,
} from "../features/discovery/compile/discovery-files.ts";
import { pageLastModified } from "../features/discovery/compile/last-modified.ts";
import { pageMarkdown } from "../features/discovery/compile/markdown-export.ts";
import { breadcrumbTrail, pageHead } from "../features/discovery/compile/page-head.ts";
import { buildNav } from "../features/navigation/compile/nav.ts";
import {
  isStaticRedirect,
  readRedirects,
  redirectPage,
  redirectTarget,
} from "../features/navigation/compile/redirects.ts";
import type { Nav } from "../features/navigation/model/nav.ts";
import { searchEntry } from "../features/search/compile/search-index.ts";
import { publicSlug, withBasePath } from "../lib/site-path.ts";
import { docsRoot, readBuildOptions } from "../paths.ts";
import { compressedSearchIndex } from "./compressed-index.ts";
import {
  composeDocument,
  islandHead,
  NOT_FOUND_HEAD,
  pageTargets,
  STATIC_DIRS,
  STATIC_FILES,
  extractStyles,
} from "./document.ts";
import { writeOutputFiles } from "./output-files.ts";
import { renderCache, renderedPageSchema, type RenderedPage } from "./render-cache.ts";
import {
  pageCacheKey,
  PRERENDER_PLAN_FILE,
  prerenderPlanSchema,
  type PrerenderPlan,
} from "./render-keys.ts";
import { renderWorkerCount, runOnWorkers, type WorkerOutcome } from "./render-workers.ts";
import { writeServiceWorker } from "./service-worker.ts";

/* Runs as the SSR bundle (see build.ts) after the client build. The main thread reads one
   build context, renders pages on worker threads of this same bundle (or reuses them from the
   render cache), then writes every output file once, beside the client's hashed assets. */
const STYLE_PLACEHOLDER = "/assets/prerender.css";
const HERO_PRELOAD = ({ site }: { site: (path: string) => string }) =>
  `<link rel="preload" as="image" href="${site("/images/coding-agents/optimized/session-detail-1024.webp")}" imagesrcset="${site("/images/coding-agents/optimized/session-detail-640.webp")} 640w, ${site("/images/coding-agents/optimized/session-detail-1024.webp")} 1024w, ${site("/images/coding-agents/optimized/session-detail-1560.webp")} 1560w" imagesizes="(min-width: 1280px) calc(100vw - 620px), (min-width: 1024px) calc(100vw - 380px), calc(100vw - 40px)">`;
const manifestSchema = z.record(
  z.string(),
  z.looseObject({ file: z.string(), name: z.string().optional(), isEntry: z.boolean().optional() }),
);

/** The one immutable context every page task reads. */
type RenderContext = { template: string; islands: string; nav: Nav; basePath: string };

async function renderPage({
  slug,
  context,
}: {
  slug: string;
  context: RenderContext;
}): Promise<RenderedPage> {
  const { template, islands, nav, basePath } = context;
  const site = (sitePath: string) => withBasePath({ basePath, path: sitePath });
  const styleLink = `<link data-docs-style rel="stylesheet" href="${STYLE_PLACEHOLDER}">`;
  const result = await render({ slug });
  const styled = extractStyles({ html: result.html });
  if (slug === "404") {
    const page = composeDocument({
      template,
      islands,
      head: `${NOT_FOUND_HEAD}${styleLink}`,
      app: styled.html,
      slug,
      operation: null,
    });
    return { page, rules: styled.rules, search: null };
  }
  const { html, title, description, operation, headings } = result;
  const preload = slug === "coding-agents/overview" ? HERO_PRELOAD({ site }) : "";
  const page = composeDocument({
    template,
    islands,
    head: `${preload}${pageHead({ slug, title, description, trail: breadcrumbTrail({ sections: nav.anchors, slug, title }) })}${styleLink}`,
    app: styled.html,
    slug,
    operation,
  });
  return { page, rules: styled.rules, search: searchEntry({ nav, slug, html, headings }) };
}

/** A worker thread: renders each slug it is sent with the context it was started with. */
function serveRenders() {
  const context = workerData as RenderContext;
  parentPort?.on("message", async ({ index, job }: { index: number; job: string }) => {
    try {
      parentPort?.postMessage({ index, result: await renderPage({ slug: job, context }) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      parentPort?.postMessage({ index, error: message.split("\n")[0] });
    }
  });
}

/** The plan build.ts wrote beside this bundle; none when the bundle runs on its own. */
function readPlan(): PrerenderPlan {
  const file = fileURLToPath(new URL(PRERENDER_PLAN_FILE, import.meta.url));
  if (!existsSync(file)) return { keys: {}, cacheDir: null };
  return prerenderPlanSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

type Outcome = WorkerOutcome<RenderedPage>;

/** The build context: client manifest islands, the page template and the navigation. */
async function readContext({ dist, basePath }: { dist: string; basePath: string }) {
  const manifestText = await readFile(path.join(dist, ".vite/manifest.json"), "utf8");
  const sources = Object.fromEntries(
    Object.values(manifestSchema.parse(JSON.parse(manifestText)))
      .filter((entry) => entry.isEntry && entry.name && entry.name !== "index")
      .map((entry) => [entry.name, withBasePath({ basePath, path: `/${entry.file}` })]),
  );
  const islands = islandHead({
    sources,
    build: createHash("sha256").update(manifestText).digest("hex").slice(0, 16),
  });
  const template = await readFile(path.join(dist, "index.html"), "utf8");
  const context: RenderContext = { template, islands, nav: buildNav({ docsRoot }), basePath };
  return context;
}

/** Each slug's outcome, reused from the cache when its key matches, else rendered on workers. */
async function renderAll({
  slugs,
  context,
  plan,
}: {
  slugs: string[];
  context: RenderContext;
  plan: PrerenderPlan;
}) {
  const keyOf = (slug: string) => {
    const pageKey = plan.keys[slug];
    return pageKey ? pageCacheKey({ pageKey, context: { context, STYLE_PLACEHOLDER } }) : null;
  };
  const cache = renderCache({ directory: plan.cacheDir });
  const outcomes = new Map<string, Outcome>();
  for (const slug of slugs) {
    const key = keyOf(slug);
    const hit = key ? await cache.read({ key }) : null;
    if (hit) outcomes.set(slug, { result: hit });
  }
  const pending = slugs.filter((slug) => !outcomes.has(slug));
  const workers = Math.min(renderWorkerCount({ requested: plan.workers }), pending.length);
  const rendered = await runOnWorkers({
    script: new URL(import.meta.url),
    workerData: context,
    jobs: pending,
    workers,
    parseResult: (value) => renderedPageSchema.parse(value),
  });
  for (const [index, slug] of pending.entries()) {
    const outcome = rendered[index];
    outcomes.set(slug, outcome);
    const key = keyOf(slug);
    if (key && "result" in outcome) await cache.write({ key, page: outcome.result });
  }
  await cache.prune();
  return { outcomes, reused: slugs.length - pending.length, rendered: pending.length, workers };
}

/* Pages, exports, search entries and one stylesheet, all in navigation order, so the output is
   the same however the pages were split across workers or taken from the cache. */
function assemble({ slugs, outcomes }: { slugs: string[]; outcomes: Map<string, Outcome> }) {
  const styles = new Set<string>();
  const pages = new Map<string, string>();
  const files = new Map<string, string | Uint8Array>();
  const searchIndex: unknown[] = [];
  const markdown: string[] = [];
  const skipped: { slug: string; reason: string }[] = [];
  for (const slug of slugs) {
    const outcome = outcomes.get(slug) ?? { error: "not rendered" };
    if ("error" in outcome) {
      skipped.push({ slug, reason: `render: ${outcome.error}` });
      continue;
    }
    for (const rule of outcome.result.rules) styles.add(rule);
    if (outcome.result.search) searchIndex.push(outcome.result.search);
    const exported = exportsOf({ slug });
    for (const [name, contents] of exported) files.set(name, contents);
    if (exported.length > 0) markdown.push(exported[0][1]);
    for (const target of slug === "404" ? ["404.html"] : pageTargets({ slug }))
      pages.set(target, outcome.result.page);
  }
  return { styles: [...styles], pages, files, searchIndex, markdown, skipped };
}

/** A page's Markdown exports; the home page is also exported at the root. */
function exportsOf({ slug }: { slug: string }): [string, string][] {
  if (slug === "404") return [];
  const markdown = pageMarkdown({ docsRoot, slug });
  const names =
    slug === "introduction" ? [slug, "index"] : [...new Set([slug, publicSlug({ slug })])];
  return names.flatMap((name) =>
    PAGE_EXPORT_EXTENSIONS.map((extension): [string, string] => [`${name}.${extension}`, markdown]),
  );
}

/** Static redirect pages, except where a configured page already publishes the same path. */
function redirectPages({
  dist,
  redirects,
  pages,
}: {
  dist: string;
  redirects: Record<string, string>;
  pages: Map<string, string>;
}) {
  for (const [source, destination] of Object.entries(redirects)) {
    const target = redirectTarget({ source });
    const published = pages.has(target) || existsSync(path.join(dist, target));
    if (!published && isStaticRedirect({ source }))
      pages.set(target, redirectPage({ destination }));
  }
}

async function copySources({ dist }: { dist: string }) {
  for (const name of [...STATIC_DIRS, ...STATIC_FILES]) {
    if (existsSync(path.join(docsRoot, name)))
      await cp(path.join(docsRoot, name), path.join(dist, name), { recursive: true });
  }
  for (const file of SPEC_FILES) {
    await mkdir(path.dirname(path.join(dist, file)), { recursive: true });
    await cp(path.join(docsRoot, file), path.join(dist, file));
  }
}

function reportSkipped({ skipped }: { skipped: { slug: string; reason: string }[] }) {
  const reasons = new Map<string, { count: number; example: string }>();
  for (const { slug, reason } of skipped) {
    const entry = reasons.get(reason) ?? { count: 0, example: slug };
    entry.count += 1;
    reasons.set(reason, entry);
  }
  for (const [reason, { count, example }] of [...reasons]
    .toSorted((a, b) => b[1].count - a[1].count)
    .slice(0, 15)) {
    console.log(`  ${count}x ${reason} (e.g. ${example}.mdx)`);
  }
}

async function generate() {
  const started = performance.now();
  const { outDir: dist, basePath } = readBuildOptions();
  const context = await readContext({ dist, basePath });
  /* Every configured page in navigation order, then the 404 page. */
  const slugs = [...Object.keys(context.nav.pages), "404"];
  const plan = readPlan();
  const run = await renderAll({ slugs, context, plan });
  const renderedAt = performance.now();
  const { styles, pages, files, searchIndex, markdown, skipped } = assemble({
    slugs,
    outcomes: run.outcomes,
  });
  const notFound = skipped.find((entry) => entry.slug === "404");
  if (notFound) throw new Error(`The 404 page failed to render: ${notFound.reason}`);

  const redirects = readRedirects({ docsRoot });
  files.set("redirects.json", JSON.stringify(redirects));
  for (const [name, contents] of Object.entries(
    discoveryFiles({
      nav: context.nav,
      lastModified: pageLastModified({ docsRoot }),
    }),
  ))
    files.set(name, contents);
  files.set("llms-full.txt", llmsFull({ nav: context.nav, exports: markdown }));
  const searchJson = JSON.stringify(searchIndex);
  files.set("search-index.json", searchJson);
  for (const [name, contents] of await compressedSearchIndex({
    json: searchJson,
    cacheDir: plan.cacheDir ? path.join(path.dirname(plan.cacheDir), "compressed") : null,
  }))
    files.set(name, contents);
  const css = styles.join("\n");
  const cssFile = `assets/prerender-${createHash("sha256").update(css).digest("hex").slice(0, 16)}.css`;
  files.set(cssFile, css);
  const cssHref = withBasePath({ basePath, path: `/${cssFile}` });
  for (const [target, page] of pages) pages.set(target, page.replace(STYLE_PLACEHOLDER, cssHref));
  redirectPages({ dist, redirects, pages });
  files.set("skipped.json", JSON.stringify(skipped, null, 2));
  await writeOutputFiles({ root: dist, files });
  await copySources({ dist });

  const seconds = ((renderedAt - started) / 1000).toFixed(1);
  console.log(
    `\n[docs-site] compiled: ${slugs.length - 1 - skipped.length}, skipped: ${skipped.length}, reused: ${run.reused}, rendered: ${run.rendered} on ${run.workers} workers in ${seconds}s`,
  );
  reportSkipped({ skipped });
  if (skipped.length > 0)
    throw new Error(`Documentation rendering failed for ${skipped.length} pages`);
  await writeServiceWorker({ outDir: dist, basePath, pages });
}

if (isMainThread) await generate();
else serveRenders();
