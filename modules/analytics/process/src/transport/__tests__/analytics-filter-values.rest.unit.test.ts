/**
 * Both timeseries REST doors refuse a filter value the query cannot apply, before the cache
 * and before any table is read, over the real analytics application.
 * @see specs/analytics/filter-value-validation.feature
 * @vitest-environment node
 */
import type {
  AnalyticsFeedbacksResult,
  AnalyticsTable,
  AnalyticsTimeseriesInput,
  AnalyticsTimeseriesResult,
  AnalyticsTopDocumentsResult,
} from "@langwatch/analytics-contract";
import { canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import type { Actor } from "@langwatch/authorization";
import type { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { InstantEvalApi } from "@langwatch/instant-eval-contract";
import type { Project, ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { analyticsTestSecrets } from "../../app/__tests__/analytics-secrets.fixture.ts";
import { AnalyticsModule } from "../../app/analytics.app.ts";
import { analyticsTestAuthz } from "../../repositories/__tests__/analytics-proof.fixture.ts";
import {
  AnalyticsRepository,
  type AnalyticsTimeseriesQuery,
} from "../../repositories/analytics.repository.ts";
import { MemoryAnalyticsRepositories } from "../../repositories/memory/memory.analytics.repositories.ts";
import { analyticsLegacyRest } from "../analytics-legacy.rest.ts";
import { analyticsRest } from "../analytics.rest.ts";

const PROJECT_ID = "project-filter-values";
const API_KEY: Actor = { type: "api_key", id: "key-of-project" };
const SERIES = [{ metric: "metadata.trace_id", aggregation: "cardinality" }] as const;

const answered: AnalyticsTimeseriesResult = {
  previousPeriod: [],
  currentPeriod: [{ date: "2026-01-01", "0/metadata.trace_id/cardinality": 2 }],
};

/** Answers every read with one series, remembering the tables it was asked to read. */
class RecordingRepository extends AnalyticsRepository {
  readonly tablesRead: AnalyticsTable[] = [];

  tableFor(_input: AnalyticsTimeseriesInput): AnalyticsTable {
    return "trace_summaries";
  }

  runTimeseries(query: AnalyticsTimeseriesQuery): Promise<AnalyticsTimeseriesResult> {
    this.tablesRead.push(query.table);
    return Promise.resolve(answered);
  }

  findFeedbackEvents(): Promise<AnalyticsFeedbacksResult> {
    return Promise.resolve({ events: [] });
  }

  async findFeedbackEventsPage() {
    return { rows: [], hasMore: false };
  }

  findTopDocuments(): Promise<AnalyticsTopDocumentsResult> {
    return Promise.resolve({ topDocuments: [], totalUniqueDocuments: 0 });
  }
}

async function doors() {
  const repository = new RecordingRepository();
  const app = await AnalyticsModule.create({
    dependencies: {
      featureFlags: createApiFixture<FeatureFlagApi>({
        isEnabled: () => Promise.resolve(false),
      }),
      authz: analyticsTestAuthz(),
      dataPrivacy: createApiFixture<DataPrivacyApi>(),
      projects: createApiFixture<ProjectApi>({
        findById: (id) => Promise.resolve({ id, kind: "application" } as Project),
      }),
      plans: createApiFixture<EntitlementApi>(),
      traces: createApiFixture<TraceApi>(),
      retention: createApiFixture<DataRetentionApi>({
        getPlatformDefaultRetentionDays: () => 30,
      }),
    },
    channels: { judge: createApiFixture<InstantEvalApi>() },
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
        clickhouseCluster: void 0,
        aggregateMaxMembers: void 0,
        installMethod: void 0,
      },
      tenantAnalyticsConcurrency: 4,
      publicBaseUrl: "https://app.langwatch.test",
    },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: analyticsTestSecrets(),
  });

  const caller = { actor: API_KEY, scope: { tier: "project" as const, id: PROJECT_ID } };
  const admit = () => caller;
  const runtime = createRestRuntime({
    audit: { record: () => {} },
    authorization: restTestAuthorization(),
    identity: { authenticate: admit, identify: admit },
  });
  const canonical = runtime.mount(analyticsRest.router(), {
    app: () => app,
    onError: canonicalErrorResponse,
  });
  const legacy = runtime.mount(analyticsLegacyRest.router(), {
    app: () => app,
    onError: canonicalErrorResponse,
  });

  const post = async (door: "canonical" | "legacy", path: string, body: unknown) => {
    const response = await (door === "canonical" ? canonical : legacy).fetch(
      new Request(`http://api.test${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    const text = await response.text();
    return { status: response.status, json: text === "" ? undefined : JSON.parse(text) };
  };

  return { repository, post };
}

const body = (overrides: Record<string, unknown>) => ({
  startDate: Date.UTC(2026, 0, 1),
  endDate: Date.UTC(2026, 0, 2),
  timeZone: "UTC",
  filters: {},
  series: SERIES,
  ...overrides,
});

const LABEL_FILTER = { "traces.error": ["Traces with error"] };

describe("given a project API key that may read analytics", () => {
  describe("when a timeseries is requested with an error filter carrying an option label", () => {
    /** @scenario "The REST endpoint refuses a label before reading any table" */
    it("answers 422 naming the filter and reads no table", async () => {
      const { repository, post } = await doors();

      const answer = await post(
        "canonical",
        "/api/analytics/timeseries",
        body({ filters: LABEL_FILTER }),
      );

      expect(answer.status).toBe(422);
      expect(answer.json).toMatchObject({
        code: "analytics_filter_value_unsupported",
        meta: { field: "filters.traces.error", received: "Traces with error" },
      });
      expect(repository.tablesRead).toEqual([]);
    });
  });

  describe("when a series carries its own error filter with an option label", () => {
    /** @scenario "A series filter carrying a label is refused the same way" */
    it("answers 422 naming the filter", async () => {
      const { repository, post } = await doors();

      const answer = await post(
        "canonical",
        "/api/analytics/timeseries",
        body({ series: [{ ...SERIES[0], filters: LABEL_FILTER }] }),
      );

      expect(answer.status).toBe(422);
      expect(answer.json).toMatchObject({ code: "analytics_filter_value_unsupported" });
      expect(repository.tablesRead).toEqual([]);
    });
  });

  describe("when the legacy path is asked with an error filter carrying an option label", () => {
    /** @scenario "The legacy REST analytics path refuses the same value" */
    it("answers 422 with the same code", async () => {
      const { repository, post } = await doors();

      const answer = await post("legacy", "/api/analytics", body({ filters: LABEL_FILTER }));

      expect(answer.status).toBe(422);
      expect(answer.json).toMatchObject({ code: "analytics_filter_value_unsupported" });
      expect(repository.tablesRead).toEqual([]);
    });
  });

  describe("when the metadata value filter is sent as a plain list", () => {
    it("answers 422 asking for the key", async () => {
      const { post } = await doors();

      const answer = await post(
        "canonical",
        "/api/analytics/timeseries",
        body({ filters: { "metadata.value": ["production"] } }),
      );

      expect(answer.status).toBe(422);
      expect(answer.json).toMatchObject({ code: "analytics_filter_key_required" });
    });
  });

  describe("when the error filter carries the option's value", () => {
    /** @scenario "The values the filter options return are still served" */
    it("answers the series", async () => {
      const { repository, post } = await doors();

      const answer = await post(
        "canonical",
        "/api/analytics/timeseries",
        body({ filters: { "traces.error": ["true"] } }),
      );

      expect(answer.status).toBe(200);
      expect(answer.json).toEqual(answered);
      expect(repository.tablesRead).toEqual(["trace_summaries"]);
    });
  });
});
