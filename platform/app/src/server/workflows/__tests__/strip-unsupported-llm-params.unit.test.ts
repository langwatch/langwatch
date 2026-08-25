import type { ModelProviderExecution } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";
import { TestModelProviderService } from "../../modelProviders/__tests__/model-provider-services.test-support";
import { stripUnsupportedLLMParamsFromWorkflow } from "../stripUnsupportedLLMParams";

const executionProvider = {
  id: "mp_openai",
  organizationId: "org_1",
  provider: "openai",
  name: "OpenAI",
  enabled: true,
  routingHandle: null,
  scopes: [{ scopeType: "PROJECT", scopeId: "project_1" }],
  customKeys: { OPENAI_API_KEY: "secret" },
  customModels: [
    {
      id: "custom-chat",
      label: "Custom Chat",
      type: "chat",
      supportedParameters: ["temperature"],
    },
  ],
  customEmbeddingsModels: [],
  extraHeaders: [],
  rateLimitRpm: null,
  rateLimitTpm: null,
  rateLimitRpd: null,
  fallbackPriorityGlobal: null,
  providerConfig: null,
  deploymentMapping: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  models: null,
  embeddingsModels: null,
  isSystem: false,
  embeddingsUnsupported: false,
} satisfies ModelProviderExecution;

describe("stripUnsupportedLLMParamsFromWorkflow", () => {
  it("uses canonical execution provider custom models to remove unsupported parameters", async () => {
    const workflow = {
      nodes: [
        {
          data: {
            llm: {
              model: "openai/custom-chat",
              temperature: 0.2,
              top_p: 0.8,
            },
          },
        },
      ],
    };

    await stripUnsupportedLLMParamsFromWorkflow(
      new TestModelProviderService({ openai: executionProvider }),
      { projectId: "project_1", workflow },
    );

    expect(workflow.nodes[0]?.data?.llm).toEqual({
      model: "openai/custom-chat",
      temperature: 0.2,
    });
  });
});
