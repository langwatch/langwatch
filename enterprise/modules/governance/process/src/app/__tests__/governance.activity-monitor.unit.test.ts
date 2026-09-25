// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The activity monitor's reads over the memory twin: main's Enterprise gate is a
 * per-organization refusal here, and an Enterprise organization reads its dashboard.
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { ScimApi } from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { ResourceScope } from "@langwatch/kernel";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { MemoryActivityMonitorRepository } from "../../repositories/memory/memory.activity-monitor.repository.ts";
import { MemoryGovernanceRepositories } from "../../repositories/memory/memory.governance.repositories.ts";
import { GovernanceApp } from "../governance.app.ts";
import type { GovernanceEncryptor } from "../governance.members.ts";

const ADMIN = { id: "user-1" };

function planOfType(type: string): Plan {
  return {
    planSource: "subscription",
    type,
    name: type,
    free: type === "FREE",
    maxMembers: 10,
    maxMembersLite: 10,
    maxMessagesPerMonth: 1000,
    canPublish: true,
    prices: { USD: 0, EUR: 0 },
  };
}

async function buildApp(planType: string) {
  const plansAsked: unknown[] = [];
  const activity = MemoryActivityMonitorRepository.create();
  const app = await GovernanceApp.create({
    config: void 0,
    repositories: { ...MemoryGovernanceRepositories.create(), activityMonitor: activity },
    dependencies: {
      projects: createApiFixture<ProjectApi>(),
      auth: createApiFixture<AuthApi>(),
      entitlements: createApiFixture<EntitlementApi>({
        getActivePlan: async (input) => {
          plansAsked.push(input);
          return planOfType(planType);
        },
      }),
      organizations: createApiFixture<OrganizationApi>(),
      permissions: createApiFixture<AuthzApi>(),
      scim: createApiFixture<ScimApi>(),
      featureFlags: createApiFixture<FeatureFlagApi>(),
      traces: createApiFixture<TraceApi>(),
      apiKeys: createApiFixture<ApiKeyApi>(),
      gateway: createApiFixture<GatewayApi>(),
      modelProviders: createApiFixture<ModelProviderApi>(),
      users: createApiFixture<UserApi>(),
      auditLog: createApiFixture<AuditLogApi>(),
    },
    members: {
      encryption: createApiFixture<GovernanceEncryptor>(),
      isSaas: false,
    },
    resources: new ResourceScope(),
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
  });
  return { app, plansAsked, activity };
}

const user = (actor: string) => ({
  actor,
  spendUsd: "1.00",
  requests: 1,
  lastActivityIso: "2026-09-01T00:00:00.000Z",
  trendVsPreviousPct: 0,
  hasPriorBaseline: false,
  mostUsedTarget: null,
});

describe("the activity monitor", () => {
  describe("given an organization on the Enterprise plan", () => {
    it("pages its spend by user, resolving the plan as the signed-in person", async () => {
      const { app, plansAsked, activity } = await buildApp("ENTERPRISE");
      activity.record("org-1", { spendByUser: [user("a"), user("b"), user("c")] });

      const rows = await app.activitySpendByUser(
        { organizationId: "org-1", windowDays: 30, limit: 1, offset: 1 },
        ADMIN,
      );

      expect(rows.map((row) => row.actor)).toEqual(["b"]);
      expect(plansAsked).toEqual([{ organizationId: "org-1", operator: { id: "user-1" } }]);
    });

    it("reads an organization with no activity as the empty dashboard", async () => {
      const { app } = await buildApp("ENTERPRISE");

      await expect(
        app.activitySummary({ organizationId: "org-1", windowDays: 30 }, ADMIN),
      ).resolves.toMatchObject({ spentThisWindowUsd: 0, openAnomalyCount: 0 });
      await expect(
        app.activitySourceHealthMetrics({ organizationId: "org-1", sourceId: "src-1" }, ADMIN),
      ).resolves.toEqual({ events24h: 0, events7d: 0, events30d: 0, lastSuccessIso: null });
    });
  });

  describe("given an organization not on the Enterprise plan", () => {
    it("refuses every read by the plan code", async () => {
      const { app } = await buildApp("FREE");
      const scope = { organizationId: "org-1" };

      await expect(app.activitySummary({ ...scope, windowDays: 30 }, ADMIN)).rejects.toMatchObject({
        code: "enterprise_plan_required",
      });
      await expect(app.activityIngestionSourcesHealth(scope, ADMIN)).rejects.toMatchObject({
        code: "enterprise_plan_required",
      });
      await expect(
        app.activityEventsForSource({ ...scope, sourceId: "src-1", limit: 50 }, ADMIN),
      ).rejects.toMatchObject({ code: "enterprise_plan_required" });
    });
  });
});
