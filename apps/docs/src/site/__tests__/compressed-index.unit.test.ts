import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { compressedSearchIndex } from "../compressed-index.ts";

let root = "";
const json = JSON.stringify([{ slug: "guide", title: "Guide", body: "word ".repeat(200) }]);

function decoded({ files }: { files: [string, Uint8Array][] }) {
  const byName = new Map(files);
  return {
    brotli: zlib.brotliDecompressSync(byName.get("search-index.json.br") ?? new Uint8Array()),
    gzip: zlib.gunzipSync(byName.get("search-index.json.gz") ?? new Uint8Array()),
  };
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "docs-compressed-index-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("precompressed search index", () => {
  /** @scenario "Build all configured documentation" */
  it("writes Brotli and gzip copies that decode to the published index", async () => {
    const { brotli, gzip } = decoded({
      files: await compressedSearchIndex({ json, cacheDir: null }),
    });
    expect(brotli.toString()).toBe(json);
    expect(gzip.toString()).toBe(json);
  });

  /** @scenario "Reuse a page rendered from unchanged inputs" */
  it("reuses a cached encoding and re-encodes a corrupt one", async () => {
    const cacheDir = path.join(root, "compressed");
    const first = await compressedSearchIndex({ json, cacheDir });
    expect(readdirSync(cacheDir).toSorted()).toHaveLength(2);
    for (const name of readdirSync(cacheDir)) writeFileSync(path.join(cacheDir, name), "corrupt");
    const second = await compressedSearchIndex({ json, cacheDir });
    expect(second).toEqual(first);
    expect(decoded({ files: second }).brotli.toString()).toBe(json);
  });
});
