import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { CANCELLATION_CHANNEL } from "~/server/scenarios/cancellation-channel";
import type { SimulationProcessingEvent } from "../../schemas/events";
import {
  type CancellationBroadcastSubscriberDeps,
  createCancellationBroadcastSubscriber,
} from "../cancellationBroadcast.subscriber";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function createEvent(
  overrides: Record<string, unknown> = {},
): SimulationProcessingEvent {
  return {
    id: "event-1",
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: "project-1",
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: "lw.simulation_run.cancel_requested",
    version: "2026-04-06",
    data: { scenarioRunId: "run-1" },
    metadata: {},
    ...overrides,
  } as unknown as SimulationProcessingEvent;
}

const context = { tenantId: "project-1", aggregateId: "run-1" };

describe("createCancellationBroadcastSubscriber", () => {
  // Typed against the dep signature rather than `ReturnType<typeof vi.fn>`,
  // which is `Mock<Constructable | Procedure>` and assignable to neither —
  // it passes at runtime and fails `typecheck:tests`.
  type Publisher = NonNullable<
    CancellationBroadcastSubscriberDeps["publisher"]
  >;

  let publisher: { publish: Mock<Publisher["publish"]> };

  beforeEach(() => {
    publisher = { publish: vi.fn().mockResolvedValue(1) };
  });

  function subscriber(
    overrides: Partial<CancellationBroadcastSubscriberDeps> = {},
  ) {
    return createCancellationBroadcastSubscriber({ publisher, ...overrides });
  }

  describe("given the default wiring", () => {
    it("registers under the cancellationBroadcast name", () => {
      expect(subscriber().name).toBe("cancellationBroadcast");
    });

    it("subscribes to cancel_requested only", () => {
      expect(subscriber().eventTypes).toEqual([
        "lw.simulation_run.cancel_requested",
      ]);
    });

    it("declares no enqueue filter, so nothing fallible runs on the routing path", () => {
      expect(subscriber().options?.enqueue).toBeUndefined();
    });

    it("declares no deduplication, so no cancellation is ever squashed", () => {
      expect(subscriber().options?.deduplication).toBeUndefined();
    });
  });

  describe("when a cancel_requested event is handled", () => {
    it("publishes the run id, and nothing else, on the cancellation channel", async () => {
      await subscriber().handle(createEvent(), context);

      expect(publisher.publish).toHaveBeenCalledWith(
        CANCELLATION_CHANNEL,
        JSON.stringify({ scenarioRunId: "run-1" }),
      );
    });

    it("falls back to the aggregate id when the event body has no run id", async () => {
      await subscriber().handle(
        createEvent({ data: { scenarioRunId: "" } }),
        context,
      );

      expect(publisher.publish).toHaveBeenCalledWith(
        CANCELLATION_CHANNEL,
        JSON.stringify({ scenarioRunId: "run-1" }),
      );
    });
  });

  describe("when the event is not a cancel_requested", () => {
    it("ignores it, so a job staged by an older build is harmless", async () => {
      await subscriber().handle(
        createEvent({ type: "lw.simulation_run.finished" }),
        context,
      );

      expect(publisher.publish).not.toHaveBeenCalled();
    });
  });

  describe("when no publisher is configured", () => {
    it("skips the broadcast without failing the job", async () => {
      await expect(
        subscriber({ publisher: null }).handle(createEvent(), context),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the publish fails", () => {
    it("rethrows so the queue redelivers while the job is still in flight", async () => {
      // Not at-most-once: a lost cancellation leaves a child process running
      // on a run the user stopped, so this must stay a throw.
      publisher.publish.mockRejectedValue(new Error("redis down"));

      await expect(subscriber().handle(createEvent(), context)).rejects.toThrow(
        "redis down",
      );
    });
  });
});
