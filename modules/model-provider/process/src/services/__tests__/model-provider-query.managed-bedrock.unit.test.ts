/**
 * The organization provider list shows a managed Bedrock as an enabled system row, as main did.
 * @see modules/model-provider/specs/model-provider.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { ModelProvider } from "@langwatch/model-provider-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { createModelProviderTestManagedProviders } from "../../app/__tests__/model-provider.fixture.ts";
import type { ModelProviderRepository } from "../../repositories/model-provider.repository.ts";
import { ManagedModelProviderGatewayService } from "../managed-model-provider-gateway.service.ts";
import { ModelProviderKeysService } from "../model-provider-keys.service.ts";
import { ModelProviderQueryService } from "../model-provider-query.service.ts";
import type { ModelProviderScopeService } from "../model-provider-scope.service.ts";
import { RegistryModelProviderCatalogService } from "../registry-model-provider-catalog.service.ts";
import { UnavailableModelProviderCredentialProbeService } from "../unavailable-model-provider-credential-probe.service.ts";

const MANAGED_ORG = "org-managed";

function savedBedrock(organizationId: string): ModelProvider {
  return {
    id: "mp_bedrock",
    organizationId,
    provider: "bedrock",
    name: "Bedrock",
    enabled: true,
    routingHandle: null,
    scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
    customKeys: { AWS_ACCESS_KEY_ID: "AKIA-customer", AWS_SECRET_ACCESS_KEY: "secret" },
    customModels: [],
    customEmbeddingsModels: [],
    extraHeaders: [],
    rateLimitRpm: null,
    rateLimitTpm: null,
    rateLimitRpd: null,
    fallbackPriorityGlobal: null,
    providerConfig: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function queryFor(saved: ModelProvider[]): ModelProviderQueryService {
  return ModelProviderQueryService.create({
    repository: createApiFixture<ModelProviderRepository>({
      findForOrganization: async () => saved,
    }),
    scopes: createApiFixture<ModelProviderScopeService>({
      getOrganizationSystemReference: async () => Temporal.Instant.from("2026-01-01T00:00:00Z"),
    }),
    credentialPolicy: ModelProviderKeysService.create(),
    catalog: RegistryModelProviderCatalogService.create({
      managed: ManagedModelProviderGatewayService.create({
        managed: createModelProviderTestManagedProviders([MANAGED_ORG]),
        projects: { findOrganizationId: async () => MANAGED_ORG },
      }),
      probe: UnavailableModelProviderCredentialProbeService.create(),
      systemProviderEnvironment: {},
      isSaas: false,
    }),
  });
}

describe("ModelProviderQueryService.listForOrganization, managed Bedrock", () => {
  describe("given an organization whose Bedrock is managed and not saved", () => {
    /** @scenario A managed-Bedrock organization lists Bedrock as an enabled system provider */
    it("lists Bedrock once as an enabled system provider", async () => {
      const listed = await queryFor([]).listForOrganization({ organizationId: MANAGED_ORG });
      const bedrock = listed.filter((provider) => provider.provider === "bedrock");

      expect(bedrock).toHaveLength(1);
      expect(bedrock[0]).toMatchObject({
        enabled: true,
        disabledByDefault: false,
        isSystem: true,
        customKeys: null,
      });
    });
  });

  describe("given a managed organization that saved its own Bedrock row", () => {
    /** @scenario A saved Bedrock row is not listed twice for a managed organization */
    it("lists Bedrock once, as the saved row", async () => {
      const listed = await queryFor([savedBedrock(MANAGED_ORG)]).listForOrganization({
        organizationId: MANAGED_ORG,
      });
      const bedrock = listed.filter((provider) => provider.provider === "bedrock");

      expect(bedrock).toHaveLength(1);
      expect(bedrock[0]?.id).toBe("mp_bedrock");
    });
  });

  describe("given an organization whose Bedrock is not managed", () => {
    /** @scenario An unmanaged organization lists no Bedrock system row */
    it("does not list Bedrock", async () => {
      const listed = await queryFor([]).listForOrganization({ organizationId: "org-other" });

      expect(listed.some((provider) => provider.provider === "bedrock")).toBe(false);
    });
  });
});
