type Field = {
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
    | "signature"
    | "llm";
  optional?: boolean;
  defaultValue?: string;
  description?: string;
  prefix?: string;
  hidden?: boolean;
};

type ComponentState = "idle" | "running" | "completed" | "failed";

type BaseComponent = {
  _library_ref?: string;

  id: string;
  type: string;
  name?: string;
  cls?: string;
  parameters?: Field[];
  inputs?: Field[];
  outputs?: Field[];
  decorated_by?: {
    ref: string;
  };

  state?: {
    state: ComponentState;
    trace_id?: string;
    span_id?: string;
    error?: string;
    parameters?: Record<string, string>;
    inputs?: Record<string, string>;
    outputs?: Record<string, string>;
    position?: {
      x: number;
      y: number;
    };
    selected?: boolean;
  };
};

type Signature = BaseComponent & {
  type: "signature";
  prompt?: string;
  llm?: string;
};

type Module = BaseComponent & {
  type: "module";
  components?: Flow["nodes"];
  forward_pass?: Flow["edges"] | { code: string };
};

type Retriever = BaseComponent & {
  type: "retriever";
};

type PromptingTechnique = BaseComponent & {
  type: "prompting_technique";
};

type Entry = BaseComponent & {
  type: "entry";
  inputs?: never;
  outputs: Field[];
  dataset?: {
    ref?: string;
  };

  state?: BaseComponent["state"] & {
    dataset?: Record<string, string[]>;
  };
};

type Evaluator = BaseComponent & {
  type: "evaluator";
  inputs: (
    | { identifier: "score"; type: "float" }
    | { identifier: "passed"; type: "bool" }
    | { identifier: "label"; type: "str" }
    | { identifier: "details"; type: "str" }
  )[];
};

type Component =
  | Entry
  | Signature
  | Module
  | Evaluator
  | Retriever
  | PromptingTechnique;

type Edge = {
  from: string;
  to: string;

  state?: {
    selected?: boolean;
  };
};

type Flow = {
  nodes: Component[];
  edges: Edge[];
};

type ExecutionState = "idle" | "running" | "completed" | "failed";

type Workflow = {
  spec_version: string;

  name: string;
  description: string;
  version: string;

  default_llm?: string;

  workflow: Flow;

  state?: {
    execution: {
      state: ExecutionState;
      trace_id?: string;
      last_component_ref?: string;
      entry:
        | { method: "manual_entry" }
        | { method: "full_dataset" }
        | { method: "random_sample"; size: number };
      inputs: Record<string, Record<string, string>>;
      outputs: Record<string, Record<string, string>>;
      error?: string;
      timestamps?: {
        started_at?: number;
        finished_at?: number;
      };
    };
    experiment?: {
      experiment_id?: string;
      run_id?: string;
      run_name?: string;
      state?: ExecutionState;
      timestamps?: {
        started_at?: number;
        finished_at?: number;
      };
    };
  };
};

const LLMSignatureFlow: Flow = {
  nodes: [
    {
      id: "entry",
      type: "entry",
      outputs: [
        {
          identifier: "question",
          type: "str",
        },
      ],
    },
    {
      _library_ref: "builtin/ChainOfThought",
      id: "chain_of_thought_1",
      type: "prompting_technique",
      cls: "dspy.ChainOfThought",
    },
    {
      id: "generate_query_1",
      type: "signature",
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
    {
      _library_ref: "builtin/ColBERTv2",
      id: "colbertv2_1",
      type: "retriever",
      cls: "dspy.ColBERTv2",
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
    {
      _library_ref: "builtin/ChainOfThought",
      id: "chain_of_thought_2",
      type: "prompting_technique",
      cls: "dspy.ChainOfThought",
      inputs: [
        {
          identifier: "signature",
          type: "signature",
        },
      ],
    },
    {
      id: "generate_answer_1",
      type: "signature",
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
  ],
  edges: [
    {
      from: "entry.outputs.question",
      to: "generate_query_1.inputs.question",
    },
    {
      from: "generate_query_1.outputs.query",
      to: "colbertv2_1.inputs.query",
    },
    {
      from: "entry.outputs.question",
      to: "generate_answer_1.inputs.question",
    },
    {
      from: "colbertv2_1.outputs.passages",
      to: "generate_answer_1.inputs.contexts",
    },
  ],
};

const LLMRAGModuleFlow: Flow = {
  nodes: [
    {
      id: "entry",
      type: "entry",
      outputs: [
        {
          identifier: "question",
          type: "str",
        },
      ],
    },
    {
      id: "rag_module_1",
      name: "RAGModule",
      type: "module",
      inputs: [
        {
          identifier: "question",
          type: "str",
        },
      ],
      components: [
        {
          _library_ref: "builtin/ChainOfThought",
          id: "chain_of_thought_1",
          type: "prompting_technique",
          cls: "dspy.ChainOfThought",
        },
        {
          id: "generate_query_1",
          type: "signature",
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
        {
          _library_ref: "builtin/ColBERTv2",
          id: "colbertv2_1",
          type: "retriever",
          cls: "dspy.ColBERTv2",
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
        {
          _library_ref: "builtin/ChainOfThought",
          id: "chain_of_thought_2",
          type: "prompting_technique",
          cls: "dspy.ChainOfThought",
          inputs: [
            {
              identifier: "signature",
              type: "signature",
            },
          ],
        },
        {
          id: "generate_answer_1",
          type: "signature",
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
      ],
      forward_pass: [
        {
          from: "self.inputs.question",
          to: "generate_query_1.inputs.question",
        },
        {
          from: "generate_query_1.outputs.query",
          to: "colbertv2_1.inputs.query",
        },
        {
          from: "self.inputs.question",
          to: "generate_answer_1.inputs.question",
        },
        {
          from: "colbertv2_1.outputs.passages",
          to: "generate_answer_1.inputs.contexts",
        },
      ],
    },
  ],
  edges: [
    {
      from: "entry.outputs.question",
      to: "rag_module_1.inputs.question",
    },
  ],
};
