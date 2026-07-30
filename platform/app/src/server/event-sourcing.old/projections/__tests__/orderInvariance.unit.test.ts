import { describe, expect, it } from "vitest";
import type { Event } from "../../domain/types";
import type { FoldProjectionDefinition } from "../foldProjection.types";
import { asSet, assertOrderInvariant } from "../orderInvariance";

/**
 * The harness's own proof. A harness that cannot fail proves nothing about the
 * folds it is pointed at, and "every fold passed" is exactly what a broken
 * harness looks like.
 */

interface State {
  total: number;
  latest: string;
  seen: string[];
  checkpoint: number;
}

function fold(
  apply: (state: State, event: Event) => State,
): FoldProjectionDefinition<State, Event> {
  return {
    name: "toy",
    version: "v1",
    eventTypes: [],
    LastEventOccurredAtKey: "checkpoint",
    init: () => ({ total: 0, latest: "", seen: [], checkpoint: 0 }),
    apply,
    store: { store: async () => {}, get: async () => null },
  };
}

const commuting = fold((state, event) => ({
  ...state,
  total: state.total + Number((event as unknown as { amount: number }).amount),
  seen: [...state.seen, event.id],
  checkpoint: Math.max(state.checkpoint, event.occurredAt),
}));

/** Last one applied wins — the classic order-dependent accumulator. */
const lastWriteWins = fold((state, event) => ({
  ...state,
  latest: event.id,
  checkpoint: Math.max(state.checkpoint, event.occurredAt),
}));

const events = [1, 2, 3, 4].map(
  (n) =>
    ({
      id: `e${n}`,
      type: "x",
      occurredAt: n * 100,
      createdAt: n * 100,
      amount: n,
    }) as unknown as Event,
);

const invariants = [
  { name: "total", of: (state: State) => state.total },
  { name: "seen (as a set)", of: (state: State) => asSet(state.seen) },
  { name: "checkpoint (latest wins)", of: (state: State) => state.checkpoint },
];

describe("assertOrderInvariant", () => {
  describe("given a fold whose accumulators commute", () => {
    it("passes over every ordering", () => {
      const result = assertOrderInvariant({
        projection: commuting,
        events,
        invariants,
      });

      expect(result.exhaustive).toBe(true);
      expect(result.orderings).toBe(24);
    });
  });

  describe("given a fold whose result depends on arrival order", () => {
    it("fails, naming the invariant and the ordering that broke it", () => {
      expect(() =>
        assertOrderInvariant({
          projection: lastWriteWins,
          events,
          invariants: [{ name: "latest", of: (state: State) => state.latest }],
        }),
      ).toThrow(
        /is not order-invariant: "latest" was "e4" .* and "e[123]" under \[/,
      );
    });
  });

  describe("given more events than can be enumerated", () => {
    it("samples deterministically rather than enumerating", () => {
      const many = Array.from(
        { length: 9 },
        (_, index) =>
          ({
            id: `e${index}`,
            type: "x",
            occurredAt: index * 100,
            createdAt: index * 100,
            amount: index,
          }) as unknown as Event,
      );

      const result = assertOrderInvariant({
        projection: commuting,
        events: many,
        invariants,
        samples: 50,
      });

      expect(result.exhaustive).toBe(false);
      expect(result.orderings).toBe(50);
    });
  });

  describe("given no invariants at all", () => {
    it("refuses to run rather than passing vacuously", () => {
      expect(() =>
        assertOrderInvariant({
          projection: commuting,
          events,
          invariants: [],
        }),
      ).toThrow(/proves nothing/);
    });
  });
});
