import type { Edge, Node } from "@xyflow/react";
import { z } from "zod";

import type { EvaluatorTypes } from "~/server/evaluations/evaluators.generated";
import type { LlmConfigInputType, LlmConfigOutputType } from "~/types";

import { datasetColumnTypeSchema } from "../../server/datasets/types";
import type { ChatMessage } from "../../server/tracer/types";

export const FIELD_TYPES = [
  "str",
  "image",
  "float",
  "int",
  "bool",
  "list",
  "list[str]",
  "list[float]",
  "list[int]",
  "list[bool]",
  "dict",
  "json_schema",
  "chat_messages",
  "signature",
  "llm",
  "prompting_technique",
  "dataset",
  "code",
] as const;

export type Field = {
  identifier: string;
  type: (typeof FIELD_TYPES)[number];
  optional?: boolean;
  value?: unknown;
  desc?: string;
  prefix?: string;
  hidden?: boolean;
  json_schema?: object;
};
export const WORKFLOW_TYPES = ["component", "evaluator", "workflow"] as const;
export type WorkflowTypes = (typeof WORKFLOW_TYPES)[number];

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

// Define the execution state type
export interface ExecutionState {
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
}

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

  execution_state?: ExecutionState;
};

export const llmConfigSchema = z.object({
  model: z.string(),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  litellm_params: z.record(z.string()).optional(),
});

export type LLMConfig = z.infer<typeof llmConfigSchema>;

export type Signature = BaseComponent;

type StronglyTypedFieldBase = Omit<Field, "value" | "type" | "identifier">;
/**
 * Parameter specific to LLM Configs
 */
export type LlmConfigParameter = StronglyTypedFieldBase & {
  type: "llm";
  identifier: "llm";
  value: LLMConfig;
};
/**
 * Parameter specific to Prompting Techniques
 */
type PromptingTechniqueParameter = StronglyTypedFieldBase & {
  type: "prompting_technique";
  identifier: "prompting_technique";
  value: unknown;
};

/**
 * Parameter specific to Demonstrations
 */
export type DemonstrationsParameter = StronglyTypedFieldBase & {
  type: "dataset";
  identifier: "demonstrations";
  value: NodeDataset | undefined;
};

/**
 * Parameter specific to Instructions
 */
type InstructionsParameter = StronglyTypedFieldBase & {
  type: "str";
  identifier: "instructions";
  value: string;
};

/**
 * Chat Messages parameter
 */
type MessagesParameter = StronglyTypedFieldBase & {
  type: "chat_messages";
  identifier: "messages";
  value: ChatMessage[];
};

export type LlmPromptConfigComponent = Signature & {
  // Config ID stored at root level
  configId?: string;
  handle?: string | null;

  // Version metadata (optional, for database-sourced prompts)
  versionMetadata?: {
    versionId: string;
    versionNumber: number;
    versionCreatedAt: string; // ISO string
  };

  inputs: (Omit<Field, "type"> & { type: LlmConfigInputType })[];
  outputs: (Omit<Field, "type"> & { type: LlmConfigOutputType })[];
  parameters: (
    | LlmConfigParameter
    | PromptingTechniqueParameter
    | DemonstrationsParameter
    | InstructionsParameter
    | MessagesParameter
  )[];
};

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

export const nodeDatasetSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  inline: z
    .object({
      records: z.record(z.array(z.string())),
      columnTypes: z.array(
        z.object({
          id: z.string().optional(),
          name: z.string(),
          type: datasetColumnTypeSchema,
        }),
      ),
    })
    .optional(),
});

export type NodeDataset = z.infer<typeof nodeDatasetSchema>;

export type Entry = BaseComponent & {
  inputs?: never;
  entry_selection: "first" | "last" | "random" | number;
  train_size: number;
  test_size: number;
  seed: number;
  dataset?: NodeDataset;
};

export type Evaluator = Omit<BaseComponent, "cls"> & {
  cls: string;
  evaluator?: EvaluatorTypes | `custom/${string}`;
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

type _Flow = {
  nodes: Node<Component>[];
  edges: Edge[];
};

// TODO: make this a complete replacement for Workflow below
export const workflowJsonSchema = z
  .object({
    workflow_id: z.string().optional(),
    experiment_id: z.string().optional(),
    spec_version: z.string(),
    name: z.string(),
    icon: z.string(),
    description: z.string(),
    version: z
      .string()
      .regex(
        /^\d+(\.\d+)?$/,
        "Version must be in the format 'number.number' (e.g. 1.0)",
      ),
    nodes: z.array(z.any()),
    edges: z.array(z.any()),
    default_llm: llmConfigSchema,
    workflow_type: z.enum(WORKFLOW_TYPES).optional(),
  })
  .passthrough();

export type Workflow = {
  spec_version: "1.4";
  workflow_id?: string;
  experiment_id?: string;
  name: string;
  icon: string;
  description: string;
  version: string;
  default_llm: LLMConfig;
  nodes: Node<Component>[];
  edges: Edge[];
  data?: Record<string, any>;
  template_adapter: "default" | "dspy_chat_adapter";
  enable_tracing: boolean;
  workflow_type?: WorkflowTypes;

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
