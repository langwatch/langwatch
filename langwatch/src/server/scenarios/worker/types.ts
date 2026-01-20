/**
 * Types for scenario worker execution with isolated OTEL context.
 *
 * These types define the serializable data passed to the worker thread
 * and the results returned from scenario execution.
 */

import type { SimulationTarget } from "~/server/api/routers/scenarios";

/**
 * Pre-fetched prompt configuration data for standalone execution.
 * Contains all data needed to execute prompt-based scenarios without DB access.
 */
export interface PromptConfigData {
  type: "prompt";
  /** The prompt ID */
  promptId: string;
  /** The system prompt content */
  systemPrompt: string;
  /** Pre-configured messages (excluding system) */
  messages: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  /** Model identifier (e.g., "openai/gpt-4") */
  model: string;
  /** Temperature for generation */
  temperature?: number;
  /** Max tokens for generation */
  maxTokens?: number;
}

/**
 * Pre-fetched HTTP agent configuration for standalone execution.
 * Contains all data needed to execute HTTP-based scenarios without DB access.
 */
export interface HttpAgentData {
  type: "http";
  /** The agent ID */
  agentId: string;
  /** HTTP endpoint URL */
  url: string;
  /** HTTP method */
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Request headers */
  headers: Array<{ key: string; value: string }>;
  /** Authentication configuration */
  auth?: {
    type: "none" | "bearer" | "api_key" | "basic";
    token?: string;
    header?: string;
    value?: string;
    username?: string;
    password?: string;
  };
  /** Request body template with placeholders */
  bodyTemplate?: string;
  /** JSONPath for extracting response content */
  outputPath?: string;
}

/**
 * Union type for all supported target adapter data.
 */
export type TargetAdapterData = PromptConfigData | HttpAgentData;

/**
 * LiteLLM proxy parameters for model access.
 */
export interface LiteLLMParams {
  api_key: string;
  model: string;
  [key: string]: string;
}

/**
 * Data passed to the scenario worker thread.
 */
export interface ScenarioWorkerData {
  /** Unique scenario ID */
  scenarioId: string;
  /** Scenario name for display */
  scenarioName: string;
  /** Scenario situation/description */
  scenarioSituation: string;
  /** Scenario set ID for grouping */
  setId: string;
  /** Batch run ID for correlation */
  batchRunId: string;
  /** Pre-fetched target adapter configuration */
  targetAdapter: TargetAdapterData;
  /** Criteria for the judge agent */
  judgeCriteria: string[];
  /** Model identifier for simulator/judge agents */
  defaultModel: string;
  /** LiteLLM params for the default model (simulator/judge) */
  defaultModelLiteLLMParams: LiteLLMParams;
  /** LiteLLM params for the target model (if prompt-based) */
  targetModelLiteLLMParams?: LiteLLMParams;
  /** LangWatch configuration */
  langwatch: {
    endpoint: string;
    apiKey: string;
  };
  /** LangWatch NLP service URL for LiteLLM proxy */
  nlpServiceUrl: string;
}

/**
 * Result returned from the scenario worker.
 */
export interface ScenarioWorkerResult {
  success: boolean;
  runId?: string;
  reasoning?: string;
  error?: string;
  metCriteria?: string[];
  unmetCriteria?: string[];
}

/**
 * Message types for worker communication.
 */
export type WorkerMessage =
  | { type: "result"; data: ScenarioWorkerResult }
  | { type: "error"; error: string; stack?: string }
  | { type: "log"; level: "info" | "warn" | "error" | "debug"; message: string };
