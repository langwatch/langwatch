import type { ProjectionStoreContext } from "@langwatch/eventing";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";
import { AnalyticsService } from "@langwatch/analytics-contract";
import { evaluationCompletedEventSchema } from "@langwatch/evaluation-contract";
import {
  EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST,
  EvaluationAnalyticsAttributePolicy,
  type EvaluationAnalyticsData,
  EvaluationAnalyticsFoldProjection,
  type EvaluationAnalyticsRow,
  EvaluationAnalyticsStore,
  EvaluationAnalyticsRowProjection,
} from "../testing";

/**
 * Read-back round-trip for the slim evaluation fold (ADR-066). `fromRow`
 * recovers the fold's WORKING state from the last committed row so the delivery
 * path never refolds from `event_log`. The genuine gap is the lifecycle
 * timestamps DurationMs is derived from — the row persisted only the derived
 * duration, not its operands.
 */

const TENANT = "proj-eval-rb";
const BASE_MS = 1_760_000_000_000;
class PassthroughAnalyticsAttributePolicy extends EvaluationAnalyticsAttributePolicy {
  trim(attributes: Record<string, string>): Record<string, string> {
    return attributes;
  }
}

const attributePolicy = new PassthroughAnalyticsAttributePolicy();
const rowProjection = EvaluationAnalyticsRowProjection.create();

const fold = new EvaluationAnalyticsFoldProjection({
  store: { store: async () => {}, get: async () => null },
});

function project(state: EvaluationAnalyticsData): EvaluationAnalyticsRow {
  return rowProjection.project({
    state,
    tenantId: TENANT,
    version: EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST,
    attributePolicy,
  });
}

function committedState(over: Partial<EvaluationAnalyticsData> = {}): EvaluationAnalyticsData {
  return {
    ...fold.init(),
    evaluationId: "eval-rb",
    evaluatorId: "monitor-x",
    evaluatorType: "langevals/llm_answer_match",
    evaluatorName: "Judge",
    status: "processed",
    isGuardrail: true,
    passed: true,
    score: 0.87,
    label: "match",
    model: "gpt-5-mini",
    traceId: "trace-9",
    scheduledAt: BASE_MS - 2000,
    startedAt: BASE_MS - 1000,
    completedAt: BASE_MS,
    costId: "cost-1",
    attributes: { "metadata.team": "platform" },
    createdAt: BASE_MS - 2000,
    updatedAt: BASE_MS + 10,
    LastEventOccurredAt: BASE_MS,
    ...over,
  };
}

describe("evaluationAnalytics read-back (fromRow)", () => {
  describe("given a committed slim row", () => {
    const state = committedState();
    const row = project(state);
    const decoded = rowProjection.fromRow(row);

    it("recovers the lifecycle operands DurationMs is derived from", () => {
      expect(decoded.startedAt).toBe(BASE_MS - 1000);
      expect(decoded.completedAt).toBe(BASE_MS);
    });

    it("recovers the hoisted dimensions and terminal outcome", () => {
      expect(decoded.status).toBe("processed");
      expect(decoded.score).toBe(0.87);
      expect(decoded.passed).toBe(true);
      expect(decoded.label).toBe("match");
      expect(decoded.model).toBe("gpt-5-mini");
      expect(decoded.evaluatorType).toBe("langevals/llm_answer_match");
      expect(decoded.evaluatorName).toBe("Judge");
      expect(decoded.isGuardrail).toBe(true);
      expect(decoded.traceId).toBe("trace-9");
      expect(decoded.LastEventOccurredAt).toBe(BASE_MS);
    });

    it("defaults the fields that feed no persisted column", () => {
      // Not persisted — re-populated by later events; evaluationId carries the
      // store's persistable-signal, so defaulting these loses no correctness.
      expect(decoded.evaluatorId).toBe("");
      expect(decoded.scheduledAt).toBeNull();
      expect(decoded.costId).toBeNull();
    });

    it("re-projects to the identical row — read-back is a fixed point", () => {
      expect(project(decoded)).toEqual(row);
    });
  });

  describe("given a scheduled-then-started row recovered after a cold cache", () => {
    it("computes a non-zero duration when the completed event finally lands", () => {
      // Started but not yet completed: the row carries DurationMs 0 but now
      // persists StartedAt, which is the whole point of the read-back column.
      const startedOnly = committedState({
        status: "in_progress",
        startedAt: BASE_MS - 1000,
        completedAt: null,
        passed: null,
        score: null,
        label: null,
      });
      const row = project(startedOnly);
      expect(row.durationMs).toBe(0);
      expect(row.startedAtMs).toBe(BASE_MS - 1000);

      // Cold-cache recovery, then the terminal event arrives.
      const recovered = rowProjection.fromRow(row);
      expect(recovered.startedAt).toBe(BASE_MS - 1000);

      const completed = fold.handleEvaluationCompleted(
        evaluationCompletedEventSchema.parse({
          type: "lw.evaluation.completed",
          id: "evt-c",
          tenantId: TENANT,
          aggregateId: "eval-rb",
          aggregateType: "evaluation",
          createdAt: BASE_MS,
          occurredAt: BASE_MS,
          version: "2025-01-14",
          data: {
            evaluationId: "eval-rb",
            status: "processed",
            passed: true,
            score: 0.9,
          },
        }),
        recovered,
      );
      const finalRow = project(completed);

      // Without the persisted StartedAt this would be 0 (startedAt lost on the
      // miss); with it, the duration is the real span.
      expect(finalRow.durationMs).toBe(1000);
    });
  });

  describe("given a pre-migration row whose read-back columns are absent", () => {
    it("stays total, decoding the lifecycle timestamps as null", () => {
      const row = project(committedState());
      const legacyRow: EvaluationAnalyticsRow = {
        ...row,
        startedAtMs: null,
        completedAtMs: null,
      };

      const decoded = rowProjection.fromRow(legacyRow);

      expect(decoded.status).toBe("processed");
      expect(decoded.score).toBe(0.87);
      // Indistinguishable from an evaluation that genuinely never started —
      // which is why the STORE, not this decoder, decides whether such a row may
      // be read back at all. See the version-gate tests below.
      expect(decoded.startedAt).toBeNull();
      expect(decoded.completedAt).toBeNull();
    });
  });
});

describe("EvaluationAnalyticsStore read-back version gate", () => {
  const context = {
    aggregateId: "eval-rb",
    tenantId: createTenantId(TENANT),
  } as ProjectionStoreContext;

  class ReadBackAnalytics extends AnalyticsService {
    constructor(private readonly row: EvaluationAnalyticsRow) {
      super();
    }

    async getTimeseries(): Promise<never> {
      throw new Error("not used");
    }

    async getFeedbacks(): Promise<never> {
      throw new Error("not used");
    }

    async getTopUsedDocuments(): Promise<never> {
      throw new Error("not used");
    }

    async upsertEvaluationAnalytics(): Promise<void> {}

    async upsertEvaluationAnalyticsBatch(): Promise<void> {}

    async tryGetEvaluationAnalytics(): Promise<{
      row: EvaluationAnalyticsRow;
      appliedEventIds: string[];
    }> {
      return { row: this.row, appliedEventIds: ["evt-1"] };
    }

    async appendEvaluationAnalyticsRollup(): Promise<void> {}

    async appendEvaluationAnalyticsRollupBatch(): Promise<void> {}
  }

  function storeOver(row: EvaluationAnalyticsRow) {
    const analytics = new ReadBackAnalytics(row);
    const store = EvaluationAnalyticsStore.create({
      analytics,
      attributePolicy,
      defaultRetentionDays: 30,
    });
    return { store };
  }

  describe("given a row stamped with the current projection version", () => {
    /** @scenario a stored state written under the fold's current shape is read straight back */
    it("reads the state and the durable watermark back", async () => {
      const { store } = storeOver(project(committedState()));

      const { state, appliedEventIds } = await store.getWithApplied("eval-rb", context);

      expect(state?.startedAt).toBe(BASE_MS - 1000);
      expect(state?.status).toBe("processed");
      expect(appliedEventIds).toEqual(["evt-1"]);
    });
  });

  describe("given a row stamped with an older projection version", () => {
    // Such a row predates the lifecycle columns: its null StartedAt is
    // indistinguishable from an evaluation that never started, so a `completed`
    // event folded onto it would compute a zero duration over a real one.
    const staleRow = (): EvaluationAnalyticsRow => ({
      ...project(committedState()),
      version: "2026-06-20",
      startedAtMs: null,
      completedAtMs: null,
    });

    /** @scenario a stored state written under an older shape is rebuilt rather than trusted */
    it("reports a store miss so the fold refolds instead of trusting it", async () => {
      const { store } = storeOver(staleRow());

      const { state, appliedEventIds, miss } = await store.getWithApplied("eval-rb", context);

      expect(state).toBeNull();
      // The watermark goes with the state: keeping it would suppress the very
      // events the re-fold needs to see.
      expect(appliedEventIds).toEqual([]);
      // Asserted on the REAL store. The executor skips its unwindowed
      // re-read on `undecodable`; without this the only test naming the
      // value fabricated it from a mock, so deleting the discriminator
      // here left the suite green.
      expect(miss).toBe("undecodable");
    });

    it("misses through get() too, so both read paths agree", async () => {
      const { store } = storeOver(staleRow());

      expect(await store.get("eval-rb", context)).toBeNull();
    });
  });
});
