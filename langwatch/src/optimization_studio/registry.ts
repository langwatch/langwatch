import { AVAILABLE_EVALUATORS } from "../server/evaluations/evaluators.generated";
import {
  type Evaluator,
  type Field,
  type PromptingTechnique,
  type Retriever,
  type Signature,
  type CustomComponent,
} from "./types/dsl";
import { convertEvaluators } from "./utils/registryUtils";

const data = {
  icon: "🧩",
  name: "ClassifyTransactions",
  edges: [
    {
      id: "xy-edge__classify_transactionoutputs.category-endinputs.output",
      type: "default",
      source: "classify_transaction",
      target: "end",
      sourceHandle: "outputs.category",
      targetHandle: "inputs.output",
    },
    {
      id: "xy-edge__classify_transactionoutputs.category-exact_matchinputs.output",
      type: "default",
      source: "classify_transaction",
      target: "exact_match",
      sourceHandle: "outputs.category",
      targetHandle: "inputs.output",
    },
    {
      id: "xy-edge__entryoutputs.Description-classify_transactioninputs.description",
      type: "default",
      source: "entry",
      target: "classify_transaction",
      sourceHandle: "outputs.Description",
      targetHandle: "inputs.description",
    },
    {
      id: "xy-edge__entryoutputs.category-exact_matchinputs.expected_output",
      type: "default",
      source: "entry",
      target: "exact_match",
      sourceHandle: "outputs.category",
      targetHandle: "inputs.expected_output",
    },
  ],
  nodes: [
    {
      id: "entry",
      data: {
        name: "Entry",
        seed: 42,
        dataset: { id: "w6NE11hPKFR1Cz9ydeofO", name: "personal_transactions" },
        outputs: [
          { type: "str", identifier: "Date" },
          { type: "str", identifier: "Description" },
          { type: "str", identifier: "Amount" },
          { type: "str", identifier: "Transaction Type" },
          { type: "str", identifier: "category" },
          { type: "str", identifier: "Account Name" },
        ],
        test_size: 0.05,
        train_size: 0.05,
        entry_selection: "random",
      },
      type: "entry",
      measured: { width: 180, height: 385 },
      position: { x: 0, y: 0 },
      selected: true,
      deletable: false,
    },
    {
      id: "classify_transaction",
      data: {
        name: "ClassifyTransaction",
        inputs: [{ type: "str", identifier: "description" }],
        prompt: "",
        outputs: [{ type: "str", identifier: "category" }],
        execution_state: {
          cost: 0.00002745,
          inputs: { description: "lol" },
          status: "success",
          outputs: { category: "slang" },
          trace_id: "trace_2ec8onmsPmAnGWDPoXl96",
          timestamps: { started_at: 1731352023297, finished_at: 1731352024128 },
        },
      },
      type: "signature",
      dragging: false,
      measured: { width: 225, height: 160 },
      position: { x: 291.4356774941994, y: -4.428816705337368 },
      selected: false,
    },
    {
      id: "exact_match",
      data: {
        cls: "ExactMatchEvaluator",
        name: "ExactMatch",
        inputs: [
          { type: "str", identifier: "output" },
          { type: "str", identifier: "expected_output" },
        ],
        outputs: [
          { type: "bool", identifier: "passed" },
          { type: "float", identifier: "score" },
        ],
        execution_state: {
          inputs: { output: "slang", expected_output: "" },
          status: "success",
          outputs: {
            cost: null,
            label: null,
            score: 0,
            passed: false,
            status: "processed",
            details: null,
          },
          trace_id: "trace_2ec8onmsPmAnGWDPoXl96",
          timestamps: { started_at: 1731352024128, finished_at: 1731352024132 },
        },
      },
      type: "evaluator",
      dragging: false,
      measured: { width: 180, height: 225 },
      position: { x: 621.1190806527039, y: 205.464137062832 },
      selected: false,
    },
    {
      id: "end",
      data: {
        name: "End",
        inputs: [{ type: "str", identifier: "output" }],
        execution_state: {
          inputs: { output: "slang" },
          status: "success",
          outputs: { output: "slang" },
          trace_id: "trace_2ec8onmsPmAnGWDPoXl96",
          timestamps: { started_at: 1731352024132, finished_at: 1731352024135 },
        },
      },
      type: "end",
      dragging: false,
      measured: { width: 180, height: 102 },
      position: { x: 637, y: -8 },
      selected: false,
      deletable: false,
    },
  ],
  state: {},
  version: "1.29",
  default_llm: {
    model: "openai/gpt-4o-mini",
    max_tokens: 2048,
    temperature: 0,
  },
  description:
    "Query transformation, vector database search and answer generation",
  workflow_id: "workflow_n5ivnYq8-0Fyo60BSXSan",
  spec_version: "1.1",
};

const signatures: Signature[] = [
  {
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
  },
];

const customComponents: CustomComponent[] = [
  {
    name: "Custom",
    inputs: [{ identifier: "question", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
    data: data,
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
  customComponents,
  promptingTechniques,
  evaluators,
  retrievers,
};
