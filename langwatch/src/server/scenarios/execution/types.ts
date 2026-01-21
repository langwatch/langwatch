/**
 * Types for scenario execution.
 *
 * Interfaces are segregated by responsibility (ISP) so consumers
 * only depend on what they actually need.
 */

// ============================================================================
// Adapter Data Types
// ============================================================================

/**
 * Pre-fetched prompt configuration data for serialized execution.
 * Contains all data needed to execute prompt-based scenarios without DB access.
 */
export interface PromptConfigData {
  type: "prompt";
  promptId: string;
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Pre-fetched HTTP agent configuration for serialized execution.
 * Contains all data needed to execute HTTP-based scenarios without DB access.
 */
export interface HttpAgentData {
  type: "http";
  agentId: string;
  url: string;
  method: string;
  headers: Array<{ key: string; value: string }>;
  auth?: {
    type: string;
    token?: string;
    header?: string;
    value?: string;
    username?: string;
    password?: string;
  };
  bodyTemplate?: string;
  outputPath?: string;
}

/** Union type for all supported target adapter data */
export type TargetAdapterData = PromptConfigData | HttpAgentData;

// ============================================================================
// LiteLLM Types
// ============================================================================

/** LiteLLM proxy parameters for model access */
export interface LiteLLMParams {
  api_key: string;
  model: string;
  [key: string]: string;
}

// ============================================================================
// Segregated Interfaces (ISP)
// ============================================================================

/** Scenario definition - what to test */
export interface ScenarioConfig {
  id: string;
  name: string;
  situation: string;
  criteria: string[];
}

/** Execution context - grouping and correlation */
export interface ExecutionContext {
  projectId: string;
  scenarioId: string;
  setId: string;
  batchRunId: string;
}

/** Model configuration - LLM settings */
export interface ModelConfig {
  defaultModel: string;
  defaultParams: LiteLLMParams;
  nlpServiceUrl: string;
}

/** Telemetry configuration - where to send traces */
export interface TelemetryConfig {
  endpoint: string;
  apiKey: string;
}

/** Target configuration - what to test against */
export interface TargetConfig {
  type: "prompt" | "http";
  referenceId: string;
}

// ============================================================================
// Result Types
// ============================================================================

/** Result of scenario execution */
export interface ScenarioExecutionResult {
  success: boolean;
  runId?: string;
  reasoning?: string;
  error?: string;
}
