/**
 * Instant Evals answers evaluator judges only (ADR-174 decision 11). A graph node that calls a
 * model runs on the gateway, never the judge, so a graph naming Instant Evals on one is refused.
 * Evaluator nodes keep it: the judge answers them.
 */

import {
  InstantEvalJudgeOnlyModelError,
  isInstantEvalJudgeModel,
} from "@langwatch/instant-eval-judge-contract";

type Loose = Record<string, unknown>;

const MAX_NAME_LENGTH = 48;

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

const placeOf = (node: Loose, data: Loose): string => {
  const name = typeof data.name === "string" && data.name ? data.name : String(node.id);
  const shown = name.length > MAX_NAME_LENGTH ? `${name.slice(0, MAX_NAME_LENGTH - 1)}…` : name;
  return `node "${shown}"`;
};

/** The nodes of a graph, of any shape, that call a model on Instant Evals, named for the reader. */
export function instantEvalJudgeModelNodesOf({ dsl }: { dsl: unknown }): string[] {
  const nodes = isLoose(dsl) && Array.isArray(dsl.nodes) ? dsl.nodes : [];
  return nodes.flatMap((node) => {
    if (!isLoose(node) || node.type === "evaluator" || !isLoose(node.data)) return [];
    const data = node.data;
    const onJudge = modelsOf(data).some(
      (model) => typeof model === "string" && isInstantEvalJudgeModel(model),
    );
    return onJudge ? [placeOf(node, data)] : [];
  });
}

/** Refuses a graph before it is stored, naming each node to change. */
export function assertNoInstantEvalJudgeModelNodes({ dsl }: { dsl: unknown }): void {
  const places = instantEvalJudgeModelNodesOf({ dsl });
  if (places.length > 0) throw new InstantEvalJudgeOnlyModelError({ places });
}
