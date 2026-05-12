/**
 * Interfaces for scenario execution orchestrator dependencies.
 *
 * All dependencies are expressed as interfaces for Dependency Inversion.
 * This enables testing with test doubles and swapping implementations.
 */

import type { AgentAdapter } from "@langwatch/scenario";
import type {
  ExecutionContext,
  LiteLLMParams,
  ScenarioConfig,
  ScenarioExecutionResult,
  TargetConfig,
  TelemetryConfig,
} from "./types";
import type { ModelParamsProvider, ModelParamsResult } from "./data-prefetcher";
export type { ModelParamsProvider, ModelParamsResult };

/** Fetches scenario configuration by ID */
export interface ScenarioRepository {
  getById(params: {
    projectId: string;
    id: string;
  }): Promise<ScenarioConfig | null>;
}

/** Fetches project configuration */
export interface ProjectRepository {
  getProject(projectId: string): Promise<{
    apiKey: string;
    defaultModel: string | null;
  } | null>;
}

/** Creates target adapters */
export interface AdapterFactory {
  create(context: {
    projectId: string;
    target: TargetConfig;
    modelParams: LiteLLMParams;
    nlpServiceUrl: string;
  }): Promise<
    | { success: true; adapter: AgentAdapter }
    | { success: false; error: string }
  >;
}

/** Handle for managing tracer lifecycle */
export interface TracerHandle {
  shutdown(): Promise<void>;
}

/** Creates tracers for scenario execution */
export interface TracerFactory {
  create(config: TelemetryConfig & { scenarioId: string; batchRunId: string; projectId: string }): TracerHandle;
}

/** Executes scenarios using the SDK */
export interface ScenarioExecutor {
  run(
    scenario: ScenarioConfig,
    adapter: AgentAdapter,
    modelParams: LiteLLMParams,
    nlpServiceUrl: string,
    batchRunId: string,
    telemetry?: { endpoint: string; apiKey: string },
  ): Promise<ScenarioExecutionResult>;
}

/** All dependencies needed by the orchestrator */
export interface OrchestratorDependencies {
  scenarioRepository: ScenarioRepository;
  projectRepository: ProjectRepository;
  modelParamsProvider: ModelParamsProvider;
  adapterFactory: AdapterFactory;
  tracerFactory: TracerFactory;
  scenarioExecutor: ScenarioExecutor;
  nlpServiceUrl: string;
  telemetryEndpoint: string;
}

/** Input for scenario execution */
export interface ExecutionInput {
  context: ExecutionContext;
  target: TargetConfig;
}
