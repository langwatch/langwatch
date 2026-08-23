/**
 * @vitest-environment node
 *
 * The projection registry must be released AFTER the queue that feeds it.
 *
 * Closing the registry only drops its router, and every dispatch arriving
 * afterwards discards its events: the guard logs and returns, and the one
 * caller (`eventSourcingService`) catches the dispatch failure and carries on,
 * so two layers swallow it and nothing above either retries. With the registry
 * closed first, that window was the entire queue drain — during which the
 * workers are very much still processing jobs and storing events.
 *
 * 55 dropped batches in the 48h to 2026-08-17, and all 55 landed after their
 * own pod's SIGTERM (zero before initialize), the latest 26s into the drain.
 *
 * Spec: specs/background/worker-graceful-shutdown.feature
 */
import { describe, expect, it } from "vitest";
import { EventSourcing } from "../eventSourcing";

/**
 * Drives the real `close()` against stubbed collaborators, recording the order
 * they are torn down in. Asserting on the sequence is the point: both closes
 * succeed either way, and only their order decides whether events are lost.
 *
 * The queue's close is held open until `finishQueueDrain()` is called. Stubs
 * that both resolve immediately cannot tell the orders apart — a `close()` that
 * fired both at once and merely happened to call the queue first would record
 * the same sequence — and "at once" is precisely the bug: the registry must not
 * release its router while the drain is still storing events.
 */
function closeWithRecording() {
  const order: string[] = [];
  let releaseQueueDrain: (() => void) | undefined;
  const queueDrained = new Promise<void>((resolve) => {
    releaseQueueDrain = resolve;
  });

  const eventSourcing = Object.create(
    EventSourcing.prototype,
  ) as EventSourcing & Record<string, unknown>;

  Object.assign(eventSourcing, {
    _processRuntimeInstance: undefined,
    pipelines: new Map(),
    _globalQueue: {
      close: async () => {
        order.push("globalQueue:start");
        await queueDrained;
        order.push("globalQueue:done");
      },
    },
    projectionRegistry: {
      isInitialized: true,
      close: async () => {
        order.push("projectionRegistry");
      },
    },
  });

  return {
    eventSourcing,
    order,
    finishQueueDrain: () => releaseQueueDrain?.(),
  };
}

/** Lets any already-scheduled microtasks run, so a premature close would show. */
const settleMicrotasks = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("closing event sourcing", () => {
  describe("given an initialized projection registry", () => {
    describe("when the queue drain is still in flight", () => {
      /** @scenario "The projection registry is closed after the queue that feeds it" */
      it("has not yet closed the projection registry", async () => {
        const { eventSourcing, order, finishQueueDrain } = closeWithRecording();

        const closing = eventSourcing.close();
        await settleMicrotasks();

        expect(order).toEqual(["globalQueue:start"]);

        finishQueueDrain();
        await closing;
      });
    });

    describe("when close() runs to completion", () => {
      /** @scenario "The projection registry is closed after the queue that feeds it" */
      it("closes the global queue before the projection registry", async () => {
        const { eventSourcing, order, finishQueueDrain } = closeWithRecording();

        const closing = eventSourcing.close();
        await settleMicrotasks();
        finishQueueDrain();
        await closing;

        expect(order).toEqual([
          "globalQueue:start",
          "globalQueue:done",
          "projectionRegistry",
        ]);
      });
    });
  });
});
