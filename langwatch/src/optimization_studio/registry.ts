import { AVAILABLE_EVALUATORS } from "../server/evaluations/evaluators.generated";
import { type Evaluator, type Signature } from "./types/dsl";
import { convertEvaluators } from "./utils/registryUtils";

const signatures: Signature[] = [
  {
    name: "LLM Signature",
    inputs: [
      {
        identifier: "question",
        type: "str",
      },
    ],
    outputs: [
      {
        identifier: "query",
        type: "str",
      },
    ],
  },
];

const ALLOWED_EVALUATORS = [
  "ragas/answer_correctness",
  "ragas/answer_relevancy",
  "langevals/basic",
  "langevals/llm_boolean",
  "langevals/llm_score",
  "lingua/language_detection",
  "azure/prompt_injection",
  "openai/moderation",
];

const evaluators: Evaluator[] = [
  {
    cls: "ExactMatchEvaluator",
    name: "ExactMatchEvaluator",
    inputs: [
      { identifier: "output", type: "str" },
      { identifier: "expected_output", type: "str" },
    ],
    outputs: [
      { identifier: "passed", type: "bool" },
      { identifier: "score", type: "float" },
    ],
  },
  ...convertEvaluators(
    Object.fromEntries(
      Object.entries(AVAILABLE_EVALUATORS)
        .filter(([cls, _evaluator]) => ALLOWED_EVALUATORS.includes(cls))
        .sort(
          ([clsA, _evaluatorA], [clsB, _evaluatorB]) =>
            ALLOWED_EVALUATORS.indexOf(clsA) - ALLOWED_EVALUATORS.indexOf(clsB)
        )
    ) as typeof AVAILABLE_EVALUATORS
  ),
];

export const MODULES = {
  signatures,
  evaluators,
};
