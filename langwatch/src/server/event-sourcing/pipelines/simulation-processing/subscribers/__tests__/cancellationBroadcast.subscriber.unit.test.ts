import { beforeEach, describe, expect, it, vi } from "vitest";
import { CANCELLATION_CHANNEL } from "~/server/scenarios/cancellation-channel";
import type { SimulationProcessingEvent } from "../../schemas/events";
import { createCancellationBroadcastSubscriber } from "../cancellationBroadcast.subscriber";

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
  let publisher: { publish: ReturnType<typeof vi.fn> };
  let readBatchRunId: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    publisher = { publish: vi.fn().mockResolvedValue(1) };
    readBatchRunId = vi.fn().mockResolvedValue("batch-1");
  });

  describe("given the default wiring", () => {
    it("registers under the cancellationBroadcast name", () => {
      const subscriber = createCancellationBroadcastSubscriber({
        publisher,
        readBatchRunId,
      });

      expect(subscriber.name).toBe("cancellationBroadcast");
    });

    it("subscribes to cancel_requested only", () => {
      const subscriber = createCancellationBroadcastSubscriber({
        publisher,
        readBatchRunId,
      });

      expect(subscriber.eventTypes).toEqual([
        "lw.simulation_run.cancel_requested",
      ]);
    });

    it("declares no enqueue filter, so nothing fallible runs on the routing path", () => {
      const subscriber = createCancellationBroadcastSubscriber({
        publisher,
        readBatchRunId,
      });

      expect(subscriber.options?.enqueue).toBeUndefined();
    });

    it("declares no deduplication, so no cancellation is ever squashed", () => {
      const subscriber = createCancellationBroadcastSubscriber({
        publisher,
        readBatchRunId,
      });

      expect(subscriber.options?.deduplication).toBeUndefined();
    });
  });

  describe("when a cancel_requested event is handled", () => {
    it("publishes the run, project and batch on the cancellation channel", async () => {
      const subscriber = createCancellationBroadcastSubscriber({
        publisher,
        readBatchRunId,
      });

      await subscriber.handle(createEvent(), context);

      expect(publisher.publish).toHaveBeenCalledWith(
        CANCELLATION_CHANNEL,
        JSON.stringify({
          scenarioRunId: "run-1",
          projectId: "project-1",
          batchRunId: "batch-1",
        }),
      );
    });

    it("resolves the batch id the event does not carry", async () => {
      const subscriber = createCancellationBroadcastSubscriber({
        publisher,
        readBatchRunId,
      });

      await subscriber.handle(createEvent(), context);

      expect(readBatchRunId).toHaveBeenCalledWith({
        tenantId: "project-1",
        scenarioRunId: "run-1",
      });
    });

    it("falls back to the aggregate id when the event body has no run id", async () => {
      const subscriber = createCancellationBroadcastSubscriber({
        publisher,
        readBatchRunId,
      });

      await subscriber.handle(
        createEvent({ data: { scenarioRunId: "" } }),
        context,
      );

      expect(readBatchRunId).toHaveBeenCalledWith({
        tenantId: "project-1",
        scenarioRunId: "run-1",
      });
    });
  });

  describe("when the event is not a cancel_requested", () => {
    it("ignores it, so a job staged by an older build is harmless", async () => {
      const subscriber = createCancellationBroadcastSubscriber({
        publisher,
        readBatchRunId,
      });

      await subscriber.handle(
        createEvent({ type: "lw.simulation_run.finished" }),
        context,
      );

      expect(publisher.publish).not.toHaveBeenCalled();
    });
  });

  describe("when no publisher is configured", () => {
    it("skips the broadcast without failing the job", async () => {
      const subscriber = createCancellationBroadcastSubscriber({
        publisher: null,
        readBatchRunId,
      });

      await expect(
        subscriber.handle(createEvent(), context),
      ).resolves.toBeUndefined();
      expect(readBatchRunId).not.toHaveBeenCalled();
    });
  });

  describe("when the batch id cannot be resolved", () => {
    it("publishes with an empty batch id when the lookup returns null", async () => {
      readBatchRunId.mockResolvedValue(null);
      const subscriber = createCancellationBroadcastSubscriber({
        publisher,
        readBatchRunId,
      });

      await subscriber.handle(createEvent(), context);

      expect(publisher.publish).toHaveBeenCalledWith(
        CANCELLATION_CHANNEL,
        JSON.stringify({
          scenarioRunId: "run-1",
          projectId: "project-1",
          batchRunId: "",
        }),
      );
    });

    it("still broadcasts when the lookup throws", async () => {
      readBatchRunId.mockRejectedValue(new Error("clickhouse down"));
      const subscriber = createCancellationBroadcastSubscriber({
        publisher,
        readBatchRunId,
      });

      await subscriber.handle(createEvent(), context);

      expect(publisher.publish).toHaveBeenCalledWith(
        CANCELLATION_CHANNEL,
        JSON.stringify({
          scenarioRunId: "run-1",
          projectId: "project-1",
          batchRunId: "",
        }),
      );
    });
  });

  describe("when the publish fails", () => {
    it("rethrows so the queue redelivers while the job is still in flight", async () => {
      publisher.publish.mockRejectedValue(new Error("redis down"));
      const subscriber = createCancellationBroadcastSubscriber({
        publisher,
        readBatchRunId,
      });

      await expect(subscriber.handle(createEvent(), context)).rejects.toThrow(
        "redis down",
      );
    });
  });
});
