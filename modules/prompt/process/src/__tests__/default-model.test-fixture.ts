import { createApiFixture } from "@langwatch/api-fixture";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";

/** The model-provider peer answering every project's prompt default with one model. */
export function defaultModelFixture(model = "openai/gpt-5-mini"): ModelProviderApi {
  return createApiFixture<ModelProviderApi>({
    resolveModelForFeature: async ({ featureKey }) => ({
      model,
      source: "role_default",
      scope: "organization",
      feature: { key: featureKey, role: "DEFAULT", displayName: "Prompts", description: "" },
    }),
  });
}
