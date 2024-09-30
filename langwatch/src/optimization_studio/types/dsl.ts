import type { Edge, Node } from "@xyflow/react";
import type { DatasetColumns } from "../../server/datasets/types";
import type { MODULES } from "./modules";

export type Field = {
  identifier: string;
  type:
    | "str"
    | "float"
    | "int"
    | "bool"
    | "list[str]"
    | "list[float]"
    | "list[int]"
    | "list[bool]"
    | "dict"
    | "signature"
    | "llm";
  optional?: boolean;
  defaultValue?: string;
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
  | "module"
  | "retriever"
  | "prompting_technique"
  | "evaluator";

export type BaseComponent = {
  _library_ref?: string;

  name?: string;
  cls?: string;
  parameters?: Field[];
  inputs?: Field[];
  outputs?: Field[];
  decorated_by?: {
    ref: string;
  };

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

export type Signature = BaseComponent & {
  prompt?: string;
  llm?: LLMConfig;
  demonstrations?: Record<string, any>[];
};

export type Module = BaseComponent & {
  components?: Flow["nodes"];
  forward_pass?: Flow["edges"] | { code: string };
};

export type Retriever = BaseComponent;

export type PromptingTechnique = BaseComponent;

export type Entry = BaseComponent & {
  inputs?: never;
  entry_selection: "first" | "last" | "random";
  train_test_split: number;
  seed: number;
  dataset?: {
    id?: string;
    name?: string;
    inline?: {
      records: Record<string, string[]>;
      columnTypes: DatasetColumns;
    };
  };
};

export type Evaluator = BaseComponent & MODULES["evaluator"];

export type Component = BaseComponent | Entry | Signature | Module | Evaluator;

type Flow = {
  nodes: Node<Component>[];
  edges: Edge[];
};

export type Workflow = {
  spec_version: string;
  workflow_id?: string;

  name: string;
  icon: string;
  description: string;
  version: string;

  default_llm: LLMConfig;

  nodes: Node<Component>[];
  edges: Edge[];

  state: {
    execution?: {
      status: ExecutionStatus;
      trace_id?: string;
      until_node_id?: string;
      error?: string;
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
        prompt: undefined,
        llm: undefined,
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
        decorated_by: {
          ref: "ChainOfThought-1",
        },
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
            defaultValue: "http://0.0.0.0",
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
        prompt: undefined,
        llm: undefined,
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
        decorated_by: {
          ref: "chain_of_thought_2",
        },
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
