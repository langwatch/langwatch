import type { AuthzApi } from "@langwatch/authz-contract";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { RateLimiter } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";
/**
 * @vitest-environment node
 * A filter picker's other selections narrow its options through Trace's grammar.
 * Spec: modules/trace/specs/trace-legacy-filtered-search.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import type { LwqlProvisioningDatabase } from "../../tasks/lwql-provision.task.ts";
import { AnalyticsModule } from "../analytics.app.ts";

type Setup = Parameters<typeof AnalyticsModule.create>[0];

async function appOver() {
  const translateLegacyFilters = vi.fn<TraceApi["translateLegacyFilters"]>(() => ({
    conditions: ["ts.ContainsErrorStatus = true"],
    params: { f0_values: ["otlp2"] },
    hasUnsupportedFilters: false,
  }));
  const statements: { sql: string; params: Record<string, unknown> | undefined }[] = [];
  const clickhouse = createApiFixture<ClickHouseQueryClient>({
    query: async (request) => {
      statements.push({ sql: request.sql, params: request.params });
      return { rows: [] };
    },
  });
  const app = await AnalyticsModule.create({
    dependencies: {
      featureFlags: createApiFixture<FeatureFlagApi>(),
      authz: createApiFixture<AuthzApi>(),
      dataPrivacy: createApiFixture<DataPrivacyApi>(),
      projects: createApiFixture<ProjectApi>(),
      organizations: createApiFixture<OrganizationApi>(),
      plans: createApiFixture<EntitlementApi>(),
      traces: createApiFixture<TraceApi>({ translateLegacyFilters }),
      retention: createApiFixture<DataRetentionApi>(),
    },
    members: {
      clickhouse,
      rateLimiter: { check: () => Promise.resolve({ allowed: true }) } satisfies RateLimiter,
      publicBaseUrl: "https://app.langwatch.test",
      clickhouseAdmin: { configured: false },
      databaseTarget: { configured: false },
      prisma: createApiFixture<LwqlProvisioningDatabase>({}, "prisma"),
    },
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
    },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: createApiFixture<Setup["secrets"]>(),
  });
  return { app, translateLegacyFilters, statements };
}

describe("AnalyticsModule.filterOptions", () => {
  describe("given a picker for one field with other filters selected", () => {
    /** @scenario "Analytics' filter picker is scoped through Trace's translation" */
    it("asks Trace to translate the other filters, leaving out the field being picked", async () => {
      const { app, translateLegacyFilters } = await appOver();

      await app.filterOptions({
        projectId: "project-1",
        field: "metadata.user_id",
        startDate: 1,
        endDate: 2,
        filters: { "metadata.user_id": ["u-1"], "traces.error": ["true"] },
      });

      expect(translateLegacyFilters).toHaveBeenCalledWith({
        filters: { "traces.error": ["true"] },
      });
    });

    /** @scenario "Analytics' filter picker is scoped through Trace's translation" */
    it("scopes the options query by Trace's conditions and their bound parameters", async () => {
      const { app, statements } = await appOver();

      await app.filterOptions({
        projectId: "project-1",
        field: "metadata.user_id",
        startDate: 1,
        endDate: 2,
        filters: { "traces.error": ["true"] },
      });

      expect(statements.at(0)?.sql).toContain("ts.ContainsErrorStatus = true");
      expect(statements.at(0)?.params).toMatchObject({ scope_f0_values: ["otlp2"] });
    });
  });
});
