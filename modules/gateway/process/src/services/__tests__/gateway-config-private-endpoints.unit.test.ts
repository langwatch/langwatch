import { type ModelProvider, type VirtualKeyWithScopes } from "@langwatch/gateway-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { memoryGatewayService } from "../../__tests__/support/memory.gateway-service.ts";
import {
  GatewayScopeResolutionRepository,
  type GatewayRoutingPolicyOrder,
} from "../../repositories/gateway-scope-resolution.repository.ts";
import { MemoryGatewayStore } from "../../repositories/memory/memory.gateway.store.ts";
import { GatewayConfigAssemblyService } from "../gateway-config-assembly.service.ts";
import { GatewayConfigMaterialiserService } from "../gateway-config-materialisation.service.ts";
import { GatewayScopeResolutionService } from "../gateway-scope-resolution.service.ts";

const AT = Temporal.Instant.from("2026-09-01T00:00:00.000Z");
const ORGANIZATION_ID = "org-customer-1";
const CUSTOMER_SECRET = "sk-customer-own";

const customerProvider: ModelProvider = {
  id: "mp-customer-openai",
  name: "Customer OpenAI",
  provider: "openai",
  routingHandle: null,
  enabled: true,
  customKeys: { OPENAI_API_KEY: CUSTOMER_SECRET },
  extraHeaders: null,
  customModels: null,
  customEmbeddingsModels: null,
  deploymentMapping: null,
  rateLimitRpm: null,
  rateLimitTpm: null,
  rateLimitRpd: null,
  rotationPolicy: "MANUAL",
  providerConfig: null,
  fallbackPriorityGlobal: null,
  langySkipPermissionsModels: null,
  healthStatus: "HEALTHY",
  circuitOpenedAt: null,
  lastHealthCheckAt: null,
  disabledAt: null,
  createdAt: AT,
  updatedAt: AT,
  organizationId: ORGANIZATION_ID,
};

/** The organization holds one provider of its own; the managed key carries its services. */
class CustomerOrganizationScopes extends GatewayScopeResolutionRepository {
  constructor(private readonly connectServices: string[]) {
    super();
  }

  async findManagedKeyConnectServices(): Promise<string[]> {
    return this.connectServices;
  }

  async findProvidersReachableFromScopes(): Promise<ModelProvider[]> {
    return [customerProvider];
  }

  async findRoutingPolicyOrder(): Promise<GatewayRoutingPolicyOrder | null> {
    return null;
  }
}

const managedKey: VirtualKeyWithScopes = {
  id: "vk-managed",
  organizationId: ORGANIZATION_ID,
  name: "Connect lic-1",
  description: null,
  status: "ACTIVE",
  purpose: "CONNECT",
  externalId: null,
  metadata: {},
  disabledAt: null,
  disabledReason: null,
  expiresAt: null,
  hashedSecret: "hashed",
  displayPrefix: "lw_vk_",
  principalUserId: null,
  traceProjectId: null,
  config: {},
  revision: 1n,
  previousHashedSecret: null,
  previousSecretValidUntil: null,
  revokedAt: null,
  revokedById: null,
  createdAt: AT,
  updatedAt: AT,
  createdById: "system",
  lastUsedAt: null,
  routingPolicyId: null,
  routingMode: "FALLBACK_ALL",
  scopes: [{ scopeType: "ORGANIZATION", scopeId: ORGANIZATION_ID }],
  principalUser: null,
  routingPolicy: null,
};

const platformProviders = createApiFixture<ModelProviderApi>({
  platformProviderChain: async () => [
    { provider: "openai", credentialKey: "OPENAI_API_KEY", credential: "sk-platform-openai" },
  ],
});

const INFERENCE = {
  hostname: "llm.internal.acme.test",
  addresses: ["10.20.1.21", "10.20.2.34"],
  port: 443,
};

/** The materialiser for an organization whose bound hostnames the test decides. */
function materialiserWith(bindings: () => (typeof INFERENCE)[]) {
  const projects = createApiFixture<ProjectApi>({
    listNamesByIds: async () => [],
    findTraceDestination: async () => null,
  });
  const repository = new CustomerOrganizationScopes([]);
  return GatewayConfigMaterialiserService.create({
    scopeResolution: GatewayScopeResolutionService.create({
      repository,
      platformProviders,
      projects,
    }),
    projects,
    chRepo: null,
    budgetDecisions: memoryGatewayService({ store: MemoryGatewayStore.create({}), projects })
      .service,
    modelProviders: createApiFixture<ModelProviderApi>({
      getCustomKeys: async () => ({
        id: customerProvider.id,
        provider: "openai",
        organizationId: ORGANIZATION_ID,
        customKeys: { OPENAI_API_KEY: CUSTOMER_SECRET },
      }),
      privateEndpointBindingsForOrganization: async ({ organizationId }) =>
        organizationId === ORGANIZATION_ID ? bindings() : [],
    }),
    assembly: GatewayConfigAssemblyService.create({ repository, platformProviders, projects }),
  });
}

describe("the configuration the gateway builds for a key of an organization with private endpoints", () => {
  describe("when the organization bound a hostname", () => {
    /** @scenario "<path> reaches the private endpoint through a bound hostname" */
    it("carries the bindings in the top-level private_endpoints field", async () => {
      const bundle = await materialiserWith(() => [INFERENCE]).materialise(managedKey);

      expect(bundle.private_endpoints).toEqual([INFERENCE]);
      expect(JSON.stringify(bundle)).toContain(
        '"private_endpoints":[{"hostname":"llm.internal.acme.test","addresses":["10.20.1.21","10.20.2.34"],"port":443}]',
      );
    });

    it("moves the ETag when a binding changes, so the gateway refetches", async () => {
      let bindings = [INFERENCE];
      const materialiser = materialiserWith(() => bindings);

      const before = await materialiser.versionToken(managedKey);
      bindings = [{ ...INFERENCE, addresses: ["10.20.9.1"] }];
      const after = await materialiser.versionToken(managedKey);
      bindings = [];
      const removed = await materialiser.versionToken(managedKey);

      expect(after).not.toBe(before);
      expect(removed).not.toBe(after);
      expect(before).not.toContain("10.20.");
    });
  });

  describe("when the organization bound nothing", () => {
    it("sends no private_endpoints field and keeps the ETag it had without bindings", async () => {
      const materialiser = materialiserWith(() => []);
      const bundle = await materialiser.materialise(managedKey);

      expect("private_endpoints" in bundle).toBe(false);
      expect(await materialiser.versionToken(managedKey)).not.toContain("pe-");
    });
  });
});
