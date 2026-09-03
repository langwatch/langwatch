import {
  AVAILABLE_EVALUATORS,
  evaluatorDisplayName,
  type EvaluatorTypes,
} from "@langwatch/evaluator-contract";

import type {
  BaseComponent,
  Code,
  Evaluator,
  Field,
  PromptingTechnique,
  Signature,
} from "@langwatch/workflow-contract";

const defaults = {
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "{{input}}" },
  ],
  inputs: [{ identifier: "input", type: "str" }],
  outputs: [{ identifier: "output", type: "str" }],
};
const systemMessage = defaults.messages.find((message) => message.role === "system");
const messages = defaults.messages.filter((message) => message.role !== "system");
const defaultInput = defaults.inputs[0];
const defaultOutput = defaults.outputs[0];

/**
 * Default Empty LLM Signature Node
 *
 * Uses the portable Studio default shape shared by the node palette.
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
      value: void 0,
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
      value: void 0,
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
      value: `class Code:
    def __call__(self, ${defaultInput?.identifier ?? "input"}: str = None):
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

const studioEvaluatorFields = (fields: string[], optional = false): Field[] =>
  fields.map((identifier) => ({
    identifier,
    type:
      identifier === "contexts" || identifier === "expected_contexts"
        ? "list[str]"
        : "str",
    ...(optional ? { optional: true } : {}),
  }));

const convertStudioEvaluators = (evaluators: typeof AVAILABLE_EVALUATORS): Evaluator[] =>
  Object.entries(evaluators)
    .filter(
      ([evaluator, definition]) =>
        !definition.requiredFields.includes("conversation") &&
        !definition.optionalFields.includes("conversation") &&
        !evaluator.startsWith("example/"),
    )
    .map(([evaluator, definition]) => {
      const inputs = [
        ...studioEvaluatorFields(definition.requiredFields),
        ...studioEvaluatorFields(definition.optionalFields, true),
      ].sort(
        (left, right) =>
          [
            "conversation",
            "input",
            "contexts",
            "output",
            "expected_output",
            "expected_contexts",
          ].indexOf(left.identifier) -
          [
            "conversation",
            "input",
            "contexts",
            "output",
            "expected_output",
            "expected_contexts",
          ].indexOf(right.identifier),
      );
      const outputs: Field[] = [
        ...(definition.result.score
          ? [{ identifier: "score", type: "float" as const }]
          : []),
        ...(definition.result.passed
          ? [{ identifier: "passed", type: "bool" as const }]
          : []),
        ...(definition.result.label
          ? [{ identifier: "label", type: "str" as const }]
          : []),
      ];
      return {
        cls: "LangWatchEvaluator",
        evaluator: evaluator as EvaluatorTypes,
        name: evaluatorDisplayName(definition.name).replace("Evaluator", "").trim(),
        description: definition.description,
        inputs,
        outputs,
      };
    });

const evaluators: Evaluator[] = [
  ...convertStudioEvaluators(
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

const http: Code = {
  name: "HTTP Call",
  description: "Make an HTTP request to an external API",
  parameters: [
    {
      identifier: "url",
      type: "str",
      value: "https://api.example.com/endpoint",
    },
    { identifier: "method", type: "str", value: "POST" },
    {
      identifier: "body_template",
      type: "str",
      value: '{\n  "input": "{{input}}"\n}',
    },
    { identifier: "output_path", type: "str", value: "" },
  ],
  inputs: [{ identifier: "input", type: "str" }] as Field[],
  outputs: [{ identifier: "output", type: "str" }] as Field[],
};

const agent: BaseComponent = {
  name: "Agent",
  description: "Connect to an agent (HTTP, code, or workflow)",
  inputs: [{ identifier: "input", type: "str" }] as Field[],
  outputs: [{ identifier: "output", type: "str" }] as Field[],
};

const ifElse: BaseComponent = {
  name: "If/Else",
  description:
    "Route execution down the true or false branch based on a condition over the inputs",
  parameters: [
    {
      identifier: "condition",
      type: "str",
      value: 'input != ""',
    },
    {
      identifier: "condition_language",
      type: "str",
      value: "liquid",
    },
  ],
  inputs: [{ identifier: "input", type: "str" }] as Field[],
  // The branch handles are the contract the engine gates on - fixed
  // identifiers, not user-editable (see IfElsePropertiesPanel).
  outputs: [
    { identifier: "true", type: "bool" },
    { identifier: "false", type: "bool" },
  ] as Field[],
};

export const MODULES = {
  signature,
  code,
  http,
  agent,
  ifElse,
  promptingTechniques,
  evaluators,
};
