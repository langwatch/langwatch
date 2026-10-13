import type {
  AnalyticsEvaluationUpsertInput,
  AnalyticsEvaluationRollupAppendInput,
} from "@langwatch/analytics-contract";
import { projectIdsReadBy } from "@langwatch/authorization";
import type { EvaluationRunData, UpsertEvaluationRunCommand } from "@langwatch/evaluation-contract";
import { createTenantId, type ProjectionStoreContext } from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { ownProof } from "../../__tests__/support/authorization-proofs.fixture.ts";
import type { EvaluationRunProjectionRepository } from "../../repositories/evaluation-run-projection.repository.ts";
import { MemoryEvaluationAnalyticsFoldCacheRepository } from "../../repositories/memory/memory.evaluation.repositories.ts";
import { EvaluationAnalyticsFoldProjection } from "../evaluation-analytics-fold.projection.ts";
import {
  EvaluationProcessingStoresAdapter,
  type EvaluationAnalyticsWrites,
} from "../evaluation-processing-stores.pipeline.ts";

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
  const authorizeFoldRead = vi.fn(async ({ projectId }: { projectId: string }) =>
    ownProof({ projectId }),
  );
  const findRunByEvaluationId = vi.fn<EvaluationRunProjectionRepository["findRunByEvaluationId"]>(
    async () => run,
  );
  const analytics: AnalyticsEvaluationUpsertInput[] = [];
  const rollups: AnalyticsEvaluationRollupAppendInput[] = [];
  const stores = EvaluationProcessingStoresAdapter.create({
    runs: createApiFixture<EvaluationRunProjectionRepository>({
      upsertRun: async (input) => {
        runs.push(input);
      },
      findRunByEvaluationId,
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
    tenantRetention: { resolve: async () => null },
    authorizeFoldRead,
  }).buildStores();

  return { stores, runs, analytics, authorizeFoldRead, findRunByEvaluationId };
}

describe("given evaluation's run fold store", () => {
  describe("when it reads a run back during a fold", () => {
    it("reads through an own-only proof minted for the context's tenant, never a bare tenant id", async () => {
      const { stores, authorizeFoldRead, findRunByEvaluationId } = storesReading(() => 30);

      await expect(
        stores.evalRunStore.get("evaluation-1", { ...context, eventId: "event-1" }),
      ).resolves.toEqual({ kind: "folded", state: run });

      expect(authorizeFoldRead).toHaveBeenCalledWith({
        projectId: TENANT,
        purpose: { kind: "event", eventId: "event-1" },
      });
      const lookup = findRunByEvaluationId.mock.calls[0]?.[0];
      expect(lookup).not.toHaveProperty("tenantId");
      expect(lookup?.evaluationId).toBe("evaluation-1");
      expect(lookup && projectIdsReadBy(lookup.authorization)).toEqual([TENANT]);
    });
  });
});

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
