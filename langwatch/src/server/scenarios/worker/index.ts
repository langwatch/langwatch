/**
 * Scenario Worker Module
 *
 * This module provides isolated worker-based scenario execution with proper
 * OpenTelemetry trace capture. Scenarios run in separate worker threads,
 * each with their own OTEL context that exports to LangWatch.
 *
 * @see https://github.com/langwatch/langwatch/issues/1088
 */

export { ScenarioWorkerManager } from "./scenario-worker-manager";
export type {
  HttpAgentData,
  LiteLLMParams,
  PromptConfigData,
  ScenarioWorkerData,
  ScenarioWorkerResult,
  TargetAdapterData,
  WorkerMessage,
} from "./types";
