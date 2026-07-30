import type {
  ReplaceStore,
  StateRead,
  StoreContext,
  StoredState,
} from "@langwatch/event-sourcing";
import { createFoldExecutor } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import { type EvaluationState, evaluation } from "./aggregate";
import { evaluationAnalytics } from "./projection";
import { evaluationAnalyticsRow, evaluationAnalyticsTable } from "./table";

const ROW_CONTEXT = {
  tenantId: "tenant-1",
  key: "eval-1",
  version: evaluationAnalytics.version,
  writtenAt: new Date("2026-07-30T00:00:00.000Z"),
  retentionDays: 90,
};

function reportedState(
  overrides: Partial<Parameters<typeof evaluation.events.reported>[0]> = {},
): EvaluationState {
  return evaluation.apply(
    evaluation.init(),
    evaluation.events.reported({
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

/** A minimal in-memory `ReplaceStore` keyed the way a real one is, so the real
 * `createFoldExecutor` can be exercised without ClickHouse. */
function createInMemoryStore(): ReplaceStore<EvaluationState> {
  const rows = new Map<string, StoredState<EvaluationState>>();
  return {
    kind: "replace",
    async read(
      key: string,
      context: StoreContext,
    ): Promise<StateRead<EvaluationState>> {
      const stored = rows.get(`${context.tenantId}:${key}`);
      return stored ? { kind: "found", stored } : { kind: "absent" };
    },
    async write(key, stored, context) {
      rows.set(`${context.tenantId}:${key}`, stored);
    },
  };
}

describe("evaluationAnalytics projection", () => {
  it("subscribes to exactly the aggregate's two events, by their persisted strings", () => {
    expect([...evaluationAnalytics.eventTypes].sort()).toEqual([
      "lw.evaluation.reported",
      "lw.evaluation.started",
    ]);
  });

  it("leaves state untouched for an event it did not name", () => {
    const state = evaluationAnalytics.init();
    expect(
      evaluationAnalytics.apply(state, {
        type: "lw.evaluation.added_later",
        data: {},
      }),
    ).toEqual(state);
  });
});

describe("evaluationAnalyticsTable", () => {
  it("anchors its partition and TTL on CreatedAt, never on the moving OccurredAt", () => {
    expect(evaluationAnalyticsTable.name).toBe("evaluation_analytics");
    expect(evaluationAnalyticsTable.partition.column).toBe("CreatedAt");
    expect(evaluationAnalyticsTable.ttl?.anchor).toBe("CreatedAt");
  });

  it("declares no DeliverySeq column", () => {
    expect(evaluationAnalyticsTable.columnNames).not.toContain("DeliverySeq");
  });
});

describe("evaluationAnalytics row mapping", () => {
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

    it("round-trips startedAt/completedAt through the epoch-ms wire form", () => {
      const row = evaluationAnalyticsRow.toRow(reportedState(), ROW_CONTEXT);
      expect(row.StartedAt).toBe(2_000n);
      expect(row.CompletedAt).toBe(2_000n);

      const decoded = evaluationAnalyticsRow.fromRow(row);
      expect(decoded.startedAt).toBe(2_000);
      expect(decoded.completedAt).toBe(2_000);
    });

    it("computes DurationMs from the started/completed operands", () => {
      const started = evaluation.apply(
        evaluation.init(),
        evaluation.events.started({
          evaluationId: "eval-1",
          evaluatorId: "monitor-1",
          evaluatorType: "langevals/answer_correctness",
          occurredAt: 1_000,
        }),
      );
      const reported = evaluation.apply(
        started,
        evaluation.events.reported({
          evaluationId: "eval-1",
          evaluatorId: "monitor-1",
          evaluatorType: "langevals/answer_correctness",
          status: "processed",
          occurredAt: 1_750,
        }),
      );

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

describe("evaluationAnalytics fold executor", () => {
  describe("given a reported delivery has already been applied", () => {
    /**
     * The same regression as the aggregate's own guard, but through the real
     * executor: a `started` delivery arriving after a `reported` one is a
     * genuinely later delivery, and nothing between it and the fold skips it.
     * @scenario "A finished evaluation is never re-counted as running through the fold executor's real delivery path"
     */
    it("does not move the evaluation back to in_progress when a late started delivery arrives", async () => {
      const store = createInMemoryStore();
      const executor = createFoldExecutor({
        store,
        init: evaluationAnalytics.init,
        apply: evaluationAnalytics.apply,
        stateVersion: evaluationAnalytics.version,
        projectionName: evaluationAnalytics.name,
      });
      const context: StoreContext = { tenantId: "tenant-1" };

      await executor.apply({
        key: "eval-1",
        tenantId: context.tenantId,
        events: [
          evaluation.events.reported({
            evaluationId: "eval-1",
            evaluatorId: "monitor-1",
            evaluatorType: "langevals/answer_correctness",
            status: "processed",
            score: 0.9,
            occurredAt: 2_000,
          }),
        ],
      });

      await executor.apply({
        key: "eval-1",
        tenantId: context.tenantId,
        events: [
          evaluation.events.started({
            evaluationId: "eval-1",
            evaluatorId: "monitor-1",
            evaluatorType: "langevals/answer_correctness",
            occurredAt: 1_000,
          }),
        ],
      });

      const read = await store.read("eval-1", context);
      if (read.kind !== "found") throw new Error("unreachable");
      expect(read.stored.state.status).toBe("processed");
      expect(read.stored.state.score).toBe(0.9);
    });
  });

  describe("given the same delivery arrives twice", () => {
    it("reaches the same stored state, with no sequence to skip on", async () => {
      const store = createInMemoryStore();
      const executor = createFoldExecutor({
        store,
        init: evaluationAnalytics.init,
        apply: evaluationAnalytics.apply,
        stateVersion: evaluationAnalytics.version,
        projectionName: evaluationAnalytics.name,
      });
      const delivery = {
        key: "eval-2",
        tenantId: "tenant-1",
        events: [
          evaluation.events.reported({
            evaluationId: "eval-2",
            evaluatorId: "monitor-1",
            evaluatorType: "langevals/answer_correctness",
            status: "processed",
            score: 0.5,
            occurredAt: 1_000,
          }),
        ],
      };

      await executor.apply(delivery);
      const once = await store.read("eval-2", { tenantId: "tenant-1" });
      await executor.apply(delivery);
      const twice = await store.read("eval-2", { tenantId: "tenant-1" });

      expect(twice).toEqual(once);
    });
  });
});
