import { createApiFixture } from "@langwatch/api-fixture";
import { ModelNotConfiguredError, type ModelProviderApi } from "@langwatch/model-provider-contract";
import type { ProjectApi, ProjectWithTeam } from "@langwatch/project-contract";
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

describe("ModelProviderExecutionHandleService", () => {
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
            throw new ModelNotConfiguredError(
              "prompt.create_default",
              "DEFAULT",
              "Prompts",
              project.id,
            );
          }),
        ).rejects.toMatchObject({ code: "model_not_configured" });
      });
    });
  });
});
