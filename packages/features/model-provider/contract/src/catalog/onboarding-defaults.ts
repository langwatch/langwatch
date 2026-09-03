import { getModelsForProvider } from "./model-catalog";

export type ProviderOnboardingDefaultPlan = {
  DEFAULT?: string;
  FAST?: string;
  EMBEDDINGS?: string;
};

function tryGetLatestEmbedding(provider: string): string | undefined {
  const embeddings = getModelsForProvider(provider)
    .filter((model) => model.mode === "embedding")
    .map((model) => model.id)
    .sort((left, right) => embeddingVersion(right) - embeddingVersion(left));

  return embeddings[0];
}

function embeddingVersion(model: string): number {
  const suffix = model.split("/")[1] ?? "";
  return Number(/\d+/.exec(suffix)?.[0] ?? 0);
}

export function buildProviderOnboardingDefaultPlan(
  provider: string,
): ProviderOnboardingDefaultPlan {
  if (provider === "openai") {
    return {
      DEFAULT: "openai/latest",
      FAST: "openai/latest-mini",
      EMBEDDINGS: tryGetLatestEmbedding("openai"),
    };
  }
  if (provider === "anthropic") {
    return { DEFAULT: "anthropic/latest", FAST: "anthropic/latest-mini" };
  }
  if (provider === "gemini") {
    return {
      DEFAULT: "gemini/latest",
      FAST: "gemini/latest-mini",
      EMBEDDINGS: tryGetLatestEmbedding("gemini"),
    };
  }
  if (provider === "voyage") {
    return { EMBEDDINGS: tryGetLatestEmbedding("voyage") };
  }

  return {};
}
