/**
 * `AnalyticsModule.executeLangWatchQL` — every execution is counted against the
 * project's tier-effective window before it runs; an over-limit caller never
 * reaches the executor.
 * @vitest-environment node
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { resolveRequestBound } from "@langwatch/plans";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { MemoryAnalyticsRepositories } from "../../repositories/memory/memory.analytics.repositories.ts";
import { EVERY_CATALOGUE_PERMISSION } from "../../services/__tests__/lwql-catalogue-access.fixture.ts";
import { AnalyticsModule } from "../analytics.app.ts";

const TIER_PLAN_TYPE: Record<string, string> = {
  "org-free": "FREE",
  "org-enterprise": "ENTERPRISE",
};

/**
 * The app as production composes it, minus the substrate: no identity is
 * provisioned, so an ADMITTED execution answers `lwql_unavailable` from the
 * executor door — how a window refusal is told apart from one past it.
 */
async function harness() {
  const app = await AnalyticsModule.create({
    dependencies: {
      featureFlags: createApiFixture<FeatureFlagApi>(),
      authz: createApiFixture<AuthzApi>(),
      dataPrivacy: createApiFixture<DataPrivacyApi>(),
      projects: createApiFixture<ProjectApi>({
        getOrganizationId: async (projectId) =>
          projectId === "project-enterprise" ? "org-enterprise" : "org-free",
      }),
      plans: createApiFixture<EntitlementApi>({
        requestBound: ({ key, organizationId }) =>
          Promise.resolve(resolveRequestBound(key, TIER_PLAN_TYPE[organizationId] ?? "FREE")),
      }),
      traces: createApiFixture<TraceApi>(),
      retention: createApiFixture<DataRetentionApi>(),
    },
    repositories: MemoryAnalyticsRepositories.create(),
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

  const execute = (projectId: string) =>
    app
      .executeLangWatchQL({
        project: { id: projectId, lwqlKey: "lwql-key" },
        protections: { catalogue: EVERY_CATALOGUE_PERMISSION },
        sql: "SELECT 1",
      })
      .then(
        () => "executed",
        (error: unknown) =>
          error instanceof Error && "code" in error ? String(error.code) : "unknown",
      );

  return { execute };
}

const FREE_QUERIES_PER_MINUTE = resolveRequestBound("lwqlPerMinute", "FREE");

describe("AnalyticsModule.executeLangWatchQL", () => {
  describe("given a free-tier project under its query ceiling", () => {
    it("reaches the executor for every query", async () => {
      const { execute } = await harness();

      for (let index = 0; index < FREE_QUERIES_PER_MINUTE; index++) {
        expect(await execute("project-free")).toBe("lwql_unavailable");
      }
    });
  });

  describe("given a free-tier project at its query ceiling", () => {
    it("refuses the next query 429 and never reaches the executor", async () => {
      const { execute } = await harness();
      for (let index = 0; index < FREE_QUERIES_PER_MINUTE; index++) {
        await execute("project-free");
      }

      expect(await execute("project-free")).toBe("lwql_rate_limited");
    });
  });

  describe("given an enterprise project past the free query ceiling", () => {
    it("still reaches the executor: the ceiling is tier-resolved, not static", async () => {
      const { execute } = await harness();
      for (let index = 0; index < FREE_QUERIES_PER_MINUTE; index++) {
        await execute("project-enterprise");
      }

      expect(await execute("project-enterprise")).toBe("lwql_unavailable");
    });
  });
});
