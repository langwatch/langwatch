/**
 * @vitest-environment node
 * @unit
 *
 * Redelivery contract for the `simulationMetricsSync` subscriber, required by
 * the `eventing-subscriber-idempotency` architecture rule.
 *
 * The subscriber publishes a pull-mode request: it carries no metrics of its
 * own, only the identity of the trace whose spans the scenario side should
 * re-derive from. Every key downstream is `tenantId : scenarioRunId : traceId`
 * — the emitted event's idempotency key, the `simulation_run_metrics` ORDER BY,
 * and the run fold's `TraceMetrics` map, which is a keyed replacement rather
 * than an accumulator. So a second delivery re-states one trace's metrics
 * instead of adding a second contribution.
 *
 * `occurredAt` is the exception, and it is the same defect the scenario-side
 * `traceMetricsSync` subscriber carries: it is `Date.now()`, not the event's.
 * The fact table is a `ReplacingMergeTree` partitioned by month, and a
 * replacement never collapses across partitions, so a redelivery whose fresh
 * clock reading lands in the next month leaves two permanent rows for one
 * trace. The read path still collapses them; the stored fact does not. Pinned
 * below rather than asserted away.
 */
import { describe, expect, it, vi } from "vitest";
import type { ComputeRunMetricsCommandData } from "@langwatch/scenario-contract";
import { createSimulationMetricsSyncHandler } from "../../src/subscribers/simulation-metrics-sync.subscriber";
import {
  createContext,
  createFoldState,
  createTraceEvent,
} from "./support/trace-subscriber.fixtures";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

function makeSimulationSink() {
  const dispatched: ComputeRunMetricsCommandData[] = [];
  return {
    dispatched,
    deps: {
      computeRunMetrics: async (data: ComputeRunMetricsCommandData) => {
        dispatched.push(data);
      },
    },
    /** The key the metrics event, the fact table and the run fold all use. */
    identities(): Set<string> {
      return new Set(
        dispatched.map((data) => `${data.tenantId}:${data.scenarioRunId}:${data.traceId}`),
      );
    },
    /**
     * Rows `simulation_run_metrics` physically retains. It is
     * `ReplacingMergeTree(OccurredAt) PARTITION BY toYYYYMM(OccurredAt)`, and a
     * replacement only collapses inside one partition, so the month is part of
     * the retained-row key.
     */
    retainedFactRows(): Set<string> {
      return new Set(
        dispatched.map((data) => {
          const at = new Date(data.occurredAt);
          const partition = at.getUTCFullYear() * 100 + at.getUTCMonth() + 1;
          return `${partition}:${data.tenantId}:${data.scenarioRunId}:${data.traceId}`;
        }),
      );
    },
  };
}

const foldState = createFoldState({
  attributes: { "langwatch.origin": "application", "scenario.run_id": "run-1" },
  spanCount: 3,
  totalCost: 0.1,
});

const event = createTraceEvent("lw.obs.trace.span_received");

describe("given a simulation trace that has stabilised", () => {
  describe("when the same event is handled twice", () => {
    it("publishes one trace identity across both deliveries", async () => {
      const sink = makeSimulationSink();
      const handler = createSimulationMetricsSyncHandler(sink.deps);

      await handler(event, createContext(foldState));
      await handler(event, createContext(foldState));

      expect(sink.dispatched).toHaveLength(2);
      expect(sink.identities().size).toBe(1);
    });

    it("asks for a fresh derivation rather than carrying a figure to add up", async () => {
      const sink = makeSimulationSink();
      const handler = createSimulationMetricsSyncHandler(sink.deps);

      await handler(event, createContext(foldState));

      expect(sink.dispatched[0]).toMatchObject({
        scenarioRunId: "run-1",
        traceId: "trace-1",
        retryCount: 0,
      });
    });
  });

  describe("when a redelivery lands inside the fact table's month partition", () => {
    it("retains one metrics row for the trace", async () => {
      vi.useFakeTimers();
      try {
        const sink = makeSimulationSink();
        const handler = createSimulationMetricsSyncHandler(sink.deps);

        vi.setSystemTime(new Date("2026-01-15T09:00:00.000Z"));
        await handler(event, createContext(foldState));
        vi.setSystemTime(new Date("2026-01-15T09:00:30.000Z"));
        await handler(event, createContext(foldState));

        expect(sink.retainedFactRows().size).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("when a redelivery crosses the fact table's month partition", () => {
    /**
     * The case the invariant exists for, and the one this subscriber fails.
     * `occurredAt: Date.now()` puts the retry in the next month's partition,
     * where a ReplacingMergeTree can never collapse it onto the first row. The
     * customer-visible figure stays right because the read path groups by
     * `TraceId`; the stored fact does not. `occurredAt: event.occurredAt` is
     * the fix, and it belongs with the identical one on the scenario side.
     */
    it("retains two rows for one trace, which is the defect this pins", async () => {
      vi.useFakeTimers();
      try {
        const sink = makeSimulationSink();
        const handler = createSimulationMetricsSyncHandler(sink.deps);

        vi.setSystemTime(new Date("2026-01-31T23:59:30.000Z"));
        await handler(event, createContext(foldState));
        vi.setSystemTime(new Date("2026-02-01T00:00:30.000Z"));
        await handler(event, createContext(foldState));

        expect(sink.identities().size).toBe(1);
        expect(sink.retainedFactRows().size).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("when the trace carries nothing to aggregate", () => {
    it("publishes nothing, so a redelivery has nothing to duplicate", async () => {
      const sink = makeSimulationSink();
      const handler = createSimulationMetricsSyncHandler(sink.deps);
      const empty = createFoldState({
        attributes: { "scenario.run_id": "run-1" },
        spanCount: 0,
        totalCost: null,
      });

      await handler(event, createContext(empty));
      await handler(event, createContext(empty));

      expect(sink.dispatched).toHaveLength(0);
    });
  });
});
