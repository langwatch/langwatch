import { DEFAULT_EMBEDDINGS_MODEL, DEFAULT_MODEL } from "../../utils/constants";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorDefinition,
  type Evaluators,
  type EvaluatorTypes,
} from "./evaluators.generated";

export const getEvaluatorDefinitions = (evaluator: string) => {
  for (const [key, val] of Object.entries(AVAILABLE_EVALUATORS)) {
    if (key === evaluator) return val;
  }
  return undefined;
};

/**
 * Default settings for an evaluator's form rendering. The `model` /
 * `embeddings_model` fields default to the global DEFAULT_MODEL /
 * DEFAULT_EMBEDDINGS_MODEL constants as a UI placeholder; the actual
 * runtime model is the cascade-resolved value, but the form needs
 * SOME initial string to render the picker. Callers can override via
 * `resolvedDefault` / `resolvedEmbedding` from
 * modelProvider.getResolvedDefault when they want the placeholder to
 * mirror the resolver instead of the global constant.
 */
export const getEvaluatorDefaultSettings = <T extends EvaluatorTypes>(
  evaluator: EvaluatorDefinition<T> | undefined,
  resolved?: {
    defaultModel?: string | null;
    embeddingsModel?: string | null;
  },
) => {
  if (!evaluator) return {};
  return Object.fromEntries(
    Object.entries(evaluator.settings).map(([key, setting]) => {
      if (key === "model" && evaluator.name.includes("LLM-as-a-Judge")) {
        return [key, resolved?.defaultModel ?? DEFAULT_MODEL];
      }
      if (key === "embeddings_model") {
        return [key, resolved?.embeddingsModel ?? DEFAULT_EMBEDDINGS_MODEL];
      }
      return [key, (setting as any).default];
    }),
  ) as Evaluators[T]["settings"];
};
