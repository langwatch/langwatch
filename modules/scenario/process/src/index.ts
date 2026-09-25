export * from "./rules/child-egress-policy.rules.ts";
export * from "./rules/scenario-log-context.rules.ts";
export {
  createChildProcessLogger,
  decodeScenarioLogContext,
} from "./app/scenario-composition.build.ts";
export * from "./services/child-process-spawn.service.ts";
export * from "./rules/child-tls-env.rules.ts";
export {
  COMPUTE_METRICS_RETRY_DELAY_MS,
  ComputeRunMetricsAdapter,
  ComputeRunMetricsCommand,
  scenarioDeferredComputeRunMetricsJob,
} from "./eventing/compute-run-metrics.commands.ts";
export type { ComputeRunMetricsDeps } from "./eventing/compute-run-metrics.commands.ts";
export type { FinishRunDeps } from "./eventing/finish-run.commands.ts";
export {
  RecordEvaluationsCommand,
  type RecordEvaluationsDeps,
  evaluationsFingerprint,
} from "./eventing/record-evaluations.commands.ts";
export { HttpLitellmModelChannel } from "./channels/http/http.litellm-model.channel.ts";
export type { LitellmModelChannel, LitellmModelInput } from "./channels/litellm-model.channel.ts";
export { HttpNlpFetchChannel } from "./channels/http/http.nlp-fetch.channel.ts";
export type { NlpFetchChannel, NlpFetchTimeouts } from "./channels/nlp-fetch.channel.ts";
export * from "./services/node-scenario-child-process.service.ts";
export { OtelScenarioProcessorMetricsAdapter } from "./services/scenario-processor-metrics.service.ts";
export * from "./repositories/redis/redis.cancellation-channel.repository.ts";
export * from "./repositories/redis/redis.scenario-tab-store.repository.ts";
export * from "./services/scenario-child-execution.service.ts";
export * from "./channels/serialized-agent-channels.registry.ts";
export * from "./channels/http/http.serialized-code-agent.channel.ts";
export * from "./channels/http/http.serialized-http-agent.channel.ts";
export * from "./channels/http/http.serialized-prompt-config.channel.ts";
export * from "./channels/http/http.serialized-workflow-agent.channel.ts";
export {
  BACKFILL_STALE_THRESHOLD_MS,
  SimulationRunMetricsStoreAdapter,
  SimulationRunStateStoreAdapter,
  SimulationStalledRunAdapter,
  type SimulationStalledRun,
} from "./repositories/clickhouse/clickhouse.simulation-eventing.repository.ts";
export * from "./eventing/simulation-processing.commands.ts";
export {
  SimulationProcessingPipelineAdapter,
  type SimulationProcessingPipelineDeps,
} from "./eventing/simulation-processing.pipeline.ts";
export { SimulationProcessingProducerPipeline } from "./eventing/simulation-processing-producer.pipeline.ts";
export {
  ScenarioApp,
  scenarioAppDependencyTokens,
  type ScenarioAppDependencies,
  type ScenarioAppInfrastructure,
} from "./app/scenario.app.ts";
// CancellationPublisher/CancellationSubscriber are not re-exported here: the
// redis adapter above already exports its own same-named types (a different
// shape, the raw client boundary), so the folded interfaces stay reachable
// only through ScenarioAppInfrastructure to avoid a duplicate barrel export.
export type { CancellationMessage } from "./app/scenario.app.ts";
export type {
  ScenarioChildEnvironment,
  ScenarioChildExecutionSession,
  ScenarioChildBootstrap,
  ScenarioClock,
  ScenarioExecutionPool,
  ScenarioExecutionRunner,
  ScenarioHttpResponse,
  ScenarioHttp,
  ScenarioId,
  ScenarioTestSuiteId,
  ScenarioProcessorServiceMetrics,
  ScenarioSecretCipher,
} from "./app/scenario.app.ts";
export { STALL_THRESHOLD_MS } from "./eventing/simulation-run-execution-evolution.process.ts";
export * from "./eventing/simulation-run-execution.process.ts";
export type { SimulationRunStateData } from "./eventing/simulation-run-state.projection.ts";
export {
  MAX_CODE_SCENARIOS,
  MAX_RUN_TARGETS,
  type ResultAtomsClickHouseClient,
  type ResultAtomsClickHouseClientResolver,
} from "./repositories/clickhouse/clickhouse.result-atoms.repository.ts";
export {
  type RawAtomRow,
  type RawCodeScenarioRow,
  type RawGroupRow,
  type RawRunTargetRow,
  type RawSeriesRow,
  type RawTotalsRow,
  type RawTrendRow,
  type RunOrdinalRow,
} from "./repositories/result-atoms.repository.ts";
export { RunConfigurationsClickHouseRepository } from "./repositories/clickhouse/clickhouse.run-configurations.repository.ts";
export { type RawRunConfigurationRow } from "./repositories/run-configurations.repository.ts";
export {
  SimulationClickHouseRepository,
  type SimulationClickHouseClient,
} from "./repositories/clickhouse/simulation-clickhouse.repository.ts";
export { SimulationExecutionRepository } from "./repositories/simulation-execution.repository.ts";
export { MemoryResultAtomsRepository } from "./repositories/memory/memory.result-atoms.repository.ts";
export { MemoryRunConfigurationsRepository } from "./repositories/memory/memory.run-configurations.repository.ts";
export { scenarioRepositories } from "./repositories/scenario-repositories.registry.ts";
export type { ScenarioRepositories } from "./repositories/scenario.repositories.ts";
export { NullSimulationRepository } from "./repositories/simulation.repository.ts";
export { scenarioServer } from "./scenario.server.ts";
export { AgentTestService, type AgentTestServiceOptions } from "./services/agent-test.service.ts";
export * from "./services/scenario-execution-pool.service.ts";
export * from "./services/scenario-execution-prefetcher.service.ts";
export * from "./services/scenario-execution.service.ts";
export * from "./services/scenario-failure-handler.service.ts";
export { ScenarioGenerateBoundsService } from "./services/scenario-generate-bounds.service.ts";
export * from "./services/scenario-processor.service.ts";
export * from "./services/scenario-tab-registry.service.ts";
export * from "./services/scenario-workflow-mapping.service.ts";
export { SimulationService } from "./services/simulation.service.ts";
export {
  StalledRunsBackfillTask,
  backfillStalledRuns,
  type StalledRunFinder,
} from "./tasks/stalled-runs-backfill.task.ts";
/**
 * The two repository bundles themselves, for the two compositions that
 * still build a `ScenarioService` by hand (api's `features/scenario`,
 * worker's scenario-execution) rather than `installApiScenario`.
 */
export { MemoryScenarioRepositories } from "./repositories/memory/memory.scenario.repositories.ts";
export { PostgresScenarioRepositories } from "./repositories/prisma/prisma.scenario.repositories.ts";
export { filterRunsByTimestamp } from "./rules/simulation-run-timestamp-filter.rules.ts";
export { ResultAtomsService } from "./services/result-atoms.service.ts";
export {
  RunConfigurationsService,
  type RunConfiguration,
  type RunConfigurationEntry,
  type RunConfigurationScope,
} from "./services/run-configurations.service.ts";
export { ScenarioService, type ScenarioServiceOptions } from "./services/scenario.service.ts";
export { scenarioEventsRest } from "./transport/scenario-event.rest.ts";
export {
  SCENARIO_GENERATE_DEFAULT_TIMEOUT_MS,
  SCENARIO_GENERATE_FEATURE_KEY,
  type ScenarioGenerationDependencies,
} from "./services/scenario-generation.service.ts";
export { scenarioGenerateRest } from "./transport/scenario-generate.rest.ts";
export { scenarioRunExportRest } from "./transport/scenario-run-export.rest.ts";
export { createScenarioRest, scenarioRestSurface } from "./transport/scenario.rest.ts";
export { scenarioTrpcTransport } from "./transport/scenario.trpc.ts";
export {
  createSimulationRunsRest,
  type ScenarioRunPlatformUrlBuilder,
} from "./transport/simulation-run.rest.ts";

// --------------------------------------------------------------------------- The run-history
// download The keyset sweep behind `POST /api/export/scenario-runs/download`, its two CSV row axes,
// and the two refusals the transport publishes. The request vocabulary is `@langwatch/scenario-
// contract`'s, shared with the drawer that composes the request.
// ---------------------------------------------------------------------------
export {
  isAbortLikeError,
  extractNlpgoHandledError,
} from "./rules/scenario-generate-nlpgo-error.rules.ts";
export { ScenarioRunExportCsvService } from "./services/scenario-run-export-csv.service.ts";
export { ScenarioRunExportDownloadService } from "./services/scenario-run-export-download.service.ts";
export { ScenarioRunExportService } from "./services/scenario-run-export.service.ts";
