import { DEFAULT_FORM_VALUES } from "~/prompts/utils/buildDefaultFormValues";
import { AVAILABLE_EVALUATORS } from "../server/evaluations/evaluators.generated";

import type {
  Code,
  Evaluator,
  Field,
  PromptingTechnique,
  Signature,
} from "./types/dsl";
import { convertEvaluators } from "./utils/registryUtils";

// Get defaults from the single source of truth
const defaults = DEFAULT_FORM_VALUES.version.configData;
const systemMessage = defaults.messages.find((m) => m.role === "system");
const messages = defaults.messages.filter((m) => m.role !== "system");
const defaultInput = defaults.inputs[0];
const defaultOutput = defaults.outputs[0];

/**
 * Default Empty LLM Signature Node
 *
 * Uses unified defaults from buildDefaultFormValues for consistency across
 * Playground, Evaluations V3, and Optimization Studio.
 */
const signature: Signature = {
  name: "Prompt",
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
      value: systemMessage!.content,
    },
    {
      identifier: "messages",
      type: "chat_messages",
      value: messages,
    },
    {
      identifier: "demonstrations",
      type: "dataset",
      value: undefined,
    },
  ],
  inputs: defaults.inputs.map((i) => ({
    identifier: i.identifier,
    type: i.type,
  })) as Field[],
  outputs: defaults.outputs.map((o) => ({
    identifier: o.identifier,
    type: o.type,
  })) as Field[],
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
    def forward(self, ${defaultInput?.identifier ?? "input"}: str):
        # Your code goes here

        return {"${defaultOutput?.identifier ?? "output"}": "Hello world!"}
`,
    },
  ],
  inputs: defaults.inputs.map((i) => ({
    identifier: i.identifier,
    type: i.type,
  })) as Field[],
  outputs: defaults.outputs.map((o) => ({
    identifier: o.identifier,
    type: o.type,
  })) as Field[],
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
