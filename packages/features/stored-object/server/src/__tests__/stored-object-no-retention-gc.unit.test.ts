/**
 * AC16: stored objects are never deleted on a clock.
 * @vitest-environment node
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
