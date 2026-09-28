import type { AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { EnterpriseGatewayApi } from "@langwatch/enterprise-gateway-contract";
import type { ScimApi } from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { GatewayApi, GatewayBudgetOverviewForUser } from "@langwatch/gateway-contract";
import { ResourceScope } from "@langwatch/kernel";
import type { LogApi } from "@langwatch/log-contract";
import type { MetricApi } from "@langwatch/metric-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import {
  type OrganizationApi,
  type PersonalWorkspace,
  TeamNotFoundError,
} from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { memoryRateLimiter } from "@langwatch/test-harness";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import type { GovernanceEncryptor } from "../../app/governance.members.ts";
import { MemoryGovernanceRepositories } from "../../repositories/memory/memory.governance.repositories.ts";
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
  const traceSpend = vi.fn(async (_input: { projectId: string }) => ({
    totalCost: 0,
    billedCost: 0,
    requestCount: 0,
    promptTokens: 0,
    completionTokens: 0,
  }));
  const budgetOverviewForUser = vi.fn(async () => noGatewayAccess);
  const getPrincipalSpendSummary = vi.fn<GatewayApi["getPrincipalSpendSummary"]>(async () => ({
    totalCost: 0,
    requestCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    topModel: null,
  }));
  const app = await GovernanceApp.create({
    config: void 0,
    repositories: MemoryGovernanceRepositories.create(),
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
      traces: createApiFixture<TraceApi>({
        getSpendSummary: traceSpend,
        findTopModelsByRequests: async () => [{ model: "claude-opus", requests: 1 }],
        findDailySpend: async () => [],
        findModelSpend: async () => [],
      }),
      apiKeys: createApiFixture<ApiKeyApi>(),
      gateway: createApiFixture<GatewayApi>({ budgetOverviewForUser, getPrincipalSpendSummary }),
      enterpriseGateway: createApiFixture<EnterpriseGatewayApi>(),
      modelProviders: createApiFixture<ModelProviderApi>(),
      users: createApiFixture<UserApi>(),
      auditLog: createApiFixture<AuditLogApi>(),
      logs: createApiFixture<LogApi>(),
      metrics: createApiFixture<MetricApi>(),
    },
    members: {
      encryption: createApiFixture<GovernanceEncryptor>(),
      isSaas: false,
      rateLimiter: memoryRateLimiter(),
    },
    resources: new ResourceScope(),
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
  });

  return { app, traceSpend, budgetOverviewForUser, getPrincipalSpendSummary };
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
      const { app, traceSpend } = await buildApp({ workspace });
      traceSpend.mockImplementation(async ({ projectId }) => ({
        totalCost: projectId === workspace.project.id ? 2.5 : 0,
        billedCost: projectId === workspace.project.id ? 2.5 : 0,
        requestCount: projectId === workspace.project.id ? 1 : 0,
        promptTokens: projectId === workspace.project.id ? 100 : 0,
        completionTokens: projectId === workspace.project.id ? 50 : 0,
      }));

      const rollup = await app.personalUsageDashboard({ organizationId: ORGANIZATION_ID }, CALLER);

      expect(rollup.summary.spentUsd).toBe(2.5);
      expect(rollup.summary.promptTokens).toBe(100);
    });
  });

  describe("given a tenant the caller already resolved, as /api/me/usage does", () => {
    it("adds the caller's ledger spend in that tenant to their personal project", async () => {
      const { app, traceSpend, getPrincipalSpendSummary } = await buildApp({ workspace });
      traceSpend.mockImplementation(async () => ({
        totalCost: 1,
        billedCost: 1,
        requestCount: 1,
        promptTokens: 10,
        completionTokens: 5,
      }));
      getPrincipalSpendSummary.mockImplementation(async () => ({
        totalCost: 4,
        requestCount: 2,
        promptTokens: 20,
        completionTokens: 10,
        topModel: { name: "claude-opus", requests: 2 },
      }));

      const rollup = await app.personalUsage({
        personalProjectId: workspace.project.id,
        userId: CALLER.id,
        ingestionTenantId: "project-governance-1",
      });

      expect(rollup.summary).toMatchObject({ spentUsd: 5, requests: 3, promptTokens: 30 });
      expect(getPrincipalSpendSummary).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "project-governance-1", userId: CALLER.id }),
      );
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
