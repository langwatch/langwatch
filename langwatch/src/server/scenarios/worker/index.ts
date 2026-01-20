/**
 * Scenario Worker Module
 *
 * This module provides isolated worker-based scenario execution with proper
 * OpenTelemetry trace capture. Scenarios run in separate worker threads,
 * each with their own OTEL context that exports to LangWatch.
 *
 * @see https://github.com/langwatch/langwatch/issues/1088
 */

export {
  ScenarioWorkerManager,
  type ScenarioWorkerManagerDeps,
} from "./scenario-worker-manager";
export { createModelFromParams } from "./model-factory";
export {
  StandalonePromptConfigAdapter,
  StandaloneHttpAgentAdapter,
} from "./standalone-adapters";
export type {
  HttpAgentData,
  LiteLLMParams,
  PromptConfigData,
  ScenarioWorkerData,
  ScenarioWorkerResult,
  TargetAdapterData,
  WorkerMessage,
} from "./types";
