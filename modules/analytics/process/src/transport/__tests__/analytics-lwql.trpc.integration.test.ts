import { createTrpcRuntime, TrpcRootDefinition } from "@langwatch/api/trpc";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ProjectApi } from "@langwatch/project-contract";
/**
 * @vitest-environment node
 * `analytics.lwql.*` on the real runtime over the real analytics application:
 * the rollout switch, the provisioning answer and the permission that is
 * checked before either. Only the flag store and the substrate are the test's.
 * @see specs/lwql/workbench.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { AnalyticsModule } from "../../app/analytics.app.ts";
import { MemoryAnalyticsRepositories } from "../../repositories/memory/memory.analytics.repositories.ts";
import { analyticsLwqlTrpcTransport } from "../analytics-lwql.trpc.ts";

type Setup = Parameters<typeof AnalyticsModule.create>[0];
type TestContext = { actor: { id: string } };

const PROJECT = { projectId: "project-1" };

function membersHolding(held: readonly string[]) {
  return trpcTestMembers<TestContext>({ permits: (permission) => held.includes(permission) });
}

/** The app as production composes it, with no LangWatchQL identity provisioned. */
async function callerFor({ switchOn, held }: { switchOn: boolean; held: readonly string[] }) {
  const app = await AnalyticsModule.create({
    dependencies: {
      featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled: async () => switchOn }),
      authz: createApiFixture<AuthzApi>(),
      dataPrivacy: createApiFixture<DataPrivacyApi>(),
      projects: createApiFixture<ProjectApi>({ getOrganizationId: async () => "org-1" }),
      plans: createApiFixture<EntitlementApi>(),
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
    secrets: createApiFixture<Setup["secrets"]>(),
  });
  const trpc = TrpcRootDefinition.forContext<TestContext>().create();

  return createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: membersHolding(held),
  })
    .mount(analyticsLwqlTrpcTransport, () => app)
    .createCaller({ actor: { id: "member-1" } });
}

describe("given the analytics.lwql tRPC namespace", () => {
  describe("when the feature switch is off for the project", () => {
    /** @scenario "Every chart surface stays dark until the experimental feature switch is on" */
    it("answers unavailable naming the switch, and refuses schema and query as not enabled", async () => {
      const caller = await callerFor({ switchOn: false, held: ["analytics:view"] });

      await expect(caller.availability(PROJECT)).resolves.toEqual({
        available: false,
        reason: "disabled",
      });
      await expect(caller.schema(PROJECT)).rejects.toMatchObject({
        cause: { code: "lwql_not_enabled" },
      });
      await expect(caller.query({ ...PROJECT, sql: "SELECT 1" })).rejects.toMatchObject({
        cause: { code: "lwql_not_enabled" },
      });
    });
  });

  describe("when the switch is on but the deployment has no LangWatchQL identity", () => {
    /** @scenario "The chart surfaces are unreachable while LangWatchQL is not provisioned" */
    it("answers unavailable naming provisioning rather than the switch", async () => {
      const caller = await callerFor({ switchOn: true, held: ["analytics:view"] });

      await expect(caller.availability(PROJECT)).resolves.toEqual({
        available: false,
        reason: "unprovisioned",
      });
    });
  });

  describe("when the member lacks the analytics view permission", () => {
    it("refuses before the switch is consulted, so the switch is not revealed", async () => {
      const caller = await callerFor({ switchOn: false, held: [] });

      await expect(caller.availability(PROJECT)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.query({ ...PROJECT, sql: "SELECT 1" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });
});
