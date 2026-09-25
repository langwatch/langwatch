import type { ComputeExperimentRunMetricsCommandData } from "@langwatch/experiment-contract";
/**
 * @vitest-environment node
 * @unit
 * Redelivery contract: timestamp-free identity records one fact; `occurredAt` stamps `Date.now()`.
 */
import { describe, expect, it, vi } from "vitest";

import { createExperimentMetricsSyncHandler } from "../experiment-metrics-sync.subscriber.ts";
import {
  OCCURRED_AT,
  createContext,
  createFoldState,
  createOtlpSpan,
  createSpanReceivedEvent,
} from "./trace-subscriber.fixtures.ts";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

function makeExperimentSink() {
  const dispatched: ComputeExperimentRunMetricsCommandData[] = [];
  return {
    dispatched,
    deps: {
      computeExperimentRunMetrics: async (data: ComputeExperimentRunMetricsCommandData) => {
        dispatched.push(data);
      },
      lookupExperimentId: async () => "experiment-1",
    },
    /** `ComputeExperimentRunMetricsCommand`'s idempotency key AND its job id. */
    identities(): Set<string> {
      return new Set(
        dispatched.map((data) => `${data.tenantId}:${data.runId}:trace-metrics:${data.traceId}`),
      );
    },
  };
}

const foldState = createFoldState({
  attributes: { "langwatch.origin": "application", "evaluation.run_id": "run-1" },
  totalCost: 0.42,
});

const event = createSpanReceivedEvent(createOtlpSpan());

describe("given an experiment trace that has stabilised", () => {
  describe("when the same event is handled twice", () => {
    it("publishes one trace-metrics identity across both deliveries", async () => {
      const sink = makeExperimentSink();
      const handler = createExperimentMetricsSyncHandler(sink.deps);

      await handler(event, createContext(foldState));
      await handler(event, createContext(foldState));

      expect(sink.dispatched).toHaveLength(2);
      expect(sink.identities().size).toBe(1);
    });

    it("publishes the same cost figure, so the run cannot double-count", async () => {
      const sink = makeExperimentSink();
      const handler = createExperimentMetricsSyncHandler(sink.deps);

      await handler(event, createContext(foldState));
      await handler(event, createContext(foldState));

      expect(sink.dispatched.map((data) => data.totalCost)).toEqual([0.42, 0.42]);
    });

    /**
     * The one field not derived from the event: the identity survives, but a
     * partitioned store ordering on `occurredAt` would keep both rows.
     */
    it("stamps the dispatch clock rather than the event's own occurredAt", async () => {
      vi.useFakeTimers();
      try {
        const sink = makeExperimentSink();
        const handler = createExperimentMetricsSyncHandler(sink.deps);

        vi.setSystemTime(new Date(OCCURRED_AT + 60_000));
        await handler(event, createContext(foldState));
        vi.setSystemTime(new Date(OCCURRED_AT + 120_000));
        await handler(event, createContext(foldState));

        expect(sink.dispatched[0]?.occurredAt).not.toBe(event.occurredAt);
        expect(sink.dispatched[1]?.occurredAt).not.toBe(sink.dispatched[0]?.occurredAt);
        expect(sink.identities().size).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("when the experiment id cannot be resolved", () => {
    it("publishes nothing, so a redelivery has nothing to duplicate", async () => {
      const sink = makeExperimentSink();
      const handler = createExperimentMetricsSyncHandler({
        ...sink.deps,
        lookupExperimentId: async () => null,
      });

      await handler(event, createContext(foldState));
      await handler(event, createContext(foldState));

      expect(sink.dispatched).toHaveLength(0);
    });
  });
});

describe("given two traces in one experiment run", () => {
  it("keeps their metrics apart, so idempotency is not collapsing real facts", async () => {
    const sink = makeExperimentSink();
    const handler = createExperimentMetricsSyncHandler(sink.deps);

    await handler(event, createContext(foldState));
    await handler(event, createContext(createFoldState({ ...foldState, traceId: "trace-2" })));

    expect(sink.identities().size).toBe(2);
  });
});
