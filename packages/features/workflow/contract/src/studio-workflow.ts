import {
  FIELD_TYPES as AGENT_FIELD_TYPES,
  HTTP_METHODS as AGENT_HTTP_METHODS,
  type Field as AgentField,
  type HttpAuth as AgentHttpAuth,
  type HttpAuthType as AgentHttpAuthType,
  type HttpHeader as AgentHttpHeader,
  type HttpMethod as AgentHttpMethod,
  agentChatMessageSchema,
  codeParameterSchema as agentCodeParameterSchema,
  fieldSchema as agentFieldSchema,
  httpAuthSchema as agentHttpAuthSchema,
  httpHeaderSchema as agentHttpHeaderSchema,
  llmConfigSchema as agentLlmConfigSchema,
  baseAgentConfigSchema,
  type CodeAgentConfig,
  codeAgentConfigSchema,
  type HttpAgentConfig,
  httpAgentConfigSchema,
  type SignatureAgentConfig,
  signatureAgentConfigSchema,
  type WorkflowAgentConfig,
  workflowAgentConfigSchema,
} from "@langwatch/agent-contract";
import { z } from "zod";

import type { EvaluatorTypes } from "@langwatch/evaluator-contract";
import { workflowDslSchema, type WorkflowDsl } from "./workflow";

import { datasetColumnTypeSchema } from "@langwatch/dataset-contract";

export const LlmConfigInputTypes = [
  "str",
  "float",
  "bool",
  "image",
  "list",
  "list[str]",
  "list[float]",
  "list[int]",
  "list[bool]",
  "dict",
  "chat_messages",
] as const;
export type LlmConfigInputType = (typeof LlmConfigInputTypes)[number];
export const LlmConfigOutputTypes = ["str", "float", "bool", "json_schema"] as const;
export type LlmConfigOutputType = (typeof LlmConfigOutputTypes)[number];
export type ChatMessage = { role?: "system" | "user" | "assistant"; content?: string };

const localPromptLlmConfigSchema = z.object({
  model: z.string(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
  topP: z.number().optional(),
  frequencyPenalty: z.number().optional(),
  presencePenalty: z.number().optional(),
  seed: z.number().optional(),
  topK: z.number().optional(),
  minP: z.number().optional(),
  repetitionPenalty: z.number().optional(),
  reasoning: z.string().optional(),
  verbosity: z.string().optional(),
  litellmParams: z.record(z.string(), z.string()).optional(),
});

const localPromptMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

const localPromptInputSchema = z.object({
  identifier: z.string(),
  type: z.enum([
    "str",
    "float",
    "bool",
    "image",
    "list[str]",
    "list[float]",
    "list[int]",
    "list[bool]",
    "dict",
    "list",
  ]),
});

const localPromptOutputSchema = z.object({
  identifier: z.string(),
  type: z.enum(LlmConfigOutputTypes),
  json_schema: z.unknown().optional(),
});

export const localPromptConfigSchema = z.object({
  llm: localPromptLlmConfigSchema,
  messages: z.array(localPromptMessageSchema),
  inputs: z.array(localPromptInputSchema),
  outputs: z.array(localPromptOutputSchema),
});

export type LocalPromptMessage = z.infer<typeof localPromptMessageSchema>;
export type LocalPromptLlmConfig = z.infer<typeof localPromptLlmConfigSchema>;
export type LocalPromptConfig = z.infer<typeof localPromptConfigSchema>;

export const FIELD_TYPES = AGENT_FIELD_TYPES;
export type Field = AgentField;
export const WORKFLOW_TYPES = ["component", "evaluator", "workflow"] as const;
export type WorkflowTypes = (typeof WORKFLOW_TYPES)[number];

export type ExecutionStatus =
  | "idle"
  | "waiting"
  | "running"
  | "success"
  | "error"
  // The node sat behind an if/else branch that was not taken - never
  // dispatched, zero cost.
  | "skipped";

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
  | "agent"
  // Conditional gate: evaluates a Liquid expression over its inputs
  // and routes execution down the true or false branch handle; the
  // engine skips nodes hanging off the not-taken branch.
  | "if_else";

// Define the execution state type
export interface ExecutionState {
  status: ExecutionStatus;
  trace_id?: string;
  span_id?: string;
  /**
   * The raw engineer-facing failure message — it can name a URL or a Go net
   * error, so it is never a headline.
   *
   * The studio presents from `error_type` via the registry; this string stays
   * in the node properties panel and the logs, where an engineer looks for it
   * (see ADR-045 and `utils/executionStateError`). Where there is no code — a
   * client-side timeout, the stream's top-level error frame, the optimization
   * runner — the customer gets the generic unknown state plus the trace id,
   * not this, because nothing has vetted what is in it.
   */
  error?: string;
  /**
   * Stable code for the failure — the nlpgo engine's `NodeError.Type`
   * (`http_error`, `upstream_http_error`, `llm_error`, …). Generated into
   * `nodeErrorCodes` and mapped to customer copy by the presentation
   * registry. Absent on older engines and on non-error states.
   */
  error_type?: string;
  /** The upstream HTTP status, when an HTTP node got a non-2xx response. */
  upstream_status?: number;
  parameters?: Record<string, any>;
  inputs?: Record<string, any>;
  outputs?: Record<string, any>;
  cost?: number;
  // Token usage + resolved model surfaced by the engine for LLM nodes. The
  // engine has no price table, so the cost is derived from these counts at the
  // canonical model rate (same path the trace-ingest collector uses).
  metrics?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    reasoning_tokens?: number;
    model?: string;
  };
  /**
   * What an HTTP node saw on the wire. Diagnostics for whoever is configuring
   * the endpoint, not workflow data: nothing downstream binds to it. Present
   * on a non-2xx as well as a success, since the failure is the case worth
   * reading. `rendered_body` is the request body after templating, which is
   * safe to show because the body template is the one field the engine
   * deliberately does not resolve secrets into.
   */
  http?: {
    status_code?: number;
    status_text?: string;
    response_headers?: Record<string, string>;
    rendered_body?: string;
    warnings?: string[];
  };
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

export const llmConfigSchema = agentLlmConfigSchema;

export type LLMConfig = z.infer<typeof llmConfigSchema>;

export type Signature = BaseComponent & {
  /** Local prompt config for unsaved prompt changes */
  localPromptConfig?: LocalPromptConfig;
  /** Reference to saved DB prompt */
  promptId?: string;
  /** Specific version reference */
  promptVersionId?: string;
  /**
   * Set to `true` when the dispatched config diverges from the saved
   * version (e.g. user edited inline via localPromptConfig without
   * persisting). Stamped onto the Prompt.compile span as
   * `langwatch.prompt.draft = true` so the trace-UI can surface
   * "Open <handle>:<version> (unsaved edits)" while keeping the base
   * id / handle / versionMetadata reference for resume. Omitted (not
   * `false`) on saved-version executions, matching python-sdk's
   * `_set_attribute_if_not_none` convention.
   */
  promptDraft?: boolean;
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
      records: z.record(z.string(), z.array(z.any())),
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
  /** Values from the last run-until-here dialog submission, used to
   *  prefill the next one. Persisted with the workflow like any node
   *  data. */
  manual_run_values?: Record<string, string>;
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

/**
 * Portable graph values. The contract deliberately describes the persisted
 * JSON rather than importing React Flow: the executor runs without a browser
 * graph runtime and the web package may adapt these to its own graph types.
 */
export type StudioPosition = { x: number; y: number };

export type StudioNode<T extends Component = Component> = {
  id: string;
  type?: string;
  position: StudioPosition;
  data: T;
  selected?: boolean;
  dragging?: boolean;
  measured?: { width?: number; height?: number };
  [key: string]: unknown;
};

export type StudioEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  selected?: boolean;
  [key: string]: unknown;
};

const studioPositionSchema = z.looseObject({
  x: z.number(),
  y: z.number(),
});

const executionStateSchema = z.looseObject({
  status: z.enum(["idle", "waiting", "running", "success", "error", "skipped"]),
  trace_id: z.string().optional(),
  span_id: z.string().optional(),
  error: z.string().optional(),
  error_type: z.string().optional(),
  upstream_status: z.number().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  inputs: z.record(z.string(), z.unknown()).optional(),
  outputs: z.record(z.string(), z.unknown()).optional(),
  cost: z.number().optional(),
  metrics: z
    .looseObject({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
      reasoning_tokens: z.number().optional(),
      model: z.string().optional(),
    })
    .optional(),
  timestamps: z
    .looseObject({
      started_at: z.number().optional(),
      finished_at: z.number().optional(),
    })
    .optional(),
});

const studioComponentSchema = z.looseObject({
  _library_ref: z.string().optional(),
  id: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  cls: z.string().optional(),
  parameters: z.array(agentFieldSchema).optional(),
  inputs: z.array(agentFieldSchema).optional(),
  outputs: z.array(agentFieldSchema).optional(),
  isCustom: z.boolean().optional(),
  behave_as: z.literal("evaluator").optional(),
  execution_state: executionStateSchema.optional(),
});

const studioNodeSchema = z.looseObject({
  id: z.string(),
  type: z.string().optional(),
  position: studioPositionSchema,
  data: studioComponentSchema,
  selected: z.boolean().optional(),
  dragging: z.boolean().optional(),
  measured: z
    .object({ width: z.number().optional(), height: z.number().optional() })
    .optional(),
});

const studioEdgeSchema = z.looseObject({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().nullable().optional(),
  targetHandle: z.string().nullable().optional(),
  selected: z.boolean().optional(),
});

/**
 * `WorkflowDsl` is the canonical open wire envelope owned by Workflow
 * contract. Studio needs a typed editor refinement for its known node data;
 * this schema keeps the same permissive node/edge payload while requiring the
 * fields the canvas materialises. It is not a second persisted wire format.
 */
const studioWorkflowWireSchema = workflowDslSchema
  .extend({
    workflow_id: z.string().optional(),
    experiment_id: z.string().optional(),
    spec_version: z.string(),
    name: z.string(),
    icon: z.string(),
    description: z.string(),
    version: z
      .string()
      .regex(/^\d+(\.\d+)?$/, "Version must be in the format 'number.number' (e.g. 1.0)"),
    nodes: z.array(studioNodeSchema),
    edges: z.array(studioEdgeSchema),
    // Legacy field from spec_version <= 1.4: every LLM node now owns its
    // config. Still accepted on input for old clients and old persisted
    // versions; migrateDSLVersion folds it into node llm parameters and
    // drops it. Never read at execution time.
    default_llm: llmConfigSchema.partial().nullish(),
    workflow_type: z.enum(WORKFLOW_TYPES).optional(),
    template_adapter: z.enum(["default", "dspy_chat_adapter"]).optional(),
    enable_tracing: z.boolean().optional(),
    state: z
      .looseObject({
        execution: z
          .looseObject({
            status: z.enum(["idle", "waiting", "running", "success", "error", "skipped"]),
            trace_id: z.string().optional(),
            until_node_id: z.string().optional(),
            error: z.string().optional(),
            error_type: z.string().optional(),
            upstream_status: z.number().optional(),
            result: z.record(z.string(), z.unknown()).optional(),
            timestamps: z
              .looseObject({
                started_at: z.number().optional(),
                finished_at: z.number().optional(),
              })
              .optional(),
          })
          .optional(),
        evaluation: z
          .looseObject({
            run_id: z.string().optional(),
            status: z
              .enum(["idle", "waiting", "running", "success", "error", "skipped"])
              .optional(),
            error: z.string().optional(),
            error_type: z.string().optional(),
            upstream_status: z.number().optional(),
            progress: z.number().optional(),
            total: z.number().optional(),
            timestamps: z
              .looseObject({
                started_at: z.number().optional(),
                finished_at: z.number().optional(),
                stopped_at: z.number().optional(),
              })
              .optional(),
          })
          .optional(),
        optimization: z
          .looseObject({
            run_id: z.string().optional(),
            status: z
              .enum(["idle", "waiting", "running", "success", "error", "skipped"])
              .optional(),
            stdout: z.string().optional(),
            error: z.string().optional(),
            timestamps: z
              .looseObject({
                started_at: z.number().optional(),
                finished_at: z.number().optional(),
                stopped_at: z.number().optional(),
              })
              .optional(),
          })
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const LATEST_SPEC_VERSION = "1.5" as const;

export type StudioWorkflow = Omit<
  WorkflowDsl,
  | "spec_version"
  | "workflow_id"
  | "name"
  | "icon"
  | "description"
  | "version"
  | "nodes"
  | "edges"
  | "state"
  | "workflow_type"
  | "template_adapter"
> & {
  spec_version: string;
  workflow_id?: string;
  experiment_id?: string;
  name: string;
  icon: string;
  description: string;
  version: string;
  nodes: StudioNode<Component>[];
  edges: StudioEdge[];
  data?: Record<string, any>;
  template_adapter?: "default" | "dspy_chat_adapter";
  enable_tracing?: boolean;
  workflow_type?: WorkflowTypes;
  state: {
    [key: string]: unknown;
    execution?: {
      [key: string]: unknown;
      status: ExecutionStatus;
      trace_id?: string;
      until_node_id?: string;
      error?: string;
      error_type?: string;
      upstream_status?: number;
      result?: Record<string, any>;
      timestamps?: {
        [key: string]: unknown;
        started_at?: number;
        finished_at?: number;
      };
    };
    evaluation?: {
      [key: string]: unknown;
      run_id?: string;
      status?: ExecutionStatus;
      error?: string;
      error_type?: string;
      upstream_status?: number;
      progress?: number;
      total?: number;
      timestamps?: {
        [key: string]: unknown;
        started_at?: number;
        finished_at?: number;
        stopped_at?: number;
      };
    };
    optimization?: {
      [key: string]: unknown;
      run_id?: string;
      status?: ExecutionStatus;
      stdout?: string;
      error?: string;
      timestamps?: {
        [key: string]: unknown;
        started_at?: number;
        finished_at?: number;
        stopped_at?: number;
      };
    };
  };
};

type StudioWorkflowWire = z.infer<typeof studioWorkflowWireSchema>;
type StudioWorkflowWireNode = StudioWorkflowWire["nodes"][number];
type StudioWorkflowWireEdge = StudioWorkflowWire["edges"][number];

const toStudioNode = (node: StudioWorkflowWireNode): StudioNode<Component> => ({
  ...node,
  position: { x: node.position.x, y: node.position.y },
  data: {
    ...node.data,
    execution_state: node.data.execution_state,
  },
});

const toStudioEdge = (edge: StudioWorkflowWireEdge): StudioEdge => ({ ...edge });

const toStudioState = (state: StudioWorkflowWire["state"]): StudioWorkflow["state"] => ({
  ...state,
  execution: state.execution,
  evaluation: state.evaluation,
  optimization: state.optimization,
});

export const studioWorkflowSchema = studioWorkflowWireSchema.transform<StudioWorkflow>(
  (workflow) => ({
    ...workflow,
    nodes: workflow.nodes.map(toStudioNode),
    edges: workflow.edges.map(toStudioEdge),
    state: toStudioState(workflow.state),
  }),
);

/** Parses untrusted persisted/API DSL into the typed Studio refinement. */
export const parseStudioWorkflow = (value: unknown): StudioWorkflow =>
  studioWorkflowSchema.parse(value);

export type ServerWorkflow = Omit<StudioWorkflow, "workflow_id"> & {
  api_key: string;
  workflow_id: string;
  project_id: string;
  secrets?: Record<string, string>;
};

// Agent authoring contracts are owned by packages/features/agent/contract.
// These names remain as aliases for the Studio graph while its
// broader workflow vocabulary stays app-owned.
export const fieldSchema = agentFieldSchema;
export const baseComponentSchema = baseAgentConfigSchema;
export const chatMessageSchema = agentChatMessageSchema;
export const signatureComponentSchema = signatureAgentConfigSchema;
export const codeParameterSchema = agentCodeParameterSchema;
export const codeComponentSchema = codeAgentConfigSchema;
export const customComponentSchema = workflowAgentConfigSchema;
export const httpHeaderSchema = agentHttpHeaderSchema;
export const httpAuthSchema = agentHttpAuthSchema;
export const HTTP_METHODS = AGENT_HTTP_METHODS;
export const httpComponentSchema = httpAgentConfigSchema;

export type HttpMethod = AgentHttpMethod;
export type HttpAuthType = AgentHttpAuthType;
export type HttpAuth = AgentHttpAuth;
export type HttpHeader = AgentHttpHeader;
export type SignatureComponentConfig = SignatureAgentConfig;
export type CodeComponentConfig = CodeAgentConfig;
export type CustomComponentConfig = WorkflowAgentConfig;
export type HttpComponentConfig = HttpAgentConfig;
