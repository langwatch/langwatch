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

import { execFileSync } from "node:child_process";
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

const NEEDLE = "legacy-parity-widgets";

/**
 * Every tracked file that contains `needle`, found with `git grep` over the
 * repository (fast, respects .gitignore, tracks only committed/staged files),
 * minus the two paths allowed to mention the deleted folder by name: this
 * test file itself (it has to name the folder to assert its absence) and the
 * feature file (history of the change, not a live reference). `git grep`
 * exits 1 when nothing matches, which is the clean "no references" case.
 */
function findReferences({
  needle,
  exclude,
}: {
  needle: string;
  exclude: Set<string>;
}): string[] {
  let output: string;
  try {
    output = execFileSync("git", ["grep", "-l", "-F", needle], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    });
  } catch (err) {
    if ((err as { status?: number }).status === 1) return [];
    throw err;
  }
  return output
    .split("\n")
    .filter((line) => line.length > 0)
    .map((rel) => path.join(REPO_ROOT, rel))
    .filter((full) => !exclude.has(full));
}

/** Every file path under `dir`, recursively; `[]` when `dir` does not exist. */
function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
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
        needle: NEEDLE,
        exclude: new Set([THIS_FILE, FEATURE_FILE]),
      });
      expect(hits, `unexpected references: ${hits.join(", ")}`).toEqual([]);
    });
  });
});

describe("reverting the Analytics v2 change", () => {
  const V2_SOURCE_DIRS = [
    path.join(REPO_ROOT, "platform/app/src/features/analytics-v2"),
    path.join(REPO_ROOT, "platform/app/src/pages/[project]/analytics-v2"),
  ];
  // A read path into any of these would mean the page touches stored data,
  // so reverting it could no longer be a pure code revert.
  const FORBIDDEN_DATA_IMPORTS = [
    "~/server/db",
    "@prisma/client",
    "~/server/clickhouse",
    "~/server/analytics/lwql/provisioning",
  ];
  const PRISMA_MIGRATIONS = path.join(
    REPO_ROOT,
    "platform/app/prisma/migrations",
  );
  const CLICKHOUSE_MIGRATIONS = path.join(
    REPO_ROOT,
    "platform/app/src/server/clickhouse/migrations",
  );
  const MIGRATION_TOKENS = ["analytics-v2", "analytics_v2"];

  /** @scenario "Reverting the change needs no data migration" */
  it("reads no stored data — the Analytics v2 source imports no database, ClickHouse, or provisioning module", () => {
    const offenders: string[] = [];
    for (const dir of V2_SOURCE_DIRS) {
      for (const file of filesUnder(dir)) {
        if (file.includes(`${path.sep}__tests__${path.sep}`)) continue;
        const content = fs.readFileSync(file, "utf-8");
        for (const token of FORBIDDEN_DATA_IMPORTS) {
          if (content.includes(token)) offenders.push(`${file} -> ${token}`);
        }
      }
    }
    expect(
      offenders,
      `unexpected data-layer imports: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  /** @scenario "Reverting the change needs no data migration" */
  it("adds no migration — no Prisma or ClickHouse migration mentions analytics-v2", () => {
    const offenders: string[] = [];
    for (const file of [
      ...filesUnder(PRISMA_MIGRATIONS),
      ...filesUnder(CLICKHOUSE_MIGRATIONS),
    ]) {
      // Use relative path so the worktree directory name (e.g., issue8296-analytics-v2-page) cannot match
      const rel = path.relative(REPO_ROOT, file);
      const haystack = `${rel}\n${fs.readFileSync(file, "utf-8")}`;
      for (const token of MIGRATION_TOKENS) {
        if (haystack.includes(token)) offenders.push(`${rel} -> ${token}`);
      }
    }
    expect(
      offenders,
      `unexpected migration references: ${offenders.join(", ")}`,
    ).toEqual([]);
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
