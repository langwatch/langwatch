export { PrismaScenarioAdapter } from "./adapters/prisma.scenario.adapter";
export * from "./ports/cancellation-channel.port";
export * from "./ports/scenario-clock.port";
export * from "./ports/scenario-child-bootstrap.port";
export * from "./ports/scenario-http.port";
export * from "./ports/scenario-id.port";
export * from "./ports/scenario-execution-runner.port";
export * from "./ports/scenario-execution-pool.port";
export * from "./ports/scenario-processor-metrics.port";
export * from "./ports/scenario-secret-cipher.port";
export * from "./ports/scenario-tab-store.port";
export * from "./services/scenario-execution-pool.service";
export * from "./services/scenario-execution.service";
export * from "./services/scenario-execution-prefetcher.service";
export {
  AgentTestService,
  type AgentTestRunResult,
  type AgentTestServiceOptions,
  type AgentTestTurnResult,
} from "./services/agent-test.service";
export {
  AgentTestOwnershipPort,
  type AgentTestOwnershipSubject,
} from "./ports/agent-test-ownership.port";
export {
  AgentTestConnectedDispatchPort,
  type AgentTestConnectedDispatchResult,
  type AgentTestConnectedInstance,
} from "./ports/agent-test-connected-dispatch.port";
export * from "./services/scenario-failure-handler.service";
export * from "./services/scenario-processor.service";
export * from "./services/scenario-tab-registry.service";
export * from "./adapters/child-logger.adapter";
export * from "./adapters/child-process-spawn.adapter";
export * from "./adapters/child-tls-env.adapter";
export * from "./adapters/http-auth.adapter";
export * from "./adapters/litellm-model.adapter";
export * from "./adapters/node-scenario-child-process.adapter";
export * from "./adapters/prompt-template.adapter";
export * from "./adapters/remote-trace-run.adapter";
export * from "./adapters/redis.cancellation-channel.adapter";
export * from "./adapters/redis.scenario-tab-store.adapter";
export * from "./adapters/scenario-child-execution.adapter";
export * from "./adapters/scenario-role-model.adapter";
export * from "./adapters/scenario-secret-reference.adapter";
export * from "./adapters/serialized-agent-registry.adapter";
export * from "./adapters/serialized-code-agent.adapter";
export * from "./adapters/serialized-http-agent.adapter";
export * from "./adapters/serialized-prompt-config.adapter";
export * from "./adapters/serialized-workflow-agent.adapter";
export * from "./services/scenario-workflow-mapping.service";
export { SimulationClickHouseAdapter } from "./adapters/simulation.clickhouse.adapter";
export type { SimulationReadClient } from "./adapters/simulation.clickhouse.adapter";
export {
  SimulationRunMetricsStoreAdapter,
  SimulationRunStateStoreAdapter,
  SimulationStalledRunAdapter,
  BACKFILL_STALE_THRESHOLD_MS,
  type SimulationStalledRun,
} from "./adapters/simulation-eventing.adapter";
export { SimulationExecutionPort } from "./ports/simulation-execution.port";
export type { SimulationRunStateData } from "./projections/simulation-run-state.projection";
export * from "./processes/simulation-run-execution.process";
export {
  SimulationWindowedReadPort,
  type SimulationWindowedReadInput,
} from "./ports/simulation-windowed-read.port";
export { SimulationService } from "./services/simulation.service";
export { STALL_THRESHOLD_MS } from "./processes/simulation-run-execution-evolution.process";
export * from "./adapters/simulation-processing-commands.adapter";
export {
  COMPUTE_METRICS_RETRY_DELAY_MS,
  ComputeRunMetricsAdapter,
  ComputeRunMetricsCommand,
  scenarioDeferredComputeRunMetricsJob,
} from "./adapters/compute-run-metrics.adapter";
export type { ComputeRunMetricsDeps } from "./adapters/compute-run-metrics.adapter";
export { FinishRunCommand, type FinishRunDeps } from "./adapters/finish-run.adapter";
export {
  CANCELLATION_CHANNEL,
  RedisCancellationPublisherAdapter,
  UnavailableCancellationPublisherAdapter,
  type CancellationPublisher,
} from "./adapters/redis.cancellation-channel.adapter";
export { SIMULATION_RUN_EXECUTION_PROCESS_NAME } from "./processes/simulation-run-execution.process";
export { simulationRunExecutionPM } from "./processes/simulation-run-execution.process";
export {
  SimulationProcessingPipelineAdapter,
  type SimulationProcessingPipelineDeps,
} from "./adapters/simulation-processing-pipeline.adapter";
export { createSimulationProcessingProducerPipeline } from "./adapters/simulation-processing-producer.adapter";
export {
  ScenarioApp,
  type QueueSimulationRunInput,
  type ScenarioAppDependencies,
  type ScenarioBroadcast,
  type ScenarioCaller,
} from "./app/scenario.app";
export { ScenarioTrpcApi } from "./transport/api-trpc/scenario.api";
export { filterRunsByTimestamp } from "./transport/api-trpc/scenario-events.api";
export {
  simulationTargetSchema,
  type SimulationTarget,
} from "./transport/api-trpc/simulation-runner.api";
export type {
  ScenarioTrpcContext,
  ScenarioTrpcPorts,
  ScenarioTrpcProcedures,
} from "./transport/api-trpc/scenario.trpc-context";
export {
  archiveScenarioSetRuns,
  createScenarioEventsRestApp,
  type InlineMediaExtraction,
} from "./transport/api-rest/scenario-event.api";
export {
  createScenarioRunExportRestApp,
  type ScenarioRunExportPort,
  type ScenarioRunExportRequestFields,
  type ScenarioRunExportRestPorts,
} from "./transport/api-rest/scenario-run-export.api";
export { createScenariosRestApp } from "./transport/api-rest/scenario.api";
export {
  createSimulationRunsRestApp,
  type ScenarioRunPlatformUrlBuilder,
} from "./transport/api-rest/simulation-run.api";

// ---------------------------------------------------------------------------
// The run-history download
//
// The keyset sweep behind `POST /api/export/scenario-runs/download`, its two
// CSV row axes, and the two refusals the transport publishes. The request
// vocabulary is `@langwatch/scenario-contract`'s, shared with the drawer that
// composes the request.
// ---------------------------------------------------------------------------
export { ScenarioRunExportService } from "./services/scenario-run-export.service";
export {
  serializeRunsToCriteriaCsv,
  serializeRunsToFullCsv,
} from "./services/scenario-run-export-csv.rules";
export {
  ScenarioRunExportForbiddenError,
  ScenarioRunExportUnauthenticatedError,
} from "./services/scenario-run-export-error.service";
export {
  SCENARIO_GENERATE_DEFAULT_TIMEOUT_MS,
  SCENARIO_GENERATE_FEATURE_KEY,
  createScenarioGenerateRestApp,
  type ScenarioGenerateRestPorts,
  type ScenarioGenerateRestSession,
} from "./transport/api-rest/scenario-generate.api";
export {
  isAbortLikeError,
  nlpgoHandledErrorFrom,
} from "./transport/api-rest/scenario-generate.nlpgo-error";
