/**
 * @vitest-environment node
 *
 * A folder row still carries execution settings, because a caller that
 * addresses a folder BY ID has nothing else to run against: the command line,
 * the MCP tool and the SDK all reach `POST /api/suites/:id/run`. What keeps
 * that from being a licence for the product UI to treat a folder as a run
 * plan again is this guard.
 *
 * The v2 Agent Testing UI queues every run through `suites.runPlan`, which
 * writes the configuration onto a RUN PLAN. It must never reach the id-based
 * `suites.run` or `suites.runAll`, and it must never write a suite row
 * directly through `suites.create` or `suites.update`, which are the two
 * procedures that accept targets, a repeat count and the models.
 *
 * A static read of the source, not a render: the point is that no file
 * anywhere under the feature calls these, which no single rendered component
 * can show.
 *
 * @see specs/suites/folder-run-plan-reuse.feature
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const UI_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../components/agent-testing",
);

/** Every TypeScript source under the feature, tests included. */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

/** The files whose source matches, named relative to the feature root. */
function filesMatching(pattern: RegExp): string[] {
  return sourceFiles(UI_ROOT)
    .filter((path) => pattern.test(readFileSync(path, "utf8")))
    .map((path) => path.slice(UI_ROOT.length + 1));
}

describe("given the Agent Testing UI", () => {
  describe("when it starts a run", () => {
    /** @scenario "The Agent Testing UI runs only through the run plan procedure" */
    it("reaches suites.runPlan and never the id-based run procedures", () => {
      // `suites.run` is a prefix of both `runPlan` and `runAll`, so the dot
      // is what makes each pattern name one procedure.
      expect(filesMatching(/api\.suites\.run\./)).toEqual([]);
      expect(filesMatching(/api\.suites\.runAll\b/)).toEqual([]);
      expect(filesMatching(/api\.suites\.runPlan\b/)).not.toEqual([]);
    });

    /** @scenario "The Agent Testing UI writes no execution settings onto a suite row" */
    it("never calls the suite procedures that accept execution settings", () => {
      expect(filesMatching(/api\.suites\.create\b/)).toEqual([]);
      expect(filesMatching(/api\.suites\.update\b/)).toEqual([]);
    });
  });
});
