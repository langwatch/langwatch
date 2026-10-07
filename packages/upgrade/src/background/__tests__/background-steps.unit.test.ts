/** A paused worker runs nothing. Spec: specs/upgrade/background-steps.feature. */
import { describe, expect, it } from "vitest";

import { defineMigrationStep } from "../../step/migration-step.ts";
import { type BackgroundStepsLedger, BackgroundStepsService } from "../background-steps.service.ts";

const refuse = (): never => {
  throw new Error("a paused worker writes nothing");
};

describe("BackgroundStepsService", () => {
  describe("given a worker whose gate stopped serving", () => {
    /** @scenario "A worker that stopped serving runs no background step" */
    it("runs no step and reports the pass paused", async () => {
      let runs = 0;
      const ledger: BackgroundStepsLedger = {
        findSteps: async () => [
          { id: "identity:reopen-unproven-accounts", status: "pending", report: null },
        ],
        acquireLease: refuse,
        renewLease: refuse,
        releaseLease: refuse,
        markRunning: refuse,
        setStatus: refuse,
        saveReport: refuse,
      };
      const service = BackgroundStepsService.create({
        ledger,
        steps: [
          defineMigrationStep({
            id: "identity:reopen-unproven-accounts",
            kind: "data",
            mode: "background",
            description: "Reopens accounts that never proved their address.",
            run: async () => ({ runs: ++runs }),
          }),
        ],
        serving: () => false,
        oldWritersGoneFor: async () => true,
        identity: { owner: "worker-1", image: "3.21.0", host: "host" },
        log: () => undefined,
      });

      const sweep = await service.sweep({ signal: new AbortController().signal });

      expect(sweep).toEqual({ paused: true, ran: [], failed: [], waiting: [] });
      expect(runs).toBe(0);
    });
  });

  describe("given a step another worker finished between the read and the lease", () => {
    /** @scenario "A step another worker finished while this one took the lease does not run again" */
    it("does not run it, mark it running or keep its lease", async () => {
      let runs = 0;
      let reads = 0;
      const released: string[] = [];
      const ledger: BackgroundStepsLedger = {
        findSteps: async () => [
          {
            id: "identity:reopen-unproven-accounts",
            status: reads++ === 0 ? "pending" : "done",
            report: null,
          },
        ],
        acquireLease: async () => ({}),
        renewLease: refuse,
        releaseLease: async ({ name }) => (released.push(name), true),
        markRunning: refuse,
        setStatus: refuse,
        saveReport: refuse,
      };
      const service = BackgroundStepsService.create({
        ledger,
        steps: [
          defineMigrationStep({
            id: "identity:reopen-unproven-accounts",
            kind: "data",
            mode: "background",
            description: "Reopens accounts that never proved their address.",
            run: async () => ({ runs: ++runs }),
          }),
        ],
        serving: () => true,
        oldWritersGoneFor: async () => true,
        identity: { owner: "worker-1", image: "3.21.0", host: "host" },
        log: () => undefined,
      });

      const sweep = await service.sweep({ signal: new AbortController().signal });

      expect(sweep).toEqual({ paused: false, ran: [], failed: [], waiting: [] });
      expect(runs).toBe(0);
      expect(released).toEqual(["background:identity:reopen-unproven-accounts"]);
    });
  });
});
