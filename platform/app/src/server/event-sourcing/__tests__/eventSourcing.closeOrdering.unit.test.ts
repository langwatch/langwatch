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
 * Spec: specs/event-sourcing/worker-graceful-shutdown.feature
 */
import { describe, expect, it } from "vitest";
import { EventSourcing } from "../eventSourcing";

/**
 * Drives the real `close()` against stubbed collaborators, recording the order
 * they are torn down in. Asserting on the sequence is the point: both closes
 * succeed either way, and only their order decides whether events are lost.
 */
function closeWithRecording() {
  const order: string[] = [];
  const eventSourcing = Object.create(
    EventSourcing.prototype,
  ) as EventSourcing & Record<string, unknown>;

  Object.assign(eventSourcing, {
    _processRuntimeInstance: undefined,
    pipelines: new Map(),
    _globalQueue: {
      close: async () => {
        order.push("globalQueue");
      },
    },
    projectionRegistry: {
      isInitialized: true,
      close: async () => {
        order.push("projectionRegistry");
      },
    },
  });

  return { eventSourcing, order };
}

describe("closing event sourcing", () => {
  describe("given an initialized projection registry", () => {
    /** @scenario "The projection registry is closed after the queue that feeds it" */
    it("closes the global queue before the projection registry", async () => {
      const { eventSourcing, order } = closeWithRecording();

      await eventSourcing.close();

      expect(order).toEqual(["globalQueue", "projectionRegistry"]);
    });
  });
});
