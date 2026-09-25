import { createApiFixture } from "@langwatch/api-fixture";
/**
 * Plain-text feature generation: the feature's model, the caller's knobs, typed failures.
 * @vitest-environment node
 */
import { ModelNotConfiguredError, type ModelProviderApi } from "@langwatch/model-provider-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { LanguageModel } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";

const ai = vi.hoisted(() => ({ generateText: vi.fn() }));

vi.mock("ai", () => ({ generateText: ai.generateText }));

import { AiCallFailureService } from "../ai-call-failure.service.ts";
import { ModelProviderExecutionHandleService } from "../model-provider-execution-handle.service.ts";
import { ModelProviderTextGenerationService } from "../model-provider-text-generation.service.ts";

function harness() {
  const execution = ModelProviderExecutionHandleService.create({
    modelProviders: createApiFixture<ModelProviderApi>(),
    projects: createApiFixture<ProjectApi>(),
    executionProxyBaseUrl: "https://nlp.example.test/go/proxy/v1",
  });
  const model: LanguageModel = "test-model";
  const resolve = vi.spyOn(execution, "resolve").mockResolvedValue(model);
  const service = ModelProviderTextGenerationService.create({
    execution,
    aiCallFailures: AiCallFailureService.create(),
  });

  return { generate: service.generate.bind(service), model, resolve };
}

const request = {
  projectId: "project_1",
  featureKey: "workflows.commit_message",
  system: "You write commit messages.",
  messages: [{ role: "user" as const, content: "the diff" }],
};

afterEach(() => {
  ai.generateText.mockReset();
  vi.restoreAllMocks();
});

describe("ModelProviderTextGenerationService", () => {
  it("runs the feature's model with the caller's limits and answers its text", async () => {
    const { generate, model, resolve } = harness();
    ai.generateText.mockResolvedValue({ text: "shorten prompt" });

    await expect(
      generate({ ...request, maxOutputTokens: 64, temperature: 0, reasoningEffort: "low" }),
    ).resolves.toEqual({ text: "shorten prompt" });

    expect(resolve).toHaveBeenCalledWith({
      projectId: "project_1",
      featureKey: "workflows.commit_message",
    });
    expect(ai.generateText).toHaveBeenCalledWith({
      model,
      system: "You write commit messages.",
      messages: [{ role: "user", content: "the diff" }],
      maxOutputTokens: 64,
      temperature: 0,
      providerOptions: { openai: { reasoningEffort: "low" } },
    });
  });

  it("refuses a provider failure as ai_call_failed", async () => {
    const { generate } = harness();
    ai.generateText.mockRejectedValue(new Error("provider 500"));

    await expect(generate(request)).rejects.toMatchObject({ code: "ai_call_failed" });
  });

  it("lets an unconfigured model refuse on its own terms", async () => {
    const { generate, resolve } = harness();
    resolve.mockRejectedValue(
      new ModelNotConfiguredError(request.featureKey, "FAST", "Commit messages", "project_1"),
    );

    await expect(generate(request)).rejects.toMatchObject({ code: "model_not_configured" });
  });
});
