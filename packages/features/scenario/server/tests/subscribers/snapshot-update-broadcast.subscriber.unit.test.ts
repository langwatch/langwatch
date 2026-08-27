import { describe, expect, it, vi } from "vitest";

import { SIMULATION_RUN_EVENT_TYPES } from "@langwatch/scenario-contract";
import type { SimulationProcessingEvent } from "@langwatch/scenario-contract";
import { createSnapshotUpdateBroadcastSubscriber } from "../../src/subscribers/snapshot-update-broadcast.subscriber";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function makeEvent(overrides: {
  type: SimulationProcessingEvent["type"];
  data: Record<string, unknown>;
}): SimulationProcessingEvent {
  return {
    id: "evt-1",
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: "project-1",
    createdAt: 1_000,
    occurredAt: 1_000,
    version: "2026-08-06",
    ...overrides,
  } as SimulationProcessingEvent;
}

function makeBroadcast() {
  const calls = vi.fn().mockResolvedValue(undefined);
  return {
    calls,
    broadcastUpdate: async (input: { tenantId: string; payload: string }) => {
      await calls(input);
    },
  } as {
    calls: ReturnType<typeof vi.fn>;
    broadcastUpdate(input: { tenantId: string; payload: string }): Promise<void>;
  };
}

const CONTEXT = {
  tenantId: "project-1",
  aggregateId: "run-1",
  state: undefined,
};

describe("snapshotUpdateBroadcast subscriber", () => {
  it("is a raw event subscription over settled-state event types (no fold attach)", () => {
    const subscriber = createSnapshotUpdateBroadcastSubscriber({
      broadcastUpdate: makeBroadcast().broadcastUpdate,
    });

    expect(subscriber).not.toHaveProperty("fold");
    expect(subscriber.events).toEqual([
      SIMULATION_RUN_EVENT_TYPES.QUEUED,
      SIMULATION_RUN_EVENT_TYPES.STARTED,
      SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT,
      SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_END,
      SIMULATION_RUN_EVENT_TYPES.FINISHED,
      SIMULATION_RUN_EVENT_TYPES.DELETED,
      SIMULATION_RUN_EVENT_TYPES.CANCEL_REQUESTED,
    ]);
  });

  it("excludes text_message_start — the API route owns streaming broadcasts", () => {
    const subscriber = createSnapshotUpdateBroadcastSubscriber({
      broadcastUpdate: makeBroadcast().broadcastUpdate,
    });

    expect(subscriber.events).not.toContain(SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_START);
  });

  it("delays delivery to absorb fold-commit lag before the UI refetches", () => {
    const subscriber = createSnapshotUpdateBroadcastSubscriber({
      broadcastUpdate: makeBroadcast().broadcastUpdate,
    });

    expect(subscriber.delay).toBe(2000);
  });

  it("dedups per tenant and run", () => {
    const subscriber = createSnapshotUpdateBroadcastSubscriber({
      broadcastUpdate: makeBroadcast().broadcastUpdate,
    });
    const event = makeEvent({
      type: SIMULATION_RUN_EVENT_TYPES.QUEUED,
      data: { scenarioRunId: "run-1" },
    });

    expect(subscriber.dedupId?.(event)).toBe("sim-update:project-1:run-1");
  });

  describe("when a queued event arrives", () => {
    it("broadcasts simulation_updated with the run and batch identity from the event", async () => {
      const broadcast = makeBroadcast();
      const subscriber = createSnapshotUpdateBroadcastSubscriber({
        broadcastUpdate: broadcast.broadcastUpdate,
      });

      await subscriber.handler(
        makeEvent({
          type: SIMULATION_RUN_EVENT_TYPES.QUEUED,
          data: {
            scenarioRunId: "run-1",
            batchRunId: "batch-1",
            scenarioSetId: "set-1",
          },
        }),
        CONTEXT,
      );

      expect(broadcast.calls).toHaveBeenCalledWith({
        tenantId: "project-1",
        payload: JSON.stringify({
          event: "simulation_updated",
          scenarioRunId: "run-1",
          batchRunId: "batch-1",
          scenarioSetId: "set-1",
        }),
      });
    });
  });

  describe("when a finished event arrives", () => {
    it("includes the status carried on the event", async () => {
      const broadcast = makeBroadcast();
      const subscriber = createSnapshotUpdateBroadcastSubscriber({
        broadcastUpdate: broadcast.broadcastUpdate,
      });

      await subscriber.handler(
        makeEvent({
          type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
          data: { scenarioRunId: "run-1", status: "SUCCESS" },
        }),
        CONTEXT,
      );

      expect(broadcast.calls).toHaveBeenCalledWith({
        tenantId: "project-1",
        payload: JSON.stringify({
          event: "simulation_updated",
          scenarioRunId: "run-1",
          status: "SUCCESS",
        }),
      });
    });
  });

  describe("when the broadcast fails", () => {
    it("swallows the error so it never blocks the pipeline", async () => {
      const broadcast = makeBroadcast();
      broadcast.calls.mockRejectedValue(new Error("redis down"));
      const subscriber = createSnapshotUpdateBroadcastSubscriber({
        broadcastUpdate: broadcast.broadcastUpdate,
      });

      await expect(
        subscriber.handler(
          makeEvent({
            type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
            data: { scenarioRunId: "run-1", status: "SUCCESS" },
          }),
          CONTEXT,
        ),
      ).resolves.toBeUndefined();
    });
  });
});
