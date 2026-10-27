/**
 * @see specs/upgrade/stepping.feature
 */
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyRelease } from "../apply-release.ts";
import { writeReleaseDirectory } from "../release-directory.ts";

let scratch: string;
let marker: string;

/** A stand-in for both tools that leaves a marker file, so a test can see whether any tool ran. */
const markingTools = () => ({
  prisma: {
    command: process.execPath,
    args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`],
  },
  goose: process.execPath,
});

async function folder(name: string, sql: string | null): Promise<string> {
  const path = join(scratch, "source", name);
  await mkdir(path, { recursive: true });
  if (sql !== null) await writeFile(join(path, "migration.sql"), sql);
  return path;
}

const toolRan = () =>
  access(marker).then(
    () => true,
    () => false,
  );

const apply = (prismaFolders: readonly string[], signal?: AbortSignal) =>
  applyRelease({
    release: "3.21.0",
    prismaFolders,
    gooseUpTo: 2,
    postgresUrl: "postgresql://unused",
    clickhouseTargets: [{ name: "clickhouse", dsn: "x", table: "x", migrationsDir: scratch }],
    environment: {},
    tools: markingTools(),
    signal,
  });

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "stepping-unit-"));
  marker = join(scratch, "tool-ran");
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("writeReleaseDirectory", () => {
  describe("when two folders lead up to the release", () => {
    /** @scenario "The release directory holds every folder up to the release and the lock file" */
    it("copies both folders and writes a postgresql lock file", async () => {
      const folders = [
        await folder("20260101_a", "SELECT 1;"),
        await folder("20260102_b", "SELECT 2;"),
      ];
      const root = await writeReleaseDirectory({ folders });
      try {
        const entries = (await readdir(join(root, "migrations"))).toSorted();
        expect(entries).toEqual(["20260101_a", "20260102_b", "migration_lock.toml"]);
        expect(await readFile(join(root, "migrations/20260102_b/migration.sql"), "utf8")).toBe(
          "SELECT 2;",
        );
        expect(await readFile(join(root, "migrations/migration_lock.toml"), "utf8")).toContain(
          'provider = "postgresql"',
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });
});

describe("applyRelease", () => {
  describe("when the folder list names the same folder twice", () => {
    /** @scenario "A release whose folder list repeats a folder is refused" */
    it("refuses with duplicate_folder before running any tool", async () => {
      const once = await folder("20260101_a", "SELECT 1;");
      await expect(apply([once, once])).rejects.toMatchObject({ code: "duplicate_folder" });
      expect(await toolRan()).toBe(false);
    });
  });

  describe("when a folder has no migration.sql", () => {
    /** @scenario "A folder without migration.sql is refused" */
    it("refuses with missing_migration_sql before running any tool", async () => {
      const empty = await folder("20260101_a", null);
      await expect(apply([empty])).rejects.toMatchObject({ code: "missing_migration_sql" });
      expect(await toolRan()).toBe(false);
    });
  });

  describe("when the signal is already aborted", () => {
    /** @scenario "An aborted upgrade skips every target" */
    it("skips every target without running a tool", async () => {
      const controller = new AbortController();
      controller.abort();
      const report = await apply([await folder("20260101_a", "SELECT 1;")], controller.signal);
      expect(report.ok).toBe(false);
      expect(report.targets).toEqual([
        { target: "postgres", status: "skipped", reason: "aborted" },
        { target: "clickhouse", status: "skipped", reason: "aborted" },
      ]);
      expect(await toolRan()).toBe(false);
    });
  });
});
