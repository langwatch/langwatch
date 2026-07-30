import type { ClickHouseClient } from "@langwatch/clickhouse";
import {
    definePipeline,
    type ReplaceStore,
    type StateRead,
    type StoreContext,
    type StoredState,
} from "@langwatch/event-sourcing";
import { describe, expect, it, vi } from "vitest";
import {
    applyEvaluationReported,
    applyEvaluationStarted,
    initEvaluationState,
} from "./evaluationAnalytics.projection";
import { EVALUATION_PIPELINE_NAME, EVALUATION_PIPELINE_PREFIX, evaluationEvents } from "./events";
import { evaluationProcessing } from "./index";
import { evaluationStateSchema, type EvaluationState } from "./schema";

/** A minimal in-memory `ReplaceStore`, so the fold's own wiring can be
 * exercised without the deployed table's unmet sort-key precondition
 * (see "refuses to mount the fold" below). */
function createInMemoryStore(): ReplaceStore<EvaluationState> {
  const rows = new Map<string, StoredState<EvaluationState>>();
  return {
    kind: "replace",
    async read(key: string, context: StoreContext): Promise<StateRead<EvaluationState>> {
      const stored = rows.get(`${context.tenantId}:${key}`);
      return stored ? { kind: "found", stored } : { kind: "absent" };
    },
    async write(key, stored, context) {
      rows.set(`${context.tenantId}:${key}`, stored);
    },
  };
}

/** Wires exactly what `evaluationProcessing`'s real chain wires, over
 * a caller-supplied store instead of a ClickHouse client. */
function buildTestPipeline(store: ReplaceStore<EvaluationState>) {
  return definePipeline(EVALUATION_PIPELINE_NAME)
    .prefix(EVALUATION_PIPELINE_PREFIX)
    .events(evaluationEvents)
    .id({
      started: (data) => data.evaluationId,
      reported: (data) => data.evaluationId,
    })
    .withFold("evaluationAnalytics", {
      state: evaluationStateSchema,
      init: initEvaluationState,
      pin: "2026-07-27",
      on: { started: applyEvaluationStarted, reported: applyEvaluationReported },
      store,
    })
    .build();
}

describe("evaluationProcessing", () => {
  /**
   * The deployed sort key leads on `OccurredAt`, so `(TenantId, EvaluationId)`
   * — the only key a fold on one evaluation can bind — is not its prefix, and
   * every fold apply would scan rather than seek. Refused at composition
   * (ADR-106) until the re-key migration lands.
   */
  it("refuses to mount the fold until evaluation_analytics is re-keyed", () => {
    const client: ClickHouseClient = {
      query: vi.fn(),
      stream: vi.fn(),
      insert: vi.fn(),
      close: vi.fn(),
    };

    expect(() => evaluationProcessing({ client })).toThrow(
      /sort key \[TenantId, OccurredAt, EvaluationId\]/,
    );
  });
});

describe("the evaluation pipeline's declared vocabulary and fold", () => {
  it("subscribes to exactly the two persisted event strings already in event_log", () => {
    const built = buildTestPipeline(createInMemoryStore());
    expect([...built.folds.evaluationAnalytics!.eventTypes].sort()).toEqual([
      "lw.evaluation.reported",
      "lw.evaluation.started",
    ]);
  });

  it("pins the fold's live production stamp rather than a freshly derived hash", () => {
    const built = buildTestPipeline(createInMemoryStore());
    expect(built.folds.evaluationAnalytics!.stateVersion).toBe("2026-07-27");
  });
});

describe("evaluationAnalytics fold executor", () => {
  describe("given a reported delivery has already been applied", () => {
    /**
     * The same regression as the projection's own guard, but through the real
     * built fold: a `started` delivery arriving after a `reported` one is a
     * genuinely later delivery, and nothing between it and the fold skips it.
     * @scenario "A finished evaluation is never re-counted as running through the fold executor's real delivery path"
     */
    it("does not move the evaluation back to in_progress when a late started delivery arrives", async () => {
      const store = createInMemoryStore();
      const built = buildTestPipeline(store);
      const context: StoreContext = { tenantId: "tenant-1" };

      await built.folds.evaluationAnalytics!.apply({
        key: "eval-1",
        tenantId: context.tenantId,
        events: [
          {
            type: "lw.evaluation.reported",
            data: {
              evaluationId: "eval-1",
              evaluatorId: "monitor-1",
              evaluatorType: "langevals/answer_correctness",
              status: "processed",
              score: 0.9,
              occurredAt: 2_000,
            },
          },
        ],
      });

      await built.folds.evaluationAnalytics!.apply({
        key: "eval-1",
        tenantId: context.tenantId,
        events: [
          {
            type: "lw.evaluation.started",
            data: {
              evaluationId: "eval-1",
              evaluatorId: "monitor-1",
              evaluatorType: "langevals/answer_correctness",
              isGuardrail: true,
              occurredAt: 1_000,
            },
          },
        ],
      });

      const read = await store.read("eval-1", context);
      if (read.kind !== "found") throw new Error("unreachable");
      expect(read.stored.state.status).toBe("processed");
      expect(read.stored.state.score).toBe(0.9);
      expect(read.stored.state.isGuardrail).toBe(true);
    });
  });

  describe("given the same delivery arrives twice", () => {
    it("reaches the same stored state, with no sequence to skip on", async () => {
      const store = createInMemoryStore();
      const built = buildTestPipeline(store);
      const delivery = {
        key: "eval-2",
        tenantId: "tenant-1",
        events: [
          {
            type: "lw.evaluation.reported",
            data: {
              evaluationId: "eval-2",
              evaluatorId: "monitor-1",
              evaluatorType: "langevals/answer_correctness",
              status: "processed",
              score: 0.5,
              occurredAt: 1_000,
            },
          },
        ],
      };

      await built.folds.evaluationAnalytics!.apply(delivery);
      const once = await store.read("eval-2", { tenantId: "tenant-1" });
      await built.folds.evaluationAnalytics!.apply(delivery);
      const twice = await store.read("eval-2", { tenantId: "tenant-1" });

      expect(twice).toEqual(once);
    });
  });
});
