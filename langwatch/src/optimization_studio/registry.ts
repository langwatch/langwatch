import { AVAILABLE_EVALUATORS } from "../server/evaluations/evaluators.generated";
import {
  type Evaluator,
  type Field,
  type PromptingTechnique,
  type Retriever,
  type Signature,
} from "./types/dsl";
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

const promptingTechniques: PromptingTechnique[] = [
  {
    cls: "ChainOfThought",
    name: "ChainOfThought",
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
    parameters: [
      {
        identifier: "k",
        desc: "Number of contexts to retrieve",
        type: "int",
        defaultValue: 3,
      },
      {
        identifier: "url",
        desc: "URL of the ColBERTv2 index",
        type: "str",
        defaultValue: "http://20.102.90.50:2017/wiki17_abstracts",
      },
    ],
    ...retrieverInputsAndOutputs,
  },
  {
    cls: "WeaviateRM",
    name: "Weaviate",
    parameters: [
      {
        identifier: "k",
        desc: "Number of contexts to retrieve",
        type: "int",
        defaultValue: 3,
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
        defaultValue: "content",
      },
    ],
    ...retrieverInputsAndOutputs,
  },
];

const ALLOWED_EVALUATORS = [
  "ragas/answer_correctness",
  "ragas/answer_relevancy",
  "ragas/faithfulness",
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
    name: "Exact Match",
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
    name: "Answer Correctness",
    parameters: [{ identifier: "llm", type: "llm" }],
    inputs: [
      { identifier: "input", type: "str" },
      { identifier: "output", type: "str" },
      { identifier: "expected_output", type: "str" },
    ],
    outputs: [{ identifier: "passed", type: "bool" }],
  },
  {
    cls: "test",
    name: "test",
    inputs: [
      { identifier: "category", type: "str" },
      { identifier: "description", type: "str" },
    ],
    outputs: [{ identifier: "output", type: "str" }],
    workflowId: "test",
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
  promptingTechniques,
  evaluators,
  retrievers,
};
