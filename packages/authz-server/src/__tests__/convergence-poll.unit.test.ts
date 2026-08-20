import { describe, expect, it } from "vitest";
import {
  convergenceTimeoutMs,
  DEFAULT_CONVERGENCE_POLL,
} from "../convergence-poll";

describe("convergenceTimeoutMs", () => {
  describe("given the default poll", () => {
    describe("when the import states more facts than the base wait could fold", () => {
      /** @scenario The convergence wait grows with the size of the import */
      it("scales the deadline with the number of facts awaited", () => {
        const small = convergenceTimeoutMs({
          poll: DEFAULT_CONVERGENCE_POLL,
          factCount: 10,
        });
        const large = convergenceTimeoutMs({
          poll: DEFAULT_CONVERGENCE_POLL,
          factCount: 315,
        });

        expect(large).toBeGreaterThan(small);
        // The organization that parked in production: 315 facts at the
        // measured ~1.8 facts/s needs ~175s, past the old fixed 120s window.
        expect(large).toBeGreaterThan(175_000);
      });

      it("stops growing at the ceiling", () => {
        const enormous = convergenceTimeoutMs({
          poll: DEFAULT_CONVERGENCE_POLL,
          factCount: 10_000_000,
        });
        expect(enormous).toBe(DEFAULT_CONVERGENCE_POLL.maxTimeoutMs);
      });
    });
  });

  describe("given an explicitly injected poll without a per-fact budget", () => {
    describe("when a wait computes its deadline", () => {
      it("keeps the injected timeout exact, whatever the size", () => {
        const timeout = convergenceTimeoutMs({
          poll: { intervalMs: 1, timeoutMs: 50 },
          factCount: 10_000,
        });
        expect(timeout).toBe(50);
      });
    });
  });
});
