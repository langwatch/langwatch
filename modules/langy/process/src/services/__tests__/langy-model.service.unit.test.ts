import { LANGY_CHAT_FEATURE_KEY, type ModelProviderApi } from "@langwatch/model-provider-contract";
/**
 * @vitest-environment node
 * @see specs/langy/langy-model-selection.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { LangyModelService } from "../langy-model.service.ts";
import { executionProvider } from "./execution-provider.fixture.ts";

function modelProvidersResolving(input: { model: string; enabled: boolean }): ModelProviderApi {
  const provider = input.model.split("/")[0] ?? "";

  return createApiFixture<ModelProviderApi>({
    resolveModelForFeature: async ({ featureKey }) => ({
      model: input.model,
      source: "role_default",
      scope: "project",
      feature: { key: featureKey, role: "LANGY", displayName: "Langy", description: "" },
    }),
    getExecutionProviders: async () => ({
      [provider]: executionProvider({ provider, enabled: input.enabled }),
    }),
  });
}

describe("LangyModelService", () => {
  describe("given the project's Langy model is on an enabled provider", () => {
    /** @scenario "A turn resolves the model the project configured for Langy" */
    it("resolves the model's full id", async () => {
      const asked: string[] = [];
      const fixture = modelProvidersResolving({ model: "openai/gpt-5-mini", enabled: true });
      const models = LangyModelService.create({
        modelProviders: {
          resolveModelForFeature: (input) => {
            asked.push(input.featureKey);
            return fixture.resolveModelForFeature(input);
          },
          getExecutionProviders: (input) => fixture.getExecutionProviders(input),
        },
      });

      await expect(models.resolve({ projectId: "project_1" })).resolves.toEqual({
        modelId: "openai/gpt-5-mini",
      });
      expect(asked).toEqual([LANGY_CHAT_FEATURE_KEY]);
    });
  });

  describe("given the project's Langy model is on a disabled provider", () => {
    /** @scenario "A Langy model on a disabled provider is refused" */
    it("refuses", async () => {
      const models = LangyModelService.create({
        modelProviders: modelProvidersResolving({ model: "openai/gpt-5-mini", enabled: false }),
      });

      await expect(models.resolve({ projectId: "project_1" })).rejects.toBeInstanceOf(Error);
    });
  });

  describe("given no provider row serves the resolved model", () => {
    it("refuses", async () => {
      const models = LangyModelService.create({
        modelProviders: createApiFixture<ModelProviderApi>({
          resolveModelForFeature: (input) =>
            modelProvidersResolving({
              model: "anthropic/claude",
              enabled: true,
            }).resolveModelForFeature(input),
          getExecutionProviders: async () => ({}),
        }),
      });

      await expect(models.resolve({ projectId: "project_1" })).rejects.toBeInstanceOf(Error);
    });
  });
});
