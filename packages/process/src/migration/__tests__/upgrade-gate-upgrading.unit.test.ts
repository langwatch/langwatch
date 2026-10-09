import { describe, expect, it, vi } from "vitest";

import { upgradeGateComponent, type UpgradeGateVerdict } from "../upgrade-gate.ts";

const logger = { info: vi.fn(), error: vi.fn() };
const upgrading: UpgradeGateVerdict = {
  admitted: false,
  outcome: "upgrading",
  outstanding: ["trace:fill-cost"],
};

describe("an api's upgrade gate in upgrading mode", () => {
  describe("given the schema steps are done and a blocking data step is outstanding", () => {
    describe("when the worker's run records the last blocking step as done", () => {
      /** @scenario "The api serves and reports ready once the ledger is current" */
      it("boots at once, is not ready meanwhile, then lifts the hold and is ready", async () => {
        const verdicts: UpgradeGateVerdict[] = [upgrading, upgrading, { admitted: true }];
        const holds: unknown[] = [];
        const release = vi.fn(async () => {});
        const component = upgradeGateComponent({
          server: "langwatch-api",
          role: "api",
          gate: { admit: async () => verdicts.shift() ?? { admitted: true }, release },
          logger,
          onHolding: async (holding) => {
            holds.push(holding);
          },
          reAskMs: 5,
        });

        await component.start?.();
        await expect(component.ready?.()).rejects.toThrow(/upgrading/);

        await vi.waitFor(() => expect(holds.at(-1)).toBeUndefined());
        await expect(component.ready?.()).resolves.toBeUndefined();
        expect(holds).toContainEqual({
          phase: "upgrading",
          outstandingStepIds: ["trace:fill-cost"],
        });
        await component.stop();
        expect(release).toHaveBeenCalledOnce();
      });
    });
  });

  describe("given a worker's gate", () => {
    describe("when the stop comes while the api still upgrades", () => {
      it("stops asking and never releases a gate it was not admitted by", async () => {
        const release = vi.fn(async () => {});
        const admit = vi.fn(async () => upgrading);
        const component = upgradeGateComponent({
          server: "langwatch-api",
          role: "api",
          gate: { admit, release },
          logger,
          onHolding: async () => {},
          reAskMs: 60_000,
        });

        await component.start?.();
        await component.stop();

        expect(release).not.toHaveBeenCalled();
      });
    });
  });
});
