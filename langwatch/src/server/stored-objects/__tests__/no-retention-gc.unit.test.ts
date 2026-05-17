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

/**
 * Directories we scan for "stored_objects" references that would imply
 * an automatic purge / retention / GC job. We deliberately go wider than
 * /server/background because a purge can also be triggered from a tRPC
 * router (project archive flow), a scenario lifecycle hook, or any other
 * scheduler.
 *
 * Note: each entry is allowed to mention "stored_objects" if the file
 * path is in the allowlist below — that's where the documented surface
 * lives.
 */
const SCAN_DIRS: readonly string[] = [
  "src/server/background",
  "src/server/api/routers",
  "src/server/scenarios",
];

/**
 * Paths where mentions of `stored_objects` are expected and reviewed.
 * Anything outside the allowlist that references the table is flagged.
 */
const SCAN_ALLOWLIST = /^src\/server\/stored-objects\//;

function findOffendingStoredObjectsRefs(absDir: string): string[] {
  const files = findSourceFiles(absDir);
  return files
    .filter((filePath) => /stored_objects/i.test(fs.readFileSync(filePath, "utf8")))
    .map((f) => path.relative(REPO_ROOT, f))
    .filter((rel) => !SCAN_ALLOWLIST.test(rel));
}

describe("AC16 — no automatic retention, GC, or orphan reaping for stored_objects", () => {
  describe("when the background worker, tRPC routers, and scenarios trees are scanned for stored_objects references", () => {
    /** @scenario "No automatic retention, time-based GC, or orphan reaping runs" */
    it("finds no scheduler that references stored_objects", () => {
      const offending: string[] = [];
      for (const dir of SCAN_DIRS) {
        const abs = path.join(REPO_ROOT, dir);
        offending.push(...findOffendingStoredObjectsRefs(abs));
      }
      // If this assertion fails, something outside the stored-objects
      // module references stored_objects. Before adding such a reference,
      // review AC16 in the RFC and either:
      //   - confirm the reference is NOT a retention/GC/orphan-reaper, then
      //     update SCAN_ALLOWLIST with a one-line rationale, or
      //   - delete the reference.
      // AC16 forbids automatic retention, time-based GC, or orphan reaping.
      expect(offending).toEqual([]);
    });
  });

  describe("when the queue definitions are scanned for stored_objects references", () => {
    it("finds no queue that enqueues stored_objects GC work", () => {
      const queuesDir = path.join(REPO_ROOT, "src/server/background/queues");
      const offending = findOffendingStoredObjectsRefs(queuesDir);
      expect(offending).toEqual([]);
    });
  });
});
