import { DEFAULT_EMBEDDINGS_MODEL, DEFAULT_MODEL } from "../../utils/constants";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorDefinition,
  type EvaluatorTypes,
  type Evaluators,
} from "./evaluators.generated";

export const getEvaluatorDefinitions = (evaluator: string) => {
  for (const [key, val] of Object.entries(AVAILABLE_EVALUATORS)) {
    if (key === evaluator) return val;
  }
  return undefined;
};

export const getEvaluatorDefaultSettings = <T extends EvaluatorTypes>(
  evaluator: EvaluatorDefinition<T> | undefined,
  project?: { defaultModel?: string | null; embeddingsModel?: string | null },
  useAtlaModelForJudges?: boolean
) => {
  if (!evaluator) return {};
  return Object.fromEntries(
    Object.entries(evaluator.settings).map(([key, setting]) => {
      if (key === "model" && evaluator.name.includes("LLM-as-a-Judge")) {
        if (useAtlaModelForJudges) {
          return [key, "atla/atla-selene"];
        }
        return [key, project?.defaultModel ?? DEFAULT_MODEL];
      }
      if (key === "embeddings_model") {
        return [key, project?.embeddingsModel ?? DEFAULT_EMBEDDINGS_MODEL];
      }
      return [key, (setting as any).default];
    })
  ) as Evaluators[T]["settings"];
};
