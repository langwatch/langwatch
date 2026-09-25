// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The pulled-usage pipeline per role: the worker hosts main's cost rollup fold, the api constructs none. */
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
    },
    members: {
      encryption: createApiFixture<GovernanceEncryptor>(),
      isSaas: false,
    },
    resources: new ResourceScope(),
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
  });
}

describe("the pulled-usage pipeline's cost rollup fold", () => {
  describe("when the worker consumes the pipeline", () => {
    it("registers the governanceCostRollup fold, so the cost reads have a writer", async () => {
      const app = await buildApp();

      const pipeline = app.pulledUsagePipeline({ participation: "consume" });

      expect([...pipeline.foldProjections.keys()]).toEqual(["governanceCostRollup"]);
    });
  });

  describe("when the api only produces", () => {
    it("constructs no fold", async () => {
      const app = await buildApp();

      const pipeline = app.pulledUsagePipeline({ participation: "produce" });

      expect(pipeline.foldProjections.size).toBe(0);
    });
  });
});

describe("the pulled-usage pipeline's commands", () => {
  describe.each(["consume", "produce"] as const)("when the process %ss the pipeline", (role) => {
    it("registers retractPulledUsage beside recordPulledUsage, so a logged withdrawal still applies", async () => {
      const app = await buildApp();

      const pipeline = app.pulledUsagePipeline({ participation: role });

      expect(pipeline.commands.map((command) => command.definition.name)).toEqual([
        "recordPulledUsage",
        "retractPulledUsage",
      ]);
    });
  });
});
