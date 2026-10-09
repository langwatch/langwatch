/**
 * @vitest-environment node
 * The feature installs: a memory-tier process gets a working `AnalyticsApi` over its registry's
 * memory repositories, reading no process member and naming no repository class here.
 */
import { AnalyticsApi, type AnalyticsEvaluationRow } from "@langwatch/analytics-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import { DataRetentionApi } from "@langwatch/data-retention-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { InstantEvalApi } from "@langwatch/instant-eval-contract";
import { bootInstalledProcess } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { testPeer } from "@langwatch/process/testing";
import { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { analyticsProcessModule } from "../../analytics.module.ts";

const PUBLIC_BASE_URL = "https://app.langwatch.test";
const OCCURRED_AT_MS = 1_750_000_000_000;

const evaluationRow: AnalyticsEvaluationRow = {
  tenantId: "project-1",
  evaluationId: "evaluation-1",
  version: "2026-06-20",
  occurredAtMs: OCCURRED_AT_MS,
  createdAtMs: OCCURRED_AT_MS,
  updatedAtMs: OCCURRED_AT_MS,
  evaluatorType: "langevals/llm_answer_match",
  evaluatorName: "Judge",
  status: "processed",
  isGuardrail: false,
  passed: true,
  score: 0.9,
  label: "match",
  model: null,
  traceId: "trace-1",
  userId: null,
  conversationId: null,
  customerId: null,
  origin: null,
  durationMs: 120,
  totalCost: null,
  nonBilledCost: null,
  attributes: {},
  startedAtMs: null,
  completedAtMs: null,
};

/** Every peer, and the judge analytics' channel binds, stand in for their uninstalled owners. */
function boot(role: "api" | "worker") {
  return bootInstalledProcess({
    role,
    modules: [analyticsProcessModule],
    config: {
      analytics: {
        langwatchQl: {
          url: undefined,
          username: undefined,
          database: undefined,
          tenantSetting: undefined,
          postgresHost: undefined,
          accessModelMode: undefined,
          sqlSingleNode: undefined,
        },
        tenantAnalyticsConcurrency: 4,
        publicBaseUrl: PUBLIC_BASE_URL,
      },
    },
    stores: memoryStores(),
    peers: [
      testPeer({ token: FeatureFlagApi, instance: createApiFixture<FeatureFlagApi>() }),
      testPeer({ token: AuthzApi, instance: createApiFixture<AuthzApi>() }),
      testPeer({ token: DataPrivacyApi, instance: createApiFixture<DataPrivacyApi>() }),
      testPeer({ token: ProjectApi, instance: createApiFixture<ProjectApi>() }),
      testPeer({ token: EntitlementApi, instance: createApiFixture<EntitlementApi>() }),
      testPeer({ token: TraceApi, instance: createApiFixture<TraceApi>() }),
      testPeer({ token: DataRetentionApi, instance: createApiFixture<DataRetentionApi>() }),
      testPeer({ token: InstantEvalApi, instance: createApiFixture<InstantEvalApi>() }),
    ],
  });
}

describe("analytics app installation", () => {
  describe("given a process that boots the feature over memory stores", () => {
    it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
      const runtime = await boot(role);

      try {
        const app = runtime.service(AnalyticsApi);

        expect(runtime.module(analyticsProcessModule).provided).toBe(app);
        // The memory tier has no ClickHouse or PostgreSQL server to offer LangWatchQL on.
        expect(app.isLangWatchQLAvailable()).toBe(false);
        await expect(app.findAppFunctionsProvisionable()).resolves.toEqual([]);
        await expect(
          app.findLastOccurredAt({
            projectId: "project-1",
            source: "trace",
            since: Temporal.Instant.fromEpochMilliseconds(0),
          }),
        ).resolves.toEqual([]);
        expect(app.savedWorkbenchChartPlatformUrl({ projectSlug: "my-project" })).toContain(
          PUBLIC_BASE_URL,
        );
      } finally {
        await runtime.stop();
      }
    });

    it("reads back the evaluation analytics it was given", async () => {
      const runtime = await boot("worker");

      try {
        const app = runtime.service(AnalyticsApi);
        await app.upsertEvaluationAnalytics({ row: evaluationRow, appliedEventIds: ["event-1"] });

        await expect(
          app.findEvaluationAnalytics({ tenantId: "project-1", evaluationId: "evaluation-1" }),
        ).resolves.toEqual({ row: evaluationRow, appliedEventIds: ["event-1"] });
        await expect(
          app.findLastOccurredAt({
            projectId: "project-1",
            source: "evaluation",
            since: Temporal.Instant.fromEpochMilliseconds(0),
          }),
        ).resolves.toEqual([Temporal.Instant.fromEpochMilliseconds(OCCURRED_AT_MS)]);
      } finally {
        await runtime.stop();
      }
    });
  });
});
