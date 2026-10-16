import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeServiceWorker } from "../service-worker.ts";

let root = "";

/** A finished build's files, before the worker is generated, with one search index. */
function stageBuild({ searchIndex }: { searchIndex: string }) {
  const outDir = path.join(root, `out-${searchIndex.length}`);
  mkdirSync(path.join(outDir, "fonts"), { recursive: true });
  writeFileSync(path.join(outDir, "fonts/Inter-Variable-latin.woff2"), "latin");
  writeFileSync(path.join(outDir, "fonts/Inter-Variable-latin-ext.woff2"), "latin-ext");
  writeFileSync(path.join(outDir, "search-index.json"), searchIndex);
  return outDir;
}

async function versionOf({ searchIndex }: { searchIndex: string }) {
  const outDir = stageBuild({ searchIndex });
  const page = '<html><head><meta name="docs-build" content="manifest"></head></html>';
  await writeServiceWorker({ outDir, pages: new Map([["index.html", page]]) });
  const html = readFileSync(path.join(outDir, "index.html"), "utf8");
  return /name="docs-build" content="([^"]+)"/.exec(html)?.[1];
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "docs-service-worker-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("offline cache version", () => {
  /** @scenario "Update an offline cache safely" */
  it("moves when only the search index changes, so an old index is never kept", async () => {
    const before = await versionOf({ searchIndex: '[{"slug":"a"}]' });
    const after = await versionOf({ searchIndex: '[{"slug":"a","body":"new"}]' });
    expect(before).toMatch(/^[0-9a-f]{16}$/);
    expect(after).not.toBe(before);
  });
});
