import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { nowInstant } from "@langwatch/time";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeOutputFiles } from "../output-files.ts";
import { renderCache } from "../render-cache.ts";
import { pageCacheKey, pageRenderKeys, type BundledChunk } from "../render-keys.ts";
import { renderWorkerCount } from "../render-workers.ts";

const GIB = 1024 * 1024 * 1024;
let root = "";
let appRoot = "";
const docsRoot = "/docs";

function installReact({ version }: { version: string }) {
  mkdirSync(path.join(appRoot, "node_modules/react"), { recursive: true });
  writeFileSync(path.join(appRoot, "node_modules/react/package.json"), JSON.stringify({ version }));
}

/* An entry that lazily imports two pages; the guide imports a snippet. File names carry content
   hashes as the bundler writes them, so editing the guide renames its chunk in the entry. */
function bundle({
  guide = "guide body",
  snippet = "snippet body",
  shell = "sidebar",
}: { guide?: string; snippet?: string; shell?: string } = {}): BundledChunk[] {
  const guideFile = `guide-${guide.length}${guide.at(-1)}.js`;
  const snippetFile = `snippet-${snippet.length}${snippet.at(-1)}.js`;
  return [
    {
      fileName: "prerender.js",
      code: `import "react"; ${shell}; import("./${guideFile}"); import("./other-a.js");`,
      isEntry: true,
      imports: ["react"],
      dynamicImports: [guideFile, "other-a.js"],
      moduleIds: ["/app/src/site/prerender.ts", "\0virtual:docs-nav"],
    },
    {
      fileName: guideFile,
      code: `import "./${snippetFile}"; ${guide}`,
      isEntry: false,
      imports: [snippetFile],
      dynamicImports: [],
      moduleIds: ["/docs/guide.mdx"],
    },
    {
      fileName: snippetFile,
      code: snippet,
      isEntry: false,
      imports: [],
      dynamicImports: [],
      moduleIds: ["/docs/snippets/shared.mdx"],
    },
    {
      fileName: "other-a.js",
      code: "other body",
      isEntry: false,
      imports: [],
      dynamicImports: [],
      moduleIds: ["/docs/other.mdx"],
    },
  ];
}

function keys(chunks: BundledChunk[]) {
  return pageRenderKeys({ chunks, slugs: ["guide", "other", "404"], docsRoot, appRoot });
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "docs-render-cache-"));
  appRoot = path.join(root, "apps/docs");
  installReact({ version: "19.0.0" });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("page render keys", () => {
  /** @scenario "Reuse a page rendered from unchanged inputs" */
  it("keeps every key for an unchanged bundle", async () => {
    expect(await keys(bundle())).toEqual(await keys(bundle()));
  });

  /** @scenario "Reuse a page rendered from unchanged inputs" */
  it("re-renders only the edited page, though its chunk is renamed in the entry", async () => {
    const before = await keys(bundle());
    const after = await keys(bundle({ guide: "guide body, edited" }));
    expect(after.guide).not.toBe(before.guide);
    expect(after.other).toBe(before.other);
    expect(after["404"]).toBe(before["404"]);
  });

  /** @scenario "Reuse a page rendered from unchanged inputs" */
  it("re-renders a page whose imported snippet changed", async () => {
    const before = await keys(bundle());
    const after = await keys(bundle({ snippet: "snippet body, edited" }));
    expect(after.guide).not.toBe(before.guide);
    expect(after.other).toBe(before.other);
  });

  /** @scenario "Reuse a page rendered from unchanged inputs" */
  it("re-renders every page when navigation, renderer or a renderer dependency changes", async () => {
    const before = await keys(bundle());
    const navigation = await keys(bundle({ shell: "sidebar with a renamed title" }));
    installReact({ version: "19.0.1" });
    const dependency = await keys(bundle());
    for (const slug of ["guide", "other", "404"]) {
      expect(navigation[slug]).not.toBe(before[slug]);
      expect(dependency[slug]).not.toBe(before[slug]);
    }
  });
});

describe("external workspace packages", () => {
  /** @scenario "Reuse a page rendered from unchanged inputs" */
  it("re-renders when an external workspace package's source changes at the same version", async () => {
    const workspace = path.join(root, "packages/time");
    mkdirSync(path.join(workspace, "src"), { recursive: true });
    writeFileSync(path.join(workspace, "package.json"), JSON.stringify({ version: "0.0.1" }));
    writeFileSync(path.join(workspace, "src/index.ts"), "export const zone = 'UTC';");
    mkdirSync(path.join(appRoot, "node_modules/@langwatch"), { recursive: true });
    symlinkSync(workspace, path.join(appRoot, "node_modules/@langwatch/time"), "dir");
    const chunks = bundle().map((chunk) =>
      chunk.isEntry ? { ...chunk, imports: [...chunk.imports, "@langwatch/time"] } : chunk,
    );
    const before = await keys(chunks);
    writeFileSync(path.join(workspace, "src/index.ts"), "export const zone = 'Europe/Amsterdam';");
    const after = await keys(chunks);
    for (const slug of ["guide", "other", "404"]) expect(after[slug]).not.toBe(before[slug]);
  });
});

describe("installed dependencies", () => {
  /** @scenario "Reuse a page rendered from unchanged inputs" */
  it("re-renders every page when only the lockfile changes", async () => {
    const lockfile = path.join(path.resolve(appRoot, "../.."), "pnpm-lock.yaml");
    writeFileSync(lockfile, "packages:\n  '@shikijs/themes@4.3.0': {}\n");
    const before = await keys(bundle());
    writeFileSync(lockfile, "packages:\n  '@shikijs/themes@4.3.1': {}\n");
    const after = await keys(bundle());
    for (const slug of ["guide", "other", "404"]) expect(after[slug]).not.toBe(before[slug]);
  });

  /** @scenario "Reuse a page rendered from unchanged inputs" */
  it("re-renders when a workspace package an external one depends on changes", async () => {
    const peer = path.join(root, "packages/zones");
    const time = path.join(root, "packages/time");
    for (const [directory, manifest] of [
      [peer, { version: "0.0.1" }],
      [time, { version: "0.0.1", dependencies: { "@langwatch/zones": "workspace:*" } }],
    ] as const) {
      mkdirSync(path.join(directory, "src"), { recursive: true });
      writeFileSync(path.join(directory, "package.json"), JSON.stringify(manifest));
      writeFileSync(path.join(directory, "src/index.ts"), "export {};");
    }
    mkdirSync(path.join(time, "node_modules/@langwatch"), { recursive: true });
    symlinkSync(peer, path.join(time, "node_modules/@langwatch/zones"), "dir");
    mkdirSync(path.join(appRoot, "node_modules/@langwatch"), { recursive: true });
    symlinkSync(time, path.join(appRoot, "node_modules/@langwatch/time"), "dir");
    const chunks = bundle().map((chunk) =>
      chunk.isEntry ? { ...chunk, imports: [...chunk.imports, "@langwatch/time"] } : chunk,
    );
    const before = await keys(chunks);
    writeFileSync(path.join(peer, "src/index.ts"), "export const zone = 'UTC';");
    expect((await keys(chunks)).guide).not.toBe(before.guide);
  });
});

describe("external renderer sources", () => {
  /** @scenario "Reuse a page rendered from unchanged inputs" */
  it("re-renders when a source the bundle imports by absolute path, or its import, changes", async () => {
    const highlight = path.join(root, "highlight.ts");
    const theme = path.join(root, "theme.ts");
    writeFileSync(highlight, 'import "react";\nimport { THEMES } from "./theme.ts";\n');
    writeFileSync(theme, 'export const THEMES = { light: "github-light" };\n');
    const chunks = bundle().map((chunk) =>
      chunk.isEntry ? { ...chunk, imports: [...chunk.imports, highlight] } : chunk,
    );
    const before = await keys(chunks);
    writeFileSync(theme, 'export const THEMES = { light: "github-light-default" };\n');
    const themed = await keys(chunks);
    writeFileSync(highlight, 'import "react";\nimport { THEMES } from "./theme.ts";\n// markup\n');
    const marked = await keys(chunks);
    for (const slug of ["guide", "other", "404"]) {
      expect(themed[slug]).not.toBe(before[slug]);
      expect(marked[slug]).not.toBe(themed[slug]);
    }
  });
});

describe("page cache keys", () => {
  const context = { template: "<html>", islands: "<meta>", nav: { pages: {} }, basePath: "" };

  /** @scenario "Reuse a page rendered from unchanged inputs" */
  it("changes with the page template, island scripts, navigation or base path", () => {
    const pageKey = "a".repeat(64);
    const base = pageCacheKey({ pageKey, context });
    for (const changed of [
      { ...context, template: "<html lang=en>" },
      { ...context, islands: "<meta name=other>" },
      { ...context, nav: { pages: { guide: {} } } },
      { ...context, basePath: "/docs" },
    ])
      expect(pageCacheKey({ pageKey, context: changed })).not.toBe(base);
    expect(pageCacheKey({ pageKey, context: { ...context } })).toBe(base);
  });
});

describe("render cache", () => {
  const key = "a".repeat(64);
  const page = {
    page: "<html>",
    rules: [".a{}"],
    search: { slug: "guide", title: "Guide", section: "Docs", description: "", headings: [] },
  };

  /** @scenario "Reuse a page rendered from unchanged inputs" */
  it("returns what was written under the same key", async () => {
    const cache = renderCache({ directory: path.join(root, "render") });
    await cache.write({ key, page });
    expect(await renderCache({ directory: path.join(root, "render") }).read({ key })).toEqual(page);
  });

  /** @scenario "Reuse a page rendered from unchanged inputs" */
  it("treats a corrupt or tampered entry as a miss", async () => {
    const directory = path.join(root, "render");
    await renderCache({ directory }).write({ key, page });
    const file = path.join(directory, `${key}.json`);
    writeFileSync(file, '{"digest":"0","entry":"{}"}');
    expect(await renderCache({ directory }).read({ key })).toBeNull();
    writeFileSync(file, "not json");
    expect(await renderCache({ directory }).read({ key })).toBeNull();
  });

  /** @scenario "Reuse a page rendered from unchanged inputs" */
  it("treats an entry whose search record is not a search entry as a miss", async () => {
    const directory = path.join(root, "render");
    const entry = JSON.stringify({ page: "<html>", rules: [], search: { slug: "guide" } });
    const digest = createHash("sha256").update(entry).digest("hex");
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, `${key}.json`), JSON.stringify({ digest, entry }));
    expect(await renderCache({ directory }).read({ key })).toBeNull();
  });

  /** @scenario "Reuse a page rendered from unchanged inputs" */
  it("refuses a key that could name a file outside the cache", async () => {
    const cache = renderCache({ directory: path.join(root, "render") });
    await expect(cache.write({ key: "../escape", page })).rejects.toThrow("sha256");
  });

  /** @scenario "Reuse a page rendered from unchanged inputs" */
  it("prunes only entries no build has used for a week", async () => {
    const directory = path.join(root, "render");
    const stale = "b".repeat(64);
    const fresh = "c".repeat(64);
    await renderCache({ directory }).write({ key: stale, page });
    await renderCache({ directory }).write({ key: fresh, page });
    const eightDaysAgo = (nowInstant().epochMilliseconds - 8 * 24 * 60 * 60 * 1000) / 1000;
    utimesSync(path.join(directory, `${stale}.json`), eightDaysAgo, eightDaysAgo);
    const cache = renderCache({ directory });
    await cache.write({ key, page });
    await cache.prune();
    expect(readdirSync(directory).toSorted()).toEqual([`${key}.json`, `${fresh}.json`]);
  });

  /** @scenario "Reuse a page rendered from unchanged inputs" */
  it("never writes an output file outside the build directory", async () => {
    const files = new Map([["../outside.html", "x"]]);
    await expect(writeOutputFiles({ root: path.join(root, "dist"), files })).rejects.toThrow(
      "escapes",
    );
  });
});

describe("renderer threads", () => {
  /** @scenario "Render pages on a bounded number of workers" */
  it("uses at most four, leaves a core free and fits free memory", () => {
    expect(renderWorkerCount({ cores: 10, free: 32 * GIB })).toBe(4);
    expect(renderWorkerCount({ cores: 3, free: 32 * GIB })).toBe(2);
    expect(renderWorkerCount({ cores: 10, free: 2 * GIB })).toBe(2);
    expect(renderWorkerCount({ cores: 10, free: GIB / 4 })).toBe(1);
    expect(renderWorkerCount({ requested: 2, cores: 10, free: 32 * GIB })).toBe(2);
    expect(renderWorkerCount({ requested: 16, cores: 10, free: 32 * GIB })).toBe(4);
  });
});
