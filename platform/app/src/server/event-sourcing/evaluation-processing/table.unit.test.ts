import { describe, expect, it } from "vitest";
import {
  applyEvaluationReported,
  applyEvaluationStarted,
  initEvaluationState,
} from "./evaluationAnalytics.projection";
import type { EvaluationReportedData, EvaluationState } from "./schema";
import { evaluationAnalyticsRow, evaluationAnalyticsTable } from "./table";

const ROW_CONTEXT = {
  tenantId: "tenant-1",
  key: "eval-1",
  version: "2026-07-27",
  writtenAt: new Date("2026-07-30T00:00:00.000Z"),
  retentionDays: 90,
};

function reportedState(
  overrides: Partial<EvaluationReportedData> = {},
): EvaluationState {
  return applyEvaluationReported(initEvaluationState(), {
    evaluationId: "eval-1",
    evaluatorId: "monitor-1",
    evaluatorType: "langevals/answer_correctness",
    evaluatorName: "Answer Correctness",
    traceId: "trace-1",
    status: "processed",
    score: 0.87,
    passed: true,
    label: "good",
    occurredAt: 2_000,
    ...overrides,
  });
}

describe("evaluationAnalyticsTable", () => {
  it("declares the engine key, partition and TTL migration 00041 deployed", () => {
    expect(evaluationAnalyticsTable.name).toBe("evaluation_analytics");
    expect(evaluationAnalyticsTable.sortKey).toEqual([
      "TenantId",
      "OccurredAt",
      "EvaluationId",
    ]);
    expect(evaluationAnalyticsTable.partition).toEqual({
      by: "toYearWeek(OccurredAt)",
      column: "OccurredAt",
    });
    expect(evaluationAnalyticsTable.ttl?.anchor).toBe("OccurredAt");
  });

  it("declares no DeliverySeq column", () => {
    expect(evaluationAnalyticsTable.columnNames).not.toContain("DeliverySeq");
  });
});

describe("evaluationAnalyticsRow mapping", () => {
  describe("given a terminal evaluation state", () => {
    it("fills every declared column and decodes the state fields back", () => {
      const row = evaluationAnalyticsRow.toRow(reportedState(), ROW_CONTEXT);

      for (const column of evaluationAnalyticsTable.columnNames) {
        expect(row).toHaveProperty(column);
      }
      expect(row.EvaluationId).toBe("eval-1");
      expect(row.Status).toBe("processed");
      expect(row.Score).toBe(0.87);
      expect(row.Passed).toBe(true);
      expect(row.Label).toBe("good");
      expect(row.EvaluatorType).toBe("langevals/answer_correctness");
      expect(row._retention_days).toBe(90);

      const decoded = evaluationAnalyticsRow.fromRow(row);
      expect(decoded.status).toBe("processed");
      expect(decoded.score).toBe(0.87);
      expect(decoded.passed).toBe(true);
      expect(decoded.label).toBe("good");
      expect(decoded.traceId).toBe("trace-1");
      expect(decoded.evaluatorName).toBe("Answer Correctness");
    });

    it("round-trips the anchor and completedAt through their wire forms", () => {
      const row = evaluationAnalyticsRow.toRow(reportedState(), ROW_CONTEXT);
      expect(row.OccurredAt).toEqual(new Date(2_000));
      expect(row.StartedAt).toBe(2_000n);
      expect(row.CompletedAt).toBe(2_000n);

      const decoded = evaluationAnalyticsRow.fromRow(row);
      expect(decoded.occurredAt).toBe(2_000);
      expect(decoded.completedAt).toBe(2_000);
    });

    /**
     * `CreatedAt` and `OccurredAt` both used to be produced by a `fill` reading
     * the wall clock, so a row's partition and TTL moved on every write.
     */
    it("carries both stamps from fold state, so a second write reproduces them", () => {
      const state = reportedState();
      const first = evaluationAnalyticsRow.toRow(state, ROW_CONTEXT);
      const second = evaluationAnalyticsRow.toRow(state, {
        ...ROW_CONTEXT,
        writtenAt: new Date("2026-08-30T00:00:00.000Z"),
      });

      expect(second.OccurredAt).toEqual(first.OccurredAt);
      expect(second.CreatedAt).toEqual(first.CreatedAt);
    });

    it("computes DurationMs from the anchor and the terminal stamp", () => {
      const started = applyEvaluationStarted(initEvaluationState(), {
        evaluationId: "eval-1",
        evaluatorId: "monitor-1",
        evaluatorType: "langevals/answer_correctness",
        occurredAt: 1_000,
      });
      const reported = applyEvaluationReported(started, {
        evaluationId: "eval-1",
        evaluatorId: "monitor-1",
        evaluatorType: "langevals/answer_correctness",
        status: "processed",
        occurredAt: 1_750,
      });

      expect(
        evaluationAnalyticsRow.toRow(reported, ROW_CONTEXT).DurationMs,
      ).toBe(750n);
    });

    it("leaves the trace-hoisted columns null rather than inventing values", () => {
      const row = evaluationAnalyticsRow.toRow(reportedState(), ROW_CONTEXT);
      expect(row.Model).toBeNull();
      expect(row.UserId).toBeNull();
      expect(row.ConversationId).toBeNull();
      expect(row.CustomerId).toBeNull();
      expect(row.Origin).toBeNull();
      expect(row.TotalCost).toBeNull();
      expect(row.NonBilledCost).toBeNull();
    });
  });
});
