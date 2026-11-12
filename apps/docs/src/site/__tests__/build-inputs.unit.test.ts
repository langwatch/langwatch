import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { nowInstant } from "@langwatch/time";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildFingerprint, buildRecords } from "../build-inputs.ts";

let root = "";
let appRoot = "";
let docsRoot = "";

function fingerprint({ outDir = path.join(root, "out") }: { outDir?: string } = {}) {
  return buildFingerprint({ appRoot, docsRoot, outDir, options: { basePath: "" } });
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "docs-build-inputs-"));
  appRoot = path.join(root, "apps/docs");
  docsRoot = path.join(root, "docs");
  mkdirSync(path.join(appRoot, "node_modules/.cache"), { recursive: true });
  mkdirSync(docsRoot, { recursive: true });
  writeFileSync(path.join(appRoot, "package.json"), "{}");
  writeFileSync(path.join(docsRoot, "guide.mdx"), "# Guide");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("whole-build fingerprint", () => {
  /** @scenario "Reuse a page rendered from unchanged inputs" */
  it("changes when a source changes, even with its modification time kept", async () => {
    const file = path.join(docsRoot, "guide.mdx");
    const before = await fingerprint();
    const { atime, mtime } = statSync(file);
    writeFileSync(file, "# Gyde");
    utimesSync(file, atime, mtime);
    expect(await fingerprint()).not.toBe(before);
  });

  /** @scenario "Reuse a page rendered from unchanged inputs" */
  it("changes when the repository release notes change with their time kept", async () => {
    const changelog = path.join(root, "CHANGELOG.md");
    writeFileSync(changelog, "## 1.0.0");
    const before = await fingerprint();
    const { atime, mtime } = statSync(changelog);
    writeFileSync(changelog, "## 1.0.1");
    utimesSync(changelog, atime, mtime);
    expect(await fingerprint()).not.toBe(before);
  });

  /** @scenario "Reuse a page rendered from unchanged inputs" */
  it("never reads its own output directory, wherever it is", async () => {
    const outDir = path.join(appRoot, "preview-build");
    mkdirSync(outDir);
    const before = await fingerprint({ outDir });
    writeFileSync(path.join(outDir, "index.html"), "x");
    expect(await fingerprint({ outDir })).toBe(before);
  });

  /** @scenario "Reuse a page rendered from unchanged inputs" */
  it("ignores build output and caches inside the app", async () => {
    const before = await fingerprint();
    writeFileSync(path.join(appRoot, "node_modules/.cache/staged.html"), "x");
    mkdirSync(path.join(appRoot, "dist"));
    writeFileSync(path.join(appRoot, "dist/index.html"), "x");
    expect(await fingerprint()).toBe(before);
  });

  /** @scenario "Reuse a page rendered from unchanged inputs" */
  it("recognises a staged build renamed into place, not an added or corrupted file", async () => {
    const records = buildRecords({ cacheDir: path.join(root, "records") });
    const staged = path.join(root, "staged");
    const live = path.join(root, "live");
    mkdirSync(staged);
    writeFileSync(path.join(staged, "index.html"), "<html>");
    const current = await fingerprint();
    await records.save({ fingerprint: current, outDir: staged });
    renameSync(staged, live);
    expect(await records.isCurrent({ fingerprint: current, outDir: live })).toBe(true);
    writeFileSync(path.join(live, "link-report.json"), "{}");
    expect(await records.isCurrent({ fingerprint: current, outDir: live })).toBe(true);
    writeFileSync(path.join(live, "index.html"), "<html>");
    writeFileSync(path.join(live, "extra.html"), "added");
    expect(await records.isCurrent({ fingerprint: current, outDir: live })).toBe(false);
    rmSync(path.join(live, "extra.html"));
    writeFileSync(path.join(live, "index.html"), "<htm!>");
    expect(await records.isCurrent({ fingerprint: current, outDir: live })).toBe(false);
  });

  /** @scenario "Reuse a page rendered from unchanged inputs" */
  it("treats a corrupt record as a build that is needed", async () => {
    const cacheDir = path.join(root, "records");
    const outDir = path.join(root, "out");
    mkdirSync(outDir);
    const current = await fingerprint();
    await buildRecords({ cacheDir }).save({ fingerprint: current, outDir });
    writeFileSync(path.join(cacheDir, `${current}.json`), "{ not json");
    expect(await buildRecords({ cacheDir }).isCurrent({ fingerprint: current, outDir })).toBe(
      false,
    );
  });

  /** @scenario "Reuse a page rendered from unchanged inputs" */
  it("keeps recent records and survives builds saving and pruning at the same time", async () => {
    const cacheDir = path.join(root, "records");
    mkdirSync(cacheDir);
    const twoHoursAgo = (nowInstant().epochMilliseconds - 2 * 60 * 60 * 1000) / 1000;
    for (let index = 0; index < 12; index += 1) {
      const file = path.join(cacheDir, `${String(index).padStart(64, "0")}.json`);
      writeFileSync(file, "{}");
      utimesSync(file, twoHoursAgo - index, twoHoursAgo - index);
    }
    const outDir = path.join(root, "out");
    mkdirSync(outDir);
    writeFileSync(path.join(outDir, "index.html"), "<html>");
    const fingerprints = ["a", "b", "c", "d"].map((letter) => letter.repeat(64));
    await Promise.all(
      fingerprints.map((fingerprint) => buildRecords({ cacheDir }).save({ fingerprint, outDir })),
    );
    const left = readdirSync(cacheDir);
    expect(left).toHaveLength(8);
    for (const fingerprint of fingerprints) expect(left).toContain(`${fingerprint}.json`);
  });
});
