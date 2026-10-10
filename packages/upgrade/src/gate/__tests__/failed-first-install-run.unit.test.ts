/**
 * @vitest-environment node
 * @see specs/upgrade/in-app-upgrade.feature
 */
import { describe, expect, it } from "vitest";

import { UpgradeRunLog } from "../../runner/run-log.ts";
import { apiPhaseVerdict } from "../serving-gate.ts";
import { failedFirstInstallRun, type refusedRunVerdict } from "../serving-upgrade-gate.ts";

const SCHEMA_STEP = "prisma:20261009_add_column";
const RELEASE = "3.22.0";
const failedSteps = [{ id: SCHEMA_STEP, error: "column exists" }];
type Run = Parameters<typeof refusedRunVerdict>[0]["runs"][number] & {
  report: Record<string, unknown> | null;
};
const run = (fields: Partial<Run>): Run => ({
  kind: "upgrade",
  release: RELEASE,
  floor: null,
  outcome: null,
  plan: null,
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
const refusedPlan = {
  outcome: "refused",
  code: "below_lts_floor",
  stopAt: "3.20.1",
  message: "this installation is on 3.15.0; upgrade to 3.20.1 (LTS) first, then to this image",
};
const refusedRun = run({
  outcome: "failed",
  plan: refusedPlan,
  report: { refused: "below_lts_floor" },
});

const ask = ({ ledger }: { ledger: readonly Run[] }) =>
  failedFirstInstallRun({
    verdict: apiPhaseVerdict({ outstanding: [SCHEMA_STEP] }),
    release: RELEASE,
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

  describe("given the installation finished an upgrade before", () => {
    /** @scenario "A failure on an installation that finished an upgrade before opens no console" */
    it("leaves the upgrading verdict without a failed run, for Ops > Upgrades to show", async () => {
      const verdict = await ask({ ledger: [run({ outcome: "succeeded" }), ...runs] });

      expect(verdict.outcome).toBe("upgrading");
      expect(verdict).not.toHaveProperty("failedRun");
    });
  });

  describe("given this image's newest upgrade run refused below the floor", () => {
    /** @scenario "A refused upgrade on an installation that never finished one opens the console" */
    it("opens the console with the refusal, naming its code and the release to stop at", async () => {
      const verdict = await ask({ ledger: [seed, refusedRun] });

      expect(verdict).toMatchObject({ outcome: "upgrading", failedRun: { failedSteps: [] } });
      const lines = "failedRun" in verdict ? (verdict.failedRun?.logTail ?? []) : [];
      expect(lines.join("\n")).toContain("refused_below_floor");
      expect(lines.join("\n")).toContain("3.20.1");
    });

    /** @scenario "A refused upgrade on an installation that finished one before refuses by name" */
    it("refuses below the floor instead of reporting upgrading", async () => {
      const verdict = await ask({ ledger: [run({ outcome: "succeeded" }), seed, refusedRun] });

      expect(verdict).toMatchObject({ admitted: false, outcome: "below-floor", floor: "3.20.1" });
      expect("refusal" in verdict && verdict.refusal).toContain("refused_below_floor");
    });

    it("ignores a refusal another image's run recorded", async () => {
      const verdict = await ask({
        ledger: [run({ outcome: "succeeded" }), { ...refusedRun, release: "3.30.0" }],
      });

      expect(verdict.outcome).toBe("upgrading");
    });

    it("ignores a refusal a later run of this image has overtaken", async () => {
      const verdict = await ask({ ledger: [run({ outcome: "succeeded" }), refusedRun, run({})] });

      expect(verdict.outcome).toBe("upgrading");
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
