import {
  checkOrderInvariance,
  type ProcessContext,
} from "@langwatch/event-sourcing";
import { TriggerAction } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchRecordedData } from "../events";
import { TerminalDispatchError } from "../intentDispatch";
import {
  addPending,
  digestBatchKey,
  drainDue,
  initTriggerSettlementState,
  MAX_PENDING_MATCHES,
  settleBoundary,
  type TriggerDispatchPorts,
  type TriggerSettlementState,
  triggerSettlementIntents,
  triggerSettlementOn,
  triggerSettlementOnWake,
} from "../triggerSettlement.process";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

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

const ctx = (overrides: Partial<ProcessContext> = {}): ProcessContext => ({
  processKey: "trigger-1",
  tenantId: "project-1",
  now: 1_000,
  ...overrides,
});

const recordMatch = (
  state: TriggerSettlementState,
  data: MatchRecordedData,
  c: ProcessContext,
) => triggerSettlementOn.matchRecorded!(state, data, c);

const wake = (state: TriggerSettlementState, c: ProcessContext) =>
  triggerSettlementOnWake(state, c);

describe("trigger settlement process", () => {
  describe("given a trace is already pending", () => {
    describe("when the trace matches again", () => {
      it("moves the durable settle wake later", () => {
        const first = addPending(initTriggerSettlementState(), match(), 1_000);
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
          overflowFlushed: 0,
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
          overflowFlushed: 0,
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
          overflowFlushed: 0,
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
          initTriggerSettlementState(),
          persistMatch(),
          ctx({ now: 1_000 }),
        );
        const firstWake = wake(firstRound.state, ctx({ now: 31_000 }));
        const secondRound = recordMatch(
          firstWake.state,
          persistMatch(),
          ctx({ now: 31_001 }),
        );
        const secondWake = wake(secondRound.state, ctx({ now: 61_001 }));

        expect(firstWake.intents.map((intent) => intent.type)).toEqual([
          "persistMatch",
        ]);
        expect(firstWake.intents[0]?.payload).toMatchObject({
          settleWindowBucket: "30000-0",
        });
        expect(secondWake.intents[0]?.payload).toMatchObject({
          settleWindowBucket: "30000-1",
        });
      });
    });
  });

  describe("given the same intent is minted twice from the same payload", () => {
    it("computes the identical message key, so a redelivery collapses", () => {
      const intents = triggerSettlementIntents({} as TriggerDispatchPorts);
      const first = intents.notifyDigest.messageKey({
        triggerId: "trigger-1",
        traceIds: ["b", "a"],
        boundary: 1_000,
      });
      const retried = intents.notifyDigest.messageKey({
        triggerId: "trigger-1",
        traceIds: ["a", "b"],
        boundary: 1_000,
      });

      expect(retried).toBe(first);
    });
  });

  describe("given a matchRecorded event is delivered twice", () => {
    it("lands on the same state both times — nothing in it accumulates", () => {
      const once = recordMatch(
        initTriggerSettlementState(),
        match(),
        ctx({ now: 1_000 }),
      );
      const twice = recordMatch(once.state, match(), ctx({ now: 1_000 }));

      expect(twice.state).toEqual(once.state);
      expect(twice.nextWakeAt).toBe(once.nextWakeAt);
    });
  });

  describe("given several matches arrive in any order, with any of them redelivered", () => {
    /**
     * `ProcessContext` carries only `now` (the instant this delivery is being
     * handled), not a separate "instant the event occurred" the way the old
     * process runtime's `ctx.at` did — so unlike the old pipeline, this state
     * is invariant to *ordering* at one wall-clock instant, not to *when*
     * each redelivery happens to be processed. That narrower guarantee is
     * what this asserts; the lost one is reported alongside this conversion.
     */
    it("reaches the same durable state for any order, at one wall-clock instant", () => {
      const report = checkOrderInvariance({
        init: () => initTriggerSettlementState(),
        apply: (state: TriggerSettlementState, data: MatchRecordedData) =>
          recordMatch(state, data, ctx({ now: 1_000 })).state,
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
          { pendingMatches, overflowFlushed: 0 },
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
          { pendingMatches, overflowFlushed: 0 },
          match({ traceId: "newest" }),
          ctx({ now: MAX_PENDING_MATCHES + 1 }),
        );

        expect(evolution.intents).toEqual([
          {
            type: "persistMatch",
            payload: {
              triggerId: "trigger-1",
              traceId: "trace-0",
              settleWindowBucket: "30000-0",
            },
          },
          {
            type: "logOverflow",
            payload: {
              triggerId: "trigger-1",
              traceIds: ["trace-0"],
              flushed: 1,
              totalFlushed: 1,
            },
          },
        ]);
      });
    });
  });

  describe("given a match delivered late, well after its own occurredAt", () => {
    describe("when the same match is redelivered later still", () => {
      it("mints the identical persist intent, so the customer's match is written once", () => {
        const persist = () =>
          match({
            action: TriggerAction.ADD_TO_DATASET,
            actionClass: "persist",
          });

        const first = recordMatch(
          initTriggerSettlementState(),
          persist(),
          ctx({ now: 1_000 }),
        );
        const redelivered = recordMatch(
          initTriggerSettlementState(),
          persist(),
          ctx({ now: 1_000 }),
        );

        expect(wake(redelivered.state, ctx({ now: 31_000 })).intents).toEqual(
          wake(first.state, ctx({ now: 31_000 })).intents,
        );
      });
    });
  });

  describe("given activity for one trace under one debounce configuration", () => {
    const bucketOf = (at: number, traceDebounceMs: number) =>
      addPending(initTriggerSettlementState(), match({ traceDebounceMs }), at)
        .state.pendingMatches["trace-1"]!.settleWindowBucket;

    it("names one round while activity stays inside the window, a new one after it", () => {
      expect(bucketOf(1_000, 30_000)).toBe("30000-0");
      expect(bucketOf(2_000, 30_000)).toBe("30000-0");
      expect(bucketOf(31_000, 30_000)).toBe("30000-1");
    });

    it("collapses only an exact redelivery when the debounce is disabled", () => {
      expect(bucketOf(1_000, 0)).toBe("0-1000");
      expect(bucketOf(1_001, 0)).toBe("0-1001");
    });
  });

  describe("given two pending matches share the oldest settle instant", () => {
    describe("when the cap forces an eviction", () => {
      it("evicts the same one whatever order the two arrived in", () => {
        const tied = {
          settleDueAt: 0,
          dispatchDueAt: 0,
          actionClass: "notify" as const,
          settleWindowBucket: "30000-0",
        };
        const filler = Object.fromEntries(
          Array.from({ length: MAX_PENDING_MATCHES - 2 }, (_unused, index) => [
            `trace-${index}`,
            {
              settleDueAt: index + 1,
              dispatchDueAt: index + 1,
              actionClass: "notify" as const,
              settleWindowBucket: "30000-0",
            },
          ]),
        );

        const forwards = addPending(
          {
            pendingMatches: { ...filler, "tie-a": tied, "tie-b": tied },
            overflowFlushed: 0,
          },
          match({ traceId: "newest" }),
          MAX_PENDING_MATCHES + 1,
        );
        const backwards = addPending(
          {
            pendingMatches: { "tie-b": tied, "tie-a": tied, ...filler },
            overflowFlushed: 0,
          },
          match({ traceId: "newest" }),
          MAX_PENDING_MATCHES + 1,
        );

        expect(forwards.flushed.map(({ traceId }) => traceId)).toEqual([
          "tie-a",
        ]);
        expect(backwards.flushed.map(({ traceId }) => traceId)).toEqual([
          "tie-a",
        ]);
      });
    });
  });
});

// ---- intent delivery ----

function makePorts(overrides: Partial<TriggerDispatchPorts> = {}): {
  ports: TriggerDispatchPorts;
  claimed: Set<string>;
} {
  const claimed = new Set<string>();
  const ports: TriggerDispatchPorts = {
    triggerIsActive: vi.fn().mockResolvedValue(true),
    confirmSettledMatch: vi.fn().mockResolvedValue("confirmed"),
    isSendClaimed: vi.fn(async ({ traceId }) => claimed.has(traceId)),
    claimSend: vi.fn(async ({ traceId }) => {
      claimed.add(traceId);
    }),
    sendNotifyDigest: vi.fn().mockResolvedValue(undefined),
    runPersistAction: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { ports, claimed };
}

const deliverCtx = { now: 1_000, tenantId: "project-1" };

describe("trigger settlement intent delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("logOverflow", () => {
    it("logs the committed flush count", async () => {
      const { deliver } = triggerSettlementIntents(
        makePorts().ports,
      ).logOverflow;
      await expect(
        deliver(
          {
            triggerId: "trigger-1",
            traceIds: ["trace-1", "trace-2"],
            flushed: 2,
            totalFlushed: 2,
          },
          deliverCtx,
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe("notifyDigest", () => {
    describe("given the trigger was deleted or deactivated since the match", () => {
      it("drops without confirming or sending", async () => {
        const { ports } = makePorts({
          triggerIsActive: vi.fn().mockResolvedValue(false),
        });

        await triggerSettlementIntents(ports).notifyDigest.deliver(
          { triggerId: "trigger-1", traceIds: ["trace-1"], boundary: 1_000 },
          deliverCtx,
        );

        expect(ports.confirmSettledMatch).not.toHaveBeenCalled();
        expect(ports.sendNotifyDigest).not.toHaveBeenCalled();
      });
    });

    describe("given a digest batch with one confirmed trace and one whose filters no longer pass", () => {
      /** @scenario An automation does not fire when its condition is unmet */
      it("sends only the trace that still confirms, leaving the other unfired", async () => {
        const { ports } = makePorts({
          confirmSettledMatch: vi.fn(async ({ traceId }) =>
            traceId === "trace-filtered" ? "filters-failed" : "confirmed",
          ),
        });

        await triggerSettlementIntents(ports).notifyDigest.deliver(
          {
            triggerId: "trigger-1",
            traceIds: ["trace-1", "trace-filtered"],
            boundary: 1_000,
          },
          deliverCtx,
        );

        expect(ports.sendNotifyDigest).toHaveBeenCalledTimes(1);
        expect(ports.sendNotifyDigest).toHaveBeenCalledWith(
          expect.objectContaining({ traceIds: ["trace-1"] }),
        );
        expect(ports.claimSend).toHaveBeenCalledTimes(1);
      });
    });

    describe("given a notify trace already claimed by an earlier settle round", () => {
      /** @scenario An automation fires at most once per trace */
      it("suppresses the duplicate send across settle windows", async () => {
        const { ports } = makePorts();
        const { deliver } = triggerSettlementIntents(ports).notifyDigest;

        await deliver(
          { triggerId: "trigger-1", traceIds: ["trace-1"], boundary: 31_000 },
          deliverCtx,
        );
        await deliver(
          { triggerId: "trigger-1", traceIds: ["trace-1"], boundary: 61_000 },
          deliverCtx,
        );

        expect(ports.sendNotifyDigest).toHaveBeenCalledTimes(1);
        expect(ports.claimSend).toHaveBeenCalledTimes(1);
      });
    });

    describe("given the trace's fold has not caught up yet", () => {
      it("throws so the outbox retries, instead of dropping the match", async () => {
        const { ports } = makePorts({
          confirmSettledMatch: vi.fn().mockResolvedValue("trace-not-settled"),
        });

        await expect(
          triggerSettlementIntents(ports).notifyDigest.deliver(
            { triggerId: "trigger-1", traceIds: ["trace-1"], boundary: 1_000 },
            deliverCtx,
          ),
        ).rejects.toThrow(/not settled/);
        expect(ports.sendNotifyDigest).not.toHaveBeenCalled();
      });
    });

    describe("given the dispatch port fails with a terminal error", () => {
      it("drops as a logged completion, without retrying", async () => {
        const { ports } = makePorts({
          sendNotifyDigest: vi
            .fn()
            .mockRejectedValue(
              new TerminalDispatchError("all recipients suppressed"),
            ),
        });

        await expect(
          triggerSettlementIntents(ports).notifyDigest.deliver(
            { triggerId: "trigger-1", traceIds: ["trace-1"], boundary: 1_000 },
            deliverCtx,
          ),
        ).resolves.toBeUndefined();
        expect(ports.claimSend).not.toHaveBeenCalled();
      });
    });

    describe("given the dispatch port fails with a plain, retryable error", () => {
      it("rethrows for the outbox to retry with backoff", async () => {
        const { ports } = makePorts({
          sendNotifyDigest: vi
            .fn()
            .mockRejectedValue(new Error("provider timeout")),
        });

        await expect(
          triggerSettlementIntents(ports).notifyDigest.deliver(
            { triggerId: "trigger-1", traceIds: ["trace-1"], boundary: 1_000 },
            deliverCtx,
          ),
        ).rejects.toThrow("provider timeout");
      });
    });

    describe("given claimSend fails after a successful send", () => {
      it("swallows the claim failure rather than retrying and double-sending", async () => {
        const { ports } = makePorts({
          claimSend: vi
            .fn()
            .mockRejectedValue(new Error("claim store unavailable")),
        });

        await expect(
          triggerSettlementIntents(ports).notifyDigest.deliver(
            { triggerId: "trigger-1", traceIds: ["trace-1"], boundary: 1_000 },
            deliverCtx,
          ),
        ).resolves.toBeUndefined();
        expect(ports.sendNotifyDigest).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("persistMatch", () => {
    describe("given the trace was already claimed", () => {
      it("skips without re-confirming or running the action", async () => {
        const { ports } = makePorts({
          isSendClaimed: vi.fn().mockResolvedValue(true),
        });

        await triggerSettlementIntents(ports).persistMatch.deliver(
          {
            triggerId: "trigger-1",
            traceId: "trace-1",
            settleWindowBucket: "30000-0",
          },
          deliverCtx,
        );

        expect(ports.confirmSettledMatch).not.toHaveBeenCalled();
        expect(ports.runPersistAction).not.toHaveBeenCalled();
      });
    });

    describe("given a persist trace only passes filters in a later settle round", () => {
      it("runs the persist action once the later confirm succeeds", async () => {
        const { ports } = makePorts({
          confirmSettledMatch: vi
            .fn()
            .mockResolvedValueOnce("filters-failed")
            .mockResolvedValueOnce("confirmed"),
        });
        const { deliver } = triggerSettlementIntents(ports).persistMatch;

        await deliver(
          {
            triggerId: "trigger-1",
            traceId: "trace-1",
            settleWindowBucket: "30000-0",
          },
          deliverCtx,
        );
        await deliver(
          {
            triggerId: "trigger-1",
            traceId: "trace-1",
            settleWindowBucket: "30000-1",
          },
          deliverCtx,
        );

        expect(ports.runPersistAction).toHaveBeenCalledTimes(1);
        expect(ports.claimSend).toHaveBeenCalledTimes(1);
      });
    });

    describe("given the persist action fails with a terminal error", () => {
      it("drops as a logged completion without claiming", async () => {
        const { ports } = makePorts({
          runPersistAction: vi
            .fn()
            .mockRejectedValue(new TerminalDispatchError("dataset deleted")),
        });

        await expect(
          triggerSettlementIntents(ports).persistMatch.deliver(
            {
              triggerId: "trigger-1",
              traceId: "trace-1",
              settleWindowBucket: "30000-0",
            },
            deliverCtx,
          ),
        ).resolves.toBeUndefined();
        expect(ports.claimSend).not.toHaveBeenCalled();
      });
    });
  });
});
