/**
 * @vitest-environment node
 * @see specs/upgrade/in-app-upgrade.feature
 */
import { describe, expect, it } from "vitest";

import { UpgradeRunLog } from "../../runner/run-log.ts";
import { apiPhaseVerdict } from "../serving-gate.ts";
import { failedRunOnHold } from "../serving-upgrade-gate.ts";

const SCHEMA_STEP = "prisma:20261009_add_column";
const failedSteps = [{ id: SCHEMA_STEP, error: "column exists" }];
const runs = [
  { outcome: "failed" as const, report: { logTail: ["an older run"] } },
  { outcome: "failed" as const, report: { logTail: ["applying", "column exists"] } },
  { outcome: null, report: null },
];

describe("failedRunOnHold", () => {
  describe("given the worker's upgrade failed on a Postgres schema step", () => {
    /** @scenario "The console shows the failure from the run report in the ledger" */
    it("hands the holding verdict the failed steps and the last failed run report's log tail", async () => {
      const verdict = await failedRunOnHold({
        verdict: apiPhaseVerdict({ outstanding: [SCHEMA_STEP] }),
        findFailedSteps: async () => failedSteps,
        findRuns: async () => runs,
      });

      expect(verdict).toMatchObject({
        outcome: "holding",
        failedRun: { failedSteps, logTail: ["applying", "column exists"] },
      });
    });

    it("hands an empty log tail when the run report carries none", async () => {
      const verdict = await failedRunOnHold({
        verdict: apiPhaseVerdict({ outstanding: [SCHEMA_STEP] }),
        findFailedSteps: async () => failedSteps,
        findRuns: async () => [{ outcome: "failed", report: { logTail: "not lines" } }],
      });

      expect(verdict).toMatchObject({ failedRun: { failedSteps, logTail: [] } });
    });
  });

  describe("given the failure is after the schema phase", () => {
    /** @scenario "A failure after the schema phase opens no console" */
    it("leaves the upgrading verdict without a failed run", async () => {
      const verdict = await failedRunOnHold({
        verdict: apiPhaseVerdict({ outstanding: ["dataset:move"] }),
        findFailedSteps: async () => [{ id: "dataset:move", error: "broke" }],
        findRuns: async () => runs,
      });

      expect(verdict.outcome).toBe("upgrading");
      expect(verdict).not.toHaveProperty("failedRun");
    });
  });
});

describe("UpgradeRunLog", () => {
  describe("when a run says more than fifty lines", () => {
    it("keeps the last fifty, redacted, for the run report", () => {
      const narrate = new UpgradeRunLog({ info: () => undefined, warn: () => undefined });
      for (let line = 1; line <= 60; line++) narrate.info(`line ${line}`);
      narrate.warn("reaching postgres://lw:s3cret@db/lw");

      const tail = narrate.tail();

      expect(tail).toHaveLength(50);
      expect(tail[0]).toBe("line 12");
      expect(tail.at(-1)).not.toContain("s3cret");
    });
  });
});
