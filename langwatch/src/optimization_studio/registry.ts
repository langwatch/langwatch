import { AVAILABLE_EVALUATORS } from "../server/evaluations/evaluators.generated";
import {
  type BaseComponent,
  type Code,
  type Evaluator,
  type Field,
  type PromptingTechnique,
  type Retriever,
  type Signature,
} from "./types/dsl";
import { convertEvaluators } from "./utils/registryUtils";

const signature: Signature = {
  name: "LLM Signature",
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
  "ragas/answer_correctness",
  "ragas/answer_relevancy",
  "ragas/faithfulness",
  "ragas/context_relevancy",
  "ragas/context_utilization",
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
