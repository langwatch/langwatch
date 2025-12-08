import { AVAILABLE_EVALUATORS } from "../server/evaluations/evaluators.generated";

import type {
  Code,
  Evaluator,
  Field,
  PromptingTechnique,
  Signature,
} from "./types/dsl";
import { convertEvaluators } from "./utils/registryUtils";

/**
 * Default Empty LLM Signature Node
 *
 * This is an empty llm signature node
 * Use this when adding a new signature node to the workspace.
 */
const signature: Signature = {
  name: "LLM Node",
  description: "LLM calling node",
  parameters: [
    {
      identifier: "llm",
      type: "llm",
      value: {
        model: "openai/gpt-4o",
        temperature: 0,
        max_tokens: 2048,
      },
    },
    {
      identifier: "prompting_technique",
      type: "prompting_technique",
      value: undefined,
    },
    {
      identifier: "instructions",
      type: "str",
      value: "You are a helpful assistant.",
    },
    {
      identifier: "messages",
      type: "chat_messages",
      value: [
        {
          role: "user",
          content: "{{question}}",
        },
      ],
    },
    {
      identifier: "demonstrations",
      type: "dataset",
      value: undefined,
    },
  ],
  inputs: [
    {
      identifier: "question",
      type: "str",
    },
  ],
  outputs: [
    {
      identifier: "answer",
      type: "str",
    },
  ],
};

const code: Code = {
  name: "Code",
  description: "Python code block",
  parameters: [
    {
      identifier: "code",
      type: "code",
      value: `import dspy

class Code(dspy.Module):
    def forward(self, question: str):
        # Your code goes here

        return {"answer": "Hello world!"}
`,
    },
  ],
  inputs: [
    {
      identifier: "question",
      type: "str",
    },
  ],
  outputs: [
    {
      identifier: "answer",
      type: "str",
    },
  ],
};

const promptingTechniques: PromptingTechnique[] = [
  {
    cls: "ChainOfThought",
    name: "ChainOfThought",
    description:
      "Drag and drop to an LLM signature to add a chain of thought prompting technique, adding a reasoning step to the LLM.",
    parameters: [],
  },
];

const retrieverInputsAndOutputs: {
  inputs: Field[];
  outputs: Field[];
} = {
  inputs: [
    {
      identifier: "query",
      type: "str",
    },
  ],
  outputs: [
    {
      identifier: "contexts",
      type: "list[str]",
    },
  ],
};

const ALLOWED_EVALUATORS = [
  "langevals/exact_match",
  "langevals/llm_answer_match",
  "ragas/factual_correctness",
  "lingua/language_detection",
  "langevals/llm_boolean",
  "langevals/llm_score",
  "langevals/llm_category",
  "ragas/faithfulness",
  "ragas/context_precision",
  "ragas/context_recall",
  "ragas/context_f1",
  "ragas/response_relevancy",
  "ragas/response_context_precision",
  "ragas/response_context_recall",
  "ragas/summarization_score",
  "langevals/basic",
  "azure/prompt_injection",
  "openai/moderation",
  "presidio/pii_detection",
  "langevals/valid_format",
  "ragas/rubrics_based_scoring",
  "ragas/sql_query_equivalence",
  "ragas/bleu_score",
  "ragas/rouge_score",
];

const evaluators: Evaluator[] = [
  ...convertEvaluators(
    Object.fromEntries(
      Object.entries(AVAILABLE_EVALUATORS)
        .filter(([cls, _evaluator]) => ALLOWED_EVALUATORS.includes(cls))
        .sort(
          ([clsA, _evaluatorA], [clsB, _evaluatorB]) =>
            ALLOWED_EVALUATORS.indexOf(clsA) - ALLOWED_EVALUATORS.indexOf(clsB),
        ),
    ) as typeof AVAILABLE_EVALUATORS,
  ),
];

export const MODULES = {
  signature,
  code,
  promptingTechniques,
  evaluators,
};
