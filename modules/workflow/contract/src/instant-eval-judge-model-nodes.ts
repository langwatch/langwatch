/**
 * Instant Evals answers LLM judges only (ADR-174 decision 11). A graph node that calls a model,
 * or an evaluator node that is not a judge, runs on the gateway, so a graph naming Instant Evals
 * on one is refused. A node naming a saved evaluator is left to that evaluator's own save.
 */

import { isInstantEvalOutsideJudge } from "@langwatch/evaluator-contract";
import {
  InstantEvalJudgeOnlyModelError,
  instantEvalJudgeOnlyPlace,
  isInstantEvalJudgeModel,
} from "@langwatch/instant-eval-judge-contract";

type Loose = Record<string, unknown>;

const isLoose = (value: unknown): value is Loose =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const modelOf = (llm: unknown): unknown => (isLoose(llm) ? llm.model : undefined);

/** Every slot a node keeps its model in: the llm parameter, the prompt draft, the legacy root. */
const modelsOf = (data: Loose): unknown[] => [
  ...(Array.isArray(data.parameters) ? data.parameters : [])
    .filter((parameter) => isLoose(parameter) && parameter.type === "llm")
    .map((parameter) => modelOf((parameter as Loose).value)),
  modelOf(data.llm),
  isLoose(data.localPromptConfig) ? modelOf(data.localPromptConfig.llm) : undefined,
];

/** The model slots of an evaluator node: its model setting, as saved or still unsaved. */
const evaluatorModelsOf = (data: Loose): unknown[] => [
  ...(Array.isArray(data.parameters) ? data.parameters : [])
    .filter((parameter) => isLoose(parameter) && parameter.identifier === "model")
    .map((parameter) => (parameter as Loose).value),
  isLoose(data.localConfig) && isLoose(data.localConfig.settings)
    ? data.localConfig.settings.model
    : undefined,
];

/** Whether an evaluator node with an inline type that is not a judge names Instant Evals. */
const isEvaluatorOutsideJudge = (data: Loose): boolean => {
  const evaluatorType = data.evaluator;
  if (typeof evaluatorType !== "string" || evaluatorType.startsWith("evaluators/")) return false;
  return evaluatorModelsOf(data).some((model) =>
    isInstantEvalOutsideJudge({ evaluatorType, model }),
  );
};

const placeOf = (node: Loose, data: Loose): string => {
  const name = typeof data.name === "string" && data.name ? data.name : String(node.id);
  return instantEvalJudgeOnlyPlace({ kind: "node", name });
};

/** The nodes of a graph, of any shape, on Instant Evals outside a judge, named for the reader. */
export function instantEvalJudgeModelNodesOf({ dsl }: { dsl: unknown }): string[] {
  const nodes = isLoose(dsl) && Array.isArray(dsl.nodes) ? dsl.nodes : [];
  return nodes.flatMap((node) => {
    if (!isLoose(node) || !isLoose(node.data)) return [];
    const data = node.data;
    const outsideJudge =
      node.type === "evaluator"
        ? isEvaluatorOutsideJudge(data)
        : modelsOf(data).some(
            (model) => typeof model === "string" && isInstantEvalJudgeModel(model),
          );
    return outsideJudge ? [placeOf(node, data)] : [];
  });
}

/** Refuses a graph before it is stored, naming each node to change. */
export function assertNoInstantEvalJudgeModelNodes({ dsl }: { dsl: unknown }): void {
  const places = instantEvalJudgeModelNodesOf({ dsl });
  if (places.length > 0) throw new InstantEvalJudgeOnlyModelError({ places });
}
