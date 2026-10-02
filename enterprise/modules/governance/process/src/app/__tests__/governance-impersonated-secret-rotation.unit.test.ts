import type { AgentApi } from "@langwatch/agent-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import { PermissionDeniedError } from "@langwatch/authorization";
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
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { MemoryGovernanceRepositories } from "../../repositories/memory/memory.governance.repositories.ts";
import { GovernanceModule } from "../governance.app.ts";
import type { GovernanceEncryptor } from "../governance.members.ts";

/** @see enterprise/modules/governance/specs/governance.feature */
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
      isSaas: false,
      rateLimiter: memoryRateLimiter(),
    },
    resources: new ResourceScope(),
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
  });
}

describe("given an operator acting as a member", () => {
  /** @scenario "An ingestion source secret is not rotated while an operator acts as another member" */
  it("refuses the rotation with permission_denied before the source is read", async () => {
    const app = await buildApp();

    const rotating = app.ingestionSourceRotateSecret({
      id: "source-1",
      organizationId: "org-1",
      impersonatorId: "operator-1",
    });

    await expect(rotating).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(rotating).rejects.toMatchObject({ code: "permission_denied" });
  });

  /** @scenario "A personal ingestion key is not minted while an operator acts as another member" */
  it("refuses installing or rotating a personal ingestion key with permission_denied", async () => {
    const app = await buildApp();
    const mint = {
      userId: "user-1",
      organizationId: "org-1",
      sourceType: "claude_code",
      impersonatorId: "operator-1",
    };

    await expect(app.ingestionKeyInstall(mint)).rejects.toMatchObject({
      code: "permission_denied",
    });
    await expect(app.ingestionKeyRotate(mint)).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
