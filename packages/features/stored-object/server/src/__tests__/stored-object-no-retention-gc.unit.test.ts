/**
 * @vitest-environment node
 *
 * AC16: stored objects are never deleted on a clock.
 *
 * The RFC forbids automatic time-based deletion, and the only way a stored
 * object can be reaped behind a customer's back is a scheduled or recurring
 * process reaching the row-and-byte deletion. This walks the two processes
 * that own recurring work and asserts none of their source names it, so
 * adding such a job trips here and forces the constraint to be revisited on
 * purpose.
 *
 * The walk is asserted to have found real files first: a tree that moved
 * would otherwise turn this into a check that passes by finding nothing.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = (() => {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  while (!existsSync(path.join(directory, "charts", "langwatch"))) {
    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error("could not find the repository root holding charts/langwatch");
    }
    directory = parent;
  }
  return directory;
})();

/** The processes that own recurring and operator-launched work. */
const SCHEDULED_WORK_ROOTS = ["apps/worker/src", "apps/tasks/src"];

/** What deleting a stored object looks like, at the row and at the bytes. */
const DELETION_MARKERS = ["deleteOwnedBy", "deleteByProject", "stored_objects"];

function sourceFilesUnder(root: string): string[] {
  const found: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.")) found.push(full);
    }
  };
  walk(path.join(REPO_ROOT, root));
  return found;
}

describe("given the processes that run work on a schedule", () => {
  describe("when their source is inspected for stored-object deletion", () => {
    /** @scenario "No automatic retention, time-based GC, or orphan reaping runs" */
    it("finds no job that deletes a stored object's row or its bytes", () => {
      const files = SCHEDULED_WORK_ROOTS.flatMap(sourceFilesUnder);

      expect(files.length).toBeGreaterThan(100);

      const offenders = files.filter((file) => {
        const source = readFileSync(file, "utf8");
        return DELETION_MARKERS.some((marker) => source.includes(marker));
      });

      expect(offenders.map((file) => path.relative(REPO_ROOT, file))).toEqual([]);
    });
  });
});
