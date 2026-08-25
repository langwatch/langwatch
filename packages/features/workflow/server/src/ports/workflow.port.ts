import type { DatasetService } from "@langwatch/dataset-contract";
import type {
  LLMConfig,
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

/** The service accepts canonical feature services, never their repositories. */
export type WorkflowDependencies = {
  datasets: DatasetService;
  execution?: WorkflowExecutionPort;
  dslMigration: WorkflowDslMigrationPort;
  projectEnvironment: WorkflowProjectEnvironmentPort;
  llmParameters: WorkflowLlmParametersPort;
};
