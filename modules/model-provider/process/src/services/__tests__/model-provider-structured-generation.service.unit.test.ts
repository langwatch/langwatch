/**
 * Structured feature generation stays portable at the contract boundary.
 * @vitest-environment node
 */
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { LanguageModel } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const ai = vi.hoisted(() => ({ generateObject: vi.fn() }));

vi.mock("ai", () => ({ generateObject: ai.generateObject }));

import { ModelProviderExecutionHandleService } from "../model-provider-execution-handle.service.ts";
import { ModelProviderStructuredGenerationService } from "../model-provider-structured-generation.service.ts";

const resultSchema = z.object({ name: z.string() });

function harness() {
  const execution = ModelProviderExecutionHandleService.create({
    modelProviders: createApiFixture<ModelProviderApi>(),
    projects: createApiFixture<ProjectApi>(),
    executionProxyBaseUrl: "https://nlp.example.test/go/proxy/v1",
  });
  const model: LanguageModel = "test-model";
  const resolve = vi.spyOn(execution, "resolve").mockResolvedValue(model);
  const service = ModelProviderStructuredGenerationService.create({ execution });

  return {
    generate: service.generate.bind(service),
    model,
    resolve,
  };
}

afterEach(() => {
  ai.generateObject.mockReset();
  vi.restoreAllMocks();
});

describe("ModelProviderStructuredGenerationService", () => {
  it("resolves the project's feature model, passes the timeout to the SDK, and returns parsed data", async () => {
    const { generate, model, resolve } = harness();
    const timeout = vi.spyOn(AbortSignal, "timeout");
    ai.generateObject.mockResolvedValue({ object: { name: "Refund request" } });

    await expect(
      generate({
        projectId: "project_1",
        featureKey: "scenarios.generator",
        schema: resultSchema,
        system: "You generate scenarios.",
        prompt: "A refund request",
        maxRetries: 1,
        timeoutMs: 2,
      }),
    ).resolves.toEqual({ name: "Refund request" });

    expect(resolve).toHaveBeenCalledWith({
      projectId: "project_1",
      featureKey: "scenarios.generator",
    });
    expect(ai.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        model,
        schema: resultSchema,
        system: "You generate scenarios.",
        prompt: "A refund request",
        maxRetries: 1,
        abortSignal: expect.any(AbortSignal),
      }),
    );
    expect(timeout).toHaveBeenCalledWith(2);
  });

  it("refuses an SDK object that does not satisfy the portable schema", async () => {
    const { generate } = harness();
    ai.generateObject.mockResolvedValue({ object: { name: 42 } });

    await expect(
      generate({
        projectId: "project_1",
        featureKey: "scenarios.generator",
        schema: resultSchema,
        system: "You generate scenarios.",
        prompt: "A refund request",
        maxRetries: 1,
        timeoutMs: 5,
      }),
    ).rejects.toBeInstanceOf(z.ZodError);
  });
});
