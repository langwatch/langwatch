/**
 * A test suite row still carries execution settings, because a caller that addresses a test suite BY ID has nothing else to run against: the command line, the MCP tool and the SDK all reach `POST /api/suites/:id/run`.
 * @vitest-environment node
 * @see specs/suites/test-suite-run-plan-reuse.feature
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const UI_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../ui/sections/agent-testing");

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
    /** @scenario "A run started from the Agent Testing UI always carries a run plan" */
    it("reaches suites.runPlan and never the id-based run procedures", () => {
      // `suites.run` is a prefix of both `runPlan` and `runAll`, so the dot
      // is what makes each pattern name one procedure.
      expect(filesMatching(/api\.suites\.run\./)).toEqual([]);
      expect(filesMatching(/api\.suites\.runAll\b/)).toEqual([]);
      expect(filesMatching(/api\.suites\.runPlan\b/)).not.toEqual([]);
    });

    /** @scenario "A test suite row never gains execution settings from the product UI" */
    it("never calls the suite procedures that accept execution settings", () => {
      expect(filesMatching(/api\.suites\.create\b/)).toEqual([]);
      expect(filesMatching(/api\.suites\.update\b/)).toEqual([]);
    });
  });
});
