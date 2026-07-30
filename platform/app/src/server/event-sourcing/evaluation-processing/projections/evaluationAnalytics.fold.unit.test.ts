import type {
  ReplaceStore,
  StateRead,
  StoreContext,
  StoredState,
} from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import { type EvaluationState, evaluationAggregate } from "../aggregate";
import { createEvaluationAnalyticsFoldExecutor } from "./evaluationAnalytics.fold";

/** A minimal in-memory `ReplaceStore`, keyed the same way a real one is
 * (`tenantId:key`), for exercising the real `createFoldExecutor` end to end
 * without ClickHouse. */
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

describe("evaluationAnalytics fold executor", () => {
  describe("given a reported delivery has already been applied", () => {
    /**
     * The same defect as `aggregate.unit.test.ts`'s "A finished evaluation is
     * never re-counted as running", but exercised through the REAL `createFoldExecutor` — not just
     * `evaluationAggregate.apply` directly — with a realistic delivery
     * sequence: the late `started` delivery has a HIGHER `deliverySeq` than
     * the `reported` delivery that landed first (a genuinely later arrival,
     * not a retry the executor's own redelivery guard would skip), which is
     * exactly ADR-098 decision 5's "a different, older event, arriving
     * late -> apply" row. If the executor's redelivery guard were the only
     * thing standing between this event and the fold, this event would NOT
     * be skipped — it must be the aggregate's own monotone-status guard that
     * stops the regression, and this test proves that, not just the guard's
     * existence in isolation.
     * @scenario "A finished evaluation is never re-counted as running through the fold executor's real delivery path"
     */
    it("does not move the evaluation back to in_progress when a late started delivery arrives", async () => {
      const store = createInMemoryStore();
      const executor = createEvaluationAnalyticsFoldExecutor({ store });
      const context: StoreContext = { tenantId: "tenant-1" };

      const reportedOutcome = await executor.apply({
        key: "eval-1",
        tenantId: context.tenantId,
        deliverySeq: 1,
        events: [
          evaluationAggregate.events.reported({
            evaluationId: "eval-1",
            evaluatorId: "monitor-1",
            evaluatorType: "langevals/answer_correctness",
            status: "processed",
            score: 0.9,
            occurredAt: 2_000,
          }),
        ],
      });
      expect(reportedOutcome.kind).toBe("applied");

      const startedOutcome = await executor.apply({
        key: "eval-1",
        tenantId: context.tenantId,
        // Higher deliverySeq: a genuinely later delivery, not a retry — the
        // executor's own redelivery-skip guard (deliverySeq comparison) does
        // NOT intercept this one.
        deliverySeq: 2,
        events: [
          evaluationAggregate.events.started({
            evaluationId: "eval-1",
            evaluatorId: "monitor-1",
            evaluatorType: "langevals/answer_correctness",
            occurredAt: 1_000,
          }),
        ],
      });
      expect(startedOutcome.kind).toBe("applied");

      const read = await store.read("eval-1", context);
      expect(read.kind).toBe("found");
      if (read.kind !== "found") throw new Error("unreachable");
      expect(read.stored.state.status).toBe("processed");
      expect(read.stored.state.score).toBe(0.9);
    });
  });

  describe("given a redelivered job carries the same or an older delivery sequence", () => {
    it("is skipped, not re-applied", async () => {
      const store = createInMemoryStore();
      const executor = createEvaluationAnalyticsFoldExecutor({ store });

      await executor.apply({
        key: "eval-2",
        tenantId: "tenant-1",
        deliverySeq: 5,
        events: [
          evaluationAggregate.events.reported({
            evaluationId: "eval-2",
            evaluatorId: "monitor-1",
            evaluatorType: "langevals/answer_correctness",
            status: "processed",
            occurredAt: 1_000,
          }),
        ],
      });

      const redelivered = await executor.apply({
        key: "eval-2",
        tenantId: "tenant-1",
        deliverySeq: 5,
        events: [
          evaluationAggregate.events.reported({
            evaluationId: "eval-2",
            evaluatorId: "monitor-1",
            evaluatorType: "langevals/answer_correctness",
            status: "error",
            occurredAt: 1_000,
          }),
        ],
      });

      expect(redelivered.kind).toBe("skipped-redelivery");
      const read = await store.read("eval-2", { tenantId: "tenant-1" });
      if (read.kind !== "found") throw new Error("unreachable");
      // The redelivered (differently-shaped) content never landed.
      expect(read.stored.state.status).toBe("processed");
    });
  });
});
