import {
  MANAGED_MODELS,
  type ModelProvider,
  type VirtualKeyWithScopes,
} from "@langwatch/gateway-contract";
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

/** The bundle the gateway builds for the managed key of a license holding the given services. */
async function bundleForLicenseServices(connectServices: string[]) {
  const projects = createApiFixture<ProjectApi>({
    listNamesByIds: async () => [],
    findTraceDestination: async () => null,
  });
  const repository = new CustomerOrganizationScopes(connectServices);
  const materialiser = GatewayConfigMaterialiserService.create({
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
      getCustomKeys: async () => {
        throw new Error("a managed key's bundle never reads a customer row");
      },
    }),
    assembly: GatewayConfigAssemblyService.create({ repository, platformProviders, projects }),
  });

  return materialiser.materialise(managedKey);
}

describe("the configuration the gateway builds for a license's managed key", () => {
  describe("when the organization holds a model provider of its own", () => {
    /** @scenario A license token reaches none of the customer's own model providers */
    it("dispatches to none of the customer's providers and carries none of their credentials", async () => {
      const bundle = await bundleForLicenseServices([MANAGED_MODELS]);
      const wire = JSON.stringify(bundle);

      expect(bundle.providers.length).toBeGreaterThan(0);
      expect(bundle.providers.map((slot) => slot.id)).not.toContain(customerProvider.id);
      expect(bundle.fallback.chain).not.toContain(customerProvider.id);
      expect(wire).not.toContain(CUSTOMER_SECRET);
    });

    it("holds no provider at all when the license names no managed models", async () => {
      const bundle = await bundleForLicenseServices([]);

      expect(bundle.providers).toEqual([]);
      expect(JSON.stringify(bundle)).not.toContain(CUSTOMER_SECRET);
    });
  });

  describe("when the license is entitled to managed models", () => {
    /** @scenario The configuration of an entitled license key lists the platform's shared providers */
    it("carries the platform's shared providers, and none when the entitlement is lacking", async () => {
      const entitled = await bundleForLicenseServices([MANAGED_MODELS]);
      const unentitled = await bundleForLicenseServices(["instant_evals"]);

      expect(entitled.providers.map((slot) => slot.id)).toEqual(
        expect.arrayContaining([expect.stringContaining("platform")]),
      );
      expect(entitled.providers.map((slot) => slot.type)).toContain("openai");
      expect(unentitled.providers).toEqual([]);
    });
  });
});
