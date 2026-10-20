/**
 * @vitest-environment node
 * @see specs/upgrade/upgrade-logging.feature
 * @see specs/upgrade/in-app-upgrade.feature
 */
import { describe, expect, it } from "vitest";

import type { UpgradeOutcomeCode } from "../../runner/upgrade-outcome.ts";
import { assertCurrent, firstInstallVerdict, type ServingVerdict } from "../serving-gate.ts";
import { admitAfterFirstInstall } from "../serving-upgrade-gate.ts";

const BEHIND_IMAGE = { release: "3.21.0", blockingSteps: ["prisma:20261006180000_add_column"] };

describe("admitAfterFirstInstall", () => {
  describe("given a worker on an empty ledger and an empty schema", () => {
    /** @scenario "The worker's first install says it runs the upgrade once before taking jobs" */
    it("says this is a first install and that it runs the upgrade, before running it", async () => {
      const said: { message: string; fields?: Record<string, unknown> }[] = [];
      const answers: ServingVerdict[] = [
        firstInstallVerdict(),
        { admitted: true, outcome: "current" },
      ];
      const verdict = await admitAfterFirstInstall({
        gate: { admit: async () => answers.shift() ?? firstInstallVerdict() },
        firstInstall: async () => {
          said.push({ message: "upgrade ran" });
          return { code: "done", logTail: [] };
        },
        warn: (message, fields) => void said.push({ message, fields }),
      });

      expect(verdict).toEqual({ admitted: true, outcome: "current" });
      expect(said.map((line) => line.message)).toEqual([
        expect.stringMatching(
          /^first install: .*this worker runs the upgrade itself before it takes jobs/,
        ),
        "upgrade ran",
        expect.stringMatching(/finished: the installation is current/),
      ]);
      expect(said[0]?.fields).toMatchObject({ phase: "first-install", next: expect.any(String) });
    });
  });

  describe("given a worker whose installation is behind its image on one blocking step", () => {
    /** @scenario "The worker says it runs the upgrade because the installation is behind, naming the steps" */
    it("says the installation is behind, naming the step, before running the upgrade", async () => {
      const said: { message: string; fields?: Record<string, unknown> }[] = [];
      const answers: ServingVerdict[] = [
        assertCurrent({ ledger: { steps: [] }, image: BEHIND_IMAGE }),
        { admitted: true, outcome: "current" },
      ];
      const verdict = await admitAfterFirstInstall({
        gate: { admit: async () => answers.shift() ?? { admitted: true, outcome: "current" } },
        firstInstall: async () => {
          said.push({ message: "upgrade ran" });
          return { code: "done", logTail: [] };
        },
        warn: (message, fields) => void said.push({ message, fields }),
      });

      expect(verdict).toEqual({ admitted: true, outcome: "current" });
      expect(said[0]?.message).toMatch(
        /behind this image: 1 step not done: prisma:20261006180000_add_column, so this worker runs the upgrade itself/,
      );
      expect(said[0]?.fields).toMatchObject({
        phase: "behind",
        next: expect.stringMatching(/^nothing to do/),
      });
      expect(said[1]?.message).toBe("upgrade ran");
    });
  });

  describe("given a worker whose installation is behind its image on several hundred steps", () => {
    /** @scenario "The worker's behind line counts the steps and names at most five" */
    it("gives the count and names only the first five", async () => {
      const said: string[] = [];
      const blockingSteps = Array.from({ length: 480 }, (_, index) => `prisma:${index}`);
      const answers: ServingVerdict[] = [
        assertCurrent({ ledger: { steps: [] }, image: { release: "3.21.0", blockingSteps } }),
        { admitted: true, outcome: "current" },
      ];
      await admitAfterFirstInstall({
        gate: { admit: async () => answers.shift() ?? { admitted: true, outcome: "current" } },
        firstInstall: async () => ({ code: "done", logTail: [] }),
        warn: (message) => void said.push(message),
      });

      expect(said[0]).toBe(
        "behind this image: 480 steps not done: prisma:0, prisma:1, prisma:2, prisma:3, prisma:4, …, so this worker runs the upgrade itself before it takes jobs; its lines follow",
      );
    });
  });

  describe("given a worker that ran the upgrade because it was behind", () => {
    /** @scenario "A worker that said it was behind says when the installation is current" */
    it("says the installation is current and it takes jobs, after the upgrade's lines", async () => {
      const said: string[] = [];
      const answers: ServingVerdict[] = [
        assertCurrent({ ledger: { steps: [] }, image: BEHIND_IMAGE }),
        { admitted: true, outcome: "current" },
      ];
      await admitAfterFirstInstall({
        gate: { admit: async () => answers.shift() ?? { admitted: true, outcome: "current" } },
        firstInstall: async () => {
          said.push("upgrade ran");
          return { code: "done", logTail: [] };
        },
        warn: (message) => void said.push(message),
      });

      expect(said.slice(1)).toEqual([
        "upgrade ran",
        "the upgrade finished: the installation is current, so this worker takes jobs",
      ]);
    });

    it("says nothing when the installation was current from the start", async () => {
      const said: string[] = [];
      await admitAfterFirstInstall({
        gate: { admit: async () => ({ admitted: true, outcome: "current" }) },
        firstInstall: async () => ({ code: "done", logTail: [] }),
        warn: (message) => void said.push(message),
      });

      expect(said).toEqual([]);
    });
  });

  describe("given a worker that lost the lease to a peer's run", () => {
    describe("when its upgrade ends lease_not_acquired after waiting for the lease", () => {
      /** @scenario "The worker waits on the run's outcome, never on a process exit code" */
      it("never counts it as a failed run and runs again once the lease is free", async () => {
        const said: string[] = [];
        const exits: UpgradeOutcomeCode[] = ["lease_not_acquired", "done"];
        const answers: ServingVerdict[] = [
          assertCurrent({ ledger: { steps: [] }, image: BEHIND_IMAGE }),
          assertCurrent({ ledger: { steps: [] }, image: BEHIND_IMAGE }),
          { admitted: true, outcome: "current" },
        ];
        const verdict = await admitAfterFirstInstall({
          gate: { admit: async () => answers.shift() ?? { admitted: true, outcome: "current" } },
          firstInstall: async () => ({ code: exits.shift() ?? "done", logTail: [] }),
          warn: (message) => void said.push(message),
          findFailedSteps: async () => [],
          wait: async () => undefined,
        });

        expect(verdict).toEqual({ admitted: true, outcome: "current" });
        expect(exits).toEqual([]);
        expect(said.filter((line) => /exited|Retry/.test(line))).toEqual([]);
      });
    });
  });

  const behind = () => assertCurrent({ ledger: { steps: [] }, image: BEHIND_IMAGE });
  const current: ServingVerdict = { admitted: true, outcome: "current" };

  describe("given another runner holding the upgrade lease", () => {
    /** @scenario "A worker waits while another runner holds the upgrade lease" */
    it("runs nothing, says once that it waits and asks again every 10 seconds", async () => {
      const answers = [behind(), behind(), current];
      const holders = [{ owner: "worker-2", host: "pod-b", image: "3.21.0" }];
      const waits: number[] = [];
      const said: string[] = [];
      let runs = 0;
      const verdict = await admitAfterFirstInstall({
        gate: { admit: async () => answers.shift() ?? current },
        firstInstall: async () => {
          runs += 1;
          return { code: "done", logTail: [] };
        },
        warn: (message) => void said.push(message),
        findLeaseHolder: async () => holders[0] ?? null,
        wait: async (ms) => void waits.push(ms),
      });

      expect(verdict).toEqual(current);
      expect(runs).toBe(0);
      expect(waits).toEqual([10_000, 10_000]);
      expect(said).toEqual([
        expect.stringMatching(/held by worker-2 on pod-b/),
        expect.stringMatching(/finished: the installation is current/),
      ]);
    });
  });

  describe("given a run that fails on a blocking step", () => {
    /** @scenario "After a failed run the worker waits for a Retry" */
    it("runs nothing while the step is failed and runs again once a Retry returns it to pending", async () => {
      let failed = [{ id: "clickhouse:00042", error: "boom" }];
      const answers = [behind(), behind(), behind(), current];
      const codes: UpgradeOutcomeCode[] = ["failed", "done"];
      let runs = 0;
      const verdict = await admitAfterFirstInstall({
        gate: { admit: async () => answers.shift() ?? current },
        firstInstall: async () => ({ code: codes[runs++] ?? "done", logTail: [] }),
        warn: () => undefined,
        findFailedSteps: async () => failed,
        wait: async () => {
          if (answers.length === 2) failed = [];
        },
      });

      expect(verdict).toEqual(current);
      expect(runs).toBe(2);
    });

    /** @scenario "A restarted worker runs a failed upgrade once more" */
    it("runs once on a new start though a step is failed, then waits for a Retry", async () => {
      const answers = [behind(), behind(), behind(), current];
      let runs = 0;
      let waitedForRetry = 0;
      const verdict = await admitAfterFirstInstall({
        gate: { admit: async () => answers.shift() ?? current },
        firstInstall: async () => {
          runs += 1;
          return { code: "failed", logTail: [] };
        },
        warn: () => undefined,
        findFailedSteps: async () => [{ id: "clickhouse:00042", error: "boom" }],
        wait: async () => void (waitedForRetry += 1),
      });

      expect(verdict).toEqual(current);
      expect(runs).toBe(1);
      expect(waitedForRetry).toBe(3);
    });
  });

  describe("given runs that fail with no failed step row", () => {
    /** @scenario "A failed run with no failed step retries on a backoff, saying why" */
    it("retries on a doubling wait, saying it retries and the run's last line, never a Retry", async () => {
      const said: string[] = [];
      const waits: number[] = [];
      const exits: UpgradeOutcomeCode[] = ["failed", "failed", "failed", "done"];
      const answers = [behind(), behind(), behind(), behind(), current];
      const verdict = await admitAfterFirstInstall({
        gate: { admit: async () => answers.shift() ?? current },
        firstInstall: async () => ({
          code: exits.shift() ?? "done",
          logTail: ["preflight refused: a failed Prisma migration"],
        }),
        warn: (message) => void said.push(message),
        wait: async (ms) => void waits.push(ms),
      });

      expect(verdict).toEqual(current);
      expect(waits).toEqual([10_000, 20_000, 40_000]);
      const retries = said.filter((line) => line.includes("retries it in"));
      expect(retries).toHaveLength(3);
      expect(retries[0]).toContain("preflight refused: a failed Prisma migration");
      expect(said.filter((line) => line.includes("waits for a Retry"))).toEqual([]);
    });

    /** @scenario "A failed run with no failed step retries on a backoff, saying why" */
    it("never waits longer than five minutes between tries", async () => {
      const waits: number[] = [];
      let runs = 0;
      await admitAfterFirstInstall({
        gate: { admit: async () => (runs < 8 ? behind() : current) },
        firstInstall: async () => {
          runs += 1;
          return { code: "failed", logTail: [] };
        },
        warn: () => undefined,
        wait: async (ms) => void waits.push(ms),
      });

      expect(Math.max(...waits)).toBe(300_000);
      expect(waits.at(-1)).toBe(300_000);
    });
  });
});
