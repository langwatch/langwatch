import type { Edge, Node } from "@xyflow/react";
import { z } from "zod";

import type { LocalPromptConfig } from "~/evaluations-v3/types";
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
  | "evaluator"
  | "http"
  | "agent";

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
  // Traditional sampling parameters
  top_p: z.number().optional(),
  frequency_penalty: z.number().optional(),
  presence_penalty: z.number().optional(),
  // Other sampling parameters
  seed: z.number().optional(),
  top_k: z.number().optional(),
  min_p: z.number().optional(),
  repetition_penalty: z.number().optional(),
  // Reasoning parameter (canonical/unified field)
  // Provider-specific mapping happens at runtime boundary (reasoningBoundary.ts)
  reasoning: z.string().optional(),
  // Provider-specific fields - kept for backward compatibility
  reasoning_effort: z.string().optional(), // OpenAI (legacy)
  thinkingLevel: z.string().optional(), // Gemini (legacy)
  effort: z.string().optional(), // Anthropic (legacy)
  verbosity: z.string().optional(),
  litellm_params: z.record(z.string()).optional(),
});

export type LLMConfig = z.infer<typeof llmConfigSchema>;

export type Signature = BaseComponent & {
  /** Local prompt config for unsaved prompt changes */
  localPromptConfig?: LocalPromptConfig;
  /** Reference to saved DB prompt */
  promptId?: string;
  /** Specific version reference */
  promptVersionId?: string;
};

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
      records: z.record(z.array(z.any())),
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
  evaluator?: EvaluatorTypes | `custom/${string}` | `evaluators/${string}`;
  workflowId?: string;
  data?: any;
  /** Local config for unsaved evaluator changes */
  localConfig?: { name?: string; settings?: Record<string, unknown> };
};

export type AgentComponent = BaseComponent & {
  /** Reference to DB agent: "agents/<id>" */
  agent?: string;
  /** Agent sub-type for backend execution delegation */
  agentType?: "http" | "code" | "workflow";
  /** Local config for unsaved changes */
  localConfig?: { name?: string; settings?: Record<string, unknown> };
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
  project_id: string;
  secrets?: Record<string, string>;
};

// ============================================================================
// Component Schemas for Agent Config Validation
// These schemas validate that agent configs match existing DSL node data types
// so they can be used directly when generating workflows for execution.
// ============================================================================

/**
 * Schema for Field type used in parameters, inputs, outputs
 */
export const fieldSchema = z.object({
  identifier: z.string(),
  type: z.enum(FIELD_TYPES),
  optional: z.boolean().optional(),
  value: z.unknown().optional(),
  desc: z.string().optional(),
  prefix: z.string().optional(),
  hidden: z.boolean().optional(),
  json_schema: z.object({}).passthrough().optional(),
});

/**
 * Schema for BaseComponent - the foundation of all node data types
 */
export const baseComponentSchema = z.object({
  _library_ref: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  cls: z.string().optional(),
  parameters: z.array(fieldSchema).optional(),
  inputs: z.array(fieldSchema).optional(),
  outputs: z.array(fieldSchema).optional(),
  isCustom: z.boolean().optional(),
  behave_as: z.literal("evaluator").optional(),
});

/**
 * Schema for chat messages used in signature configs
 */
export const chatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]).optional(),
  content: z.string().optional(),
});

/**
 * Schema for Signature/LlmPromptConfigComponent node data
 * Used for "signature" type agents
 *
 * Supports two storage formats:
 * 1. Top-level llm/prompt/messages (used by agent drawers)
 * 2. Parameters array with llm/instructions/messages entries (used by workflow nodes)
 */
export const signatureComponentSchema = baseComponentSchema.extend({
  configId: z.string().optional(),
  handle: z.string().nullable().optional(),
  versionMetadata: z
    .object({
      versionId: z.string(),
      versionNumber: z.number(),
      versionCreatedAt: z.string(),
    })
    .optional(),
  // Top-level LLM config (alternative to parameters array)
  llm: llmConfigSchema.optional(),
  prompt: z.string().optional(),
  messages: z.array(chatMessageSchema).optional(),
});

/**
 * Schema for the code parameter specifically
 */
export const codeParameterSchema = z.object({
  identifier: z.literal("code"),
  type: z.literal("code"),
  value: z.string(),
  optional: z.boolean().optional(),
  desc: z.string().optional(),
  prefix: z.string().optional(),
  hidden: z.boolean().optional(),
});

/**
 * Schema for Code node data
 * Used for "code" type agents
 * Requires a parameters array with at least a "code" parameter
 */
export const codeComponentSchema = baseComponentSchema.extend({
  parameters: z
    .array(z.union([codeParameterSchema, fieldSchema]))
    .refine(
      (params) =>
        params?.some((p) => p.identifier === "code" && p.type === "code"),
      {
        message: "Code component must have a 'code' parameter with type 'code'",
      },
    ),
});

/**
 * Schema for Custom/Workflow node data
 * Used for "workflow" type agents
 */
export const customComponentSchema = baseComponentSchema.extend({
  isCustom: z.boolean().optional(),
  workflow_id: z.string().optional(),
  publishedId: z.string().optional(),
  version_id: z.string().optional(),
  versions: z.record(z.any()).optional(),
});

// TODO: Move schemas and exports to their own files
/**
 * Schema for HTTP header key-value pairs
 */
export const httpHeaderSchema = z.object({
  key: z.string(),
  value: z.string(),
});

/**
 * Schema for HTTP authentication configuration
 */
export const httpAuthSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("bearer"), token: z.string() }),
  z.object({
    type: z.literal("api_key"),
    header: z.string(),
    value: z.string(),
  }),
  z.object({
    type: z.literal("basic"),
    username: z.string(),
    password: z.string(),
  }),
]);

/**
 * HTTP methods supported by HTTP agents
 */
export const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * HTTP authentication types
 */
export type HttpAuthType = "none" | "bearer" | "api_key" | "basic";
export type HttpAuth = z.infer<typeof httpAuthSchema>;
export type HttpHeader = z.infer<typeof httpHeaderSchema>;

/**
 * Schema for HTTP component node data
 * Used for "http" type agents that call external APIs
 *
 * Note: URL validation is relaxed to allow progressive typing in UI.
 * Full URL validation should happen on save in the drawer.
 */
export const httpComponentSchema = baseComponentSchema.extend({
  url: z.string().min(1, "URL is required"),
  method: z.enum(HTTP_METHODS).default("POST"),
  headers: z.array(httpHeaderSchema).optional(),
  auth: httpAuthSchema.optional(),
  bodyTemplate: z.string().optional(),
  outputPath: z.string().optional(),
  timeoutMs: z.number().positive().optional(),
});

/**
 * Union type for all valid agent config types
 * These match the existing Component types so they're directly usable in DSL
 */
export type SignatureComponentConfig = z.infer<typeof signatureComponentSchema>;
export type CodeComponentConfig = z.infer<typeof codeComponentSchema>;
export type CustomComponentConfig = z.infer<typeof customComponentSchema>;
export type HttpComponentConfig = z.infer<typeof httpComponentSchema>;
