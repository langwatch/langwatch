import { AnalyticsService } from "@langwatch/analytics-contract";
import { createTenantId, type ProjectionStoreContext } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";
import { EvaluationAnalyticsAttributePolicy } from "../app/evaluation.members.ts";
import {
  EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST,
  EvaluationAnalyticsFoldProjection,
} from "../projections/evaluation-analytics-fold.projection.ts";
import type {
  EvaluationAnalyticsData,
  EvaluationAnalyticsRow,
} from "../projections/evaluation-analytics-row.projection.ts";
import { EvaluationAnalyticsStore } from "../stores/eventing/evaluation-attributes.store.ts";

/**
 * The write path for the evaluation fold. Two claims the executor's dedup and
 * `trustAbsentMiss` both rest on: the applied-event-id watermark is persisted
 * beside the row, and no state is ever refused — a state with no identity of
 * its own is stamped from the aggregate id rather than gated out.
 */

const TENANT = "proj-eval-watermark";

class PassthroughAttributePolicy implements EvaluationAnalyticsAttributePolicy {
  trim(attributes: Record<string, string>): Record<string, string> {
    return attributes;
  }
}

type Written = {
  row: EvaluationAnalyticsRow;
  retentionDays: number;
  appliedEventIds: string[];
};

class RecordingAnalytics extends AnalyticsService {
  readonly written: Written[] = [];

  async getTimeseries(): Promise<never> {
    throw new Error("not used");
  }
  async getFeedbacks(): Promise<never> {
    throw new Error("not used");
  }
  async getTopUsedDocuments(): Promise<never> {
    throw new Error("not used");
  }
  async upsertEvaluationAnalytics(entry: Written): Promise<void> {
    this.written.push(entry);
  }
  async upsertEvaluationAnalyticsBatch(entries: Written[]): Promise<void> {
    this.written.push(...entries);
  }
  async findEvaluationAnalytics(): Promise<null> {
    return null;
  }
  async appendEvaluationAnalyticsRollup(): Promise<void> {}
  async appendEvaluationAnalyticsRollupBatch(): Promise<void> {}
}

const fold = EvaluationAnalyticsFoldProjection.create({
  store: { store: async () => {}, tryGet: async () => null },
});

const bareState = (): EvaluationAnalyticsData => fold.init();

const context = (appliedEventIds?: string[]): ProjectionStoreContext =>
  ({
    aggregateId: "eval-1",
    tenantId: createTenantId(TENANT),
    ...(appliedEventIds ? { appliedEventIds } : {}),
  }) as ProjectionStoreContext;

function makeStore() {
  const analytics = new RecordingAnalytics();
  const store = EvaluationAnalyticsStore.create({
    analytics,
    attributePolicy: new PassthroughAttributePolicy(),
    defaultRetentionDays: 30,
  });
  return { analytics, store };
}

describe("EvaluationAnalyticsStore — write path", () => {
  describe("when a state is committed with the ids of the batch that produced it", () => {
    /** @scenario the watermark survives the eval write path too */
    it("persists the applied-event-id watermark next to the row", async () => {
      const { analytics, store } = makeStore();

      await store.store(bareState(), context(["evt-9"]));

      expect(analytics.written).toHaveLength(1);
      expect(analytics.written[0]!.appliedEventIds).toEqual(["evt-9"]);
    });
  });

  describe("when the state carries no identity of its own", () => {
    // The old gate refused such a state; the aggregate-id stamp makes one, so
    // nothing is gated and absence stays authoritative for trustAbsentMiss.
    /** @scenario no state is unwritable, identity falls back to the aggregate id */
    it("writes it anyway, stamped from the aggregate id", async () => {
      const { analytics, store } = makeStore();

      await store.store(bareState(), context());

      expect(analytics.written).toHaveLength(1);
      expect(analytics.written[0]!.row.evaluationId).toBe("eval-1");
      expect(analytics.written[0]!.row.version).toBe(
        EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST,
      );
    });
  });
});
