import type { AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { ScimApi } from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { GatewayApi, GatewayBudgetOverviewForUser } from "@langwatch/gateway-contract";
import { ResourceScope } from "@langwatch/kernel";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import {
  type OrganizationApi,
  type PersonalWorkspace,
  TeamNotFoundError,
} from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import type { GovernanceEncryptor } from "../../app/governance.members.ts";
import { MemoryGovernanceRepositories } from "../../repositories/memory/memory.governance.repositories.ts";
import { MemoryPersonalUsageRepository } from "../../repositories/memory/memory.personal-usage.repository.ts";
import { GovernanceApp } from "../governance.app.ts";

const ORGANIZATION_ID = "org-1";
const CALLER = { id: "user-1" };
const NOW = Date.now();

const workspace: PersonalWorkspace = {
  team: { id: "team-personal-1", name: "Ariana", slug: "ariana", createdAtMs: NOW },
  project: {
    id: "project-personal-1",
    name: "Ariana",
    slug: "ariana",
    apiKey: "k",
    createdAtMs: NOW,
  },
};

const noGatewayAccess: GatewayBudgetOverviewForUser = {
  gatewayAccess: false,
  reason: "flag_off",
  budgets: [],
};

async function buildApp(options: { workspace: PersonalWorkspace | null }) {
  const personalUsage = MemoryPersonalUsageRepository.create();
  const budgetOverviewForUser = vi.fn(async () => noGatewayAccess);
  const app = await GovernanceApp.create({
    config: void 0,
    repositories: { ...MemoryGovernanceRepositories.create(), personalUsage },
    dependencies: {
      agents: createApiFixture<AgentApi>(),
      projects: createApiFixture<ProjectApi>({ findInternal: async () => null }),
      auth: createApiFixture<AuthApi>(),
      entitlements: createApiFixture<EntitlementApi>(),
      organizations: createApiFixture<OrganizationApi>({
        getPersonalWorkspace: async () => {
          if (!options.workspace) throw new TeamNotFoundError();
          return options.workspace;
        },
      }),
      permissions: createApiFixture<AuthzApi>(),
      scim: createApiFixture<ScimApi>(),
      featureFlags: createApiFixture<FeatureFlagApi>(),
      traces: createApiFixture<TraceApi>(),
      apiKeys: createApiFixture<ApiKeyApi>(),
      gateway: createApiFixture<GatewayApi>({ budgetOverviewForUser }),
      modelProviders: createApiFixture<ModelProviderApi>(),
      users: createApiFixture<UserApi>(),
      auditLog: createApiFixture<AuditLogApi>(),
    },
    members: { encryption: createApiFixture<GovernanceEncryptor>(), isSaas: false },
    resources: new ResourceScope(),
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
  });

  return { app, personalUsage, budgetOverviewForUser };
}

describe("GovernanceApp personal surface", () => {
  describe("given a member with no personal workspace yet", () => {
    it("answers the usage dashboard with zeros", async () => {
      const { app } = await buildApp({ workspace: null });

      const rollup = await app.personalUsageDashboard({ organizationId: ORGANIZATION_ID }, CALLER);

      expect(rollup.summary.requests).toBe(0);
      expect(rollup.dailyBuckets).toEqual([]);
      expect(rollup.breakdownByModel).toEqual([]);
    });
  });

  describe("given a member whose personal tenant carries traffic", () => {
    it("reads the usage dashboard from their personal tenant", async () => {
      const { app, personalUsage } = await buildApp({ workspace });
      personalUsage.recordTraceUsage({
        tenantId: workspace.project.id,
        occurredAtMs: NOW,
        totalCost: 2.5,
        nonBilledCost: 0,
        promptTokens: 100,
        completionTokens: 50,
        models: ["claude-opus"],
      });

      const rollup = await app.personalUsageDashboard({ organizationId: ORGANIZATION_ID }, CALLER);

      expect(rollup.summary.spentUsd).toBe(2.5);
      expect(rollup.summary.promptTokens).toBe(100);
    });
  });

  describe("when the caller reads their budget overview", () => {
    it("asks the gateway for the caller's own overview", async () => {
      const { app, budgetOverviewForUser } = await buildApp({ workspace });

      await expect(
        app.personalBudgetOverview({ organizationId: ORGANIZATION_ID }, CALLER),
      ).resolves.toEqual(noGatewayAccess);
      expect(budgetOverviewForUser).toHaveBeenCalledWith({
        organizationId: ORGANIZATION_ID,
        userId: CALLER.id,
      });
    });

    it("passes the ask for top models through to the gateway", async () => {
      const { app, budgetOverviewForUser } = await buildApp({ workspace });

      await app.personalBudgetOverview(
        { organizationId: ORGANIZATION_ID, includeTopModels: true },
        CALLER,
      );

      expect(budgetOverviewForUser).toHaveBeenCalledWith({
        organizationId: ORGANIZATION_ID,
        userId: CALLER.id,
        includeTopModels: true,
      });
    });
  });
});
