import { AVAILABLE_EVALUATORS } from "../server/evaluations/evaluators.generated";

import {
  type Code,
  type Evaluator,
  type Field,
  type PromptingTechnique,
  type Retriever,
  type Signature,
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
      value: undefined,
    },
    {
      identifier: "prompting_technique",
      type: "prompting_technique",
      value: undefined,
    },
    {
      identifier: "instructions",
      type: "str",
      value: undefined,
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

const retrievers: Retriever[] = [
  {
    cls: "ColBERTv2",
    name: "ColBERTv2",
    description: "Retriever for a ColBERTv2 vector database",
    parameters: [
      {
        identifier: "k",
        desc: "Number of contexts to retrieve",
        type: "int",
        value: 3,
      },
      {
        identifier: "url",
        desc: "URL of the ColBERTv2 index",
        type: "str",
        value: "http://20.102.90.50:2017/wiki17_abstracts",
      },
    ],
    ...retrieverInputsAndOutputs,
  },
  {
    cls: "WeaviateRM",
    name: "Weaviate",
    description: "Retriever for a Weaviate vector database",
    parameters: [
      {
        identifier: "k",
        desc: "Number of contexts to retrieve",
        type: "int",
        value: 3,
      },
      {
        identifier: "weaviate_url",
        desc: "URL of the Weaviate instance",
        type: "str",
      },
      {
        identifier: "weaviate_api_key",
        desc: "API key for the Weaviate Cloud instance",
        type: "str",
        optional: true,
      },
      {
        identifier: "weaviate_collection_name",
        desc: "Name of the Weaviate collection",
        type: "str",
      },
      {
        identifier: "weaviate_collection_text_key",
        desc: "Name of the key in the Weaviate collection that contains the text",
        type: "str",
        value: "content",
      },
      {
        identifier: "embedding_header_key",
        desc: "Name of the header key in the Weaviate for the embeddings model api key",
        type: "str",
        value: "X-Cohere-Api-Key",
      },
      {
        identifier: "embedding_header_value",
        desc: "API key for the embeddings model",
        type: "str",
        value: "xxx",
      },
    ],
    ...retrieverInputsAndOutputs,
  },
];

const ALLOWED_EVALUATORS = [
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
  {
    cls: "ExactMatchEvaluator",
    name: "Exact Match",
    description:
      "Check if the generated output exactly matches the expected output (==)",
    inputs: [
      { identifier: "output", type: "str" },
      { identifier: "expected_output", type: "str" },
    ],
    outputs: [
      { identifier: "passed", type: "bool" },
      { identifier: "score", type: "float" },
    ],
  },
  {
    cls: "AnswerCorrectnessEvaluator",
    name: "LLM Answer Match",
    description:
      "Uses an LLM to judge to check if the generated output and the expected output are the same",
    parameters: [{ identifier: "llm", type: "llm" }],
    inputs: [
      { identifier: "input", type: "str" },
      { identifier: "output", type: "str" },
      { identifier: "expected_output", type: "str" },
    ],
    outputs: [{ identifier: "passed", type: "bool" }],
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
  signature,
  code,
  promptingTechniques,
  evaluators,
  retrievers,
};
