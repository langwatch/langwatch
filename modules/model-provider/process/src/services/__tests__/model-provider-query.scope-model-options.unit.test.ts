/**
 * Which chat and embedding models a Default models config on some scopes may pick.
 * @see modules/model-provider/specs/default-models-scope-model-options.feature
 */
import type { ModelDefaultScope, ModelProvider } from "@langwatch/model-provider-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { UnavailableModelProviderCredentialProbeService } from "../../features/credential-probe/services/unavailable-model-provider-credential-probe.service.ts";
import type { ModelProviderRepository } from "../../repositories/model-provider.repository.ts";
import { ModelProviderKeysService } from "../model-provider-keys.service.ts";
import { ModelProviderQueryService } from "../model-provider-query.service.ts";
import type { ModelProviderScopeService } from "../model-provider-scope.service.ts";
import { RegistryModelProviderCatalogService } from "../registry-model-provider-catalog.service.ts";
import { UnmanagedModelProviderGatewayService } from "../unmanaged-model-provider-gateway.service.ts";

const ORGANIZATION: ModelDefaultScope = { scopeType: "ORGANIZATION", scopeId: "org_1" };
const TEAM: ModelDefaultScope = { scopeType: "TEAM", scopeId: "team_1" };
const PROJECT_A: ModelDefaultScope = { scopeType: "PROJECT", scopeId: "proj_a" };
const PROJECT_B: ModelDefaultScope = { scopeType: "PROJECT", scopeId: "proj_b" };
const PROJECT_PAGE: ModelDefaultScope = { scopeType: "PROJECT", scopeId: "proj_page" };

type Model = { id: string; label?: string };

function rowOf({
  id,
  provider,
  name,
  scope,
  customModels = [],
  customEmbeddingsModels = [],
}: {
  id: string;
  provider: string;
  name: string;
  scope: ModelDefaultScope;
  customModels?: Model[];
  customEmbeddingsModels?: Model[];
}): ModelProvider {
  const at = new Date(0);
  const toModels = (models: Model[], type: "chat" | "embedding") =>
    models.map((model) => ({ id: model.id, label: model.label ?? model.id, type }));
  return {
    id,
    organizationId: "org_1",
    provider,
    name,
    enabled: true,
    routingHandle: null,
    scopes: [scope],
    customKeys: { KEY: `${id}-key` },
    customModels: toModels(customModels, "chat"),
    customEmbeddingsModels: toModels(customEmbeddingsModels, "embedding"),
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

/** Each project sits under the one team and organization. */
function chainOf(projectId: string): ModelDefaultScope[] {
  return [{ scopeType: "PROJECT", scopeId: projectId }, TEAM, ORGANIZATION];
}

function sameScope(left: ModelDefaultScope, right: ModelDefaultScope): boolean {
  return left.scopeType === right.scopeType && left.scopeId === right.scopeId;
}

function queryFor({
  saved,
  scopesOrganizationId = "org_1",
}: {
  saved: ModelProvider[];
  scopesOrganizationId?: string;
}): ModelProviderQueryService {
  return ModelProviderQueryService.create({
    repository: createApiFixture<ModelProviderRepository>({
      findForProject: async (chain) =>
        saved.filter((row) => row.scopes.some((scope) => chain.some((c) => sameScope(c, scope)))),
    }),
    scopes: createApiFixture<ModelProviderScopeService>({
      getProjectContext: async (projectId) => ({
        projectId,
        projectName: projectId,
        teamId: "team_1",
        organizationId: "org_1",
        organizationName: "ACME",
      }),
      getOrganizationIdForScopes: async () => scopesOrganizationId,
      getOrganizationIdForScope: async () => "org_1",
      getProjectSystemContext: async (projectId) => ({
        scopes: chainOf(projectId),
        referenceCreatedAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
      }),
      getOrganizationSystemReference: async () => Temporal.Instant.from("2026-01-01T00:00:00Z"),
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

const OPENAI_ON_A = rowOf({ id: "openai_a", provider: "openai", name: "OpenAI", scope: PROJECT_A });
const ANTHROPIC_ON_B = rowOf({
  id: "anthropic_b",
  provider: "anthropic",
  name: "Anthropic",
  scope: PROJECT_B,
});
const EMPTY_AZURE_ON_A = rowOf({
  id: "azure_a",
  provider: "azure",
  name: "Azure OpenAI",
  scope: PROJECT_A,
});

describe("ModelProviderQueryService.getModelOptionsForScopes", () => {
  describe("given the picked project runs OpenAI and the page's project runs Anthropic", () => {
    /** @scenario "A config row offers the chat models of the picked project, not the page's project" */
    it("offers OpenAI's chat models and none of Anthropic's", async () => {
      const anthropicOnPage = { ...ANTHROPIC_ON_B, scopes: [PROJECT_PAGE] };
      const options = await queryFor({
        saved: [OPENAI_ON_A, anthropicOnPage],
      }).getModelOptionsForScopes({ projectId: "proj_page", scopes: [PROJECT_A] });

      expect(options.chat).toContain("openai/latest");
      expect(options.chat.some((model) => model.startsWith("openai/gpt-"))).toBe(true);
      expect(options.chat.some((model) => model.startsWith("anthropic/"))).toBe(false);
      expect(options.embedding.every((model) => model.startsWith("openai/"))).toBe(true);
    });
  });

  describe("given one picked project runs OpenAI and another runs only Anthropic", () => {
    /** @scenario "A config on several scopes is offered only the models every scope runs" */
    it("offers no model of either", async () => {
      const options = await queryFor({
        saved: [OPENAI_ON_A, ANTHROPIC_ON_B],
      }).getModelOptionsForScopes({ projectId: "proj_a", scopes: [PROJECT_A, PROJECT_B] });

      expect(options.chat).toEqual([]);
      expect(options.embedding).toEqual([]);
    });

    /** @scenario "Scopes that each offer chat models but share none are told apart from none" */
    it("says they share no chat model, and not for embeddings only one of them offers", async () => {
      const options = await queryFor({
        saved: [OPENAI_ON_A, ANTHROPIC_ON_B],
      }).getModelOptionsForScopes({ projectId: "proj_a", scopes: [PROJECT_A, PROJECT_B] });

      expect(options.sharesNone).toEqual({ chat: true, embedding: false });
    });
  });

  describe("given a deployment listed on one project's Azure provider only", () => {
    /** @scenario "An organization config is not offered a model only one project's provider lists" */
    it("does not offer it to the organization", async () => {
      const withDeployment = rowOf({
        id: "azure_a",
        provider: "azure",
        name: "Azure OpenAI",
        scope: PROJECT_A,
        customModels: [{ id: "prod-gpt", label: "Production GPT" }],
      });

      const forProject = await queryFor({ saved: [withDeployment] }).getModelOptionsForScopes({
        projectId: "proj_a",
        scopes: [PROJECT_A],
      });
      const forOrganization = await queryFor({ saved: [withDeployment] }).getModelOptionsForScopes({
        projectId: "proj_a",
        scopes: [ORGANIZATION],
      });

      expect(forProject.chat).toEqual(["azure/prod-gpt"]);
      expect(forProject.displayNames["azure/prod-gpt"]).toBe("Production GPT");
      expect(forOrganization.chat).toEqual([]);
    });
  });

  describe("given the picked project runs an Azure provider with no deployments", () => {
    /** @scenario "An Azure provider with no deployments is named as having none" */
    it("offers nothing and names Azure as empty for chat and embeddings", async () => {
      const options = await queryFor({ saved: [EMPTY_AZURE_ON_A] }).getModelOptionsForScopes({
        projectId: "proj_a",
        scopes: [PROJECT_A],
      });

      const named = { id: "azure_a", provider: "azure", name: "Azure OpenAI", isSystem: false };
      expect(options.chat).toEqual([]);
      expect(options.embedding).toEqual([]);
      expect(options.emptyProviders).toEqual({ chat: [named], embedding: [named] });
      expect(options.sharesNone).toEqual({ chat: false, embedding: false });
    });

    it("names Azure for embeddings only once a chat deployment is listed", async () => {
      const withChat = rowOf({
        ...EMPTY_AZURE_ON_A,
        scope: PROJECT_A,
        customModels: [{ id: "prod-gpt" }],
      });

      const options = await queryFor({ saved: [withChat] }).getModelOptionsForScopes({
        projectId: "proj_a",
        scopes: [PROJECT_A],
      });

      expect(options.emptyProviders.chat).toEqual([]);
      expect(options.emptyProviders.embedding.map((provider) => provider.id)).toEqual(["azure_a"]);
    });
  });

  describe("given an organization Azure provider and a project Azure provider", () => {
    const orgAzure = (customModels: Model[]) =>
      rowOf({ ...EMPTY_AZURE_ON_A, id: "azure_org", scope: ORGANIZATION, customModels });

    /** @scenario "A deployment the organization's provider lists is offered beside the project's" */
    it("offers the deployments of both, as execution runs both", async () => {
      const projectAzure = rowOf({
        ...EMPTY_AZURE_ON_A,
        scope: PROJECT_A,
        customModels: [{ id: "local" }],
      });

      const options = await queryFor({
        saved: [orgAzure([{ id: "shared", label: "Shared GPT" }]), projectAzure],
      }).getModelOptionsForScopes({ projectId: "proj_a", scopes: [PROJECT_A] });

      expect(options.chat.toSorted()).toEqual(["azure/local", "azure/shared"]);
      expect(options.displayNames["azure/shared"]).toBe("Shared GPT");
    });

    it("does not name the project's empty Azure while the organization's offers one", async () => {
      const options = await queryFor({
        saved: [orgAzure([{ id: "shared" }]), EMPTY_AZURE_ON_A],
      }).getModelOptionsForScopes({ projectId: "proj_a", scopes: [PROJECT_A] });

      expect(options.chat).toEqual(["azure/shared"]);
      expect(options.emptyProviders.chat).toEqual([]);
    });
  });

  describe("given the picked project runs Anthropic", () => {
    /** @scenario "A provider with catalogue models is never named for a kind it does not offer" */
    it("does not name Anthropic as holding no embedding model", async () => {
      const anthropicOnA = { ...ANTHROPIC_ON_B, scopes: [PROJECT_A] };

      const options = await queryFor({ saved: [anthropicOnA] }).getModelOptionsForScopes({
        projectId: "proj_a",
        scopes: [PROJECT_A],
      });

      expect(options.embedding).toEqual([]);
      expect(options.emptyProviders.embedding).toEqual([]);
    });
  });

  describe("given a picked scope of another organization", () => {
    /** @scenario "Listing models for scopes of another organization is refused" */
    it("refuses with model_provider_invalid", async () => {
      await expect(
        queryFor({ saved: [], scopesOrganizationId: "org_2" }).getModelOptionsForScopes({
          projectId: "proj_a",
          scopes: [PROJECT_A],
        }),
      ).rejects.toMatchObject({ code: "model_provider_invalid" });
    });
  });

  describe("given no scope is picked", () => {
    /** @scenario "Listing models with no scope picked offers nothing" */
    it("offers nothing and names no provider", async () => {
      const options = await queryFor({ saved: [OPENAI_ON_A] }).getModelOptionsForScopes({
        projectId: "proj_a",
        scopes: [],
      });

      expect(options).toEqual({
        chat: [],
        embedding: [],
        displayNames: {},
        emptyProviders: { chat: [], embedding: [] },
        sharesNone: { chat: false, embedding: false },
      });
    });
  });

  describe("given a team scope", () => {
    it("offers the team's and the organization's providers, not a project's", async () => {
      const teamOpenAi = { ...OPENAI_ON_A, id: "openai_team", scopes: [TEAM] };
      const projectAzure = rowOf({
        ...EMPTY_AZURE_ON_A,
        scope: PROJECT_A,
        customModels: [{ id: "prod-gpt" }],
      });

      const options = await queryFor({
        saved: [teamOpenAi, projectAzure],
      }).getModelOptionsForScopes({ projectId: "proj_a", scopes: [TEAM] });

      expect(options.chat).toContain("openai/latest");
      expect(options.chat).not.toContain("azure/prod-gpt");
    });
  });
});
