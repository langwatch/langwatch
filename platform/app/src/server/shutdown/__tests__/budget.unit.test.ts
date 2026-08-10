import { afterEach, describe, expect, it } from "vitest";
import { KUBELET_SLACK_MS, resolveShutdownBudget } from "../budget";

const ORIGINAL = process.env.SHUTDOWN_DRAIN_TIMEOUT_MS;

afterEach(() => {
  if (ORIGINAL === void 0) delete process.env.SHUTDOWN_DRAIN_TIMEOUT_MS;
  else process.env.SHUTDOWN_DRAIN_TIMEOUT_MS = ORIGINAL;
});

describe("resolveShutdownBudget", () => {
  describe("given any drain budget", () => {
    describe("when the clocks are derived", () => {
      // The whole point of the module: four clocks that used to be four
      // literals in four files, where the app's 5s force-exit sat inside the
      // queue's 20s drain and silently won.
      /** @scenario Every shutdown clock nests inside the one outside it */
      it("orders them strictly innermost to outermost", () => {
        for (const drain of ["1000", "20000", "60000", "600000"]) {
          process.env.SHUTDOWN_DRAIN_TIMEOUT_MS = drain;
          const b = resolveShutdownBudget();

          expect(b.queueDrainMs).toBeLessThan(b.appCloseMs);
          expect(b.appCloseMs).toBeLessThan(b.processDeadlineMs);
          expect(b.processDeadlineMs).toBeLessThan(
            b.requiredGracePeriodSeconds * 1000,
          );
        }
      });

      /** @scenario Raising the drain budget widens every clock above it */
      it("moves the outer clocks with the drain", () => {
        process.env.SHUTDOWN_DRAIN_TIMEOUT_MS = "20000";
        const base = resolveShutdownBudget();
        process.env.SHUTDOWN_DRAIN_TIMEOUT_MS = "120000";
        const raised = resolveShutdownBudget();

        expect(raised.appCloseMs - base.appCloseMs).toBe(100_000);
        expect(raised.processDeadlineMs - base.processDeadlineMs).toBe(100_000);
        expect(
          raised.requiredGracePeriodSeconds - base.requiredGracePeriodSeconds,
        ).toBe(100);
      });

      // The chart's guard adds the same 30s (5 + 15 + 10) on top of the drain.
      // If these two ever disagree the chart admits a release the kubelet
      // kills mid-drain, which is the failure the guard exists to catch.
      /** @scenario The required grace period matches what the chart guard enforces */
      it("requires drain + 30s, the same margin the chart validates", () => {
        process.env.SHUTDOWN_DRAIN_TIMEOUT_MS = "20000";
        const b = resolveShutdownBudget();

        expect(b.requiredGracePeriodSeconds).toBe(50);
        expect(b.processDeadlineMs + KUBELET_SLACK_MS).toBe(
          b.requiredGracePeriodSeconds * 1000,
        );
      });
    });
  });

  describe("given a malformed override", () => {
    describe("when the budget is resolved", () => {
      /** @scenario A malformed drain override is refused, not silently defaulted */
      it("throws rather than falling back to the default", () => {
        for (const bad of ["nonsense", "0", "-5"]) {
          process.env.SHUTDOWN_DRAIN_TIMEOUT_MS = bad;
          expect(() => resolveShutdownBudget()).toThrow(
            /SHUTDOWN_DRAIN_TIMEOUT_MS/,
          );
        }
      });
    });
  });
});
