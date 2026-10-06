/**
 * The ADR-034 read tripwire is the feature-flag peer's answer, asked of the project: where
 * it is on the legacy table is read beside the routed one, and the routed result still wins.
 * @vitest-environment node
 */
import type {
  AnalyticsFeedbacksResult,
  AnalyticsTable,
  AnalyticsTimeseriesInput,
  AnalyticsTimeseriesResult,
  AnalyticsTopDocumentsResult,
} from "@langwatch/analytics-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi, FeatureFlagTarget } from "@langwatch/feature-flag-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import {
  AnalyticsRepository,
  type AnalyticsTimeseriesQuery,
} from "../../repositories/analytics.repository.ts";
import { MemoryAnalyticsRepositories } from "../../repositories/memory/memory.analytics.repositories.ts";
import { AnalyticsModule } from "../analytics.app.ts";

const PROJECT_ID = "project-tripwire";
const TRIPWIRE_FLAG = "release_event_sourced_analytics_read_tripwire";

const routedResult: AnalyticsTimeseriesResult = {
  previousPeriod: [],
  currentPeriod: [{ date: "2026-01-01", "0/performance.total_cost/sum": 50 }],
};
const legacyResult: AnalyticsTimeseriesResult = {
  previousPeriod: [],
  currentPeriod: [{ date: "2026-01-01", "0/performance.total_cost/sum": 100 }],
};

/** Routes every read to the rollup and answers per table, remembering which tables were read. */
class TableRecordingRepository extends AnalyticsRepository {
  readonly tablesRead: AnalyticsTable[] = [];

  tableFor(_input: AnalyticsTimeseriesInput): AnalyticsTable {
    return "trace_analytics_rollup";
  }

  runTimeseries(query: AnalyticsTimeseriesQuery): Promise<AnalyticsTimeseriesResult> {
    this.tablesRead.push(query.table);

    return Promise.resolve(query.table === "trace_analytics_rollup" ? routedResult : legacyResult);
  }

  findFeedbackEvents(): Promise<AnalyticsFeedbacksResult> {
    return Promise.resolve({ events: [] });
  }

  findTopDocuments(): Promise<AnalyticsTopDocumentsResult> {
    return Promise.resolve({ topDocuments: [], totalUniqueDocuments: 0 });
  }
}

async function harness(tripwireOn: boolean) {
  const flagReads: { key: string; target: FeatureFlagTarget }[] = [];
  const repository = new TableRecordingRepository();
  const app = await AnalyticsModule.create({
    dependencies: {
      featureFlags: createApiFixture<FeatureFlagApi>({
        isEnabled: (key, target) => {
          flagReads.push({ key, target });

          return Promise.resolve(key === TRIPWIRE_FLAG && tripwireOn);
        },
      }),
      authz: createApiFixture<AuthzApi>(),
      dataPrivacy: createApiFixture<DataPrivacyApi>(),
      projects: createApiFixture<ProjectApi>(),
      plans: createApiFixture<EntitlementApi>(),
      traces: createApiFixture<TraceApi>(),
      retention: createApiFixture<DataRetentionApi>({
        getPlatformDefaultRetentionDays: () => 30,
      }),
    },
    repositories: { ...MemoryAnalyticsRepositories.create(), analytics: repository },
    config: {
      langwatchQl: {
        url: void 0,
        username: void 0,
        database: void 0,
        tenantSetting: void 0,
        postgresHost: void 0,
        accessModelMode: void 0,
        sqlSingleNode: void 0,
      },
      publicBaseUrl: "https://app.langwatch.test",
    },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: {} as never,
  });

  return { app, repository, flagReads };
}

const timeseriesInput: AnalyticsTimeseriesInput = {
  projectId: PROJECT_ID,
  startDate: Date.UTC(2026, 0, 1),
  endDate: Date.UTC(2026, 0, 2),
  filters: {},
  series: [{ metric: "performance.total_cost", aggregation: "sum" }],
  timeZone: "Europe/Amsterdam",
};

describe("AnalyticsModule.getTimeseries read tripwire", () => {
  describe("given the tripwire flag is on for the project", () => {
    /** @scenario "A project with the read tripwire on is also read from the legacy table" */
    it("reads the legacy table beside the routed one and returns the routed result", async () => {
      const { app, repository, flagReads } = await harness(true);

      const result = await app.getTimeseries(timeseriesInput);

      expect(repository.tablesRead.toSorted()).toEqual([
        "trace_analytics_rollup",
        "trace_summaries",
      ]);
      expect(result).toEqual(routedResult);
      expect(flagReads).toEqual([
        { key: TRIPWIRE_FLAG, target: { kind: "project", projectId: PROJECT_ID } },
      ]);
    });
  });

  describe("given the tripwire flag is off for the project", () => {
    /** @scenario "A project with the read tripwire off is read only from the routed table" */
    it("reads only the routed table", async () => {
      const { app, repository } = await harness(false);

      const result = await app.getTimeseries(timeseriesInput);

      expect(repository.tablesRead).toEqual(["trace_analytics_rollup"]);
      expect(result).toEqual(routedResult);
    });
  });
});
