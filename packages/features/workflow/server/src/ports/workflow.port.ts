import type {
  LLMConfig,
  StudioClientEvent,
  StudioWorkflow,
  WorkflowDsl,
  WorkflowRunOrigin,
  WorkflowVersion,
} from "@langwatch/workflow-contract";

export type WorkflowExecutionInput = {
  projectId: string;
  workflowId: string;
  version: WorkflowVersion;
  inputs: Record<string, unknown>;
  doNotTrace?: boolean;
  runEvaluations?: boolean;
  origin?: WorkflowRunOrigin;
  causalityDepth?: number;
  parentTrace?: { traceId: string; parentSpanId: string };
};

/** Execution is infrastructure: the feature supplies a dispatch port. */
export abstract class WorkflowExecutionPort {
  abstract execute(input: WorkflowExecutionInput): Promise<unknown>;
}

export type WorkflowNlpDispatchInput = {
  projectId: string;
  body: StudioClientEvent;
  origin: WorkflowRunOrigin;
  causalityDepth?: number;
  parentTrace?: { traceId: string; parentSpanId: string };
};

export type WorkflowNlpDispatchResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
};

export abstract class WorkflowNlpRuntimePort {
  abstract dispatch(input: WorkflowNlpDispatchInput): Promise<WorkflowNlpDispatchResponse>;
}

export abstract class WorkflowIdPort {
  abstract next(): string;
}

/** Upgrades a persisted graph before it becomes the workflow's current version. */
export abstract class WorkflowDslMigrationPort {
  abstract migrate(dsl: WorkflowDsl): WorkflowDsl;
}

/** Project credentials and decrypted secrets are application infrastructure. */
export abstract class WorkflowProjectEnvironmentPort {
  abstract get(input: {
    projectId: string;
  }): Promise<{ apiKey: string; secrets: Record<string, string> }>;
}

export type WorkflowLlmParameterResolution = {
  model: string;
  provider: string;
  configured: boolean;
  enabled: boolean;
  litellmParams?: Record<string, string>;
};

/** Resolves process-specific LiteLLM credentials without exposing provider rows. */
export abstract class WorkflowLlmParametersPort {
  abstract resolve(input: {
    projectId: string;
    models: readonly LLMConfig["model"][];
  }): Promise<readonly WorkflowLlmParameterResolution[]>;
}

/**
 * Application-owned preparation of a Studio graph before it is persisted.
 *
 * Two steps the host owns rather than the feature: editor-only local node
 * configuration is folded into the execution DSL, and every LLM node without a
 * model is filled in from the project's providers. The second reaches the
 * host's model cascade and its registry flagship, so the whole preparation is
 * one port rather than a rule split across the boundary.
 */
export abstract class WorkflowStudioDslPort {
  abstract prepare(input: { projectId: string; dsl: StudioWorkflow }): Promise<StudioWorkflow>;
}

/**
 * The agent-mapping recompute a saved Studio graph triggers.
 *
 * Best effort and outside the save: the agents whose scenario mappings this
 * refreshes are the host's rows, and a failure to refresh them must never fail
 * the version that was already written.
 */
export abstract class WorkflowAgentMappingPort {
  abstract recompute(input: {
    projectId: string;
    workflowId: string;
    dsl: StudioWorkflow;
  }): Promise<void>;
}

/** The stored workflow a copy lands in, before its first version exists. */
export type WorkflowRowDraft = {
  id: string;
  projectId: string;
  name: string;
  icon: string;
  description: string;
  isEvaluator: boolean;
  isComponent: boolean;
  copiedFromWorkflowId: string;
};

/**
 * Writes the bare workflow row a Studio copy lands in.
 *
 * A copy is two writes with the caller's own step between them: the row, then
 * a version the caller commits once it has finished rewriting the graph. The
 * lifecycle's own `copy` writes both at once, so this is the seam that keeps
 * the two-step available without duplicating the version rules.
 */
export abstract class WorkflowRowPort {
  abstract create(input: WorkflowRowDraft): Promise<void>;
}
