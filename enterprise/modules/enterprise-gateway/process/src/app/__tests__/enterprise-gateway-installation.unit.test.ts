// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi } from "@langwatch/authz-contract";
import { EnterpriseGatewayApi } from "@langwatch/enterprise-gateway-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { createApp } from "@langwatch/kernel";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { memoryStores } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import { enterpriseGatewayServer } from "../../enterprise-gateway.server.ts";

function boot() {
  const { logger } = createTestLogger();
  return createApp({ role: "api" })
    .withModules([enterpriseGatewayServer])
    .withStores(memoryStores())
    .withMembers({ isSaas: false })
    .withObservability((observability) => observability.withLogging(logger))
    .provide({
      gateway: createApiFixture<GatewayApi>(),
      project: createApiFixture<ProjectApi>(),
      organization: createApiFixture<OrganizationApi>(),
      authz: createApiFixture<AuthzApi>(),
      "model-provider": createApiFixture<ModelProviderApi>(),
    })
    .boot();
}

describe("enterprise gateway installation", () => {
  /** @scenario "The enterprise gateway serves routing policies and personal virtual keys" */
  it("serves routingPolicy and personalVirtualKeys", () => {
    expect(enterpriseGatewayServer.transports.map((transport) => transport.namespace)).toEqual([
      "routingPolicy",
      "personalVirtualKeys",
    ]);
  });

  /** @scenario "The enterprise gateway boots over memory stores and answers from its own routing policies" */
  it("boots over memory stores and counts an organization's routing policies itself", async () => {
    const runtime = await boot();

    try {
      const app = runtime.service(EnterpriseGatewayApi);
      expect(runtime.module(enterpriseGatewayServer).provided).toBe(app);
      await expect(app.countRoutingPolicies({ organizationId: "org_1" })).resolves.toBe(0);
      await expect(app.listRoutingPolicies({ organizationId: "org_1" })).resolves.toEqual([]);
    } finally {
      await runtime.stop();
    }
  });
});
