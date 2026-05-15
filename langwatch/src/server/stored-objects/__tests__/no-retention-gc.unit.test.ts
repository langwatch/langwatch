/**
 * @vitest-environment node
 *
 * Negative regression test for AC16:
 *   "No automatic retention, time-based GC, or orphan reaping runs"
 *
 * Asserts that no file under langwatch/src/server/background/ (the home
 * of all scheduled workers and queues) references the string "stored_objects"
 * in a way that would imply a background purge, GC, or retention job is
 * running against the stored_objects table.
 *
 * WHY: The RFC explicitly forbids automatic time-based deletion. This test
 * codifies that contract as a regression net so that any future engineer who
 * adds a scheduled job touching stored_objects must update this test, which
 * forces a deliberate review of the AC16 constraint.
 *
 * Excluded from the scan:
 *  - test files (*.test.ts, *.spec.ts) — tests are allowed to reference the
 *    table name for assertions
 *  - migration files — DDL is not a scheduled job
 *  - the stored-objects module itself (src/server/stored-objects/) — service
 *    code referencing the table name is expected
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "../../../../");

/** Returns all .ts files under `dir`, recursively, excluding test files. */
function findSourceFiles(dir: string): string[] {
  const results: string[] = [];

  function walk(current: string) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (
        entry.isFile() &&
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".test.ts") &&
        !entry.name.endsWith(".spec.ts")
      ) {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("AC16 — no automatic retention, GC, or orphan reaping for stored_objects", () => {
  describe("when the background worker directory is scanned for stored_objects references", () => {
    /** @scenario "No automatic retention, time-based GC, or orphan reaping runs" */
    it("finds no background job that references stored_objects", () => {
      const backgroundDir = path.join(REPO_ROOT, "src/server/background");
      const sourceFiles = findSourceFiles(backgroundDir);

      const offendingFiles = sourceFiles.filter((filePath) => {
        const content = fs.readFileSync(filePath, "utf8");
        return /stored_objects/i.test(content);
      });

      // If this assertion fails, a new background job references stored_objects.
      // Before adding such a job, review AC16 in the RFC and update this test
      // to explicitly allow the reference with a clear rationale.
      // AC16 forbids automatic retention, time-based GC, or orphan reaping.
      const offendingPaths = offendingFiles.map((f) =>
        path.relative(REPO_ROOT, f),
      );
      expect(offendingPaths).toEqual([]);
    });
  });

  describe("when the queue definitions are scanned for stored_objects references", () => {
    it("finds no queue that enqueues stored_objects GC work", () => {
      const queuesDir = path.join(REPO_ROOT, "src/server/background/queues");
      const sourceFiles = findSourceFiles(queuesDir);

      const offendingFiles = sourceFiles.filter((filePath) => {
        const content = fs.readFileSync(filePath, "utf8");
        return /stored_objects/i.test(content);
      });

      // AC16 forbids automatic retention GC queues for stored_objects.
      const offendingPaths = offendingFiles.map((f) =>
        path.relative(REPO_ROOT, f),
      );
      expect(offendingPaths).toEqual([]);
    });
  });
});
