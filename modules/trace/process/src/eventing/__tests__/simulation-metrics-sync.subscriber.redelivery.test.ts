import type { ComputeRunMetricsCommandData } from "@langwatch/scenario-contract";
/**
 * @vitest-environment node
 * @unit
 * Redelivery contract: keyed replace, not add; occurredAt month-crossing defect pinned below.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSimulationMetricsSyncHandler } from "../simulation-metrics-sync.subscriber.ts";
import {
  createContext,
  createFoldState,
  createOtlpSpan,
  createSpanReceivedEvent,
} from "./trace-subscriber.fixtures.ts";

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
     * Rows retained: `ReplacingMergeTree` collapses only inside one month
     * partition, so the month is part of the retained-row key.
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

const event = createSpanReceivedEvent(createOtlpSpan());

describe("given a simulation trace that has stabilised", () => {
  describe("when the same event is handled twice", () => {
    let sink: ReturnType<typeof makeSimulationSink>;
    let handler: ReturnType<typeof createSimulationMetricsSyncHandler>;

    beforeEach(() => {
      sink = makeSimulationSink();
      handler = createSimulationMetricsSyncHandler(sink.deps);
    });

    it("publishes one trace identity across both deliveries", async () => {
      await handler(event, createContext(foldState));
      await handler(event, createContext(foldState));

      expect(sink.dispatched).toHaveLength(2);
      expect(sink.identities().size).toBe(1);
    });

    it("asks for a fresh derivation rather than carrying a figure to add up", async () => {
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
     * The known defect: `occurredAt: Date.now()` puts a retry in the next
     * month's partition, where ReplacingMergeTree can't collapse it onto the
     * first row. Fix is `occurredAt: event.occurredAt`, shared with the scenario side.
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
