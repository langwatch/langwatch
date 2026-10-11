/**
 * @vitest-environment node
 * @see specs/upgrade/in-app-upgrade.feature
 */
import { describe, expect, it } from "vitest";

import { UpgradeRunLog } from "../../runner/run-log.ts";
import { apiPhaseVerdict } from "../serving-gate.ts";
import { failedFirstInstallRun } from "../serving-upgrade-gate.ts";

const SCHEMA_STEP = "prisma:20261009_add_column";
const RELEASE = "3.22.0";
const failedSteps = [{ id: SCHEMA_STEP, error: "column exists" }];
type Run = Awaited<ReturnType<Parameters<typeof failedFirstInstallRun>[0]["findRuns"]>>[number] & {
  release: string | null;
};
const run = (fields: Partial<Run>): Run => ({
  kind: "upgrade",
  release: RELEASE,
  outcome: null,
  report: null,
  ...fields,
});
const seed = run({ kind: "seed", release: null, outcome: "succeeded" });
const runs = [
  seed,
  run({ outcome: "failed", report: { logTail: ["an older run"] } }),
  run({ outcome: "failed", report: { logTail: ["applying", "column exists"] } }),
  run({}),
];

const ask = ({ ledger }: { ledger: readonly Run[] }) =>
  failedFirstInstallRun({
    verdict: apiPhaseVerdict({ outstanding: [SCHEMA_STEP] }),
    findFailedSteps: async () => failedSteps,
    findRuns: async () => ledger,
  });

describe("failedFirstInstallRun", () => {
  describe("given the worker's first install failed", () => {
    /** @scenario "The console shows the failure from the run report in the ledger" */
    it("hands the upgrading verdict the failed steps and the last failed run report's log tail", async () => {
      expect(await ask({ ledger: runs })).toMatchObject({
        outcome: "upgrading",
        failedRun: { failedSteps, logTail: ["applying", "column exists"] },
      });
    });

    /** @scenario "A first install whose ledger seed succeeded still opens the console" */
    it("never counts the ledger seed's succeeded run as a finished upgrade", async () => {
      expect(await ask({ ledger: runs })).toHaveProperty("failedRun.failedSteps", failedSteps);
    });

    it("hands an empty log tail when the run report carries none", async () => {
      const ledger = [seed, run({ outcome: "failed", report: { logTail: "not lines" } })];

      expect(await ask({ ledger })).toMatchObject({ failedRun: { failedSteps, logTail: [] } });
    });
  });

  describe("given the first install failed in a schema phase, writing no failed step", () => {
    const schemaFailure = run({
      outcome: "failed",
      report: { error: "goose: table already exists", logTail: ["applying clickhouse"] },
    });
    const askWithoutSteps = ({ ledger }: { ledger: readonly Run[] }) =>
      failedFirstInstallRun({
        verdict: apiPhaseVerdict({ outstanding: [SCHEMA_STEP] }),
        findFailedSteps: async () => [],
        findRuns: async () => ledger,
      });

    /** @scenario "A first install that failed in a schema phase opens the console without a failed step" */
    it("opens the console with the run's error closing its log tail", async () => {
      expect(await askWithoutSteps({ ledger: [seed, schemaFailure] })).toMatchObject({
        outcome: "upgrading",
        failedRun: {
          failedSteps: [],
          logTail: ["applying clickhouse", "goose: table already exists"],
        },
      });
    });

    it("opens no console while no finished upgrade run failed", async () => {
      const verdict = await askWithoutSteps({ ledger: [seed, run({})] });

      expect(verdict).not.toHaveProperty("failedRun");
    });
  });

  describe("given the installation finished an upgrade before", () => {
    /** @scenario "A failure on an installation that finished an upgrade before opens no console" */
    it("leaves the upgrading verdict without a failed run, for Ops > Upgrades to show", async () => {
      const verdict = await ask({ ledger: [run({ outcome: "succeeded" }), ...runs] });

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
