/**
 * Where a call's provider keys come from: the provider's stored keys first, and the
 * deployment's environment only when that environment is the customer's own to lend.
 * @see modules/model-provider/specs/model-provider.feature
 */
import { describe, expect, it } from "vitest";

import { createModelProviderTestManagedProviders } from "../../app/__tests__/model-provider.fixture.ts";
import { UnavailableModelProviderCredentialProbeService } from "../../features/credential-probe/services/unavailable-model-provider-credential-probe.service.ts";
import { ManagedModelProviderGatewayService } from "../managed-model-provider-gateway.service.ts";
import { RegistryModelProviderCatalogService } from "../registry-model-provider-catalog.service.ts";

const environment = {
  GOOGLE_APPLICATION_CREDENTIALS: '{"type":"service_account","project_id":"langwatch"}',
  VERTEXAI_PROJECT: "langwatch",
  VERTEXAI_LOCATION: "europe-west4",
};

function catalog(isSaas: boolean): RegistryModelProviderCatalogService {
  return RegistryModelProviderCatalogService.create({
    managed: ManagedModelProviderGatewayService.create({
      managed: createModelProviderTestManagedProviders([]),
      projects: { findOrganizationId: async () => "org-1" },
    }),
    probe: UnavailableModelProviderCredentialProbeService.create(),
    systemProviderEnvironment: environment,
    isSaas,
  });
}

describe("RegistryModelProviderCatalogService.pickExecutionValue", () => {
  describe("given the hosted deployment", () => {
    /** @scenario "On the hosted deployment a provider with its own keys never borrows LangWatch's" */
    it("reads only stored keys for a provider with its own, and the environment for the system provider", () => {
      const hosted = catalog(true);
      const customerKeys = { VERTEXAI_PROJECT: "acme-ai", VERTEXAI_LOCATION: "us-central1" };

      expect(
        hosted.pickExecutionValue({
          customKeys: customerKeys,
          key: "GOOGLE_APPLICATION_CREDENTIALS",
        }),
      ).toBeNull();
      expect(hosted.pickExecutionValue({ customKeys: customerKeys, key: "VERTEXAI_PROJECT" })).toBe(
        "acme-ai",
      );
      expect(
        hosted.pickExecutionValue({ customKeys: null, key: "GOOGLE_APPLICATION_CREDENTIALS" }),
      ).toBe(environment.GOOGLE_APPLICATION_CREDENTIALS);
    });
  });

  describe("given a self-hosted install", () => {
    /** @scenario "A self-hosted install fills a provider's missing key from its own environment" */
    it("fills a key the provider does not store from the environment", () => {
      const selfHosted = catalog(false);

      expect(
        selfHosted.pickExecutionValue({
          customKeys: { VERTEXAI_PROJECT: "acme-ai", GOOGLE_APPLICATION_CREDENTIALS: "" },
          key: "GOOGLE_APPLICATION_CREDENTIALS",
        }),
      ).toBe(environment.GOOGLE_APPLICATION_CREDENTIALS);
    });
  });
});
