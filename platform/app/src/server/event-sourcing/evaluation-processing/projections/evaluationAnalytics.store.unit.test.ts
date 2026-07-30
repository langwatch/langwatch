import { describe, expect, it } from "vitest";
import { type EvaluationState, evaluationAggregate } from "../aggregate";
import {
  evaluationStateFromRow,
  projectEvaluationStateToRow,
} from "./evaluationAnalytics.store";
import { evaluationAnalyticsTable } from "./evaluationAnalytics.table";

function stateFor(overrides: Partial<EvaluationState> = {}): EvaluationState {
  return evaluationAggregate.apply(
    evaluationAggregate.init(),
    evaluationAggregate.events.reported({
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
    }),
  );
}

describe("evaluationAnalyticsTable", () => {
  it("constructs without throwing, proving the partition/TTL anchor is frozen and platform-controlled (ADR-099)", () => {
    // `defineTable` throws at construction (not at query time) if the
    // partition column or TTL anchor is not `frozen && platformControlled`
    // (see `evaluationAnalytics.table.ts`'s Finding #1). Importing the table
    // module already exercises this; this test names the property so a
    // regression reads as an assertion failure, not an import-time crash a
    // reader has to trace back.
    expect(evaluationAnalyticsTable.name).toBe("evaluation_analytics");
    expect(evaluationAnalyticsTable.partition.column).toBe("CreatedAt");
    expect(evaluationAnalyticsTable.ttl?.anchor).toBe("CreatedAt");
  });

  it("never names OccurredAt as the partition column or TTL anchor", () => {
    expect(evaluationAnalyticsTable.partition.column).not.toBe("OccurredAt");
    expect(evaluationAnalyticsTable.ttl?.anchor).not.toBe("OccurredAt");
  });
});

describe("evaluationAnalytics row round-trip", () => {
  describe("given a terminal evaluation state", () => {
    it("projects and decodes back the fields the slim table can carry", () => {
      const state = stateFor();

      const row = projectEvaluationStateToRow({
        evaluationId: "eval-1",
        state,
        tenantId: "tenant-1",
        version: evaluationAggregate.stateVersion,
        deliverySeq: 1,
      });

      expect(row.EvaluationId).toBe("eval-1");
      expect(row.Status).toBe("processed");
      expect(row.Score).toBe(0.87);
      expect(row.Passed).toBe(true);
      expect(row.Label).toBe("good");
      expect(row.EvaluatorType).toBe("langevals/answer_correctness");
      expect(row.DeliverySeq).toBe(1n);

      const decoded = evaluationStateFromRow(row);
      expect(decoded.status).toBe("processed");
      expect(decoded.score).toBe(0.87);
      expect(decoded.passed).toBe(true);
      expect(decoded.label).toBe("good");
      expect(decoded.evaluatorType).toBe("langevals/answer_correctness");
      expect(decoded.traceId).toBe("trace-1");
    });

    it("computes DurationMs from the started/completed operands", () => {
      const started = evaluationAggregate.apply(
        evaluationAggregate.init(),
        evaluationAggregate.events.started({
          evaluationId: "eval-1",
          evaluatorId: "monitor-1",
          evaluatorType: "langevals/answer_correctness",
          occurredAt: 1_000,
        }),
      );
      const reported = evaluationAggregate.apply(
        started,
        evaluationAggregate.events.reported({
          evaluationId: "eval-1",
          evaluatorId: "monitor-1",
          evaluatorType: "langevals/answer_correctness",
          status: "processed",
          occurredAt: 1_750,
        }),
      );

      const row = projectEvaluationStateToRow({
        evaluationId: "eval-1",
        state: reported,
        tenantId: "tenant-1",
        version: evaluationAggregate.stateVersion,
        deliverySeq: 2,
      });

      expect(row.DurationMs).toBe(750n);
    });

    it("round-trips StartedAt/CompletedAt through the epoch-ms-or-zero wire convention", () => {
      const state = stateFor();
      const row = projectEvaluationStateToRow({
        evaluationId: "eval-1",
        state,
        tenantId: "tenant-1",
        version: evaluationAggregate.stateVersion,
        deliverySeq: 1,
      });

      // Never started via a `started` event (the atomic monitor path) —
      // `applyReported` backfills startedAtMs from its own occurredAt, so
      // this is never the wire-level zero sentinel here. A genuinely
      // never-started evaluation is a state this fold cannot produce: every
      // handler sets it.
      expect(row.StartedAt).toBe(2_000n);
      expect(row.CompletedAt).toBe(2_000n);

      const decoded = evaluationStateFromRow(row);
      expect(decoded.startedAtMs).toBe(2_000);
      expect(decoded.completedAtMs).toBe(2_000);
    });
  });

  describe("given a row the slim table cannot carry heavy fields for", () => {
    it("decodes details/inputs/error/errorDetails as null without losing the terminal result", () => {
      const state: EvaluationState = {
        ...stateFor(),
        details: "would not survive a re-fold from this table anyway",
        inputs: { some: "input" },
        error: "boom",
        errorDetails: "stack trace",
      };

      const row = projectEvaluationStateToRow({
        evaluationId: "eval-1",
        state,
        tenantId: "tenant-1",
        version: evaluationAggregate.stateVersion,
        deliverySeq: 1,
      });
      const decoded = evaluationStateFromRow(row);

      expect(decoded.details).toBeNull();
      expect(decoded.inputs).toBeNull();
      expect(decoded.error).toBeNull();
      expect(decoded.errorDetails).toBeNull();
      // The fields this table exists for survive regardless.
      expect(decoded.status).toBe("processed");
      expect(decoded.score).toBe(0.87);
    });
  });

  it("stamps the row's declared retention, falling back to the platform default", () => {
    const row = projectEvaluationStateToRow({
      evaluationId: "eval-1",
      state: stateFor(),
      tenantId: "tenant-1",
      version: evaluationAggregate.stateVersion,
      deliverySeq: 1,
      retentionDays: 90,
    });
    expect(row._retention_days).toBe(90);

    const withDefault = projectEvaluationStateToRow({
      evaluationId: "eval-1",
      state: stateFor(),
      tenantId: "tenant-1",
      version: evaluationAggregate.stateVersion,
      deliverySeq: 1,
    });
    expect(withDefault._retention_days).toBeGreaterThan(0);
  });
});
