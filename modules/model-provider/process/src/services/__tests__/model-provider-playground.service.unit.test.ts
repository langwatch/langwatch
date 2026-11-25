import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { Project, ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

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

function service(
  getExecutionProviders: ModelProviderApi["getExecutionProviders"],
  kind = "application",
) {
  return ModelProviderPlaygroundService.create({
    modelProviders: createApiFixture<ModelProviderApi>({ getExecutionProviders }),
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
