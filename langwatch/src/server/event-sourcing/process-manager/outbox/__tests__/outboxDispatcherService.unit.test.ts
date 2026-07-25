import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProcessManagerService } from "../../processManagerService";
import { InMemoryProcessStore } from "../../stores/inMemoryProcessStore";
import {
  pilotDefinition,
  pilotEvent,
  pilotRef,
  T0,
  type PilotState,
} from "../../__tests__/helpers/pilotProcess.fixture";
import {
  OutboxDispatcherService,
  type DispatchableMessage,
} from "../outboxDispatcherService";

describe("OutboxDispatcherService", () => {
  let store: InMemoryProcessStore;
  let service: ProcessManagerService<PilotState>;

  beforeEach(() => {
    store = new InMemoryProcessStore();
    service = new ProcessManagerService({
      definition: pilotDefinition,
      store,
    });
  });

  async function commitStartedTurn(): Promise<void> {
    await service.handleEvent({
      envelope: pilotEvent({ eventId: "evt_start" }),
      now: T0,
    });
  }

  describe("given a pending worker-dispatch intent", () => {
    beforeEach(commitStartedTurn);

    describe("when the dispatcher runs", () => {
      it("invokes the handler with the message identity and payload", async () => {
        const handler = vi.fn().mockResolvedValue(undefined);
        const dispatcher = new OutboxDispatcherService({
          store,
          handlers: { "worker-dispatch": handler },
        });

        const report = await dispatcher.runOnce({ now: T0 + 1 });

        expect(report.dispatched).toEqual(["dispatch:turn_1:1"]);
        expect(handler).toHaveBeenCalledTimes(1);
        const { message } = handler.mock.calls[0]![0] as {
          message: DispatchableMessage;
        };
        expect(message).toMatchObject({
          processName: pilotRef.processName,
          projectId: pilotRef.projectId,
          processKey: pilotRef.processKey,
          tenantId: "tenant_1",
          messageKey: "dispatch:turn_1:1",
          intentType: "worker-dispatch",
          sourceEventId: "evt_start",
          attempt: 1,
          payload: {
            turnId: "turn_1",
            generation: 1,
            handoffKey: "handoff:turn_1",
          },
        });
      });

      it("does not redeliver a dispatched message", async () => {
        const handler = vi.fn().mockResolvedValue(undefined);
        const dispatcher = new OutboxDispatcherService({
          store,
          handlers: { "worker-dispatch": handler },
        });

        await dispatcher.runOnce({ now: T0 + 1 });
        const second = await dispatcher.runOnce({ now: T0 + 60_000 });

        expect(second.dispatched).toEqual([]);
        expect(handler).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the handler fails on the first attempt", () => {
      it("redelivers the same logical message after the retry delay (at-least-once)", async () => {
        const handler = vi
          .fn()
          .mockRejectedValueOnce(new Error("worker unavailable"))
          .mockResolvedValue(undefined);
        const dispatcher = new OutboxDispatcherService({
          store,
          handlers: { "worker-dispatch": handler },
          retryDelayMs: () => 5_000,
        });

        const first = await dispatcher.runOnce({ now: T0 + 1 });
        expect(first.retried).toEqual(["dispatch:turn_1:1"]);

        const tooSoon = await dispatcher.runOnce({ now: T0 + 2 });
        expect(tooSoon.dispatched).toEqual([]);
        expect(tooSoon.retried).toEqual([]);

        const second = await dispatcher.runOnce({ now: T0 + 1 + 5_000 });
        expect(second.dispatched).toEqual(["dispatch:turn_1:1"]);
        expect(handler).toHaveBeenCalledTimes(2);

        const attempts = handler.mock.calls.map(
          (call) => (call[0] as { message: DispatchableMessage }).message,
        );
        expect(attempts[0]!.messageKey).toBe(attempts[1]!.messageKey);
        expect(attempts.map((message) => message.attempt)).toEqual([1, 2]);
      });

      it("uses a provider Retry-After as a floor over exponential backoff", async () => {
        const handler = vi
          .fn()
          .mockRejectedValueOnce(
            Object.assign(new Error("slow down"), { retryAfterMs: 90_000 }),
          )
          .mockResolvedValue(undefined);
        const dispatcher = new OutboxDispatcherService({
          store,
          handlers: { "worker-dispatch": handler },
          retryDelayMs: () => 5_000,
        });

        await dispatcher.runOnce({ now: T0 + 1 });
        await dispatcher.runOnce({ now: T0 + 5_001 });
        expect(handler).toHaveBeenCalledTimes(1);

        await dispatcher.runOnce({ now: T0 + 90_001 });
        expect(handler).toHaveBeenCalledTimes(2);
      });
    });

    describe("when the handler keeps failing past maxAttempts", () => {
      it("marks the message dead and stops leasing it", async () => {
        const handler = vi.fn().mockRejectedValue(new Error("always broken"));
        const dispatcher = new OutboxDispatcherService({
          store,
          handlers: { "worker-dispatch": handler },
          retryDelayMs: () => 1_000,
          maxAttempts: 2,
        });

        const first = await dispatcher.runOnce({ now: T0 + 1 });
        expect(first.retried).toEqual(["dispatch:turn_1:1"]);
        const second = await dispatcher.runOnce({ now: T0 + 2_000 });
        expect(second.dead).toEqual(["dispatch:turn_1:1"]);

        const third = await dispatcher.runOnce({ now: T0 + 60_000 });
        expect(third.dispatched).toEqual([]);
        expect(third.retried).toEqual([]);
        expect(handler).toHaveBeenCalledTimes(2);
      });
    });

    describe("when no handler is registered for the intent type", () => {
      it("schedules a retry instead of crashing", async () => {
        const dispatcher = new OutboxDispatcherService({
          store,
          handlers: {},
        });

        const report = await dispatcher.runOnce({ now: T0 + 1 });

        expect(report.dispatched).toEqual([]);
        expect(report.retried).toEqual(["dispatch:turn_1:1"]);
      });
    });

    describe("when another dispatcher holds the lease", () => {
      it("does not double-dispatch the same message", async () => {
        let releaseHandler!: () => void;
        const blocked = new Promise<void>((resolve) => {
          releaseHandler = resolve;
        });
        const handler = vi.fn().mockImplementation(async () => blocked);
        const dispatcher = new OutboxDispatcherService({
          store,
          handlers: { "worker-dispatch": handler },
          leaseDurationMs: 60_000,
        });

        const firstRun = dispatcher.runOnce({ now: T0 + 1 });
        await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

        const secondRun = await dispatcher.runOnce({ now: T0 + 2 });
        expect(secondRun.dispatched).toEqual([]);

        releaseHandler();
        const firstReport = await firstRun;
        expect(firstReport.dispatched).toEqual(["dispatch:turn_1:1"]);
        expect(handler).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given several pending intents", () => {
    async function commitTurns(count: number): Promise<void> {
      for (let index = 0; index < count; index++) {
        await service.handleEvent({
          envelope: pilotEvent({
            eventId: `evt_start_${index}`,
            processKey: `conv_${index}`,
            payload: { turnId: `turn_${index}` },
          }),
          now: T0,
        });
      }
    }

    /** Dispatcher whose handler records the peak number of in-flight calls. */
    function trackingDispatcher(concurrency?: number) {
      const seen = { inFlight: 0, peak: 0 };
      const dispatcher = new OutboxDispatcherService({
        store,
        ...(concurrency === undefined ? {} : { concurrency }),
        handlers: {
          "worker-dispatch": async () => {
            seen.inFlight += 1;
            seen.peak = Math.max(seen.peak, seen.inFlight);
            await new Promise((resolve) => setTimeout(resolve, 5));
            seen.inFlight -= 1;
          },
        },
      });
      return { dispatcher, seen };
    }

    describe("when concurrency is left at its default", () => {
      it("dispatches the batch one message at a time", async () => {
        await commitTurns(3);
        const { dispatcher, seen } = trackingDispatcher();

        const report = await dispatcher.runOnce({ now: T0 + 1 });

        expect(report.dispatched).toHaveLength(3);
        expect(seen.peak).toBe(1);
      });
    });

    describe("when concurrency is raised", () => {
      it("keeps that many dispatches in flight at once", async () => {
        await commitTurns(3);
        const { dispatcher, seen } = trackingDispatcher(3);

        const report = await dispatcher.runOnce({ now: T0 + 1 });

        expect(report.dispatched).toHaveLength(3);
        // Leasing three at a time but awaiting them in a loop still peaks at
        // one, which is how ADR-051's "~3 concurrent" claim went unmet: the
        // batch size bounded the lease, never the dispatch.
        expect(seen.peak).toBe(3);
      });
    });
  });
});
