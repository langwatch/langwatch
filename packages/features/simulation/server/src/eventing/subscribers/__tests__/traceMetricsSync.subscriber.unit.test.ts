import { describe, expect, it, vi } from "vitest";

import { SIMULATION_RUN_EVENT_TYPES } from "../../schemas/constants";
import type { SimulationProcessingEvent } from "../../schemas/events";
import {
  createTraceMetricsSyncSubscriber,
  type TraceMetricsSyncSubscriberDeps,
} from "../traceMetricsSync.subscriber";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function finishedEvent(
  dataOverride: Record<string, unknown> = {},
): SimulationProcessingEvent {
  return {
    id: "evt-1",
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: "project-1",
    createdAt: 5_000,
    occurredAt: 5_000,
    version: "2026-08-06",
    type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
    data: {
      scenarioRunId: "run-1",
      status: "SUCCESS",
      ...dataOverride,
    },
  } as SimulationProcessingEvent;
}

function makeDeps(
  overrides: Partial<TraceMetricsSyncSubscriberDeps> = {},
): TraceMetricsSyncSubscriberDeps {
  return {
    computeRunMetrics: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const CONTEXT = {
  tenantId: "project-1",
  aggregateId: "run-1",
  state: undefined,
};

describe("traceMetricsSync subscriber", () => {
  describe("when a run finishes carrying trace ids", () => {
    it("dispatches one computeRunMetrics per trace", async () => {
      const deps = makeDeps();
      const subscriber = createTraceMetricsSyncSubscriber(deps);

      await subscriber.handler(
        finishedEvent({ traceIds: ["trace-1", "trace-2"] }),
        CONTEXT,
      );

      expect(deps.computeRunMetrics).toHaveBeenCalledTimes(2);
      expect(deps.computeRunMetrics).toHaveBeenNthCalledWith(1, {
        tenantId: "project-1",
        scenarioRunId: "run-1",
        traceId: "trace-1",
        retryCount: 0,
        occurredAt: expect.any(Number),
      });
      expect(deps.computeRunMetrics).toHaveBeenNthCalledWith(2, {
        tenantId: "project-1",
        scenarioRunId: "run-1",
        traceId: "trace-2",
        retryCount: 0,
        occurredAt: expect.any(Number),
      });
    });
  });

  describe("when a run finishes without trace ids", () => {
    it("dispatches nothing for an empty traceIds array", async () => {
      const deps = makeDeps();
      const subscriber = createTraceMetricsSyncSubscriber(deps);

      await subscriber.handler(finishedEvent({ traceIds: [] }), CONTEXT);

      expect(deps.computeRunMetrics).not.toHaveBeenCalled();
    });

    it("dispatches nothing when traceIds is absent (pre-enrichment event)", async () => {
      const deps = makeDeps();
      const subscriber = createTraceMetricsSyncSubscriber(deps);

      await subscriber.handler(finishedEvent(), CONTEXT);

      expect(deps.computeRunMetrics).not.toHaveBeenCalled();
    });
  });

  describe("when the dispatch fails", () => {
    it("propagates the error so the GroupQueue retries", async () => {
      const deps = makeDeps({
        computeRunMetrics: vi.fn().mockRejectedValue(new Error("trace pipeline down")),
      });
      const subscriber = createTraceMetricsSyncSubscriber(deps);

      await expect(
        subscriber.handler(finishedEvent({ traceIds: ["trace-1"] }), CONTEXT),
      ).rejects.toThrow("trace pipeline down");
    });
  });
});
