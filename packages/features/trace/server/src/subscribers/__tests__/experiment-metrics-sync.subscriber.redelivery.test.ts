/**
 * @vitest-environment node
 * @unit
 *
 * Redelivery contract for the `experimentMetricsSync` subscriber, required by
 * the `eventing-subscriber-idempotency` architecture rule.
 *
 * The contract holds, but not through the command this subscriber builds.
 * `ComputeExperimentRunMetricsCommand`'s idempotency key and job id are both
 * `${tenantId}:${runId}:trace-metrics:${traceId}` — no timestamp — so however
 * many times this subscriber dispatches for one trace, the experiment run
 * records one trace-metrics fact.
 *
 * What does NOT ride on the event is `occurredAt`: this subscriber stamps
 * `Date.now()`, so a redelivery produces a command that differs from the first
 * in that one field. It reaches the event's `occurredAt`, which is what the
 * fold and any partitioned store order on. That is pinned below as the fact it
 * is, next to the identity that saves it.
 */
import { describe, expect, it, vi } from "vitest";
import type { ComputeExperimentRunMetricsCommandData } from "@langwatch/experiment-contract";
import { createExperimentMetricsSyncHandler } from "../experiment-metrics-sync.subscriber";
import {
  createContext,
  createFoldState,
  createTraceEvent,
  OCCURRED_AT,
} from "./subscribers/support/trace-subscriber.fixtures";

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

const event = createTraceEvent("lw.obs.trace.span_received");

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
     * The one field that is not derived from the event. Everything the store
     * keys on is timestamp-free, so this does not break the identity — but it
     * does mean the recorded `occurredAt` is the retry's wall clock rather than
     * the trace's, and a partitioned store that ordered on it would keep both
     * rows. `event.occurredAt` is the value that would make this stable.
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
