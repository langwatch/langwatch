import { describe, expect, it, vi } from "vitest";

import {
  outstandingSummary,
  upgradeGateComponent,
  type UpgradeGateVerdict,
} from "../upgrade-gate.ts";

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
      it("boots at once, is not ready meanwhile, then is ready", async () => {
        const verdicts: UpgradeGateVerdict[] = [upgrading, upgrading, { admitted: true }];
        const release = vi.fn(async () => {});
        const component = upgradeGateComponent({
          server: "langwatch-api",
          role: "api",
          gate: { admit: async () => verdicts.shift() ?? { admitted: true }, release },
          logger,
          reAskMs: 5,
        });

        await component.start?.();
        await expect(component.ready?.()).rejects.toThrow(/upgrading/);

        await vi.waitFor(() => expect(verdicts).toHaveLength(0));
        await vi.waitFor(() => expect(component.ready?.()).resolves.toBeUndefined());
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
          reAskMs: 60_000,
        });

        await component.start?.();
        await component.stop();

        expect(release).not.toHaveBeenCalled();
      });
    });
  });
});

describe("the upgrading line", () => {
  describe("given 482 outstanding steps", () => {
    /** @scenario "The upgrading line names a count and at most five step ids" */
    it("names the count and the first five ids", () => {
      const outstanding = Array.from({ length: 482 }, (_, index) => `prisma:${index}`);
      expect(outstandingSummary({ outstanding })).toBe(
        "482 steps outstanding: prisma:0, prisma:1, prisma:2, prisma:3, prisma:4, …",
      );
    });
  });

  describe("given one outstanding step", () => {
    it("names it without an ellipsis", () => {
      expect(outstandingSummary({ outstanding: ["trace:fill-cost"] })).toBe(
        "1 step outstanding: trace:fill-cost",
      );
    });
  });
});
