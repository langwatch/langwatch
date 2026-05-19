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
 * Default settings for an evaluator's form rendering. `model` and
 * `embeddings_model` fields prefer the cascade-resolved values when
 * the caller provides them (from `modelProvider.getResolvedDefault`),
 * because the per-evaluator zod defaults are baked-in literals like
 * `openai/gpt-5` that don't reflect what this project / team / org
 * has actually configured. The global DEFAULT_MODEL constants remain
 * as a last-resort fallback for the case where the cascade has
 * nothing to say (e.g. server-side callers without project context).
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
      if (key === "model") {
        return [key, resolved?.defaultModel ?? DEFAULT_MODEL];
      }
      if (key === "embeddings_model") {
        return [key, resolved?.embeddingsModel ?? DEFAULT_EMBEDDINGS_MODEL];
      }
      return [key, (setting as any).default];
    }),
  ) as Evaluators[T]["settings"];
};
