import { checkOrderInvariance } from "@langwatch/event-sourcing";
import { TriggerAction } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { type MatchRecordedData, triggerAggregate } from "../aggregate";
import {
  addPending,
  digestBatchKey,
  drainDue,
  MAX_PENDING_MATCHES,
  settleBoundary,
  type TriggerSettlementState,
  triggerSettlement,
} from "../process-managers/triggerSettlement";

const initialState = (): TriggerSettlementState => triggerSettlement.init();

const match = (
  overrides: Partial<MatchRecordedData> = {},
): MatchRecordedData => ({
  triggerId: "trigger-1",
  traceId: "trace-1",
  action: TriggerAction.SEND_EMAIL,
  actionClass: "notify",
  traceDebounceMs: 30_000,
  notificationCadence: "immediate",
  ...overrides,
});

const context = (overrides: Partial<{ at: number; now: number }> = {}) => ({
  processKey: "trigger-1",
  tenantId: "project-1",
  at: overrides.at ?? 1_000,
  now: overrides.now ?? overrides.at ?? 1_000,
});

const recordMatch = (
  state: TriggerSettlementState,
  data: MatchRecordedData,
  ctx: ReturnType<typeof context>,
) =>
  triggerSettlement.evolve(
    state,
    triggerAggregate.events.matchRecorded(data),
    triggerSettlement.intents,
    ctx,
  )!;

const wake = (state: TriggerSettlementState, ctx: ReturnType<typeof context>) =>
  triggerSettlement.onWake!(state, triggerSettlement.intents, ctx);

describe("trigger settlement process", () => {
  describe("given a trace is already pending", () => {
    describe("when the trace matches again", () => {
      it("moves the durable settle wake later", () => {
        const first = addPending(initialState(), match(), 1_000);
        const second = addPending(first.state, match(), 10_000);

        expect(settleBoundary(second.state)).toBe(40_000);
      });
    });
  });

  describe("given notify and persist matches are due", () => {
    describe("when the process wakes", () => {
      it("coalesces notify matches at one cadence boundary", () => {
        const state: TriggerSettlementState = {
          pendingMatches: {
            "trace-b": {
              settleDueAt: 900,
              dispatchDueAt: 1_000,
              actionClass: "notify",
              settleWindowBucket: "30000-0",
            },
            "trace-a": {
              settleDueAt: 800,
              dispatchDueAt: 1_000,
              actionClass: "notify",
              settleWindowBucket: "30000-0",
            },
          },
        };

        expect(drainDue(state, 1_000).boundaries).toEqual([
          { key: 1_000, traceIds: ["trace-a", "trace-b"] },
        ]);
      });

      it("emits persist matches independently", () => {
        const state: TriggerSettlementState = {
          pendingMatches: {
            "trace-a": {
              settleDueAt: 800,
              dispatchDueAt: 1_000,
              actionClass: "persist",
              settleWindowBucket: "30000-0",
            },
            "trace-b": {
              settleDueAt: 900,
              dispatchDueAt: 1_000,
              actionClass: "persist",
              settleWindowBucket: "30000-0",
            },
          },
        };

        expect(drainDue(state, 1_000).settledMatches).toEqual([
          { traceId: "trace-a", settleWindowBucket: "30000-0" },
          { traceId: "trace-b", settleWindowBucket: "30000-0" },
        ]);
      });

      it("keeps the next future boundary durable", () => {
        const state: TriggerSettlementState = {
          pendingMatches: {
            due: {
              settleDueAt: 800,
              dispatchDueAt: 1_000,
              actionClass: "notify",
              settleWindowBucket: "30000-0",
            },
            future: {
              settleDueAt: 1_800,
              dispatchDueAt: 2_000,
              actionClass: "notify",
              settleWindowBucket: "30000-0",
            },
          },
        };

        expect(drainDue(state, 1_000).nextBoundary).toBe(2_000);
      });
    });
  });

  describe("given a persist match completed its settle round", () => {
    describe("when later activity arrives in a new settle window", () => {
      it("creates a fresh persist intent for the later round", () => {
        const persistMatch = () =>
          match({
            action: TriggerAction.ADD_TO_DATASET,
            actionClass: "persist",
          });

        const firstRound = recordMatch(
          initialState(),
          persistMatch(),
          context({ at: 1_000 }),
        );
        const firstWake = wake(firstRound.state, context({ at: 31_000 }));
        const secondRound = recordMatch(
          firstWake.state,
          persistMatch(),
          context({ at: 31_001 }),
        );
        const secondWake = wake(secondRound.state, context({ at: 61_001 }));

        expect(firstWake.intents.map((intent) => intent.messageKey)).toEqual([
          "persist:trace-1:30000-0",
        ]);
        expect(secondWake.intents.map((intent) => intent.messageKey)).toEqual([
          "persist:trace-1:30000-1",
        ]);
      });
    });
  });

  describe("given the same intent is minted twice from the same payload", () => {
    it("computes the identical message key, so a redelivery collapses", () => {
      const first = triggerSettlement.intents.notifyDigest({
        triggerId: "trigger-1",
        traceIds: ["b", "a"],
        boundary: 1_000,
      });
      const retried = triggerSettlement.intents.notifyDigest({
        triggerId: "trigger-1",
        traceIds: ["a", "b"],
        boundary: 1_000,
      });

      expect(retried.messageKey).toBe(first.messageKey);
      expect(first.intentType).toBe("triggerSettlement/notifyDigest");
    });
  });

  describe("given a matchRecorded event is delivered twice", () => {
    it("lands on the same state both times — nothing in it accumulates", () => {
      const once = recordMatch(initialState(), match(), context({ at: 1_000 }));
      const twice = recordMatch(once.state, match(), context({ at: 1_000 }));

      expect(twice.state).toEqual(once.state);
      expect(twice.nextWakeAt).toBe(once.nextWakeAt);
    });
  });

  describe("given several matches arrive in any order, with any of them redelivered", () => {
    it("reaches the same durable state every time", () => {
      const ctx = context({ at: 1_000 });
      const report = checkOrderInvariance({
        init: () => triggerSettlement.init(),
        apply: (state: TriggerSettlementState, data: MatchRecordedData) =>
          recordMatch(state, data, ctx).state,
        events: [
          match({ traceId: "trace-a" }),
          match({ traceId: "trace-b", actionClass: "persist" }),
          match({ traceId: "trace-c", traceDebounceMs: 0 }),
          match({ traceId: "trace-a", notificationCadence: "immediate" }),
        ],
      });

      expect(report.invariant).toBe(true);
      expect(report.duplicatesChecked).toBe(4);
    });
  });

  describe("given more pending matches than the state bound", () => {
    describe("when another match is recorded", () => {
      it("flushes the oldest match out of pending state without discarding it", () => {
        const pendingMatches = Object.fromEntries(
          Array.from({ length: MAX_PENDING_MATCHES }, (_, index) => [
            `trace-${index}`,
            {
              settleDueAt: index,
              dispatchDueAt: index,
              actionClass: "notify" as const,
              settleWindowBucket: "30000-0",
            },
          ]),
        );

        const next = addPending(
          { pendingMatches },
          match({ traceId: "newest" }),
          MAX_PENDING_MATCHES + 1,
        );

        expect(Object.keys(next.state.pendingMatches)).toHaveLength(
          MAX_PENDING_MATCHES,
        );
        expect(next.state.pendingMatches["trace-0"]).toBeUndefined();
        expect(next.flushed).toEqual([
          {
            traceId: "trace-0",
            match: {
              settleDueAt: 0,
              dispatchDueAt: 0,
              actionClass: "notify",
              settleWindowBucket: "30000-0",
            },
          },
        ]);
      });

      it("emits immediate dispatch intents for the flushed matches plus one log intent", () => {
        const pendingMatches = Object.fromEntries(
          Array.from({ length: MAX_PENDING_MATCHES }, (_, index) => [
            `trace-${index}`,
            {
              settleDueAt: index,
              dispatchDueAt: index === 0 ? 1_000 : index,
              actionClass:
                index === 0 ? ("persist" as const) : ("notify" as const),
              settleWindowBucket: "30000-0",
            },
          ]),
        );

        const evolution = recordMatch(
          { pendingMatches },
          match({ traceId: "newest" }),
          context({ at: MAX_PENDING_MATCHES + 1 }),
        );

        // trace-0 (oldest, persist-class) flushes to an immediate persist
        // intent carrying its settle-window identity; the log intent names the
        // flushed traces. Nothing is discarded.
        expect(evolution.intents).toEqual([
          {
            messageKey: "persist:trace-0:30000-0",
            intentType: "triggerSettlement/persistMatch",
            payload: {
              triggerId: "trigger-1",
              traceId: "trace-0",
              settleWindowBucket: "30000-0",
            },
          },
          {
            messageKey: `overflow:${digestBatchKey(["trace-0"])}`,
            intentType: "triggerSettlement/logOverflow",
            payload: { triggerId: "trigger-1", traceIds: ["trace-0"] },
          },
        ]);
      });
    });
  });

  describe("given a match delivered late, well after its own occurredAt", () => {
    describe("when the process schedules its boundary", () => {
      it("schedules from wall-clock now, never from the stale event time", () => {
        // Scheduling from `at` alone would compute a boundary already behind
        // the present and dispatch immediately as a singleton, defeating the
        // coalescing the settle window exists for.
        const evolution = recordMatch(
          initialState(),
          match({ traceDebounceMs: 0, notificationCadence: "immediate" }),
          {
            processKey: "trigger-1",
            tenantId: "project-1",
            at: 1_000,
            now: 100_000,
          },
        );

        expect(settleBoundary(evolution.state)).toBe(100_000);
      });
    });
  });
});
