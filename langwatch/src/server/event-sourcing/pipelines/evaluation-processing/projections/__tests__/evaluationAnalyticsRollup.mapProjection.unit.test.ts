import { describe, expect, it } from "vitest";
import { EvaluationAnalyticsRollupMapProjection } from "../evaluationAnalyticsRollup.mapProjection";
import type {
  EvaluationCompletedEvent,
  EvaluationReportedEvent,
} from "../../schemas/events";

const TENANT = "proj-1";

const map = new EvaluationAnalyticsRollupMapProjection({
  store: { append: async () => {} },
});

function makeCompleted(
  overrides: Partial<EvaluationCompletedEvent["data"]> = {},
): EvaluationCompletedEvent {
  return {
    type: "lw.evaluation.completed",
    id: "evt-c",
    tenantId: TENANT,
    aggregateId: "eval-1",
    occurredAt: Date.UTC(2026, 5, 20, 10, 17, 33), // some ts mid-minute
    data: {
      evaluationId: "eval-1",
      status: "processed",
      score: 0.7,
      passed: true,
      label: null,
      ...overrides,
    },
  } as unknown as EvaluationCompletedEvent;
}

function makeReported(
  overrides: Partial<EvaluationReportedEvent["data"]> = {},
): EvaluationReportedEvent {
  return {
    type: "lw.evaluation.reported",
    id: "evt-r",
    tenantId: TENANT,
    aggregateId: "eval-9",
    occurredAt: Date.UTC(2026, 5, 20, 10, 17, 33),
    data: {
      evaluationId: "eval-9",
      evaluatorId: "monitor-z",
      evaluatorType: "langevals/atomic",
      status: "processed",
      score: 1,
      passed: true,
      ...overrides,
    },
  } as unknown as EvaluationReportedEvent;
}

describe("evaluationAnalyticsRollup map projection — per-event row", () => {
  describe("when emitting from a completed event", () => {
    it("buckets BucketStart to the minute and stamps the dims", () => {
      const row = map.mapEvaluationCompleted(makeCompleted());
      expect(row.tenantId).toBe(TENANT);
      expect(row.bucketStart.getUTCSeconds()).toBe(0);
      expect(row.bucketStart.getUTCMilliseconds()).toBe(0);
      expect(row.status).toBe("processed");
      // Completed events have no identity on the payload; rollup
      // accepts the under-count documented in the projection's
      // class comment.
      expect(row.evaluatorType).toBe("");
    });

    it("decodes pass/fail counters from `passed`", () => {
      expect(map.mapEvaluationCompleted(makeCompleted({ passed: true })).passCount).toBe(1);
      expect(map.mapEvaluationCompleted(makeCompleted({ passed: true })).failCount).toBe(0);
      expect(map.mapEvaluationCompleted(makeCompleted({ passed: false })).passCount).toBe(0);
      expect(map.mapEvaluationCompleted(makeCompleted({ passed: false })).failCount).toBe(1);
      expect(map.mapEvaluationCompleted(makeCompleted({ passed: null })).passCount).toBe(0);
      expect(map.mapEvaluationCompleted(makeCompleted({ passed: null })).failCount).toBe(0);
    });

    it("decodes error / skipped counters from `status`", () => {
      expect(map.mapEvaluationCompleted(makeCompleted({ status: "error" })).errorCount).toBe(1);
      expect(map.mapEvaluationCompleted(makeCompleted({ status: "error" })).skippedCount).toBe(0);
      expect(map.mapEvaluationCompleted(makeCompleted({ status: "skipped" })).errorCount).toBe(0);
      expect(map.mapEvaluationCompleted(makeCompleted({ status: "skipped" })).skippedCount).toBe(1);
      expect(map.mapEvaluationCompleted(makeCompleted({ status: "processed" })).errorCount).toBe(0);
    });

    it("decodes ScoreSum/ScoreCount with null-aware divisor", () => {
      const a = map.mapEvaluationCompleted(makeCompleted({ score: 0.85 }));
      expect(a.scoreSum).toBe(0.85);
      expect(a.scoreCount).toBe(1);

      const b = map.mapEvaluationCompleted(makeCompleted({ score: null }));
      expect(b.scoreSum).toBe(0);
      expect(b.scoreCount).toBe(0);
    });
  });

  describe("when emitting from a reported (atomic) event", () => {
    it("carries the real evaluatorType (identity is on the event)", () => {
      const row = map.mapEvaluationReported(makeReported());
      expect(row.evaluatorType).toBe("langevals/atomic");
    });
  });
});
