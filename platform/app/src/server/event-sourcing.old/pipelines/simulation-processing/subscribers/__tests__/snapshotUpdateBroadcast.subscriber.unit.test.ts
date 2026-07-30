import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import type { BroadcastService } from "~/server/app-layer/broadcast/broadcast.service";

import type { SimulationProcessingEvent } from "../../schemas/events";
import {
  createSnapshotUpdateBroadcastSubscriber,
  SNAPSHOT_UPDATE_BROADCAST_DEDUP_TTL_MS,
} from "../snapshotUpdateBroadcast.subscriber";

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
    type: "lw.simulation_run.started",
    version: "2026-02-01",
    data: {
      scenarioRunId: "run-1",
      scenarioId: "scenario-1",
      batchRunId: "batch-1",
      scenarioSetId: "set-1",
    },
    metadata: {},
    ...overrides,
  } as unknown as SimulationProcessingEvent;
}

const context = { tenantId: "project-1", aggregateId: "run-1" };

describe("createSnapshotUpdateBroadcastSubscriber", () => {
  type BroadcastToTenant = BroadcastService["broadcastToTenant"];

  let broadcast: { broadcastToTenant: Mock<BroadcastToTenant> };

  beforeEach(() => {
    broadcast = { broadcastToTenant: vi.fn().mockResolvedValue(undefined) };
  });

  function subscriber() {
    return createSnapshotUpdateBroadcastSubscriber({
      broadcast: broadcast as unknown as BroadcastService,
    });
  }

  function pushedPayload(): Record<string, unknown> {
    const [, payload] = broadcast.broadcastToTenant.mock.calls[0]!;
    return JSON.parse(payload as string) as Record<string, unknown>;
  }

  describe("given the default wiring", () => {
    it("registers under the snapshotUpdateBroadcast name", () => {
      expect(subscriber().name).toBe("snapshotUpdateBroadcast");
    });

    it("narrows on no event type, so a new event still nudges the client", () => {
      expect(subscriber().eventTypes).toEqual([]);
    });

    it("debounces so a burst of run events collapses into one push", () => {
      expect(subscriber().options?.deduplication).toEqual({
        makeId: expect.any(Function),
        ttlMs: SNAPSHOT_UPDATE_BROADCAST_DEDUP_TTL_MS,
      });
    });

    it("keys the debounce per run, so two runs never squash each other", () => {
      const strategy = subscriber().options?.deduplication;
      const makeId = typeof strategy === "object" ? strategy.makeId : undefined;

      expect(makeId?.(createEvent())).not.toBe(
        makeId?.(createEvent({ aggregateId: "run-2" })),
      );
    });
  });

  describe("given the enqueue filter", () => {
    it("accepts an ordinary run event", () => {
      expect(subscriber().options?.enqueue?.filter?.(createEvent())).toBe(true);
    });

    it("declines text_message_start, so streaming content is not replaced mid-flight", () => {
      expect(
        subscriber().options?.enqueue?.filter?.(
          createEvent({ type: "lw.simulation_run.text_message_start" }),
        ),
      ).toBe(false);
    });

    it("answers rather than throws for an event carrying no data at all", () => {
      // Totality is the whole point: the enqueue seam has no retry, so a
      // throw here loses the job for this event permanently.
      expect(
        subscriber().options?.enqueue?.filter?.({
          type: "lw.simulation_run.finished",
        } as unknown as SimulationProcessingEvent),
      ).toBe(true);
    });
  });

  describe("when a run event is handled", () => {
    it("pushes the run identities the client filters on", async () => {
      await subscriber().handle(createEvent(), context);

      expect(broadcast.broadcastToTenant).toHaveBeenCalledWith(
        "project-1",
        JSON.stringify({
          event: "simulation_updated",
          scenarioRunId: "run-1",
          batchRunId: "batch-1",
          scenarioSetId: "set-1",
        }),
        "simulation_updated",
      );
    });

    it("omits the status, which no client has ever read", async () => {
      await subscriber().handle(
        createEvent({
          type: "lw.simulation_run.finished",
          data: {
            scenarioRunId: "run-1",
            batchRunId: "batch-1",
            scenarioSetId: "set-1",
            status: "SUCCESS",
          },
        }),
        context,
      );

      expect(pushedPayload()).not.toHaveProperty("status");
    });

    it("takes the run id from the aggregate rather than the event body", async () => {
      await subscriber().handle(
        createEvent({ data: { scenarioRunId: "stale-run" } }),
        { tenantId: "project-1", aggregateId: "run-7" },
      );

      expect(pushedPayload()).toMatchObject({ scenarioRunId: "run-7" });
    });

    it("labels the push from the event, not from a projection read-back", async () => {
      await subscriber().handle(
        createEvent({
          data: {
            scenarioRunId: "run-1",
            batchRunId: "batch-9",
            scenarioSetId: "set-9",
          },
        }),
        context,
      );

      expect(pushedPayload()).toMatchObject({
        batchRunId: "batch-9",
        scenarioSetId: "set-9",
      });
    });
  });

  describe("when the event carries no batch or set id", () => {
    it("pushes the run id alone rather than inventing one", async () => {
      await subscriber().handle(
        createEvent({
          type: "lw.simulation_run.message_snapshot",
          data: { scenarioRunId: "run-1", messages: [], traceIds: [] },
        }),
        context,
      );

      expect(pushedPayload()).toEqual({
        event: "simulation_updated",
        scenarioRunId: "run-1",
      });
    });
  });

  describe("when the event is a text_message_start", () => {
    it("stays quiet, so a job staged by an older build is harmless", async () => {
      await subscriber().handle(
        createEvent({ type: "lw.simulation_run.text_message_start" }),
        context,
      );

      expect(broadcast.broadcastToTenant).not.toHaveBeenCalled();
    });
  });

  describe("when the broadcast fails", () => {
    it("swallows the failure rather than asking for redelivery", async () => {
      broadcast.broadcastToTenant.mockRejectedValue(new Error("redis down"));

      await expect(
        subscriber().handle(createEvent(), context),
      ).resolves.toBeUndefined();
    });
  });
});
