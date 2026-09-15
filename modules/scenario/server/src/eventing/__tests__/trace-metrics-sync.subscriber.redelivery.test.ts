/**
 * @vitest-environment node
 * @unit
 * traceMetricsSync redelivery: OccurredAt drifts across months on retry; fix is event.occurredAt.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ComputeRunMetricsCommandData } from "@langwatch/scenario-contract";
import { SIMULATION_RUN_EVENT_TYPES } from "@langwatch/scenario-contract";
import type { SimulationProcessingEvent } from "@langwatch/scenario-contract";
import { createTraceMetricsSyncSubscriber } from "../trace-metrics-sync.subscriber.ts";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

/** Stands in for the computeRunMetrics command queue. */
function makeMetricsPipeline() {
  const commands: ComputeRunMetricsCommandData[] = [];
  return {
    commands,
    deps: {
      computeRunMetrics: async (data: ComputeRunMetricsCommandData): Promise<void> => {
        commands.push(data);
      },
    },
    /**
     * The identity everything downstream keys on: the emitted event's
     * `idempotencyKey`, the fact table's ORDER BY, the fold's `TraceMetrics`
     * map, and the read path's `GROUP BY TraceId`. No timestamp in it.
     */
    traceIdentities(): Set<string> {
      return new Set(
        commands.map((data) => `${data.tenantId}:${data.scenarioRunId}:${data.traceId}`),
      );
    },
    /**
     * Rows the fact table would physically retain: `simulation_run_metrics`
     * is `ReplacingMergeTree(OccurredAt) PARTITION BY toYYYYMM`, so a
     * replacement only collapses rows inside one partition, the retained-row key.
     */
    retainedFactRows(): Set<string> {
      return new Set(
        commands.map((data) => {
          const occurredAt = new Date(data.occurredAt);
          const partition = occurredAt.getUTCFullYear() * 100 + occurredAt.getUTCMonth() + 1;
          return `${partition}:${data.tenantId}:${data.scenarioRunId}:${data.traceId}`;
        }),
      );
    },
  };
}

function finishedEvent(traceIds: string[]): SimulationProcessingEvent {
  return {
    id: "evt-1",
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: "project-1",
    createdAt: 5_000,
    occurredAt: 5_000,
    version: "2026-08-06",
    type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
    data: { scenarioRunId: "run-1", status: "SUCCESS", traceIds },
  } as SimulationProcessingEvent;
}

const CONTEXT = { tenantId: "project-1", aggregateId: "run-1", state: undefined };

afterEach(() => {
  vi.useRealTimers();
});

describe("traceMetricsSync subscriber redelivery", () => {
  describe("given a finished event handled twice", () => {
    it("computes metrics for one trace identity across both dispatches", async () => {
      const metrics = makeMetricsPipeline();
      const subscriber = createTraceMetricsSyncSubscriber(metrics.deps);
      const event = finishedEvent(["trace-1"]);

      await subscriber.handler(event, CONTEXT);
      await subscriber.handler(event, CONTEXT);

      expect(metrics.commands).toHaveLength(2);
      expect(metrics.traceIdentities().size).toBe(1);
    });

    /**
     * `occurredAt` rides on the event, so the redelivered command is the
     * same. A clock reading here would reach the fact table as both the
     * ReplacingMergeTree version and the monthly partition key.
     */
    it("dispatches the same command a month later", async () => {
      vi.useFakeTimers();
      const metrics = makeMetricsPipeline();
      const subscriber = createTraceMetricsSyncSubscriber(metrics.deps);
      const event = finishedEvent(["trace-1"]);

      vi.setSystemTime(new Date("2026-01-15T09:00:00.000Z"));
      await subscriber.handler(event, CONTEXT);
      vi.setSystemTime(new Date("2026-02-15T09:00:00.000Z"));
      await subscriber.handler(event, CONTEXT);

      const [first, second] = metrics.commands;
      expect(second).toEqual(first);
      expect(first?.occurredAt).toBe(event.occurredAt);
    });
  });

  describe("given a redelivery inside the fact table's month partition", () => {
    it("retains one metrics row for the trace", async () => {
      vi.useFakeTimers();
      const metrics = makeMetricsPipeline();
      const subscriber = createTraceMetricsSyncSubscriber(metrics.deps);
      const event = finishedEvent(["trace-1"]);

      vi.setSystemTime(new Date("2026-01-15T09:00:00.000Z"));
      await subscriber.handler(event, CONTEXT);
      vi.setSystemTime(new Date("2026-01-15T09:00:30.000Z"));
      await subscriber.handler(event, CONTEXT);

      expect(metrics.retainedFactRows().size).toBe(1);
    });
  });

  describe("given a redelivery that crosses the fact table's month partition", () => {
    /**
     * ReplacingMergeTree partitioned by month never collapses across partitions.
     * Redelivery in next month survives forever. Migrations 00080/00081 state this invariant.
     */
    it("retains one metrics row for the trace", async () => {
      vi.useFakeTimers();
      const metrics = makeMetricsPipeline();
      const subscriber = createTraceMetricsSyncSubscriber(metrics.deps);
      const event = finishedEvent(["trace-1"]);

      vi.setSystemTime(new Date("2026-01-31T23:59:30.000Z"));
      await subscriber.handler(event, CONTEXT);
      vi.setSystemTime(new Date("2026-02-01T00:00:30.000Z"));
      await subscriber.handler(event, CONTEXT);

      expect(metrics.retainedFactRows().size).toBe(1);
      expect(metrics.traceIdentities().size).toBe(1);
    });
  });

  describe("given a run carrying two traces", () => {
    it("computes metrics for each trace identity", async () => {
      const metrics = makeMetricsPipeline();
      const subscriber = createTraceMetricsSyncSubscriber(metrics.deps);

      await subscriber.handler(finishedEvent(["trace-1", "trace-2"]), CONTEXT);

      expect(metrics.traceIdentities().size).toBe(2);
    });
  });
});
