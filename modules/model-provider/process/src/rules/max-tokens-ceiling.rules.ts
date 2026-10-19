import { findModelById, type CustomModelEntry } from "@langwatch/model-provider-contract";

type ProviderWithCustomModels = {
  customModels?: CustomModelEntry[] | null;
};

/** Vertex AI serves Google's and Anthropic's models; the catalogue lists them under those names. */
const VERTEX_AI_PUBLISHERS = ["gemini", "anthropic"] as const;

/** LLM evaluators' max_tokens default (langevals `DEFAULT_MAX_TOKENS`), above most limits. */
export const EVALUATOR_DEFAULT_MAX_TOKENS = 128_000;

/** Whether to leave max_tokens out: the evaluator default, on a model whose limit is unknown. */
export function isUnboundedEvaluatorDefault({
  value,
  ceiling,
}: {
  value: number;
  ceiling: number | undefined;
}): boolean {
  return ceiling === undefined && value === EVALUATOR_DEFAULT_MAX_TOKENS;
}

/**
 * The completion-token ceiling a model may be called with: a custom model's own limit where the
 * project declared one, and the catalogue's otherwise.
 */
export function pickMaxTokensCeiling(
  modelId: string,
  modelProvider: ProviderWithCustomModels | null | undefined,
): number | undefined {
  const [provider = ""] = modelId.split("/");
  const modelName = modelId.split("/").slice(1).join("/");
  const custom = modelProvider?.customModels?.find((entry) => entry.modelId === modelName);
  if (custom?.maxTokens && custom.maxTokens > 0) return custom.maxTokens;

  const candidates = [
    modelId,
    modelName,
    ...(provider === "vertex_ai"
      ? VERTEX_AI_PUBLISHERS.map((publisher) => `${publisher}/${modelName}`)
      : []),
  ];
  const model = candidates.map((candidate) => findModelById(candidate)[0]).find(Boolean);
  return model?.maxCompletionTokens ?? undefined;
}
