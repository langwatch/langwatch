/**
 * @vitest-environment node
 * @unit
 *
 * Redelivery contract for the `traceMetricsSync` subscriber, required by the
 * `eventing-subscriber-idempotency` architecture rule.
 *
 * The contract holds, but NOT the way this pipeline's schema says it does, and
 * the difference is a real defect rather than a documentation nit. These tests
 * pin both halves.
 *
 * What holds: every key downstream of this subscriber is
 * `tenantId : scenarioRunId : traceId`, and none of them contains a timestamp.
 * `ComputeRunMetricsAdapter` stamps that string as the emitted event's
 * `idempotencyKey`; `simulation_run_metrics` orders on
 * `(TenantId, ScenarioRunId, TraceId)`; `SimulationRunStateFoldProjection`
 * writes `TraceMetrics[traceId]` as a keyed replacement and recomputes the
 * run's totals from the map rather than adding to them; and the read path
 * (`ClickHouseSimulationRunMetricsRepository.getRunMetrics`) merges
 * `argMaxMerge(...) GROUP BY TraceId` over the rollup. Redelivery therefore
 * leaves one visible metrics figure per trace. That is the mechanism, and the
 * tests below pin it.
 *
 * What does NOT hold: the subscriber builds its command with
 * `occurredAt: Date.now()`, so a second delivery of one `RunFinished` produces
 * a command that differs from the first. Migrations 00080 and 00081 are
 * written against the opposite invariant, in as many words: "a retry re-inserts
 * a row with the SAME OccurredAt (stamped from event.occurredAt by the map
 * projection)". `simulation_run_metrics` is
 * `ReplacingMergeTree(OccurredAt) PARTITION BY toYYYYMM(OccurredAt)`, and a
 * ReplacingMergeTree never collapses across partitions, so a redelivery whose
 * fresh clock reading lands in a different calendar month leaves two permanent
 * rows for one trace in the fact table (and, by `PARTITION BY PartitionMonth`,
 * two in the rollup). The read path still collapses them, so the figure a
 * customer sees stays correct; the stored fact does not, and any future read
 * that skips the `GROUP BY TraceId` collapse the migration warns about would
 * double-count. The surviving row also carries the retry's wall clock as its
 * `OccurredAt` rather than the run's.
 *
 * The one-line fix is `occurredAt: event.occurredAt`, which is what the sibling
 * `suiteRunSync` subscriber already does. Note that it is necessary but not
 * sufficient: `ComputeRunMetricsAdapter.handle` restamps `occurredAt: Date.now()`
 * on each `scheduleRetry`, so a run whose metrics land on a later attempt
 * breaks the same invariant from inside the command handler.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ComputeRunMetricsCommandData } from "@langwatch/scenario-contract";
import { SIMULATION_RUN_EVENT_TYPES } from "@langwatch/scenario-contract";
import type { SimulationProcessingEvent } from "@langwatch/scenario-contract";
import { createTraceMetricsSyncSubscriber } from "../../src/subscribers/trace-metrics-sync.subscriber";

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
     * Rows the fact table would physically retain. `simulation_run_metrics` is
     * `ReplacingMergeTree(OccurredAt) PARTITION BY toYYYYMM(OccurredAt)`, and a
     * replacement only ever collapses rows inside one partition, so the
     * partition is part of the retained-row key.
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
     * `occurredAt` rides on the event, so the redelivered command is the same
     * command. A clock reading here would travel all the way to the fact
     * table, where it is both the ReplacingMergeTree version and the monthly
     * partition key: the month-crossing case below is what that costs.
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
     * The case the invariant exists for. `simulation_run_metrics` is a
     * ReplacingMergeTree partitioned by month, and a ReplacingMergeTree never
     * collapses across partitions — so a redelivery whose row lands in the next
     * month is a row that survives forever. It only lands there if `occurredAt`
     * moves, which is why this test and the wall clock are the same test.
     *
     * Migrations 00080 and 00081 state the invariant in their headers: "a retry
     * re-inserts a row with the SAME OccurredAt". This is what holds them to it.
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
