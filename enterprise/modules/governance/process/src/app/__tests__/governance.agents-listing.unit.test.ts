import type { AgentApi } from "@langwatch/agent-contract";
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
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** `governanceAgents.requestListing` over memory rows, pinned to main's refusal when no pull pipeline runs. */
import { memoryRateLimiter } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { MemoryGovernanceRepositories } from "../../repositories/memory/memory.governance.repositories.ts";
import type { GovernanceEncryptor } from "../../services/ingestion-credentials.service.ts";
import { GovernanceModule } from "../governance.app.ts";

function buildApp() {
  return GovernanceModule.create({
    config: void 0,
    repositories: MemoryGovernanceRepositories.create(),
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
      rateLimiter: memoryRateLimiter(),
    },
    resources: new ResourceScope(),
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
  });
}

describe("asking every source for its agents", () => {
  describe("given a process running no ingestion pull pipeline", () => {
    describe("when the organization has no source that can list agents", () => {
      /** @scenario "Asking for an agent listing without the pull pipeline is refused by name" */
      it("refuses with agent_listing_unavailable rather than answering zero requested", async () => {
        const app = await buildApp();

        await expect(
          app.governanceAgentsRequestListing({ organizationId: "org-1" }),
        ).rejects.toMatchObject({ code: "agent_listing_unavailable" });
      });
    });
  });
});
