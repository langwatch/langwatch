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
const PRIVATE_ENDPOINT = "http://vpce-1.vpce-svc-1.us-east-1.vpce.amazonaws.com";

const customerProvider: ModelProvider = {
  id: "mp-customer-bedrock",
  name: "Customer Bedrock",
  provider: "bedrock",
  routingHandle: null,
  enabled: true,
  customKeys: {},
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

/** The organization holds one Bedrock row of its own, managed through a private endpoint. */
class CustomerOrganizationScopes extends GatewayScopeResolutionRepository {
  async findManagedKeyConnectServices(): Promise<string[]> {
    return [];
  }

  async findProvidersReachableFromScopes(): Promise<ModelProvider[]> {
    return [customerProvider];
  }

  async findRoutingPolicyOrder(): Promise<GatewayRoutingPolicyOrder | null> {
    return null;
  }
}

const langyKey: VirtualKeyWithScopes = {
  id: "vk-langy",
  organizationId: ORGANIZATION_ID,
  name: "Langy",
  description: null,
  status: "ACTIVE",
  purpose: "LANGY",
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
  platformProviderChain: async () => [],
});

/** The materialiser for a Langy key over the customer's managed Bedrock row. */
function managedBedrockMaterialiser({ keysEpoch }: { keysEpoch: () => string }) {
  const projects = createApiFixture<ProjectApi>({
    listNamesByIds: async () => [],
    findTraceDestination: async () => null,
  });
  const repository = new CustomerOrganizationScopes();
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
      getGatewayCustomKeys: async ({ modelProviderId }) => ({
        id: modelProviderId,
        provider: "bedrock",
        organizationId: ORGANIZATION_ID,
        customKeys: {
          AWS_ACCESS_KEY_ID: "ASIA-customer-role",
          AWS_SECRET_ACCESS_KEY: "customer-role-secret",
          AWS_SESSION_TOKEN: "customer-role-session",
          AWS_REGION_NAME: "us-east-1",
          AWS_BEDROCK_RUNTIME_ENDPOINT: PRIVATE_ENDPOINT,
        },
      }),
      getGatewayKeysEpoch: keysEpoch,
    }),
    assembly: GatewayConfigAssemblyService.create({ repository, platformProviders, projects }),
  });
}

/** The bundle the gateway builds for a Langy key over the customer's managed Bedrock row. */
function bundleForManagedBedrock() {
  return managedBedrockMaterialiser({ keysEpoch: () => "managed-1" }).materialise(langyKey);
}

describe("the configuration the gateway builds over a managed Bedrock row", () => {
  /** @scenario "The gateway bundle sends a managed Bedrock row to the private endpoint" */
  it("carries the customer role's credentials and names the private endpoint on the Bedrock credential", async () => {
    const bundle = await bundleForManagedBedrock();
    const slot = bundle.providers.find((provider) => provider.id === customerProvider.id);

    expect(slot?.credentials).toEqual({
      access_key: "ASIA-customer-role",
      secret_key: "customer-role-secret",
      session_token: "customer-role-session",
      region: "us-east-1",
      bedrock_runtime_endpoint: PRIVATE_ENDPOINT,
    });
    expect(slot?.base_url).toBeUndefined();
  });
});

describe("the config version the gateway confirms for a managed Bedrock key", () => {
  /** @scenario "The gateway re-reads a managed row's keys before its session expires" */
  it("moves when the managed session window moves, so a 304 never confirms an old session", async () => {
    let epoch = "managed-1";
    const materialiser = managedBedrockMaterialiser({ keysEpoch: () => epoch });

    const first = await materialiser.versionToken(langyKey);
    const sameWindow = await materialiser.versionToken(langyKey);
    epoch = "managed-2";
    const nextWindow = await materialiser.versionToken(langyKey);

    expect(sameWindow).toBe(first);
    expect(nextWindow).not.toBe(first);
  });
});
