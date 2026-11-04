/**
 * Which stored row a project runs on for one provider key: the one the settings page lists.
 * @see specs/model-providers/instant-evals-decision-model.feature
 */
import type { ModelDefaultScope, ModelProvider } from "@langwatch/model-provider-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { UnavailableModelProviderCredentialProbeService } from "../../features/credential-probe/services/unavailable-model-provider-credential-probe.service.ts";
import type { ModelProviderRepository } from "../../repositories/model-provider.repository.ts";
import { ModelProviderKeysService } from "../model-provider-keys.service.ts";
import { ModelProviderQueryService } from "../model-provider-query.service.ts";
import type { ModelProviderScopeService } from "../model-provider-scope.service.ts";
import { RegistryModelProviderCatalogService } from "../registry-model-provider-catalog.service.ts";
import { UnmanagedModelProviderGatewayService } from "../unmanaged-model-provider-gateway.service.ts";

const CHAIN: ModelDefaultScope[] = [
  { scopeType: "PROJECT", scopeId: "proj_1" },
  { scopeType: "TEAM", scopeId: "team_1" },
  { scopeType: "ORGANIZATION", scopeId: "org_1" },
];

function rowOf({
  id,
  scope,
  createdAt,
}: {
  id: string;
  scope: ModelDefaultScope;
  createdAt: string;
}): ModelProvider {
  const at = new Date(createdAt);
  return {
    id,
    organizationId: "org_1",
    provider: "openai",
    name: "OpenAI",
    enabled: true,
    routingHandle: null,
    scopes: [scope],
    customKeys: { OPENAI_API_KEY: `${id}-key` },
    customModels: [],
    customEmbeddingsModels: [],
    extraHeaders: [],
    rateLimitRpm: null,
    rateLimitTpm: null,
    rateLimitRpd: null,
    fallbackPriorityGlobal: null,
    providerConfig: null,
    createdAt: at,
    updatedAt: at,
  };
}

function queryFor(saved: ModelProvider[]): ModelProviderQueryService {
  return ModelProviderQueryService.create({
    repository: createApiFixture<ModelProviderRepository>({
      findForProject: async () => saved,
    }),
    scopes: createApiFixture<ModelProviderScopeService>({
      getProjectScopes: async () => CHAIN,
    }),
    credentialPolicy: ModelProviderKeysService.create(),
    catalog: RegistryModelProviderCatalogService.create({
      managed: UnmanagedModelProviderGatewayService.create(),
      probe: UnavailableModelProviderCredentialProbeService.create(),
      systemProviderEnvironment: {},
      isSaas: false,
    }),
  });
}

const ORG_ROW = rowOf({ id: "org_row", scope: CHAIN[2]!, createdAt: "2026-01-01T00:00:00Z" });
const TEAM_ROW = rowOf({ id: "team_row", scope: CHAIN[1]!, createdAt: "2026-02-01T00:00:00Z" });
const PROJECT_ROW = rowOf({
  id: "project_row",
  scope: CHAIN[0]!,
  createdAt: "2026-03-01T00:00:00Z",
});

describe("ModelProviderQueryService.findProviderForProject", () => {
  describe("given an older organization row and a newer project row for one provider", () => {
    /** @scenario "A project's own key wins over an older organization key" */
    it("answers the project row", async () => {
      const row = await queryFor([ORG_ROW, TEAM_ROW, PROJECT_ROW]).findProviderForProject({
        projectId: "proj_1",
        provider: "openai",
      });

      expect(row?.id).toBe("project_row");
    });
  });

  describe("given only organization and team rows", () => {
    it("answers the team row", async () => {
      const row = await queryFor([ORG_ROW, TEAM_ROW]).findProviderForProject({
        projectId: "proj_1",
        provider: "openai",
      });

      expect(row?.id).toBe("team_row");
    });
  });

  describe("given the project row is switched off", () => {
    it("answers the enabled organization row, as the settings page lists it", async () => {
      const off = { ...PROJECT_ROW, enabled: false };
      const row = await queryFor([ORG_ROW, off]).findProviderForProject({
        projectId: "proj_1",
        provider: "openai",
      });

      expect(row?.id).toBe("org_row");
    });
  });

  describe("given no row for the provider", () => {
    it("answers null", async () => {
      const row = await queryFor([ORG_ROW]).findProviderForProject({
        projectId: "proj_1",
        provider: "azure",
      });

      expect(row).toBeNull();
    });
  });
});
