import type { AuthzApi } from "@langwatch/authz-contract";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { ReaderReadStatement } from "@langwatch/clickhouse-client/builder";
import type { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { InstantEvalApi } from "@langwatch/instant-eval-contract";
import type { ProjectApi } from "@langwatch/project-contract";
/**
 * @vitest-environment node
 * A filter picker's other selections narrow its options through analytics' own grammar.
 * Spec: modules/analytics/specs/filter-options-narrowing.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { analyticsProof } from "../../repositories/__tests__/analytics-proof.fixture.ts";
import { FilterOptionsClickHouseRepository } from "../../repositories/clickhouse/clickhouse.filter-options.repository.ts";
import { MemoryAnalyticsRepositories } from "../../repositories/memory/memory.analytics.repositories.ts";
import { AnalyticsModule } from "../analytics.app.ts";
import { analyticsTestSecrets } from "./analytics-secrets.fixture.ts";

async function appOver() {
  const statements: ReaderReadStatement[] = [];
  const clickhouse = createApiFixture<ClickHouseQueryClient>({
    read: async ({ statement }) => {
      statements.push(statement as ReaderReadStatement);
      return { rows: [] };
    },
  });
  const app = await AnalyticsModule.create({
    dependencies: {
      featureFlags: createApiFixture<FeatureFlagApi>(),
      authz: createApiFixture<AuthzApi>(),
      dataPrivacy: createApiFixture<DataPrivacyApi>(),
      projects: createApiFixture<ProjectApi>(),
      plans: createApiFixture<EntitlementApi>(),
      traces: createApiFixture<TraceApi>(),
      retention: createApiFixture<DataRetentionApi>(),
    },
    channels: { judge: createApiFixture<InstantEvalApi>() },
    repositories: {
      ...MemoryAnalyticsRepositories.create(),
      filterOptions: FilterOptionsClickHouseRepository.create({ clickhouse }),
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
        clickhouseCluster: void 0,
        aggregateMaxMembers: void 0,
      },
      tenantAnalyticsConcurrency: 4,
      publicBaseUrl: "https://app.langwatch.test",
    },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: analyticsTestSecrets(),
  });
  return { app, statements };
}

describe("AnalyticsModule.filterOptions", () => {
  describe("given a picker for one field with other filters selected", () => {
    /** @scenario "A filter picker is narrowed by the other filters, never its own" */
    it("narrows the read by the other filters through analytics' own grammar", async () => {
      const { app, statements } = await appOver();

      await app.filterOptions(
        {
          projectId: "project-1",
          field: "metadata.user_id",
          startDate: 1,
          endDate: 2,
          filters: { "metadata.user_id": ["u-1"], "traces.name": ["checkout"] },
        },
        { authorization: analyticsProof({ projectId: "project-1" }) },
      );

      const [statement] = statements;
      expect(statement?.identity).toBe("reader");
      expect(statement?.settings).toMatchObject({ SQL_langwatch_tenant_ids: "project-1" });
      expect(statement?.sql).toContain("TraceName");
      expect(JSON.stringify(statement?.params)).toContain("checkout");
    });

    /** @scenario "A filter picker is narrowed by the other filters, never its own" */
    it("leaves out the field's own selection", async () => {
      const { app, statements } = await appOver();

      await app.filterOptions(
        {
          projectId: "project-1",
          field: "metadata.user_id",
          startDate: 1,
          endDate: 2,
          filters: { "metadata.user_id": ["u-1"] },
        },
        { authorization: analyticsProof({ projectId: "project-1" }) },
      );

      expect(JSON.stringify(statements.at(0)?.params)).not.toContain("u-1");
    });
  });
});
