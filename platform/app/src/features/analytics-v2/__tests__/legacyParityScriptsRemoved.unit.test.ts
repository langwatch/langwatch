/**
 * The legacy parity scripts folder (`platform/app/scripts/legacy-parity-widgets`)
 * is not a product surface — it was the scratch space the nine Analytics v2
 * widgets were prototyped in before they moved in-app. The feature deletes
 * it in the same change, so nothing in the repository should reference it
 * any more, and the starter-dashboard seed manifest — the one other script
 * that named files inside it — must resolve every widget it lists from
 * somewhere else.
 *
 * @see specs/analytics/analytics-v2.feature
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const THIS_FILE = fileURLToPath(import.meta.url);

/** Walk upward from this file until a repo-root marker is found. */
function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 20; i++) {
    if (
      fs.existsSync(path.join(dir, "pnpm-workspace.yaml")) ||
      fs.existsSync(path.join(dir, ".git"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not find repo root walking up from ${startDir}`);
}

const REPO_ROOT = findRepoRoot(path.dirname(THIS_FILE));
const LEGACY_FOLDER = path.join(
  REPO_ROOT,
  "platform/app/scripts/legacy-parity-widgets",
);
const SEED_MANIFEST_FILE = path.join(
  REPO_ROOT,
  "platform/app/scripts/starter-dashboard/seed.mjs",
);
const FEATURE_FILE = path.join(
  REPO_ROOT,
  "specs/analytics/analytics-v2.feature",
);

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  "build",
  "coverage",
]);
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB
const NEEDLE = "legacy-parity-widgets";

/**
 * Every file path under `dir` that contains `needle`, skipping binary-ish
 * concerns (skip dirs, oversized files) and the two paths that are allowed
 * to mention the deleted folder by name: this test file itself (it has to
 * name the folder to assert its absence) and the feature file (history of
 * the change, not a live reference).
 */
function findReferences({
  dir,
  needle,
  exclude,
}: {
  dir: string;
  needle: string;
  exclude: Set<string>;
}): string[] {
  const hits: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (exclude.has(full)) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      hits.push(...findReferences({ dir: full, needle, exclude }));
      continue;
    }
    if (!entry.isFile()) continue;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.size > MAX_FILE_BYTES) continue;
    let content: string;
    try {
      content = fs.readFileSync(full, "utf-8");
    } catch {
      // Not a text file (binary) — cannot contain the needle in a
      // meaningful way for this check.
      continue;
    }
    if (content.includes(needle)) hits.push(full);
  }
  return hits;
}

describe("the legacy parity scripts folder", () => {
  /** @scenario "The legacy parity scripts folder is gone and nothing references it" */
  it("does not exist on disk", () => {
    expect(fs.existsSync(LEGACY_FOLDER)).toBe(false);
  });

  describe("given a walk of the whole repository", () => {
    /** @scenario "The legacy parity scripts folder is gone and nothing references it" */
    it("finds no remaining reference to legacy-parity-widgets", () => {
      const hits = findReferences({
        dir: REPO_ROOT,
        needle: NEEDLE,
        exclude: new Set([THIS_FILE, FEATURE_FILE]),
      });
      expect(hits, `unexpected references: ${hits.join(", ")}`).toEqual([]);
    });
  });
});

describe("the starter dashboard seed manifest", () => {
  const manifestText = fs.readFileSync(SEED_MANIFEST_FILE, "utf-8");
  const entryPattern = /\{\s*pack:\s*"([^"]+)"\s*,\s*file:\s*"([^"]+)"\s*\}/g;
  const entries = [...manifestText.matchAll(entryPattern)].map((m) => ({
    pack: m[1] as string,
    file: m[2] as string,
  }));

  /** @scenario "The starter dashboard seed still resolves every widget file" */
  it("lists exactly eight widget entries", () => {
    expect(entries).toHaveLength(8);
  });

  describe("given each listed widget file", () => {
    /** @scenario "The starter dashboard seed still resolves every widget file" */
    it("resolves to a file that exists on disk", () => {
      for (const entry of entries) {
        const resolved = path.join(
          REPO_ROOT,
          "platform/app/scripts",
          entry.pack,
          entry.file,
        );
        expect(
          fs.existsSync(resolved),
          `${entry.pack}/${entry.file} does not exist at ${resolved}`,
        ).toBe(true);
      }
    });

    /** @scenario "The starter dashboard seed still resolves every widget file" */
    it("names no widget living in the deleted legacy-parity-widgets pack", () => {
      for (const entry of entries) {
        expect(entry.pack).not.toBe("legacy-parity-widgets");
      }
    });
  });
});
