/**
 * `AnalyticsModule.executeLangWatchQL` on an aggregate: the route's proof sends the statement to
 * the members, and the query is counted once, against the aggregate.
 * @see specs/lwql/aggregate-reads.feature
 * @vitest-environment node
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { InstantEvalApi } from "@langwatch/instant-eval-contract";
import { resolveRequestBound } from "@langwatch/plans";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { analyticsProof } from "../../repositories/__tests__/analytics-proof.fixture.ts";
import { MemoryAnalyticsRepositories } from "../../repositories/memory/memory.analytics.repositories.ts";
import { EVERY_CATALOGUE_PERMISSION } from "../../services/__tests__/lwql-catalogue-access.fixture.ts";
import { project } from "../../services/__tests__/project.fixture.ts";
import { AnalyticsModule } from "../analytics.app.ts";

const AGGREGATE = "project_aggregate";
const MEMBERS = ["project_a", "project_b"];

/**
 * The app as production composes it, minus the substrate: no identity is provisioned, so a run
 * that passes every gate answers `lwql_unavailable` from the executor door.
 */
async function harness({ keyless = [] }: { keyless?: readonly string[] } = {}) {
  const app = await AnalyticsModule.create({
    dependencies: {
      featureFlags: createApiFixture<FeatureFlagApi>(),
      authz: createApiFixture<AuthzApi>(),
      dataPrivacy: createApiFixture<DataPrivacyApi>(),
      projects: createApiFixture<ProjectApi>({
        getOrganizationId: async () => "org-free",
        findById: async (id) => (keyless.includes(id) ? null : project(id)),
      }),
      plans: createApiFixture<EntitlementApi>({
        requestBound: ({ key }) => Promise.resolve(resolveRequestBound(key, "FREE")),
      }),
      traces: createApiFixture<TraceApi>(),
      retention: createApiFixture<DataRetentionApi>(),
    },
    channels: { judge: createApiFixture<InstantEvalApi>() },
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
      tenantAnalyticsConcurrency: 4,
      publicBaseUrl: "https://app.langwatch.test",
    },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: {} as never,
  });

  const outcome = (run: Promise<unknown>) =>
    run.then(
      () => "executed",
      (error: unknown) =>
        error instanceof Error && "code" in error ? String(error.code) : "unknown",
    );
  const onAggregate = () =>
    outcome(
      app.executeLangWatchQL({
        project: { id: AGGREGATE, lwqlKey: "lwql-aggregate" },
        protections: { catalogue: EVERY_CATALOGUE_PERMISSION },
        sql: "SELECT 1",
        authorization: analyticsProof({
          projectId: AGGREGATE,
          shared: MEMBERS.map((projectId) => ({ projectId, from: 0 })),
        }),
      }),
    );
  const onMember = (projectId: string) =>
    outcome(
      app.executeLangWatchQL({
        project: { id: projectId, lwqlKey: `lwql-${projectId}` },
        protections: { catalogue: EVERY_CATALOGUE_PERMISSION },
        sql: "SELECT 1",
        authorization: analyticsProof({ projectId }),
      }),
    );

  return { onAggregate, onMember };
}

const FREE_QUERIES_PER_MINUTE = resolveRequestBound("lwqlPerMinute", "FREE");

describe("AnalyticsModule.executeLangWatchQL on an aggregate", () => {
  describe("given the aggregate at its query ceiling", () => {
    /** @scenario "Limits are charged to the aggregate once" */
    it("refuses the aggregate's next run while its members still run", async () => {
      const { onAggregate, onMember } = await harness();
      for (let index = 0; index < FREE_QUERIES_PER_MINUTE; index++) {
        expect(await onAggregate()).toBe("lwql_unavailable");
      }

      expect(await onAggregate()).toBe("lwql_rate_limited");
      expect(await onMember("project_a")).toBe("lwql_unavailable");
      expect(await onMember("project_b")).toBe("lwql_unavailable");
    });
  });

  describe("given a member whose project cannot be read", () => {
    it("refuses through the door before anything runs", async () => {
      const { onAggregate } = await harness({ keyless: ["project_b"] });

      expect(await onAggregate()).toBe("lwql_member_key_missing");
    });
  });
});
