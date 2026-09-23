/**
 * @vitest-environment node
 * Registry must close AFTER queue drain to prevent event loss. Regression from
 * 55 dropped batches in worker graceful shutdown. {@link
 * specs/background/worker-graceful-shutdown.feature}
 */
import { describe, expect, it } from "vitest";

import { EventSourcing } from "../eventSourcing.ts";

/**
 * Test close order: queue closes before registry. Queue drain is held open
 * until finishQueueDrain() called.
 */
function closeWithRecording() {
  const order: string[] = [];
  let releaseQueueDrain: (() => void) | undefined;
  const queueDrained = new Promise<void>((resolve) => {
    releaseQueueDrain = resolve;
  });

  // `Object.create(the prototype)` on purpose, and NOT an object literal:
  // this test calls the REAL `close()` and asserts the order in which it
  // closes the global queue and then the projection registry. A literal
  // cannot carry that method, and `satisfies EventSourcing` over the four
  // fields the test controls does not type-check against the other 37.
  const eventSourcing = Object.create(EventSourcing.prototype) as EventSourcing &
    Record<string, unknown>;

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

        expect(order).toEqual(["globalQueue:start", "globalQueue:done", "projectionRegistry"]);
      });
    });
  });
});
