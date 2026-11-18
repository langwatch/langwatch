import type { ModelProviderApi, ModelProviderExecution } from "@langwatch/model-provider-contract";
import type { Project, ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelProviderPlaygroundService } from "../model-provider-playground.service.ts";

const request = {
  projectId: "project-1",
  model: "openai/gpt-5-mini",
  systemPrompt: null,
  messages: [],
};

const PROJECT: Project = {
  id: "project-1",
  name: "Project",
  slug: "project",
  apiKey: "legacy-key",
  lwqlKey: "lwql-key",
  teamId: "team-1",
  language: "en",
  framework: "other",
  kind: "application",
  firstMessage: false,
  integrated: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  userLinkTemplate: null,
  traceSharingEnabled: false,
  presenceEnabled: false,
  s3Endpoint: null,
  s3AccessKeyId: null,
  s3SecretAccessKey: null,
  s3Bucket: null,
  archivedAt: null,
  isPersonal: false,
  ownerUserId: null,
  personalFeatures: {},
  departmentId: null,
  langyEgressAllowlist: null,
  lastCodingAgentSessionAt: null,
  lastCodingAgentPullRequestAt: null,
};

const OPENAI: ModelProviderExecution = {
  id: "provider-openai",
  organizationId: "organization-1",
  provider: "openai",
  name: "OpenAI",
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
  createdAt: new Date(0),
  updatedAt: new Date(0),
  models: null,
  embeddingsModels: null,
  isSystem: false,
  embeddingsUnsupported: false,
};

function service(
  getExecutionProviders: ModelProviderApi["getExecutionProviders"],
  kind = "application",
) {
  return ModelProviderPlaygroundService.create({
    modelProviders: createApiFixture<ModelProviderApi>({
      getExecutionProviders,
      prepareExecution: async () => ({ api_key: "test-key" }),
    }),
    projects: createApiFixture<ProjectApi>({
      findById: async () => ({ ...PROJECT, kind }),
    }),
    executionProxyBaseUrl: "http://nlp.test/go/proxy/v1",
  });
}

describe("ModelProviderPlaygroundService", () => {
  it("keeps the provider-not-configured response at the app boundary", async () => {
    const result = await service(async () => ({})).execute(request);

    expect(result.status).toBe(400);
    expect(result.headers["content-type"]).toBe("application/json");
    expect(new TextDecoder().decode((await result.body[Symbol.asyncIterator]().next()).value)).toBe(
      JSON.stringify({ error: "Provider not configured: openai" }),
    );
  });

  describe("when a completion streams", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("asks the proxy for chat completions with the model a latest alias names", async () => {
      const sent: { url: string; model: string }[] = [];
      vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
        sent.push({ url, model: (JSON.parse(init.body as string) as { model: string }).model });
        return new Response("data: [DONE]\n\n", {
          headers: { "content-type": "text/event-stream" },
        });
      });

      const result = await service(async () => ({ openai: OPENAI })).execute({
        ...request,
        model: "openai/latest-mini",
        messages: [{ role: "user", content: "Hello" }],
      });
      const chunks: Uint8Array[] = [];
      for await (const chunk of result.body) chunks.push(chunk);

      expect(sent).toHaveLength(1);
      expect(sent[0]?.url).toBe("http://nlp.test/go/proxy/v1/chat/completions");
      expect(sent[0]?.model).toMatch(/^openai\//);
      expect(sent[0]?.model).not.toContain("latest");
    });
  });

  describe("when the project is an aggregate", () => {
    it("refuses with aggregate_project_is_read_only before choosing a provider", async () => {
      const asked: string[] = [];
      const playground = service(async () => {
        asked.push("providers");
        return {};
      }, "aggregate");

      await expect(playground.execute(request)).rejects.toMatchObject({
        code: "aggregate_project_is_read_only",
      });
      expect(asked).toEqual([]);
    });
  });
});
