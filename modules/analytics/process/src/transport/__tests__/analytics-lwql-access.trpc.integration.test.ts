/**
 * @vitest-environment node
 * `analytics.lwql.query` on the real runtime over the real analytics application, for a member
 * whose role withholds cost: the grants are the built-in role's own, the protections and the
 * validator are production's. Only the peers and the substrate are the test's.
 * @see modules/analytics/specs/dashboard-widget-frame-states.feature
 */
import { findLangWatchQLMissingGates } from "@langwatch/analytics-contract";
import { createTrpcRuntime, TrpcRootDefinition } from "@langwatch/api/trpc";
import { builtinRoleGrants, type BuiltinRoleKey } from "@langwatch/authz-contract";
import {
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type DataPrivacyApi,
} from "@langwatch/data-privacy-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { InstantEvalApi } from "@langwatch/instant-eval-contract";
import { resolveRequestBound } from "@langwatch/plans";
import type { Project, ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { AnalyticsModule } from "../../app/analytics.app.ts";
import { MemoryAnalyticsRepositories } from "../../repositories/memory/memory.analytics.repositories.ts";
import { authzGranting } from "../../services/__tests__/lwql-catalogue-access.fixture.ts";
import { analyticsLwqlTrpcTransport } from "../analytics-lwql.trpc.ts";

type Setup = Parameters<typeof AnalyticsModule.create>[0];
type TestContext = { actor: { id: string } };

const PROJECT_ID = "project-1";

const PROJECT: Project = {
  id: PROJECT_ID,
  name: "Checkout Agent",
  slug: "checkout-agent",
  apiKey: "legacy-key",
  lwqlKey: "lwql-key",
  teamId: "team-1",
  language: "en",
  framework: "other",
  kind: "application",
  firstMessage: true,
  integrated: true,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  userLinkTemplate: null,
  traceSharingEnabled: false,
  presenceEnabled: false,
  s3Endpoint: null,
  s3AccessKeyId: null,
  s3SecretAccessKey: null,
  s3Bucket: null,
  archivedAt: null,
  isPersonal: false,
  ownerUserId: null,
  personalFeatures: {},
  departmentId: null,
  langyEgressAllowlist: null,
  lastCodingAgentSessionAt: null,
  lastCodingAgentPullRequestAt: null,
};

/** The query door for a member holding exactly what the built-in `role` grants. */
async function callerWithRole(role: BuiltinRoleKey) {
  const holds = (permission: string) => builtinRoleGrants({ role, permission });
  const app = await AnalyticsModule.create({
    dependencies: {
      featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled: async () => true }),
      authz: authzGranting({ grants: ({ permission }) => holds(permission) }).authz,
      dataPrivacy: createApiFixture<DataPrivacyApi>({
        getResolvedForProject: async () => PLATFORM_DEFAULT_DATA_PRIVACY,
      }),
      projects: createApiFixture<ProjectApi>({
        getOrganizationId: async () => "org-1",
        findById: async () => PROJECT,
      }),
      plans: createApiFixture<EntitlementApi>({
        requestBound: async ({ key }) => resolveRequestBound(key, "ENTERPRISE"),
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
    secrets: createApiFixture<Setup["secrets"]>(),
  });
  const trpc = TrpcRootDefinition.forContext<TestContext>().create();

  return createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<TestContext>({ permits: holds }),
  })
    .mount(analyticsLwqlTrpcTransport, () => app)
    .createCaller({ actor: { id: "member-1" } });
}

const COST_SQL = "SELECT sum(TotalCost) AS cost FROM analytics.traces";
const NO_COST_SQL = "SELECT count() AS traces FROM analytics.traces";

/** What the door answered a statement with: the handled error's code and meta. */
async function refusalOf({ role, sql }: { role: BuiltinRoleKey; sql: string }) {
  const caller = await callerWithRole(role);
  const error: unknown = await caller.query({ projectId: PROJECT_ID, sql }).then(
    () => undefined,
    (caught: unknown) => caught,
  );
  const cause = (error as { cause?: { code?: string; meta?: { violations?: unknown } } }).cause;
  return { trpcCode: (error as { code?: string }).code, code: cause?.code, meta: cause?.meta };
}

describe("given analytics.lwql.query and a member whose role withholds cost", () => {
  describe.each(["viewer", "lite-member"] as const)("when a %s sums TotalCost", (role) => {
    /** @scenario "A member without cost access is refused a cost query as a matter of access" */
    it("answers lwql_not_permitted, classified as an access refusal naming cost:view", async () => {
      const refusal = await refusalOf({ role, sql: COST_SQL });

      expect(refusal.trpcCode).not.toBe("INTERNAL_SERVER_ERROR");
      expect(refusal.code).toBe("lwql_not_permitted");
      expect(findLangWatchQLMissingGates(refusal.meta?.violations)).toEqual(["cost:view"]);
    });

    /** @scenario "A member without cost access is refused a cost query as a matter of access" */
    it("is not refused by the policy for a statement that reads no cost", async () => {
      const refusal = await refusalOf({ role, sql: NO_COST_SQL });

      // Past the policy, this deployment has no LangWatchQL identity to run the statement as.
      expect(refusal.code).toBe("lwql_unavailable");
    });
  });

  describe("when a member, who holds cost:view, sums TotalCost", () => {
    it("is not refused by the policy, so the refusal follows the reader and not the query", async () => {
      const refusal = await refusalOf({ role: "member", sql: COST_SQL });

      expect(refusal.code).toBe("lwql_unavailable");
    });
  });
});
