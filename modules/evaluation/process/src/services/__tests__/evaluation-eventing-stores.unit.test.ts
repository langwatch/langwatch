import type {
  AnalyticsEvaluationUpsertInput,
  AnalyticsEvaluationRollupAppendInput,
} from "@langwatch/analytics-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { EvaluationRunData, UpsertEvaluationRunCommand } from "@langwatch/evaluation-contract";
import { createTenantId, type ProjectionStoreContext } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { EvaluationAnalyticsFoldProjection } from "../../eventing/evaluation-analytics-fold.projection.ts";
import type { EvaluationRunProjectionRepository } from "../../repositories/evaluation-run-projection.repository.ts";
import { MemoryEvaluationAnalyticsFoldCacheRepository } from "../../repositories/memory/memory.evaluation-analytics-fold-cache.repository.ts";
import {
  EvaluationEventingService,
  type EvaluationAnalyticsWrites,
} from "../evaluation-eventing.service.ts";

const TENANT = "project-1";
const context: ProjectionStoreContext = {
  aggregateId: "evaluation-1",
  tenantId: createTenantId(TENANT),
};

const run: EvaluationRunData = {
  evaluationId: "evaluation-1",
  evaluatorId: "evaluator-1",
  evaluatorType: "langevals/exact_match",
  evaluatorName: "Exact match",
  traceId: "trace-1",
  isGuardrail: false,
  status: "processed",
  score: 1,
  passed: true,
  label: null,
  details: null,
  inputs: null,
  error: null,
  errorDetails: null,
  createdAt: 1,
  updatedAt: 2,
  LastEventOccurredAt: 2,
  archivedAt: null,
  scheduledAt: 1,
  startedAt: 1,
  completedAt: 2,
  costId: null,
};

function storesReading(defaultRetentionDays: () => number) {
  const runs: UpsertEvaluationRunCommand[] = [];
  const analytics: AnalyticsEvaluationUpsertInput[] = [];
  const rollups: AnalyticsEvaluationRollupAppendInput[] = [];
  const stores = EvaluationEventingService.create({
    runs: createApiFixture<EvaluationRunProjectionRepository>({
      upsertRun: async (input) => {
        runs.push(input);
      },
    }),
    analytics: createApiFixture<EvaluationAnalyticsWrites>({
      upsertEvaluationAnalytics: async (input) => {
        analytics.push(input);
      },
      appendEvaluationAnalyticsRollup: async (input) => {
        rollups.push(input);
      },
    }),
    analyticsFoldCache: MemoryEvaluationAnalyticsFoldCacheRepository.create(),
    defaultRetentionDays,
  }).buildStores();

  return { stores, runs, analytics };
}

describe("given evaluation's fold stores built over the platform default retention", () => {
  describe("when a run and its analytics fold are written for a tenant with no override", () => {
    /** @scenario "Evaluation's fold stores stamp the platform default retention read at write time" */
    it("reads the default on each write, never while the stores are built", async () => {
      let days = 30;
      const reads: number[] = [];
      const { stores, runs, analytics } = storesReading(() => {
        reads.push(days);
        return days;
      });
      expect(reads).toEqual([]);

      days = 90;
      await stores.evalRunStore.store(run, context);
      await stores.evaluationAnalyticsStore.store(
        EvaluationAnalyticsFoldProjection.create({
          store: { store: async () => {}, get: async () => ({ kind: "empty" }) },
        }).init(),
        context,
      );

      expect(runs.map((entry) => entry.retentionDays)).toEqual([90]);
      expect(analytics.map((entry) => entry.retentionDays)).toEqual([90]);
      expect(reads).toEqual([90, 90]);
    });
  });
});
