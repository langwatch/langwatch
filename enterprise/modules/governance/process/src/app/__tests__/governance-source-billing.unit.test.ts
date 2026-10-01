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
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { LogApi } from "@langwatch/log-contract";
import type { MetricApi } from "@langwatch/metric-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { ResourceScope } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { memoryRateLimiter } from "@langwatch/test-harness";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { MemoryCostAttributionPolicyRepository } from "../../repositories/memory/memory.cost-attribution-policy.repository.ts";
import { MemoryGovernanceRepositories } from "../../repositories/memory/memory.governance.repositories.ts";
import { GovernanceApp } from "../governance.app.ts";
import type { GovernanceEncryptor } from "../governance.members.ts";

async function buildApp() {
  const costAttributionPolicies = MemoryCostAttributionPolicyRepository.create();
  costAttributionPolicies.addEnabledCodingAssistantConfig({
    organizationId: "org-1",
    config: { assistantKind: "codex", bundledPlan: false },
  });
  return GovernanceApp.create({
    config: void 0,
    repositories: { ...MemoryGovernanceRepositories.create(), costAttributionPolicies },
    dependencies: {
      agents: createApiFixture<AgentApi>(),
      projects: createApiFixture<ProjectApi>(),
      auth: createApiFixture<AuthApi>(),
      entitlements: createApiFixture<EntitlementApi>(),
      organizations: createApiFixture<OrganizationApi>(),
      permissions: createApiFixture<AuthzApi>(),
      scim: createApiFixture<ScimApi>(),
      featureFlags: createApiFixture<FeatureFlagApi>(),
      traces: createApiFixture<TraceApi>(),
      apiKeys: createApiFixture<ApiKeyApi>(),
      gateway: createApiFixture<GatewayApi>(),
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
}

describe("GovernanceApp.isSourceBilled", () => {
  /** @scenario "Governance answers whether a coding-assistant source is billed" */
  it("bills only a source whose tile opts out of the bundled plan", async () => {
    const app = await buildApp();
    await expect(
      app.isSourceBilled({ organizationId: "org-1", sourceType: "codex" }),
    ).resolves.toBe(true);
    await expect(
      app.isSourceBilled({ organizationId: "org-1", sourceType: "claude_code" }),
    ).resolves.toBe(false);
    await expect(
      app.isSourceBilled({ organizationId: "org-2", sourceType: "codex" }),
    ).resolves.toBe(false);
  });
});
