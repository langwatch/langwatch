import type { Edge, Node } from "@xyflow/react";
import type { DatasetColumns } from "../../server/datasets/types";

export type Field = {
  identifier: string;
  type:
    | "str"
    | "image"
    | "float"
    | "int"
    | "bool"
    | "list"
    | "list[str]"
    | "list[float]"
    | "list[int]"
    | "list[bool]"
    | "dict"
    | "signature"
    | "llm"
    | "prompting_technique"
    | "dataset"
    | "code";
  optional?: boolean;
  value?: unknown;
  desc?: string;
  prefix?: string;
  hidden?: boolean;
};

export type ExecutionStatus =
  | "idle"
  | "waiting"
  | "running"
  | "success"
  | "error";

export type ComponentType =
  | "entry"
  | "end"
  | "signature"
  | "code"
  | "retriever"
  | "prompting_technique"
  | "custom"
  | "evaluator";

export type BaseComponent = {
  _library_ref?: string;
  id?: string;
  name?: string;
  description?: string;
  cls?: string;
  parameters?: Field[];
  inputs?: Field[];
  outputs?: Field[];
  isCustom?: boolean;
  behave_as?: "evaluator";

  execution_state?: {
    status: ExecutionStatus;
    trace_id?: string;
    span_id?: string;
    error?: string;
    parameters?: Record<string, any>;
    inputs?: Record<string, any>;
    outputs?: Record<string, any>;
    cost?: number;
    timestamps?: {
      started_at?: number;
      finished_at?: number;
    };
  };
};

export type LLMConfig = {
  model: string;
  temperature?: number;
  max_tokens?: number;
  litellm_params?: Record<string, string>;
};

export type Signature = BaseComponent;

export type Code = BaseComponent;

export type Custom = BaseComponent & {
  isCustom?: boolean;
  workflow_id?: string;
  publishedId?: string;
  version_id?: string;
  versions?: Record<string, any>;
};

export type Retriever = BaseComponent;

export type PromptingTechnique = BaseComponent;

export type NodeDataset = {
  id?: string;
  name?: string;
  inline?: {
    records: Record<string, string[]>;
    columnTypes: DatasetColumns;
  };
};

export type Entry = BaseComponent & {
  inputs?: never;
  entry_selection: "first" | "last" | "random";
  train_size: number;
  test_size: number;
  seed: number;
  dataset?: NodeDataset;
};

export type Evaluator = Omit<BaseComponent, "cls"> & {
  cls: string;
  evaluator?: string;
  workflowId?: string;
  data?: any;
};

export type End = BaseComponent & {
  outputs?: never;
  isEvaluator?: boolean;
};

export type Component =
  | BaseComponent
  | Entry
  // eslint-disable-next-line
  | Signature
  // eslint-disable-next-line
  | Code
  | Evaluator
  | End
  | Custom;

type Flow = {
  nodes: Node<Component>[];
  edges: Edge[];
};

export type Workflow = {
  spec_version: "1.2";
  workflow_id?: string;
  name: string;
  icon: string;
  description: string;
  version: string;
  default_llm: LLMConfig;
  nodes: Node<Component>[];
  edges: Edge[];
  data?: Record<string, any>;

  state: {
    execution?: {
      status: ExecutionStatus;
      trace_id?: string;
      until_node_id?: string;
      error?: string;
      result?: Record<string, any>;
      timestamps?: {
        started_at?: number;
        finished_at?: number;
      };
    };
    evaluation?: {
      experiment_slug?: string;
      run_id?: string;
      status?: ExecutionStatus;
      error?: string;
      progress?: number;
      total?: number;
      timestamps?: {
        started_at?: number;
        finished_at?: number;
        stopped_at?: number;
      };
    };
    optimization?: {
      experiment_slug?: string;
      run_id?: string;
      status?: ExecutionStatus;
      stdout?: string;
      error?: string;
      timestamps?: {
        started_at?: number;
        finished_at?: number;
        stopped_at?: number;
      };
    };
  };
};

export type ServerWorkflow = Omit<Workflow, "workflow_id"> & {
  api_key: string;
  workflow_id: string;
};

const LLMSignatureFlow: Flow = {
  nodes: [
    {
      id: "entry",
      type: "entry",
      position: {
        x: 0,
        y: 0,
      },
      data: {
        name: "Entry",
        outputs: [
          {
            identifier: "question",
            type: "str",
          },
        ],
      },
    },
    {
      id: "chain_of_thought_1",
      type: "prompting_technique",
      position: {
        x: 0,
        y: 0,
      },
      data: {
        name: "ChainOfThought",
        _library_ref: "builtin/ChainOfThought",
        cls: "ChainOfThought",
      },
    },
    {
      id: "generate_query_1",
      type: "signature",
      position: {
        x: 0,
        y: 0,
      },
      data: {
        name: "GenerateQuery",
        parameters: [
          {
            identifier: "prompt",
            type: "str",
            value: "",
          },
          {
            identifier: "llm",
            type: "llm",
            value: undefined,
          },
          {
            identifier: "prompting_technique",
            type: "prompting_technique",
            value: {
              ref: "chain_of_thought_1",
            },
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
            identifier: "query",
            type: "str",
          },
        ],
      },
    },
    {
      id: "colbertv2_1",
      type: "retriever",
      position: {
        x: 0,
        y: 0,
      },
      data: {
        name: "ColBERTv2",
        _library_ref: "builtin/ColBERTv2",
        cls: "ColBERTv2",
        parameters: [
          {
            identifier: "url",
            type: "str",
            value: "http://0.0.0.0",
          },
        ],
        inputs: [
          {
            identifier: "query",
            type: "str",
          },
        ],
        outputs: [
          {
            identifier: "passages",
            type: "list[str]",
          },
        ],
      },
    },
    {
      id: "chain_of_thought_2",
      type: "prompting_technique",
      position: {
        x: 0,
        y: 0,
      },
      data: {
        name: "ChainOfThought",
        _library_ref: "builtin/ChainOfThought",
        cls: "ChainOfThought",
        inputs: [
          {
            identifier: "signature",
            type: "signature",
          },
        ],
      },
    },
    {
      id: "generate_answer_1",
      type: "signature",
      position: {
        x: 0,
        y: 0,
      },
      data: {
        name: "GenerateAnswer",
        parameters: [
          {
            identifier: "prompt",
            type: "str",
            value: "",
          },
          {
            identifier: "llm",
            type: "llm",
            value: undefined,
          },
          {
            identifier: "prompting_technique",
            type: "prompting_technique",
            value: {
              ref: "chain_of_thought_2",
            },
          },
        ],
        inputs: [
          {
            identifier: "question",
            type: "str",
          },
          {
            identifier: "contexts",
            type: "list[str]",
          },
        ],
        outputs: [
          {
            identifier: "answer",
            type: "str",
          },
        ],
      },
    },
  ],
  edges: [
    {
      id: "entry_to_generate_query_1",
      source: "entry",
      sourceHandle: "outputs.question",
      target: "generate_query_1",
      targetHandle: "inputs.question",
    },
    {
      id: "generate_query_1_to_colbertv2_1",
      source: "generate_query_1",
      sourceHandle: "outputs.query",
      target: "colbertv2_1",
      targetHandle: "inputs.query",
    },
    {
      id: "entry_to_generate_answer_1",
      source: "entry",
      sourceHandle: "outputs.question",
      target: "generate_answer_1",
      targetHandle: "inputs.question",
    },
    {
      id: "colbertv2_1_to_generate_answer_1",
      source: "colbertv2_1",
      sourceHandle: "outputs.passages",
      target: "generate_answer_1",
      targetHandle: "inputs.contexts",
    },
  ],
};

// const LLMRAGModuleFlow: Flow = {
//   nodes: [
//     {
//       id: "entry",
//       type: "entry",
//       outputs: [
//         {
//           identifier: "question",
//           type: "str",
//         },
//       ],
//     },
//     {
//       id: "rag_module_1",
//       name: "RAGModule",
//       type: "module",
//       inputs: [
//         {
//           identifier: "question",
//           type: "str",
//         },
//       ],
//       components: [
//         {
//           _library_ref: "builtin/ChainOfThought",
//           id: "chain_of_thought_1",
//           type: "prompting_technique",
//           cls: "ChainOfThought",
//         },
//         {
//           id: "generate_query_1",
//           type: "signature",
//           name: "GenerateQuery",
//           prompt: undefined,
//           llm: undefined,
//           inputs: [
//             {
//               identifier: "question",
//               type: "str",
//             },
//           ],
//           outputs: [
//             {
//               identifier: "query",
//               type: "str",
//             },
//           ],
//           decorated_by: {
//             ref: "ChainOfThought-1",
//           },
//         },
//         {
//           _library_ref: "builtin/ColBERTv2",
//           id: "colbertv2_1",
//           type: "retriever",
//           cls: "ColBERTv2",
//           parameters: [
//             {
//               identifier: "url",
//               type: "str",
//               defaultValue: "http://0.0.0.0",
//             },
//           ],
//           inputs: [
//             {
//               identifier: "query",
//               type: "str",
//             },
//           ],
//           outputs: [
//             {
//               identifier: "passages",
//               type: "list[str]",
//             },
//           ],
//         },
//         {
//           _library_ref: "builtin/ChainOfThought",
//           id: "chain_of_thought_2",
//           type: "prompting_technique",
//           cls: "ChainOfThought",
//           inputs: [
//             {
//               identifier: "signature",
//               type: "signature",
//             },
//           ],
//         },
//         {
//           id: "generate_answer_1",
//           type: "signature",
//           name: "GenerateAnswer",
//           prompt: undefined,
//           llm: undefined,
//           inputs: [
//             {
//               identifier: "question",
//               type: "str",
//             },
//             {
//               identifier: "contexts",
//               type: "list[str]",
//             },
//           ],
//           outputs: [
//             {
//               identifier: "answer",
//               type: "str",
//             },
//           ],
//           decorated_by: {
//             ref: "chain_of_thought_2",
//           },
//         },
//       ],
//       forward_pass: [
//         {
//           source: "self.inputs.question",
//           target: "generate_query_1.inputs.question",
//         },
//         {
//           source: "generate_query_1.outputs.query",
//           target: "colbertv2_1.inputs.query",
//         },
//         {
//           source: "self.inputs.question",
//           target: "generate_answer_1.inputs.question",
//         },
//         {
//           source: "colbertv2_1.outputs.passages",
//           target: "generate_answer_1.inputs.contexts",
//         },
//       ],
//     },
//   ],
//   edges: [
//     {
//       source: "entry.outputs.question",
//       target: "rag_module_1.inputs.question",
//     },
//   ],
// };
