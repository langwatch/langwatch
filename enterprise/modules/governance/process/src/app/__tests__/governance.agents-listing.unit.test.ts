// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** `governanceAgents.requestListing` over memory rows, pinned to main's refusal when no pull pipeline runs. */
import { createApiFixture } from "@langwatch/api-fixture";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { ScimApi } from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
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

import { MemoryGovernanceRepositories } from "../../repositories/memory/memory.governance.repositories.ts";
import { GovernanceApp } from "../governance.app.ts";
import type { GovernanceEncryptor } from "../governance.members.ts";

function buildApp() {
  return GovernanceApp.create({
    config: void 0,
    repositories: MemoryGovernanceRepositories.create(),
    dependencies: {
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
