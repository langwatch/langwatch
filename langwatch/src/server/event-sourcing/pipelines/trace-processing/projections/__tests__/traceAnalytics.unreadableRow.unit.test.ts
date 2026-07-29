import { describe, expect, it, vi } from "vitest";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import { EvaluationAnalyticsStore } from "../../../evaluation-processing/projections/evaluationAnalytics.store";
import { TraceAnalyticsStore } from "../traceAnalytics.store";

/**
 * The store half of `specs/clickhouse/unreadable-row-recovery.feature`.
 *
 * The regression this pins is a live one: a read-back of
 * `trace_analytics.AnnotationIds` threw, the fold job failed, GroupQueue
 * redelivered it, and the aggregate's group stopped making progress — while
 * the row was complete and the cluster was healthy. The read must ANSWER, and
 * it must answer `undecodable` specifically, because that is the miss the
 * executor rebuilds from `event_log` without first retrying an unwindowed
 * re-read that can only find the same row again.
 */

const TENANT = "tenant-unreadable";

const context = {
  aggregateId: "trace-1",
  tenantId: createTenantId(TENANT),
} as unknown as ProjectionStoreContext;

function unreadableColumnError(column: string): Error {
  const error = new Error(
    `Amount of memory requested to allocate is more than allowed: ` +
      `(while reading column ${column}): (while reading from part ` +
      `/var/lib/clickhouse/data/store/95c/abc/202629_0_387304_1998/ in table ` +
      `langwatch.trace_analytics located on disk local of type local, ` +
      `from mark 8 with max_rows_to_read = 1, offset = 44). `,
  );
  (error as Error & { code: string }).code = "173";
  return error;
}

describe("TraceAnalyticsStore.getWithApplied", () => {
  describe("given the stored row cannot be decoded", () => {
    it("reports a rebuildable miss instead of failing the job", async () => {
      const store = new TraceAnalyticsStore({
        findByTraceIdWithApplied: vi
          .fn()
          .mockRejectedValue(unreadableColumnError("AnnotationIds")),
      } as unknown as ConstructorParameters<typeof TraceAnalyticsStore>[0]);

      const { state, appliedEventIds, miss } = await store.getWithApplied(
        "trace-1",
        context,
      );

      expect(state).toBeNull();
      // Not "absent": the row was found and refused, so an unwindowed re-read
      // would only find it again.
      expect(miss).toBe("undecodable");
      // The watermark goes with the state — keeping it would suppress the very
      // events the re-fold needs.
      expect(appliedEventIds).toEqual([]);
    });

    it("misses through get() too, so both read paths agree", async () => {
      const store = new TraceAnalyticsStore({
        findByTraceIdWithApplied: vi
          .fn()
          .mockRejectedValue(unreadableColumnError("AnnotationIds")),
      } as unknown as ConstructorParameters<typeof TraceAnalyticsStore>[0]);

      await expect(store.get("trace-1", context)).resolves.toBeNull();
    });
  });

  describe("given the cluster is merely unavailable", () => {
    it("propagates so the queue redelivers rather than refolding", async () => {
      const unavailable = new Error("connect ECONNREFUSED 10.0.0.1:8123");
      (unavailable as Error & { code: string }).code = "ECONNREFUSED";
      const store = new TraceAnalyticsStore({
        findByTraceIdWithApplied: vi.fn().mockRejectedValue(unavailable),
      } as unknown as ConstructorParameters<typeof TraceAnalyticsStore>[0]);

      await expect(store.getWithApplied("trace-1", context)).rejects.toBe(
        unavailable,
      );
    });
  });
});

describe("EvaluationAnalyticsStore.getWithApplied", () => {
  describe("given the stored row cannot be decoded", () => {
    it("reports a rebuildable miss instead of failing the job", async () => {
      const store = new EvaluationAnalyticsStore({
        findByEvaluationIdWithApplied: vi
          .fn()
          .mockRejectedValue(unreadableColumnError("AppliedEventIds")),
      } as unknown as ConstructorParameters<
        typeof EvaluationAnalyticsStore
      >[0]);

      const { state, miss } = await store.getWithApplied("eval-1", {
        ...context,
        aggregateId: "eval-1",
      } as unknown as ProjectionStoreContext);

      expect(state).toBeNull();
      expect(miss).toBe("undecodable");
    });
  });
});
