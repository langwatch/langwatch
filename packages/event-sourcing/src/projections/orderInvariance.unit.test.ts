import { describe, expect, it } from "vitest";
import { checkOrderInvariance } from "./orderInvariance";

/**
 * The harness exists to catch folds that only look order-invariant. Each test
 * below is a fold shape that is either genuinely safe (commutative
 * accumulator, monotone-by-rank) or genuinely unsafe (last-write-wins with no
 * timestamp, a fold that mutates the event it is handed) — the assertions are
 * on which side of that line the harness places each one.
 */

interface Reading {
  readonly value: number;
}

describe("checkOrderInvariance", () => {
  describe("given a commutative accumulator fold", () => {
    const events: Reading[] = [
      { value: 3 },
      { value: -1 },
      { value: 7 },
      { value: 2 },
    ];

    /** @scenario a fold that only accumulates is unaffected by order */
    it("reports invariant across every permutation", () => {
      const report = checkOrderInvariance({
        init: () => ({ sum: 0, count: 0, max: -Infinity }),
        apply: (state, event: Reading) => ({
          sum: state.sum + event.value,
          count: state.count + 1,
          max: Math.max(state.max, event.value),
        }),
        events,
      });

      expect(report.invariant).toBe(true);
      expect(report.counterexample).toBeUndefined();
      // 4 events, exhaustive: 4! permutations, identity counted once.
      expect(report.permutationsChecked).toBe(24);
    });
  });

  describe("given a monotone-by-rank status fold", () => {
    interface StatusEvent {
      readonly status: "queued" | "running" | "completed";
      readonly rank: number;
    }

    const events: StatusEvent[] = [
      { status: "running", rank: 1 },
      { status: "queued", rank: 0 },
      { status: "completed", rank: 2 },
    ];

    /** @scenario a fold whose status only ever moves forward is unaffected by order */
    it("reports invariant regardless of delivery order", () => {
      const report = checkOrderInvariance({
        init: () => ({ status: "queued" as StatusEvent["status"], rank: -1 }),
        apply: (state, event: StatusEvent) =>
          event.rank > state.rank ? { status: event.status, rank: event.rank } : state,
        events,
      });

      expect(report.invariant).toBe(true);
    });
  });

  describe("given a last-write-wins field with no timestamp on the event", () => {
    const events: Reading[] = [{ value: 1 }, { value: 2 }];

    /** @scenario a field that simply overwrites is caught as order-dependent */
    it("finds an order counterexample", () => {
      const report = checkOrderInvariance({
        init: () => ({ value: 0 }),
        apply: (_state, event: Reading) => ({ value: event.value }),
        events,
      });

      expect(report.invariant).toBe(false);
      expect(report.cause).toBe("order");
      expect(report.counterexample).toBeDefined();
      expect(report.counterexample?.orderA).not.toEqual(report.counterexample?.orderB);
    });
  });

  describe("given a fold that mutates the event object it is handed", () => {
    /** @scenario a fold that mutates the state it was handed is reported distinctly */
    it("reports the failure as mutation, not as an order counterexample", () => {
      const events: Array<{ value: number }> = [{ value: 1 }, { value: 2 }];

      const report = checkOrderInvariance({
        init: () => ({ total: 0 }),
        apply: (state, event: { value: number }) => {
          const before = event.value;
          // Mutates the shared event object: the SAME ordering, folded again
          // from a fresh cloned state, now reads an already-doubled value.
          event.value = event.value * 2;
          return { total: state.total + before };
        },
        events,
      });

      expect(report.invariant).toBe(false);
      expect(report.cause).toBe("mutation");
      expect(report.counterexample?.orderA).toEqual(report.counterexample?.orderB);
      expect(report.permutationsChecked).toBe(1);
    });
  });

  describe("given more events than the exhaustive threshold", () => {
    const events: Reading[] = Array.from({ length: 8 }, (_unused, i) => ({ value: i }));

    /** @scenario a large event set is sampled rather than exhaustively permuted */
    it("checks no more permutations than the configured cap", () => {
      const report = checkOrderInvariance({
        init: () => ({ sum: 0 }),
        apply: (state, event: Reading) => ({ sum: state.sum + event.value }),
        events,
        maxPermutations: 15,
      });

      expect(report.permutationsChecked).toBeLessThanOrEqual(15);
      expect(report.invariant).toBe(true);
    });
  });

  describe("given a deterministic fold checked twice", () => {
    const events: Reading[] = Array.from({ length: 7 }, (_unused, i) => ({ value: i * i }));
    const args = {
      init: () => ({ sum: 0 }),
      apply: (state: { sum: number }, event: Reading) => ({ sum: state.sum + event.value }),
      events,
    };

    /** @scenario the same fold and events always produce the same verdict */
    it("returns an identical report across repeated calls", () => {
      const first = checkOrderInvariance(args);
      const second = checkOrderInvariance(args);

      expect(second).toEqual(first);
    });
  });

  describe("given a state field that toggles between null and undefined by order", () => {
    /** @scenario an order-dependent fold reports how to reproduce the disagreement */
    it("finds a counterexample instead of treating them as equal", () => {
      const events: Array<{ makeNull: boolean }> = [
        { makeNull: true },
        { makeNull: false },
      ];

      const report = checkOrderInvariance({
        init: () => ({ value: 0 as number | null | undefined }),
        apply: (_state, event) => ({ value: event.makeNull ? null : undefined }),
        events,
      });

      expect(report.invariant).toBe(false);
      expect(report.cause).toBe("order");
    });
  });
});
