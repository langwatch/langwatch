export * from "./ports/cancellation-channel.port.ts";
export * from "./ports/scenario-clock.port.ts";
export * from "./ports/scenario-child-bootstrap.port.ts";
export * from "./ports/scenario-http.port.ts";
export * from "./ports/scenario-id.port.ts";
export * from "./ports/scenario-execution-runner.port.ts";
export * from "./ports/scenario-execution-pool.port.ts";
export * from "./ports/scenario-processor-metrics.port.ts";
export * from "./ports/scenario-activity.port.ts";
export * from "./ports/scenario-secret-cipher.port.ts";
export * from "./ports/scenario-tab-store.port.ts";
export {
  ResultAtomsReadPort,
  MAX_TREND_POINTS,
  MAX_CODE_SCENARIOS,
  MAX_RUN_TARGETS,
  type RawAtomRow,
  type RunOrdinalRow,
  type RawGroupRow,
  type RawTrendRow,
  type RawCodeScenarioRow,
  type RawRunTargetRow,
  type RawSeriesRow,
  type RawTotalsRow,
} from "./ports/result-atoms-read.port.ts";
export {
  RunConfigurationsReadPort,
  type RawRunConfigurationRow,
} from "./ports/run-configurations-read.port.ts";
export * from "./services/scenario-execution-pool.service.ts";
export * from "./services/scenario-execution.service.ts";
export * from "./services/scenario-execution-prefetcher.service.ts";
export {
  AgentTestService,
  type AgentTestServiceOptions,
} from "./services/agent-test.service.ts";
export * from "./services/scenario-failure-handler.service.ts";
export * from "./services/scenario-processor.service.ts";
export * from "./services/scenario-tab-registry.service.ts";
export * from "./adapters/child-egress-policy.adapter.ts";
export * from "./adapters/child-logger.adapter.ts";
export * from "./adapters/child-process-spawn.adapter.ts";
export * from "./adapters/child-tls-env.adapter.ts";
export * from "./adapters/http-auth.adapter.ts";
export * from "./adapters/litellm-model.adapter.ts";
export { NlpFetchAdapter, type NlpFetchTimeouts } from "./adapters/nlp-fetch.adapter.ts";
export * from "./adapters/node-scenario-child-process.adapter.ts";
export { OtelScenarioProcessorMetricsAdapter } from "./adapters/otel.scenario-processor-metrics.adapter.ts";
export * from "./adapters/prompt-template.adapter.ts";
export * from "./adapters/remote-trace-run.adapter.ts";
export * from "./adapters/redis.cancellation-channel.adapter.ts";
export * from "./adapters/redis.scenario-tab-store.adapter.ts";
export * from "./adapters/scenario-child-execution.adapter.ts";
export * from "./adapters/scenario-role-model.adapter.ts";
export * from "./adapters/scenario-secret-reference.adapter.ts";
export * from "./adapters/serialized-agent-registry.adapter.ts";
export * from "./adapters/serialized-code-agent.adapter.ts";
export * from "./adapters/serialized-http-agent.adapter.ts";
export * from "./adapters/serialized-prompt-config.adapter.ts";
export * from "./adapters/serialized-workflow-agent.adapter.ts";
export * from "./services/scenario-workflow-mapping.service.ts";
export { SimulationClickHouseAdapter } from "./adapters/simulation.clickhouse.adapter.ts";
export type { SimulationReadClient } from "./adapters/simulation.clickhouse.adapter.ts";
export {
  SimulationRunMetricsStoreAdapter,
  SimulationRunStateStoreAdapter,
  SimulationStalledRunAdapter,
  BACKFILL_STALE_THRESHOLD_MS,
  type SimulationStalledRun,
} from "./adapters/simulation-eventing.adapter.ts";
export { SimulationExecutionPort } from "./ports/simulation-execution.port.ts";
export type { SimulationRunStateData } from "./projections/simulation-run-state.projection.ts";
export * from "./processes/simulation-run-execution.process.ts";
export {
  SimulationWindowedReadPort,
  type SimulationWindowedReadInput,
} from "./ports/simulation-windowed-read.port.ts";
export { SimulationService } from "./services/simulation.service.ts";
export { STALL_THRESHOLD_MS } from "./processes/simulation-run-execution-evolution.process.ts";
export * from "./adapters/simulation-processing-commands.adapter.ts";
export {
  COMPUTE_METRICS_RETRY_DELAY_MS,
  ComputeRunMetricsAdapter,
  ComputeRunMetricsCommand,
  scenarioDeferredComputeRunMetricsJob,
} from "./adapters/compute-run-metrics.adapter.ts";
export type { ComputeRunMetricsDeps } from "./adapters/compute-run-metrics.adapter.ts";
export { FinishRunCommand, type FinishRunDeps } from "./adapters/finish-run.adapter.ts";
export {
  CANCELLATION_CHANNEL,
  RedisCancellationPublisherAdapter,
  UnavailableCancellationPublisherAdapter,
  type CancellationPublisher,
} from "./adapters/redis.cancellation-channel.adapter.ts";
export { SIMULATION_RUN_EXECUTION_PROCESS_NAME } from "./processes/simulation-run-execution.process.ts";
export { simulationRunExecutionPM } from "./processes/simulation-run-execution.process.ts";
export {
  SimulationProcessingPipelineAdapter,
  type SimulationProcessingPipelineDeps,
} from "./adapters/simulation-processing-pipeline.adapter.ts";
export { SimulationProcessingProducerAdapter } from "./adapters/simulation-processing-producer.adapter.ts";
export {
  StalledRunsBackfillTask,
  backfillStalledRuns,
  type StalledRunFinder,
} from "./tasks/stalled-runs-backfill.task.ts";
export {
  ScenarioApp,
  scenarioAppDependencyTokens,
  type ScenarioAppDependencies,
  type ScenarioAppInfrastructure,
  type ScenarioBroadcast,
} from "./app/scenario.app.ts";
export type { ScenarioRepositories } from "./repositories/scenario.repositories.ts";
export { scenarioRepositories } from "./repositories/scenario-repositories.registry.ts";
export { scenarioServer } from "./scenario.server.ts";
/**
 * The two repository bundles themselves, for the two compositions that still
 * build a `ScenarioService` by hand (`apps/api/src/features/scenario` and
 * `apps/worker`'s scenario-execution composition) rather than through
 * `installApiScenario`. `PrismaScenarioRepository` itself stays private.
 */
export { PostgresScenarioRepositories } from "./repositories/prisma/prisma.scenario.repositories.ts";
export { MemoryScenarioRepositories } from "./repositories/memory/memory.scenario.repositories.ts";
export { ResultAtomsService } from "./services/result-atoms.service.ts";
export { ScenarioService, type ScenarioServiceOptions } from "./services/scenario.service.ts";
export {
  RunConfigurationsService,
  type RunConfiguration,
  type RunConfigurationEntry,
  type RunConfigurationScope,
} from "./services/run-configurations.service.ts";
export {
  ResultAtomsClickHouseAdapter,
  type ResultAtomsClickHouseClient,
} from "./adapters/result-atoms.clickhouse.adapter.ts";
export { RunConfigurationsClickHouseAdapter } from "./adapters/run-configurations.clickhouse.adapter.ts";
export { scenarioTrpcTransport } from "./transport/scenario.trpc.ts";
export {
  createScenarioRest,
  ScenarioRestNotThereError,
  scenarioRestErrorHandler,
  scenarioRestSurface,
} from "./transport/scenario.rest.ts";
export {
  createSimulationRunsRest,
  SimulationRunNotThereError,
  simulationRunErrorHandler,
  type ScenarioRunPlatformUrlBuilder,
} from "./transport/simulation-run.rest.ts";
export {
  createScenarioGenerateRest,
  SCENARIO_GENERATE_DEFAULT_TIMEOUT_MS,
  SCENARIO_GENERATE_FEATURE_KEY,
  type ScenarioGenerateRestPorts,
  type ScenarioGenerateRestSession,
} from "./transport/scenario-generate.rest.ts";
export {
  createScenarioRunExportRest,
  type ScenarioRunExportPort,
  type ScenarioRunExportRequestFields,
  type ScenarioRunExportRestPorts,
} from "./transport/scenario-run-export.rest.ts";
export {
  archiveScenarioRun,
  archiveScenarioSetRuns,
  createScenarioEventsRest,
  ScenarioRunNotThereError,
  scenarioEventErrorHandler,
  type InlineMediaExtraction,
} from "./transport/scenario-event.rest.ts";
export { filterRunsByTimestamp } from "./rules/simulation-run-timestamp-filter.rules.ts";

// --------------------------------------------------------------------------- The run-history
// download The keyset sweep behind `POST /api/export/scenario-runs/download`, its two CSV row axes,
// and the two refusals the transport publishes. The request vocabulary is `@langwatch/scenario-
// contract`'s, shared with the drawer that composes the request.
// ---------------------------------------------------------------------------
export { ScenarioRunExportService } from "./services/scenario-run-export.service.ts";
export { ScenarioRunExportCsvService } from "./services/scenario-run-export-csv.service.ts";
export {
  ScenarioRunExportForbiddenError,
  ScenarioRunExportUnauthenticatedError,
} from "@langwatch/scenario-contract";
export {
  isAbortLikeError,
  nlpgoHandledErrorFrom,
} from "./rules/scenario-generate-nlpgo-error.rules.ts";
