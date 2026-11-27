/**
 * The deploy-time replayer trusts the claimed-groups index (ADR-092) only because each call runs
 * after ops:fill-queue-tenant-claims; defineProjectionReplayStep forces that order, so it must
 * stay the one caller. specs/upgrade/projection-replay-step.feature.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const SCANNED = ["apps", "modules", "enterprise", "packages"];
const SKIPPED_DIRS = new Set(["node_modules", "dist", "__tests__", ".turbo", "coverage"]);
const CALL = /\.replayLane\(/;
/** The step, and the process replayer it is handed, which only passes the call on to the engine. */
const ALLOWED = [
  "packages/process/src/migration/projection-replayer.ts",
  "packages/upgrade/src/step/projection-replay-step.ts",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return SKIPPED_DIRS.has(entry.name) ? [] : sourceFiles(join(dir, entry.name));
    }
    const isSource = /\.(ts|tsx|mts)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name);
    return isSource ? [join(dir, entry.name)] : [];
  });
}

describe("given the source tree outside tests", () => {
  /** @scenario "Only the projection replay step drives the deploy-time lane replayer" */
  it("calls replayLane only from defineProjectionReplayStep", () => {
    const callers = SCANNED.flatMap((top) => sourceFiles(join(ROOT, top)))
      .filter((file) => CALL.test(readFileSync(file, "utf8")))
      .map((file) => relative(ROOT, file));

    expect(callers).toContain("packages/upgrade/src/step/projection-replay-step.ts");
    expect(callers.toSorted()).toEqual(ALLOWED);
  });
});
