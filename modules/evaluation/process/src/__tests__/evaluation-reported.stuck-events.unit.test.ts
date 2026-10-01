import {
  analyticsEvaluationRollupAppendInputSchema,
  analyticsEvaluationUpsertBatchInputSchema,
  analyticsEvaluationUpsertInputSchema,
  type AnalyticsEvaluationUpsertInput,
} from "@langwatch/analytics-contract";
import type { EvaluationReportedEvent } from "@langwatch/evaluation-contract";
import {
  createTenantId,
  FoldProjectionExecutor,
  MapProjectionExecutor,
  type ProjectionStoreContext,
} from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { EvaluationAnalyticsFoldProjection } from "../eventing/evaluation-analytics-fold.projection.ts";
import { EvaluationAnalyticsRollupMapProjection } from "../eventing/evaluation-analytics-rollup.projection.ts";
import {
  EvaluationProcessingStoresAdapter,
  type EvaluationAnalyticsWrites,
} from "../eventing/evaluation-processing-stores.pipeline.ts";
import { EvaluationRunFoldProjection } from "../eventing/evaluation-run.projection.ts";
import { MemoryEvaluationAnalyticsFoldCacheRepository } from "../repositories/memory/memory.evaluation-analytics-fold-cache.repository.ts";
import { MemoryEvaluationRunRepository } from "../repositories/memory/memory.evaluation-run.repository.ts";
import { EvaluationRunProjectionService } from "../services/evaluation-run-projection.service.ts";
import {
  experimentReportedEvent,
  monitorReportedEvent,
  rollupReportedEvent,
} from "./fixtures/stuck-reported-events.fixture.ts";

const RETENTION = { traces: 63, scenarios: 63, experiments: 63 };

/** Real run service and repository parses; analytics parses as its ClickHouse repository does. */
function stores() {
  const analyticsRows = new Map<string, AnalyticsEvaluationUpsertInput>();
  const analytics = createApiFixture<EvaluationAnalyticsWrites>({
    upsertEvaluationAnalytics: async (input) => {
      const parsed = analyticsEvaluationUpsertInputSchema.parse(input);
      analyticsRows.set(parsed.row.evaluationId, parsed);
    },
    upsertEvaluationAnalyticsBatch: async (input) => {
      for (const entry of analyticsEvaluationUpsertBatchInputSchema.parse(input)) {
        analyticsRows.set(entry.row.evaluationId, entry);
      }
    },
    findEvaluationAnalytics: async ({ evaluationId }) => {
      const found = analyticsRows.get(evaluationId);
      return found ? { row: found.row, appliedEventIds: found.appliedEventIds ?? [] } : null;
    },
    appendEvaluationAnalyticsRollup: async (input) => {
      analyticsEvaluationRollupAppendInputSchema.parse(input);
    },
  });
  return EvaluationProcessingStoresAdapter.create({
    runs: EvaluationRunProjectionService.create({
      repository: MemoryEvaluationRunRepository.create(),
      retention: { getPlatformDefaultRetentionDays: () => 30, findRetentionDays: async () => [] },
    }),
    analytics,
    analyticsFoldCache: MemoryEvaluationAnalyticsFoldCacheRepository.create(),
    defaultRetentionDays: () => 30,
    tenantRetention: { resolve: async () => RETENTION },
  }).buildStores();
}

function contextOf(
  event: EvaluationReportedEvent,
  deliveryAttempt: number,
): ProjectionStoreContext {
  return {
    aggregateId: event.aggregateId,
    tenantId: createTenantId(event.tenantId),
    retentionPolicy: RETENTION,
    deliveryAttempt,
  };
}

describe("given the reported events that retried on the check stack", () => {
  describe.each([
    ["a monitor", monitorReportedEvent],
    ["an experiment", experimentReportedEvent],
  ])("when %s reported event folds into evaluationRun, first and on retry", (_, event) => {
    it("stores the run on both attempts", async () => {
      const { evalRunStore } = stores();
      const projection = EvaluationRunFoldProjection.create({ store: evalRunStore });
      const executor = new FoldProjectionExecutor();

      await executor.execute(projection, event, contextOf(event, 1));
      const retried = await executor.execute(projection, event, contextOf(event, 12));

      expect(retried.status).toBe("processed");
    });
  });

  describe.each([
    ["a monitor", monitorReportedEvent],
    ["an experiment", experimentReportedEvent],
  ])("when %s reported event folds into evaluationAnalytics, first and on retry", (_, event) => {
    it("stores the analytics row on both attempts", async () => {
      const { evaluationAnalyticsStore } = stores();
      const projection = EvaluationAnalyticsFoldProjection.create({
        store: evaluationAnalyticsStore,
      });
      const executor = new FoldProjectionExecutor();

      await executor.execute(projection, event, contextOf(event, 1));
      const retried = await executor.execute(projection, event, contextOf(event, 12));

      expect(retried.status).toBe("processed");
    });
  });

  describe("when the reported event maps into the evaluation rollup", () => {
    it("appends the rollup row", async () => {
      const { evaluationAnalyticsRollupAppendStore } = stores();
      const projection = EvaluationAnalyticsRollupMapProjection.create({
        store: evaluationAnalyticsRollupAppendStore,
      });

      const row = await new MapProjectionExecutor().execute(
        projection,
        rollupReportedEvent,
        contextOf(rollupReportedEvent, 12),
      );

      expect(row).toMatchObject({ evaluatorType: "langevals/exact_match", passCount: 1 });
    });
  });
});
