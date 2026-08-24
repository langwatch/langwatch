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
import type { Edge, Node } from "@xyflow/react";
import { z } from "zod";

import type { LocalPromptConfig } from "~/experiments-v3/types";
import type { EvaluatorTypes } from "~/server/evaluations/evaluators";
import type { LlmConfigInputType, LlmConfigOutputType } from "~/types";

import { datasetColumnTypeSchema } from "@langwatch/dataset-contract";
import type { ChatMessage } from "../../server/tracer/types";

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
    // Legacy field from spec_version <= 1.4: every LLM node now owns its
    // config. Still accepted on input for old clients and old persisted
    // versions; migrateDSLVersion folds it into node llm parameters and
    // drops it. Never read at execution time.
    default_llm: llmConfigSchema.nullish(),
    workflow_type: z.enum(WORKFLOW_TYPES).optional(),
  })
  .passthrough();

export const LATEST_SPEC_VERSION = "1.5" as const;

export type Workflow = {
  spec_version: typeof LATEST_SPEC_VERSION;
  workflow_id?: string;
  experiment_id?: string;
  name: string;
  icon: string;
  description: string;
  version: string;
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
      /** Stable failure code — mirrors `ExecutionState.error_type`. */
      error_type?: string;
      /** Upstream HTTP status, when an HTTP node got a non-2xx. */
      upstream_status?: number;
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
      /** Stable failure code — mirrors `ExecutionState.error_type`. */
      error_type?: string;
      /** Upstream HTTP status, when an HTTP node got a non-2xx. */
      upstream_status?: number;
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
