/**
 * @vitest-environment node
 *
 * Negative regression test for AC16:
 *   "No automatic retention, time-based GC, or orphan reaping runs"
 *
 * Asserts that no file under langwatch/src/server (outside the stored-objects
 * module) references the string "stored_objects" in a way that would imply a
 * background purge, GC, or retention job is running against the stored_objects
 * table.
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
 * Paths (relative to REPO_ROOT) where mentions of `stored_objects` are
 * expected and reviewed. Anything outside the allowlist that references
 * the table is flagged.
 *
 * Add a new entry here only when the reference has been audited against
 * AC16 — it must NOT be a retention/GC/orphan-reaper.
 */
const SCAN_ALLOWLIST: ReadonlyArray<RegExp> = [
  // The stored-objects module itself is the legitimate home for all
  // service, repository, and driver code that references the table.
  /^src\/server\/stored-objects\//,
  // tracer/types.ts references "stored_objects" only in a JSDoc comment
  // that documents the BinaryPart shape — it is not a GC or retention
  // reference. Audited: no delete/update/truncate on stored_objects.
  /^src\/server\/tracer\/types\.ts$/,
];

function isAllowlisted(rel: string): boolean {
  return SCAN_ALLOWLIST.some((pattern) => pattern.test(rel));
}

function findOffendingStoredObjectsRefs(absDir: string): string[] {
  const files = findSourceFiles(absDir);
  return files
    .filter((filePath) =>
      /stored_objects/i.test(fs.readFileSync(filePath, "utf8")),
    )
    .map((f) => path.relative(REPO_ROOT, f))
    .filter((rel) => !isAllowlisted(rel));
}

describe("AC16 — no automatic retention, GC, or orphan reaping for stored_objects", () => {
  describe("when all of src/server is scanned for stored_objects references", () => {
    /** @scenario "No automatic retention, time-based GC, or orphan reaping runs" */
    it("finds no file outside the stored-objects module that references stored_objects", () => {
      // Walk the entire server tree so that future surfaces (jobs/, routes/,
      // webhooks/, etc.) are covered automatically. Adding a reference
      // anywhere under src/server (outside the allowlist) will fail this
      // test and force a deliberate review of AC16.
      const serverDir = path.join(REPO_ROOT, "src/server");
      const offending = findOffendingStoredObjectsRefs(serverDir);
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
});
