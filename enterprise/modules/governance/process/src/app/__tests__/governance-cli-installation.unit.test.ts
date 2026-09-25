import type { AgentApi } from "@langwatch/agent-contract";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 */
import { OrganizationInvalidCredentialsError } from "@langwatch/api";
import { createApiFixture } from "@langwatch/api-fixture";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import { BearerIdentity, RestHost } from "@langwatch/api/rest";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { EnterpriseGatewayApi } from "@langwatch/enterprise-gateway-contract";
import type { ScimApi } from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { createApp } from "@langwatch/kernel";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { memoryStores } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { governanceServer } from "../../governance.server.ts";
import { governanceCliRest } from "../../transport/governance-cli.rest.ts";
import type { GovernanceEncryptor } from "../governance.members.ts";

const MAIN_CLI_ROUTES = [
  "GET /api/auth/cli/budget/status",
  "GET /api/auth/cli/bootstrap",
  "GET /api/auth/cli/budget-overview",
  "GET /api/auth/cli/personal-project",
  "POST /api/auth/cli/virtual-key",
  "POST /api/auth/cli/project-key",
  "GET /api/auth/cli/governance/ingest/sources",
  "GET /api/auth/cli/governance/ingest/sources/:sourceId/events",
  "GET /api/auth/cli/governance/ingest/sources/:sourceId/health",
  "GET /api/auth/cli/governance/status",
  "GET /api/auth/cli/governance/ingestion-templates",
  "POST /api/auth/cli/governance/ingestion-key",
  "GET /api/auth/cli/governance/ingestion-keys",
  "GET /api/auth/cli/governance/ingestion-keys/:lookup_id",
];

function restHost() {
  const closed = BearerIdentity.create({ name: "unconfigured", token: void 0 });
  return RestHost.create({
    identities: {
      project: closed,
      organization: closed,
      apiKey: closed,
      scimToken: closed,
      "instance-admin": closed,
      browser: closed,
    },
    bearers: () => closed,
    audit: { record: async () => {} },
  });
}

async function boot(rest: RestHost) {
  const resolver = SecretsResolver.over(SecretsChain.start({ environment: {} }).withEnv());
  await resolver.preflight(Object.values(governanceServer.secrets ?? {}));
  return createApp({ role: "api", secrets: (owner, declared) => resolver.scopeTo(owner, declared) })
    .withModules([governanceServer])
    .withStores(memoryStores())
    .expose(() => ({ hosts: { rest, trpc: { mount: () => ({}) } }, serve: () => undefined }))
    .withMembers({
      encryption: createApiFixture<GovernanceEncryptor>(),
      isSaas: false,
      publicBaseUrl: "https://app.test",
    })
    .provide({
      agent: createApiFixture<AgentApi>(),
      project: createApiFixture<ProjectApi>(),
      auth: createApiFixture<AuthApi>({
        getCliAccessSession: () => Promise.reject(new OrganizationInvalidCredentialsError()),
      }),
      entitlement: createApiFixture<EntitlementApi>(),
      organization: createApiFixture<OrganizationApi>(),
      authz: createApiFixture<AuthzApi>(),
      scim: createApiFixture<ScimApi>(),
      "feature-flag": createApiFixture<FeatureFlagApi>(),
      trace: createApiFixture<TraceApi>(),
      "api-key": createApiFixture<ApiKeyApi>(),
      gateway: createApiFixture<GatewayApi>(),
      "enterprise-gateway": createApiFixture<EnterpriseGatewayApi>(),
      "model-provider": createApiFixture<ModelProviderApi>(),
      user: createApiFixture<UserApi>(),
      "audit-log": createApiFixture<AuditLogApi>(),
    })
    .boot();
}

describe("the governance installation's CLI plane", () => {
  /** @scenario "The api answers the CLI governance routes main serves" */
  it("mounts main's fourteen routes and answers them from the installed app", async () => {
    const rest = restHost();
    const runtime = await boot(rest);

    try {
      const mounted = governanceServer.transports.includes(governanceCliRest);
      const routes = governanceCliRest
        .router()
        .routes.map((route) => `${route.method.toUpperCase()} ${route.path}`);
      const response = await rest.app.fetch(
        new Request("http://api.test/api/auth/cli/budget/status", {
          headers: { Authorization: "Bearer lw_at_unknown" },
        }),
      );

      expect(mounted).toBe(true);
      expect(routes.toSorted()).toEqual(MAIN_CLI_ROUTES.toSorted());
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ code: "invalid_credentials" });
    } finally {
      await runtime.stop();
    }
  });
});
