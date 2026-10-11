import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { assertMaterializedAssets } from "../docs-assets.mjs";

describe("Git LFS documentation assets", () => {
  /** @scenario "Build with materialized Git LFS assets" */
  it("rejects a pointer in a nested media directory before publishing a broken asset", async () => {
    const docsRoot = mkdtempSync(path.join(os.tmpdir(), "docs-lfs-"));
    try {
      const directory = path.join(docsRoot, "media/videos");
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        path.join(directory, "tour.webm"),
        `version https://git-lfs.github.com/spec/v1\noid sha256:${"a".repeat(64)}\nsize 1024\n`,
      );
      await expect(assertMaterializedAssets({ docsRoot })).rejects.toThrow(
        "Git LFS asset is not downloaded: media/videos/tour.webm",
      );
    } finally {
      rmSync(docsRoot, { recursive: true, force: true });
    }
  });

  /** @scenario "Build with materialized Git LFS assets" */
  it("rejects an unresolved pointer in the app public directory", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "docs-lfs-"));
    const docsRoot = path.join(root, "docs");
    const publicRoot = path.join(root, "apps/docs/public");
    try {
      mkdirSync(docsRoot, { recursive: true });
      mkdirSync(publicRoot, { recursive: true });
      writeFileSync(
        path.join(publicRoot, "reading.woff2"),
        `version https://git-lfs.github.com/spec/v1\noid sha256:${"a".repeat(64)}\nsize 1024\n`,
      );
      await expect(assertMaterializedAssets({ docsRoot, publicRoot })).rejects.toThrow(
        "Git LFS asset is not downloaded: ../apps/docs/public/reading.woff2",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /** @scenario "Build with materialized Git LFS assets" */
  it("accepts downloaded images, fonts and ordinary source files", async () => {
    const docsRoot = mkdtempSync(path.join(os.tmpdir(), "docs-lfs-"));
    try {
      mkdirSync(path.join(docsRoot, "images"));
      mkdirSync(path.join(docsRoot, "public/fonts"), { recursive: true });
      writeFileSync(
        path.join(docsRoot, "images/hero.png"),
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
      writeFileSync(
        path.join(docsRoot, "public/fonts/reading.woff2"),
        Buffer.from("wOF2downloaded-font"),
      );
      writeFileSync(path.join(docsRoot, "public/fonts/LICENSE.txt"), "Font license");
      await expect(
        assertMaterializedAssets({ docsRoot, publicRoot: path.join(docsRoot, "public") }),
      ).resolves.toBeUndefined();
    } finally {
      rmSync(docsRoot, { recursive: true, force: true });
    }
  });
});
