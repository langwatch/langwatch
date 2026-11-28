/** Spec: specs/tooling/lint-projection-replay-sole-caller.feature. ADR-092. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { lintProjectionReplaySoleCaller } from "../src/policies/boundaries/projection-replay-sole-caller.ts";
import type { FeatureCatalogueEntry } from "../src/types.ts";
import { snapshotOf } from "./workspace.ts";

const CATALOGUE: FeatureCatalogueEntry[] = [
  { id: "billing", root: "modules/billing", classification: "core", subjects: ["billing"] },
];
const CALL =
  "export const run = (replayer: { replayLane(i: unknown): void }) => replayer.replayLane({});\n";
let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "projection-replay-sole-caller-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function run() {
  return lintProjectionReplaySoleCaller(snapshotOf({ root, catalogue: CATALOGUE }));
}

describe("projection-replay-sole-caller", () => {
  /** @scenario "A module calls replayLane directly" */
  it("reports a module file that calls replayLane", () => {
    write("modules/billing/process/src/services/replay.ts", CALL);

    const violations = run();

    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toContain("modules/billing/process/src/services/replay.ts");
    expect(violations[0]?.line).toBe(1);
  });

  /** @scenario "Only the projection replay step drives the deploy-time lane replayer" */
  it("allows the replay step, the process replayer and tests", () => {
    write("packages/upgrade/src/step/projection-replay-step.ts", CALL);
    write("packages/process/src/migration/projection-replayer.ts", CALL);
    write("modules/billing/process/src/services/__tests__/replay.unit.test.ts", CALL);

    expect(run()).toEqual([]);
  });
});
