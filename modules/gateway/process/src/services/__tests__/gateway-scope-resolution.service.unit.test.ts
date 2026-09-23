import { createApiFixture } from "@langwatch/api-fixture";
import {
  MANAGED_MODELS,
  type ModelProvider,
  type VirtualKeyPurpose,
  type VirtualKeyWithScopes,
} from "@langwatch/gateway-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  GatewayScopeResolutionRepository,
  type GatewayRoutingPolicyOrder,
} from "../../repositories/gateway-scope-resolution.repository.ts";
import { GatewayScopeResolutionService } from "../gateway-scope-resolution.service.ts";

const AT = Temporal.Instant.from("2026-09-01T00:00:00.000Z");

function customerProvider(id: string): ModelProvider {
  return {
    id,
    name: id,
    provider: "openai",
    routingHandle: null,
    enabled: true,
    customKeys: { OPENAI_API_KEY: "sk-customer-own" },
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
    organizationId: "org-customer-1",
  };
}

/**
 * The customer organization holds one provider of its own, reachable from every scope, and its
 * managed key carries the services it was granted.
 */
class CustomerOrganizationScopes extends GatewayScopeResolutionRepository {
  constructor(private readonly connectServices: string[]) {
    super();
  }

  async findTeamIdsForProjects(): Promise<string[]> {
    return [];
  }

  async findManagedKeyConnectServices(input: {
    virtualKeyId: string;
    organizationId: string;
  }): Promise<string[]> {
    return input.virtualKeyId === "vk-1" && input.organizationId === "org-customer-1"
      ? this.connectServices
      : [];
  }

  async findProvidersReachableFromScopes(): Promise<ModelProvider[]> {
    return [customerProvider("mp-customer-openai")];
  }

  async findRoutingPolicyOrder(): Promise<GatewayRoutingPolicyOrder | null> {
    return null;
  }
}

function keyWithPurpose(purpose: VirtualKeyPurpose): VirtualKeyWithScopes {
  return {
    id: "vk-1",
    organizationId: "org-customer-1",
    name: "key",
    description: null,
    status: "ACTIVE",
    purpose,
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
    scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-customer-1" }],
    principalUser: null,
    routingPolicy: null,
  };
}

const platformProviders = createApiFixture<ModelProviderApi>({
  platformProviderChain: () =>
    Promise.resolve([
      { provider: "openai", credentialKey: "OPENAI_API_KEY", credential: "sk-platform-openai" },
      {
        provider: "anthropic",
        credentialKey: "ANTHROPIC_API_KEY",
        credential: "sk-platform-anthropic",
      },
    ]),
});

function serviceGranting(connectServices: string[]): GatewayScopeResolutionService {
  return GatewayScopeResolutionService.create({
    repository: new CustomerOrganizationScopes(connectServices),
    platformProviders,
  });
}

describe("the providers a license's managed key dispatches to", () => {
  describe("when the key names no managed models", () => {
    it("never reaches the customer organization's own providers", async () => {
      const service = serviceGranting(["instant_evals"]);

      expect(await service.eligibleModelProvidersForVk(keyWithPurpose("CONNECT"))).toEqual([]);
    });
  });

  describe("when the key names managed models", () => {
    /** @scenario "An entitled license key resolves to the platform's shared providers" */
    it("dispatches on the platform's own providers, in the chain's order", async () => {
      const service = serviceGranting(["instant_evals", MANAGED_MODELS]);

      const reached = await service.eligibleModelProvidersForVk(keyWithPurpose("CONNECT"));

      expect(reached.map((mp) => mp.id)).toEqual(["platform-openai", "platform-anthropic"]);
      expect(reached.map((mp) => mp.customKeys)).toEqual([
        { OPENAI_API_KEY: "sk-platform-openai" },
        { ANTHROPIC_API_KEY: "sk-platform-anthropic" },
      ]);
    });

    it("keeps an ordinary key on the organization's providers", async () => {
      const service = serviceGranting([MANAGED_MODELS]);

      const reached = await service.eligibleModelProvidersForVk(keyWithPurpose("USER"));

      expect(reached.map((mp) => mp.id)).toEqual(["mp-customer-openai"]);
    });
  });
});
