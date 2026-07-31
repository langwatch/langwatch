import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type {
  BuiltProcessManager,
  BuiltProcessManagerIntent,
} from "../pipeline/pipeline.types";
import type { HandlerContext, Outbox, OutboxRow } from "./contracts";
import { DispatchError } from "./dispatchError";
import { memoryClock, memoryOutbox } from "./memory";
import { createOutboxDispatcher } from "./outboxDispatcher";

/**
 * The outbox dispatcher claims a lease, delivers, and settles or fails
 * (ADR-108 decision 11). These tests are about the classification that
 * decides retry vs. dead, the ordering that keeps a durable effect from being
 * masked by a best-effort step around it, and the scoping of pruning.
 */

function fakeManager(args: {
  readonly name: string;
  readonly intents: Readonly<Record<string, BuiltProcessManagerIntent>>;
}): BuiltProcessManager {
  return {
    name: args.name,
    enabled: true,
    eventTypes: [],
    intentTypes: Object.keys(args.intents).map((k) => `${args.name}/${k}`),
    stateSchema: z.object({}),
    stateVersion: "v1",
    schemaHash: "v1",
    intents: args.intents,
    init: () => ({}),
    evolve: () => null,
  };
}

function intent(
  deliver: (payload: unknown, ctx: HandlerContext) => void | Promise<void>,
): BuiltProcessManagerIntent {
  return {
    payload: z.object({}),
    messageKey: () => "k",
    deliver,
  };
}

async function stageRow(
  outbox: Outbox,
  args: {
    readonly intentType: string;
    readonly messageKey?: string;
    readonly tenantId?: string;
  },
): Promise<void> {
  await outbox.stage([
    {
      intentType: args.intentType,
      messageKey: args.messageKey ?? args.intentType,
      tenantId: args.tenantId ?? "tenant-1",
      payload: JSON.stringify({}),
    },
  ]);
}

function findRow(
  outbox: ReturnType<typeof memoryOutbox>,
  intentType: string,
): OutboxRow & {
  readonly dead: boolean;
  readonly readyAt: number;
  readonly settledAt: number | null;
} {
  const row = outbox.rows.find((r) => r.intentType === intentType);
  if (!row) throw new Error(`no row staged for ${intentType}`);
  return row;
}

describe("outbox dispatcher", () => {
  describe("given a claimed row whose intent's delivery throws a retryable DispatchError", () => {
    /** @scenario A retryable failure schedules a backoff rather than killing the row */
    it("schedules a retry and does not mark the row dead", async () => {
      const clock = memoryClock(1000);
      const outbox = memoryOutbox(clock);
      const manager = fakeManager({
        name: "billing",
        intents: {
          charge: intent(() => {
            throw new DispatchError({
              message: "rate limited",
              retryable: true,
            });
          }),
        },
      });
      await stageRow(outbox, { intentType: "billing/charge" });
      const dispatcher = createOutboxDispatcher({
        outbox,
        clock,
        processManagers: [manager],
      });

      const result = await dispatcher.dispatchOnce({
        limit: 10,
        leaseMs: 1000,
      });

      expect(result).toEqual({ settled: 0, retried: 1, dead: 0 });
      const row = findRow(outbox, "billing/charge");
      expect(row.dead).toBe(false);
      expect(row.readyAt).toBeGreaterThan(clock.now());
    });
  });

  describe("given a claimed row whose intent's delivery throws a non-retryable DispatchError", () => {
    /** @scenario A terminal failure is marked dead without a retry */
    it("marks the row dead", async () => {
      const clock = memoryClock(1000);
      const outbox = memoryOutbox(clock);
      const manager = fakeManager({
        name: "billing",
        intents: {
          charge: intent(() => {
            throw new DispatchError({
              message: "card declined",
              retryable: false,
            });
          }),
        },
      });
      await stageRow(outbox, { intentType: "billing/charge" });
      const dispatcher = createOutboxDispatcher({
        outbox,
        clock,
        processManagers: [manager],
      });

      const result = await dispatcher.dispatchOnce({
        limit: 10,
        leaseMs: 1000,
      });

      expect(result).toEqual({ settled: 0, retried: 0, dead: 1 });
      expect(findRow(outbox, "billing/charge").dead).toBe(true);
    });
  });

  describe("given a claimed row whose intent's delivery throws an error carrying no recognizable classification", () => {
    /** @scenario An unclassifiable failure defaults to retryable */
    it("schedules a retry rather than marking the row dead", async () => {
      const clock = memoryClock(1000);
      const outbox = memoryOutbox(clock);
      const manager = fakeManager({
        name: "billing",
        intents: {
          charge: intent(() => {
            throw new Error("connection reset");
          }),
        },
      });
      await stageRow(outbox, { intentType: "billing/charge" });
      const dispatcher = createOutboxDispatcher({
        outbox,
        clock,
        processManagers: [manager],
      });

      const result = await dispatcher.dispatchOnce({
        limit: 10,
        leaseMs: 1000,
      });

      expect(result).toEqual({ settled: 0, retried: 1, dead: 0 });
      expect(findRow(outbox, "billing/charge").dead).toBe(false);
    });
  });

  describe("given a claimed row whose intent's delivery succeeds", () => {
    /** @scenario A successful delivery settles the row */
    it("settles the row and does not retry it", async () => {
      const clock = memoryClock(1000);
      const outbox = memoryOutbox(clock);
      const manager = fakeManager({
        name: "billing",
        intents: { charge: intent(() => undefined) },
      });
      await stageRow(outbox, { intentType: "billing/charge" });
      const dispatcher = createOutboxDispatcher({
        outbox,
        clock,
        processManagers: [manager],
      });

      const result = await dispatcher.dispatchOnce({
        limit: 10,
        leaseMs: 1000,
      });

      expect(result).toEqual({ settled: 1, retried: 0, dead: 0 });
      expect(findRow(outbox, "billing/charge").settledAt).not.toBeNull();
    });
  });

  describe("given a claimed row whose intent type matches no registered process manager", () => {
    /** @scenario A row naming an intent nobody declares is marked dead rather than retried forever */
    it("marks the row dead without attempting delivery", async () => {
      const clock = memoryClock(1000);
      const outbox = memoryOutbox(clock);
      const deliverSpy = vi.fn();
      const manager = fakeManager({
        name: "billing",
        intents: { charge: intent(deliverSpy) },
      });
      await stageRow(outbox, { intentType: "billing/refund" });
      const dispatcher = createOutboxDispatcher({
        outbox,
        clock,
        processManagers: [manager],
      });

      const result = await dispatcher.dispatchOnce({
        limit: 10,
        leaseMs: 1000,
      });

      expect(result).toEqual({ settled: 0, retried: 0, dead: 1 });
      expect(deliverSpy).not.toHaveBeenCalled();
    });
  });

  describe("given an intent whose delivery catches its own failure internally and returns normally", () => {
    /** @scenario A delivery that swallows its own failure and returns settles as if it had succeeded */
    it("settles the row, which is exactly why a delivery must throw to be seen as failed", async () => {
      const clock = memoryClock(1000);
      const outbox = memoryOutbox(clock);
      const manager = fakeManager({
        name: "billing",
        intents: {
          charge: intent(() => {
            try {
              throw new Error("the real side effect failed");
            } catch {
              // Logs and returns as if nothing happened — the outbox has no
              // way to tell this apart from genuine success.
            }
          }),
        },
      });
      await stageRow(outbox, { intentType: "billing/charge" });
      const dispatcher = createOutboxDispatcher({
        outbox,
        clock,
        processManagers: [manager],
      });

      const result = await dispatcher.dispatchOnce({
        limit: 10,
        leaseMs: 1000,
      });

      expect(result.settled).toBe(1);
      expect(findRow(outbox, "billing/charge").settledAt).not.toBeNull();
    });
  });

  describe("given an intent whose delivery performs its durable effect and then a best-effort cache update", () => {
    /** @scenario A cache update failing after a successful durable effect still settles */
    it("settles even though the trailing cache update failed", async () => {
      const clock = memoryClock(1000);
      const outbox = memoryOutbox(clock);
      const durableWrite = vi.fn();
      const manager = fakeManager({
        name: "billing",
        intents: {
          charge: intent(async () => {
            durableWrite();
            try {
              throw new Error("cache unavailable");
            } catch {
              // Best-effort; swallowed deliberately.
            }
          }),
        },
      });
      await stageRow(outbox, { intentType: "billing/charge" });
      const dispatcher = createOutboxDispatcher({
        outbox,
        clock,
        processManagers: [manager],
      });

      const result = await dispatcher.dispatchOnce({
        limit: 10,
        leaseMs: 1000,
      });

      expect(durableWrite).toHaveBeenCalledOnce();
      expect(result.settled).toBe(1);
    });
  });

  describe("given an intent whose delivery emits a best-effort signal and then its durable effect throws", () => {
    /** @scenario A durable effect failing is never masked by an earlier best-effort signal */
    it("is not settled, and is classified for retry or death like any other failure", async () => {
      const clock = memoryClock(1000);
      const outbox = memoryOutbox(clock);
      const signal = vi.fn();
      const manager = fakeManager({
        name: "billing",
        intents: {
          charge: intent(() => {
            signal();
            throw new DispatchError({
              message: "durable write failed",
              retryable: true,
            });
          }),
        },
      });
      await stageRow(outbox, { intentType: "billing/charge" });
      const dispatcher = createOutboxDispatcher({
        outbox,
        clock,
        processManagers: [manager],
      });

      const result = await dispatcher.dispatchOnce({
        limit: 10,
        leaseMs: 1000,
      });

      expect(signal).toHaveBeenCalledOnce();
      expect(result.settled).toBe(0);
      expect(findRow(outbox, "billing/charge").settledAt).toBeNull();
    });
  });

  describe("given dispatched rows belonging to two different process managers", () => {
    /** @scenario Pruning one process manager's dispatched history leaves another's untouched */
    it("removes only the pruned process manager's old rows", async () => {
      const clock = memoryClock(1000);
      const outbox = memoryOutbox(clock);
      const managerA = fakeManager({
        name: "billing",
        intents: { charge: intent(() => undefined) },
      });
      const managerB = fakeManager({
        name: "digest",
        intents: { send: intent(() => undefined) },
      });
      await stageRow(outbox, { intentType: "billing/charge" });
      await stageRow(outbox, {
        intentType: "digest/send",
        messageKey: "digest/send:2",
      });
      const dispatcher = createOutboxDispatcher({
        outbox,
        clock,
        processManagers: [managerA, managerB],
      });
      await dispatcher.dispatchOnce({ limit: 10, leaseMs: 1000 });
      clock.advance(10_000);

      const removed = await dispatcher.prune("billing", clock.now());

      expect(removed).toBe(1);
      expect(outbox.rows.some((r) => r.intentType === "billing/charge")).toBe(
        false,
      );
      expect(outbox.rows.some((r) => r.intentType === "digest/send")).toBe(
        true,
      );
    });
  });

  describe("given a staged intent whose delivery fails on its first attempt", () => {
    /** @scenario Work is retried until it succeeds */
    it("is attempted again after the backoff and stops once it succeeds", async () => {
      const clock = memoryClock(1000);
      const outbox = memoryOutbox(clock);
      let attempts = 0;
      const manager = fakeManager({
        name: "billing",
        intents: {
          charge: intent(() => {
            attempts += 1;
            if (attempts === 1)
              throw new DispatchError({
                message: "try again",
                retryable: true,
              });
          }),
        },
      });
      await stageRow(outbox, { intentType: "billing/charge" });
      const dispatcher = createOutboxDispatcher({
        outbox,
        clock,
        processManagers: [manager],
      });

      const first = await dispatcher.dispatchOnce({ limit: 10, leaseMs: 1000 });
      expect(first).toEqual({ settled: 0, retried: 1, dead: 0 });

      clock.advance(60_000);
      const second = await dispatcher.dispatchOnce({
        limit: 10,
        leaseMs: 1000,
      });

      expect(second).toEqual({ settled: 1, retried: 0, dead: 0 });
      expect(attempts).toBe(2);
    });
  });

  describe("given an event has caused a process manager to stage a chargeable intent", () => {
    /** @scenario Work that costs money survives the worker that started it */
    it("is delivered by a fresh dispatcher run reading the same outbox", async () => {
      const clock = memoryClock(1000);
      const outbox = memoryOutbox(clock);
      const deliverSpy = vi.fn();
      const manager = fakeManager({
        name: "billing",
        intents: { charge: intent(deliverSpy) },
      });
      await stageRow(outbox, { intentType: "billing/charge" });

      // "The worker that staged it is replaced": a brand new dispatcher, same
      // durable outbox.
      const freshDispatcher = createOutboxDispatcher({
        outbox,
        clock,
        processManagers: [manager],
      });
      const result = await freshDispatcher.dispatchOnce({
        limit: 10,
        leaseMs: 1000,
      });

      expect(deliverSpy).toHaveBeenCalledOnce();
      expect(result.settled).toBe(1);
    });
  });
});
