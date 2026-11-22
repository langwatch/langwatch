import {
  ModelNotConfiguredError,
  type ModelProviderApi,
  type ModelProviderExecution,
} from "@langwatch/model-provider-contract";
import type { ProjectApi, ProjectWithTeam } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { ModelProviderExecutionHandleService } from "../model-provider-execution-handle.service.ts";

const OWNER = "user-owner";
const AT = new Date("2026-09-01T00:00:00Z");

const project: ProjectWithTeam = {
  id: "project-1",
  name: "Personal",
  slug: "personal",
  apiKey: "key",
  lwqlKey: "lwql",
  teamId: "team-1",
  language: "python",
  framework: "other",
  kind: "application",
  firstMessage: true,
  integrated: true,
  createdAt: AT,
  updatedAt: AT,
  userLinkTemplate: null,
  traceSharingEnabled: false,
  presenceEnabled: false,
  s3Endpoint: null,
  s3AccessKeyId: null,
  s3SecretAccessKey: null,
  s3Bucket: null,
  archivedAt: null,
  isPersonal: true,
  ownerUserId: OWNER,
  personalFeatures: null,
  departmentId: null,
  langyEgressAllowlist: null,
  lastCodingAgentSessionAt: null,
  lastCodingAgentPullRequestAt: null,
  team: {
    id: "team-1",
    name: "Personal",
    slug: "personal",
    organizationId: "organization-1",
    createdAt: AT,
    updatedAt: AT,
    archivedAt: null,
    isPersonal: true,
    ownerUserId: OWNER,
    departmentId: null,
  },
};

function getModel(resolveModelForFeature: ModelProviderApi["resolveModelForFeature"]) {
  return ModelProviderExecutionHandleService.getVercelAIModel({
    projectId: project.id,
    featureKey: "prompt.create_default",
    modelProviders: createApiFixture<ModelProviderApi>({
      getExecutionProviders: async () => ({}),
      resolveModelForFeature,
    }),
    projects: createApiFixture<ProjectApi>({ findWithTeam: async () => project }),
    executionProxyBaseUrl: "https://nlp.example.test/go/proxy/v1",
  });
}

const CODEX_MODEL = "openai_codex/gpt-5.6-terra";

const codexProvider: ModelProviderExecution = {
  id: "provider-codex",
  organizationId: "organization-1",
  provider: "openai_codex",
  name: "Codex",
  enabled: true,
  routingHandle: null,
  scopes: [],
  customKeys: null,
  customModels: [],
  customEmbeddingsModels: [],
  extraHeaders: [],
  rateLimitRpm: null,
  rateLimitTpm: null,
  rateLimitRpd: null,
  fallbackPriorityGlobal: null,
  providerConfig: null,
  createdAt: AT,
  updatedAt: AT,
  models: null,
  embeddingsModels: null,
  isSystem: false,
  embeddingsUnsupported: false,
};

/** Built the way the app builds it: no codex handle is composed. */
function getTitleModel() {
  return ModelProviderExecutionHandleService.create({
    modelProviders: createApiFixture<ModelProviderApi>({
      getExecutionProviders: async () => ({ openai_codex: codexProvider }),
      resolveModelForFeature: async ({ featureKey }) => ({
        model: CODEX_MODEL,
        source: "role_default",
        scope: "project",
        feature: {
          key: featureKey,
          role: "FAST",
          displayName: "Langy chat titles",
          description: "Names each Langy conversation from its messages.",
        },
      }),
    }),
    projects: createApiFixture<ProjectApi>({ findWithTeam: async () => project }),
    executionProxyBaseUrl: "https://nlp.example.test/go/proxy/v1",
  }).resolve({ projectId: project.id, featureKey: "langy.conversation_title" });
}

/** A model asked for by name, against the project's provider rows. */
function getNamedModel(providers: Record<string, ModelProviderExecution>) {
  return ModelProviderExecutionHandleService.getVercelAIModel({
    projectId: project.id,
    model: "openai/gpt-5-mini",
    featureKey: "langy.conversation_title",
    modelProviders: createApiFixture<ModelProviderApi>({
      getExecutionProviders: async () => providers,
    }),
    projects: createApiFixture<ProjectApi>({ findWithTeam: async () => project }),
    executionProxyBaseUrl: "https://nlp.example.test/go/proxy/v1",
  });
}

describe("ModelProviderExecutionHandleService", () => {
  describe("given a model named outright", () => {
    describe("when the project has no row for its provider", () => {
      /** @scenario "A named model whose provider is not set up is refused with a typed code" */
      it("refuses with model_provider_unavailable, reason not_configured", async () => {
        await expect(getNamedModel({})).rejects.toMatchObject({
          code: "model_provider_unavailable",
          fault: "customer",
          httpStatus: 400,
          meta: { reason: "not_configured" },
        });
      });
    });

    describe("when the project's row for its provider is disabled", () => {
      /** @scenario "A named model whose provider is turned off is refused with a typed code" */
      it("refuses with model_provider_unavailable, reason disabled", async () => {
        const openai = {
          ...codexProvider,
          id: "provider-openai",
          provider: "openai",
          enabled: false,
        };

        await expect(getNamedModel({ openai })).rejects.toMatchObject({
          code: "model_provider_unavailable",
          fault: "customer",
          meta: { reason: "disabled" },
        });
      });
    });
  });

  describe("given the feature resolves to a codex model and no codex handle is composed", () => {
    describe("when the handle is asked for", () => {
      /** @scenario "A codex model this process cannot execute is refused with a typed code" */
      it("refuses with model_execution_unavailable, naming the model and feature", async () => {
        await expect(getTitleModel()).rejects.toMatchObject({
          code: "model_execution_unavailable",
          meta: { model: CODEX_MODEL, featureKey: "langy.conversation_title" },
        });
      });
    });
  });

  describe("given no explicit model", () => {
    describe("when the feature-default resolver fails on infrastructure", () => {
      it("propagates the resolver's own failure instead of rescuing another model", async () => {
        const failure = new Error("database unavailable");

        await expect(
          getModel(async () => {
            throw failure;
          }),
        ).rejects.toBe(failure);
      });
    });

    describe("when no model is configured for the feature", () => {
      it("propagates model_not_configured so the missing-model prompt opens", async () => {
        await expect(
          getModel(async () => {
            throw new ModelNotConfiguredError({
              featureKey: "prompt.create_default",
              role: "DEFAULT",
              featureDisplayName: "Prompts",
              projectId: project.id,
            });
          }),
        ).rejects.toMatchObject({ code: "model_not_configured" });
      });
    });
  });
});
