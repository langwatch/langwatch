import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type PilotState,
  pilotDefinition,
  pilotEvent,
  pilotRef,
  T0,
} from "../../__tests__/helpers/pilotProcess.fixture";
import { ProcessManagerService } from "../../processManagerService";
import { InMemoryProcessStore } from "../../stores/inMemoryProcessStore";
import {
  type DispatchableMessage,
  OutboxDispatcherService,
} from "../outboxDispatcherService";

const { observeDispatchLag } = vi.hoisted(() => ({
  observeDispatchLag: vi.fn(),
}));
vi.mock("../../../metrics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../metrics")>()),
  observeEsProcessOutboxDispatchLag: observeDispatchLag,
}));

describe("OutboxDispatcherService", () => {
  let store: InMemoryProcessStore;
  let service: ProcessManagerService<PilotState>;

  beforeEach(() => {
    observeDispatchLag.mockClear();
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

    describe("when failed deliveries are recorded to the attempt log", () => {
      /** @scenario Each failed delivery records why it failed */
      it("appends one entry per failed attempt, oldest first, with the killer marked dead", async () => {
        // DispatchError's shape: a deliberately-written delivery diagnostic,
        // which the attempt log preserves verbatim.
        const transient = Object.assign(new Error("receiver returned 503"), {
          name: "DispatchError",
          retryable: true,
        });
        const handler = vi.fn().mockRejectedValue(transient);
        const dispatcher = new OutboxDispatcherService({
          store,
          handlers: { "worker-dispatch": handler },
          retryDelayMs: () => 1_000,
          maxAttempts: 2,
        });

        await dispatcher.runOnce({ now: T0 + 1 });
        await dispatcher.runOnce({ now: T0 + 2_000 });

        const attempts = store.findFailedAttempts({
          processName: pilotRef.processName,
          projectId: pilotRef.projectId,
          messageKey: "dispatch:turn_1:1",
        });
        expect(attempts.map((a) => a.attempt)).toEqual([1, 2]);
        expect(attempts[0]?.outcome).toBe("retry_scheduled");
        expect(attempts[1]?.outcome).toBe("dead");
        expect(attempts[1]?.errorMessage).toBe("receiver returned 503");
      });

      it("redacts the diagnostic for an untyped error, which can carry anything", async () => {
        const handler = vi
          .fn()
          .mockRejectedValue(new Error("raw payload: sk-secret"));
        const dispatcher = new OutboxDispatcherService({
          store,
          handlers: { "worker-dispatch": handler },
          retryDelayMs: () => 1_000,
          maxAttempts: 2,
        });

        await dispatcher.runOnce({ now: T0 + 1 });

        const attempts = store.findFailedAttempts({
          processName: pilotRef.processName,
          projectId: pilotRef.projectId,
          messageKey: "dispatch:turn_1:1",
        });
        expect(attempts[0]?.errorMessage).not.toContain("sk-secret");
      });

      it("redacts an error that merely claims to be retryable", async () => {
        // `retryable` alone is not proof of provenance: anything can carry it,
        // and only our own class stamps the DispatchError name.
        const impostor = Object.assign(new Error("raw payload: sk-secret"), {
          retryable: true,
        });
        const dispatcher = new OutboxDispatcherService({
          store,
          handlers: { "worker-dispatch": vi.fn().mockRejectedValue(impostor) },
          retryDelayMs: () => 1_000,
          maxAttempts: 2,
        });

        await dispatcher.runOnce({ now: T0 + 1 });

        const attempts = store.findFailedAttempts({
          processName: pilotRef.processName,
          projectId: pilotRef.projectId,
          messageKey: "dispatch:turn_1:1",
        });
        expect(attempts[0]?.errorMessage).not.toContain("sk-secret");
      });

      /** @scenario A recording failure never fails the delivery accounting */
      it("retries and retires exactly as it would have when the attempt log write throws", async () => {
        const failingStore = new Proxy(store, {
          get(target, prop, receiver) {
            if (prop === "recordFailedAttempt") {
              return () => Promise.reject(new Error("attempt log down"));
            }
            return Reflect.get(target, prop, receiver);
          },
        });
        const handler = vi.fn().mockRejectedValue(new Error("always broken"));
        const dispatcher = new OutboxDispatcherService({
          store: failingStore,
          handlers: { "worker-dispatch": handler },
          retryDelayMs: () => 1_000,
          maxAttempts: 2,
        });

        const first = await dispatcher.runOnce({ now: T0 + 1 });
        expect(first.retried).toEqual(["dispatch:turn_1:1"]);
        const second = await dispatcher.runOnce({ now: T0 + 2_000 });
        expect(second.dead).toEqual(["dispatch:turn_1:1"]);

        // The missing attempt entry is the only loss.
        expect(
          store.findFailedAttempts({
            processName: pilotRef.processName,
            projectId: pilotRef.projectId,
            messageKey: "dispatch:turn_1:1",
          }),
        ).toEqual([]);
      });
    });

    describe("when the handler throws a terminal error", () => {
      /** @scenario A permanent receiver error retires the batch immediately */
      it("dead-letters on that attempt instead of burning the remaining ladder", async () => {
        const terminal = Object.assign(new Error("HTTP 404"), {
          retryable: false,
        });
        const handler = vi.fn().mockRejectedValue(terminal);
        const dispatcher = new OutboxDispatcherService({
          store,
          handlers: { "worker-dispatch": handler },
          retryDelayMs: () => 1_000,
          maxAttempts: 10,
        });

        const first = await dispatcher.runOnce({ now: T0 + 1 });
        expect(first.dead).toEqual(["dispatch:turn_1:1"]);
        expect(first.retried).toEqual([]);

        const second = await dispatcher.runOnce({ now: T0 + 60_000 });
        expect(second.dispatched).toEqual([]);
        expect(second.retried).toEqual([]);
        expect(handler).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the handler throws a retryable-true error", () => {
      it("classifies it as retried and re-dispatches after the delay", async () => {
        const transient = Object.assign(new Error("HTTP 503"), {
          retryable: true,
        });
        const handler = vi.fn().mockRejectedValue(transient);
        const dispatcher = new OutboxDispatcherService({
          store,
          handlers: { "worker-dispatch": handler },
          retryDelayMs: () => 1_000,
          maxAttempts: 10,
        });

        const first = await dispatcher.runOnce({ now: T0 + 1 });
        expect(first.retried).toEqual(["dispatch:turn_1:1"]);
        expect(first.dead).toEqual([]);

        // The ladder is real: past the delay the same message dispatches
        // again as attempt two.
        const second = await dispatcher.runOnce({ now: T0 + 1_100 });
        expect(second.retried).toEqual(["dispatch:turn_1:1"]);
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

  describe("given a lease that lapses mid-delivery", () => {
    beforeEach(commitStartedTurn);

    describe("when the superseded delivery succeeds", () => {
      it("reports the acknowledgement as fenced, never as dispatched", async () => {
        let releaseSlowHandler!: () => void;
        const blocked = new Promise<void>((resolve) => {
          releaseSlowHandler = resolve;
        });
        const slow = new OutboxDispatcherService({
          store,
          handlers: { "worker-dispatch": vi.fn().mockReturnValue(blocked) },
          leaseDurationMs: 100,
        });
        const fast = new OutboxDispatcherService({
          store,
          handlers: { "worker-dispatch": vi.fn().mockResolvedValue(undefined) },
          leaseDurationMs: 100,
        });

        const slowRun = slow.runOnce({ now: T0 + 1 });
        // The slow dispatcher's lease lapses; a second dispatcher re-leases
        // and completes the same message.
        const fastReport = await fast.runOnce({ now: T0 + 200 });
        expect(fastReport.dispatched).toEqual(["dispatch:turn_1:1"]);

        releaseSlowHandler();
        const slowReport = await slowRun;
        expect(slowReport.fenced).toEqual(["dispatch:turn_1:1"]);
        expect(slowReport.dispatched).toEqual([]);
      });
    });

    describe("when the superseded delivery fails", () => {
      it("reports the acknowledgement as fenced, never as retried or dead", async () => {
        let rejectSlowHandler!: (error: Error) => void;
        const blocked = new Promise<void>((_resolve, reject) => {
          rejectSlowHandler = reject;
        });
        const slow = new OutboxDispatcherService({
          store,
          handlers: { "worker-dispatch": vi.fn().mockReturnValue(blocked) },
          leaseDurationMs: 100,
        });
        const fast = new OutboxDispatcherService({
          store,
          handlers: { "worker-dispatch": vi.fn().mockResolvedValue(undefined) },
          leaseDurationMs: 100,
        });

        const slowRun = slow.runOnce({ now: T0 + 1 });
        const fastReport = await fast.runOnce({ now: T0 + 200 });
        expect(fastReport.dispatched).toEqual(["dispatch:turn_1:1"]);

        rejectSlowHandler(new Error("handler failed after the lease lapsed"));
        const slowReport = await slowRun;
        expect(slowReport.fenced).toEqual(["dispatch:turn_1:1"]);
        expect(slowReport.retried).toEqual([]);
        expect(slowReport.dead).toEqual([]);

        // The rival's success stands: a fenced failure must not reopen a
        // message another dispatcher already completed.
        const rows = await store.findMessagesByRef({ ref: pilotRef });
        expect(rows[0]).toMatchObject({ status: "dispatched", attempts: 2 });
      });
    });
  });

  describe("given a batch whose earlier deliveries consume the lease budget", () => {
    describe("when the dispatcher reaches the remaining messages", () => {
      it("releases the tail un-attempted and leaves it immediately leasable", async () => {
        for (let index = 0; index < 3; index++) {
          await service.handleEvent({
            envelope: pilotEvent({
              eventId: `evt_start_${index}`,
              processKey: `conv_${index}`,
              payload: { turnId: `turn_${index}` },
            }),
            now: T0,
          });
        }
        let elapsed = 0;
        const handler = vi.fn().mockImplementation(async () => {
          elapsed += 600;
        });
        const dispatcher = new OutboxDispatcherService({
          store,
          handlers: { "worker-dispatch": handler },
          leaseDurationMs: 1_000,
          clock: () => elapsed,
        });

        // Safety margin is 200ms (20% of the lease). Deliveries one and two
        // fit; the third would start with none of the lease left.
        const first = await dispatcher.runOnce({ now: T0 + 1 });
        expect(first.dispatched).toHaveLength(2);
        expect(first.released).toHaveLength(1);
        expect(handler).toHaveBeenCalledTimes(2);

        // The released message was returned to the pool, not delayed: the
        // next drain at the same logical time picks it up.
        const second = await dispatcher.runOnce({ now: T0 + 2 });
        expect(second.dispatched).toEqual(first.released);
      });
    });
  });

  describe("given a domain whose slow deliveries earn it a large lease", () => {
    describe("when a delivery would start with less than the scaled margin", () => {
      it("scales the safety margin with the lease instead of capping it", async () => {
        for (let index = 0; index < 2; index++) {
          await service.handleEvent({
            envelope: pilotEvent({
              eventId: `evt_large_${index}`,
              processKey: `conv_large_${index}`,
              payload: { turnId: `turn_large_${index}` },
            }),
            now: T0,
          });
        }
        let elapsed = 0;
        const handler = vi.fn().mockImplementation(async () => {
          elapsed += 85_000;
        });
        const dispatcher = new OutboxDispatcherService({
          store,
          handlers: { "worker-dispatch": handler },
          leaseDurationMs: 100_000,
          clock: () => elapsed,
        });

        // Margin is 20_000ms (20% of the lease). After the first delivery
        // 15_000ms remain: under a flat 10_000ms cap the second delivery
        // would start and outlive the lease; the scaled margin releases it.
        const report = await dispatcher.runOnce({ now: T0 + 1 });

        expect(report.dispatched).toHaveLength(1);
        expect(report.released).toHaveLength(1);
        expect(handler).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given a lease query slowed by the same degraded store", () => {
    describe("when the query consumes most of the lease before any delivery", () => {
      it("counts the query time against the lease budget", async () => {
        await commitStartedTurn();
        let elapsed = 0;
        const slowLeasingStore = new Proxy(store, {
          get(target, property, receiver) {
            if (property !== "leaseDueMessages") {
              return Reflect.get(target, property, receiver);
            }
            return async (
              params: Parameters<typeof store.leaseDueMessages>[0],
            ) => {
              // The store anchors leasedUntil before the query runs, so a
              // slow query burns real lease time before any delivery starts.
              elapsed += 900;
              return target.leaseDueMessages(params);
            };
          },
        });
        const handler = vi.fn().mockResolvedValue(undefined);
        const dispatcher = new OutboxDispatcherService({
          store: slowLeasingStore,
          handlers: { "worker-dispatch": handler },
          leaseDurationMs: 1_000,
          clock: () => elapsed,
        });

        // 900ms of the 1_000ms lease went to the query; 100ms remain, under
        // the 200ms margin, so the delivery must not start.
        const report = await dispatcher.runOnce({ now: T0 + 1 });

        expect(report.dispatched).toHaveLength(0);
        expect(report.released).toHaveLength(1);
        expect(handler).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a message whose leases keep lapsing without any acknowledgement", () => {
    beforeEach(commitStartedTurn);

    describe("when a dispatcher leases it again", () => {
      it("retires it as dead without invoking the handler again", async () => {
        // Two delivery starts that never acknowledge (crashed mid-delivery):
        // each lease charges an attempt, each lease lapses.
        await store.leaseDueMessages({
          now: T0 + 1,
          limit: 1,
          leaseDurationMs: 100,
        });
        await store.leaseDueMessages({
          now: T0 + 200,
          limit: 1,
          leaseDurationMs: 100,
        });

        const handler = vi.fn().mockResolvedValue(undefined);
        const dispatcher = new OutboxDispatcherService({
          store,
          handlers: { "worker-dispatch": handler },
          maxAttempts: 2,
          leaseDurationMs: 100,
        });

        const report = await dispatcher.runOnce({ now: T0 + 400 });

        expect(report.dead).toEqual(["dispatch:turn_1:1"]);
        expect(handler).not.toHaveBeenCalled();

        const rows = await store.findMessagesByRef({ ref: pilotRef });
        expect(rows[0]).toMatchObject({ status: "dead" });
      });
    });
  });

  describe("given a delivery that crashed between the handler and its acknowledgement", () => {
    beforeEach(commitStartedTurn);

    describe("when the lease lapses and another dispatcher leases the message", () => {
      /** @scenario Attempt counting survives crashes between delivery and acknowledgement */
      it("redelivers with a higher attempt number and observes dispatch lag only once", async () => {
        // The crash: the first delivery starts, charging attempt one and
        // observing the commit-to-dispatch lag, and never acknowledges.
        const crashed = new OutboxDispatcherService({
          store,
          handlers: {
            "worker-dispatch": vi
              .fn()
              .mockReturnValue(new Promise<void>(() => undefined)),
          },
          leaseDurationMs: 100,
        });
        void crashed.runOnce({ now: T0 + 1 });
        await vi.waitFor(() =>
          expect(observeDispatchLag).toHaveBeenCalledTimes(1),
        );

        const handler = vi.fn().mockResolvedValue(undefined);
        const dispatcher = new OutboxDispatcherService({
          store,
          handlers: { "worker-dispatch": handler },
          leaseDurationMs: 100,
        });
        const report = await dispatcher.runOnce({ now: T0 + 200 });

        expect(report.dispatched).toEqual(["dispatch:turn_1:1"]);
        const { message } = handler.mock.calls[0]![0] as {
          message: DispatchableMessage;
        };
        // Before attempts were counted at lease time, this redelivery
        // reported attempt one forever: it re-observed first-attempt dispatch
        // lag on every redelivery and never crossed maxAttempts.
        expect(message.attempt).toBe(2);
        expect(observeDispatchLag).toHaveBeenCalledTimes(1);
      });
    });
  });
});
