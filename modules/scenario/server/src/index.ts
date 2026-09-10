export * from "./services/child-egress-policy.service.ts";
export * from "./services/child-logger.service.ts";
export * from "./services/child-process-spawn.service.ts";
export * from "./services/child-tls-env.service.ts";
export {
    COMPUTE_METRICS_RETRY_DELAY_MS,
    ComputeRunMetricsAdapter,
    ComputeRunMetricsCommand,
    scenarioDeferredComputeRunMetricsJob
} from "./eventing/compute-run-metrics.commands.ts";
export type { ComputeRunMetricsDeps } from "./eventing/compute-run-metrics.commands.ts";
export { FinishRunCommand, type FinishRunDeps } from "./eventing/finish-run.commands.ts";
export * from "./services/http-auth.service.ts";
export * from "./services/litellm-model.service.ts";
export { NlpFetchAdapter, type NlpFetchTimeouts } from "./services/nlp-fetch.service.ts";
export * from "./services/node-scenario-child-process.service.ts";
export { OtelScenarioProcessorMetricsAdapter } from "./services/scenario-processor-metrics.service.ts";
export * from "./services/prompt-template.service.ts";
export * from "./repositories/redis/redis.cancellation-channel.repository.ts";
export {
    CANCELLATION_CHANNEL,
    RedisCancellationPublisherAdapter,
    UnavailableCancellationPublisherAdapter,
    type CancellationPublisher
} from "./repositories/redis/redis.cancellation-channel.repository.ts";
export * from "./repositories/redis/redis.scenario-tab-store.repository.ts";
export * from "./services/remote-trace-run.service.ts";
export * from "./services/scenario-child-execution.service.ts";
export * from "./services/scenario-role-model.service.ts";
export * from "./services/scenario-secret-reference.service.ts";
export * from "./services/serialized-agent-registry.service.ts";
export * from "./services/serialized-code-agent.service.ts";
export * from "./services/serialized-http-agent.service.ts";
export * from "./services/serialized-prompt-config.service.ts";
export * from "./services/serialized-workflow-agent.service.ts";
export {
    BACKFILL_STALE_THRESHOLD_MS,
    SimulationRunMetricsStoreAdapter,
    SimulationRunStateStoreAdapter,
    SimulationStalledRunAdapter,
    type SimulationStalledRun
} from "./repositories/clickhouse/clickhouse.simulation-eventing.repository.ts";
export * from "./eventing/simulation-processing.commands.ts";
export {
    SimulationProcessingPipelineAdapter,
    type SimulationProcessingPipelineDeps
} from "./eventing/simulation-processing.pipeline.ts";
export { ClickhouseSimulationProcessingProducerRepository as SimulationProcessingProducerAdapter } from "./repositories/clickhouse/clickhouse.simulation-processing-producer.repository.ts";
export {
    ScenarioApp,
    scenarioAppDependencyTokens,
    type ScenarioAppDependencies,
    type ScenarioAppInfrastructure,
    type ScenarioBroadcast
} from "./app/scenario.app.ts";
// CancellationPublisher/CancellationSubscriber are not re-exported here: the
// redis adapter above already exports its own same-named types (a different
// shape, the raw client boundary), so the folded interfaces stay reachable
// only through ScenarioAppInfrastructure to avoid a duplicate barrel export.
export type { CancellationMessage } from "./app/scenario.app.ts";
export * from "./services/scenario-activity.service.ts";
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
  ScenarioTabStore,
} from "./app/scenario.app.ts";
export { STALL_THRESHOLD_MS } from "./processes/simulation-run-execution-evolution.process.ts";
export * from "./processes/simulation-run-execution.process.ts";
export { SIMULATION_RUN_EXECUTION_PROCESS_NAME, simulationRunExecutionPM } from "./processes/simulation-run-execution.process.ts";
export type { SimulationRunStateData } from "./projections/simulation-run-state.projection.ts";
export {
    MAX_CODE_SCENARIOS,
    MAX_RUN_TARGETS,
    MAX_TREND_POINTS,
    ResultAtomsClickHouseRepository,
    ResultAtomsRepository,
    type RawAtomRow,
    type RawCodeScenarioRow,
    type RawGroupRow,
    type RawRunTargetRow,
    type RawSeriesRow,
    type RawTotalsRow,
    type RawTrendRow,
    type ResultAtomsClickHouseClient,
    type ResultAtomsClickHouseClientResolver,
    type RunOrdinalRow
} from "./repositories/clickhouse/clickhouse.result-atoms.repository.ts";
export {
    RunConfigurationsClickHouseRepository,
    RunConfigurationsRepository,
    type RawRunConfigurationRow
} from "./repositories/clickhouse/clickhouse.run-configurations.repository.ts";
export {
    SimulationClickHouseRepository,
    SimulationExecutionRepository,
    SimulationWindowedRepository,
    type SimulationClickHouseClient as SimulationReadClient,
    type SimulationWindowedReadInput
} from "./repositories/clickhouse/simulation-clickhouse.repository.ts";
export { MemoryResultAtomsRepository } from "./repositories/memory/memory.result-atoms.repository.ts";
export { MemoryRunConfigurationsRepository } from "./repositories/memory/memory.run-configurations.repository.ts";
export { scenarioRepositories } from "./repositories/scenario-repositories.registry.ts";
export type { ScenarioRepositories } from "./repositories/scenario.repositories.ts";
export { NullSimulationRepository } from "./repositories/simulation.repository.ts";
export { scenarioServer } from "./scenario.server.ts";
export {
    AgentTestService,
    type AgentTestServiceOptions
} from "./services/agent-test.service.ts";
export * from "./services/scenario-execution-pool.service.ts";
export * from "./services/scenario-execution-prefetcher.service.ts";
export * from "./services/scenario-execution.service.ts";
export * from "./services/scenario-failure-handler.service.ts";
export * from "./services/scenario-processor.service.ts";
export * from "./services/scenario-tab-registry.service.ts";
export * from "./services/scenario-workflow-mapping.service.ts";
export { SimulationService } from "./services/simulation.service.ts";
export {
    StalledRunsBackfillTask,
    backfillStalledRuns,
    type StalledRunFinder
} from "./tasks/stalled-runs-backfill.task.ts";
/**
 * The two repository bundles themselves, for the two compositions that still
 * build a `ScenarioService` by hand (`apps/api/src/features/scenario` and
 * `apps/worker`'s scenario-execution composition) rather than through
 * `installApiScenario`. `PrismaScenarioRepository` itself stays private.
 */
export { MemoryScenarioRepositories } from "./repositories/memory/memory.scenario.repositories.ts";
export { PostgresScenarioRepositories } from "./repositories/prisma/prisma.scenario.repositories.ts";
export { filterRunsByTimestamp } from "./rules/simulation-run-timestamp-filter.rules.ts";
export { ResultAtomsService } from "./services/result-atoms.service.ts";
export {
    RunConfigurationsService,
    type RunConfiguration,
    type RunConfigurationEntry,
    type RunConfigurationScope
} from "./services/run-configurations.service.ts";
export { ScenarioService, type ScenarioServiceOptions } from "./services/scenario.service.ts";
export {
    ScenarioRunNotThereError,
    archiveScenarioRun,
    archiveScenarioSetRuns,
    createScenarioEventsRest,
    scenarioEventErrorHandler,
    type InlineMediaExtraction
} from "./transport/scenario-event.rest.ts";
export {
    SCENARIO_GENERATE_DEFAULT_TIMEOUT_MS,
    SCENARIO_GENERATE_FEATURE_KEY,
    createScenarioGenerateRest,
    type ScenarioGenerateRestPorts,
    type ScenarioGenerateRestSession
} from "./transport/scenario-generate.rest.ts";
export {
    createScenarioRunExportRest,
    type ScenarioRunExport,
    type ScenarioRunExportRequestFields,
    type ScenarioRunExportRestPorts
} from "./transport/scenario-run-export.rest.ts";
export {
    ScenarioRestNotThereError,
    createScenarioRest,
    scenarioRestErrorHandler,
    scenarioRestSurface
} from "./transport/scenario.rest.ts";
export { scenarioTrpcTransport } from "./transport/scenario.trpc.ts";
export {
    SimulationRunNotThereError,
    createSimulationRunsRest,
    simulationRunErrorHandler,
    type ScenarioRunPlatformUrlBuilder
} from "./transport/simulation-run.rest.ts";

// --------------------------------------------------------------------------- The run-history
// download The keyset sweep behind `POST /api/export/scenario-runs/download`, its two CSV row axes,
// and the two refusals the transport publishes. The request vocabulary is `@langwatch/scenario-
// contract`'s, shared with the drawer that composes the request.
// ---------------------------------------------------------------------------
export {
    isAbortLikeError,
    nlpgoHandledErrorFrom
} from "./rules/scenario-generate-nlpgo-error.rules.ts";
export { ScenarioRunExportCsvService } from "./services/scenario-run-export-csv.service.ts";
export { ScenarioRunExportService } from "./services/scenario-run-export.service.ts";
export {
    ScenarioRunExportForbiddenError,
    ScenarioRunExportUnauthenticatedError
} from "@langwatch/scenario-contract";
