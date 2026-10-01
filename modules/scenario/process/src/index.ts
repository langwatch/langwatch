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
export * from "./channels/redis/redis.scenario-cancellation.channel.ts";
export type { SimulationStalledRun } from "./eventing/simulation-eventing.store.ts";
export * from "./eventing/simulation-processing.commands.ts";
export {
  SimulationProcessingPipelineAdapter,
  type SimulationProcessingPipelineDeps,
} from "./eventing/simulation-processing.pipeline.ts";
export { SimulationProcessingProducerPipeline } from "./eventing/simulation-processing-producer.pipeline.ts";
export type { ScenarioAppDependencies, ScenarioAppInfrastructure } from "./app/scenario.app.ts";
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
  ScenarioId,
  ScenarioTestSuiteId,
  ScenarioProcessorServiceMetrics,
  ScenarioSecretCipher,
} from "./app/scenario.app.ts";
export { STALL_THRESHOLD_MS } from "./eventing/simulation-run-execution-evolution.process.ts";
export * from "./eventing/simulation-run-execution.process.ts";
export type { SimulationRunStateData } from "./eventing/simulation-run-state.projection.ts";
export type {
  ResultAtomsClickHouseClient,
  ResultAtomsClickHouseClientResolver,
} from "./repositories/clickhouse/clickhouse.result-atoms.repository.ts";
export type {
  RawAtomRow,
  RawCodeScenarioRow,
  RawGroupRow,
  RawRunTargetRow,
  RawSeriesRow,
  RawTotalsRow,
  RawTrendRow,
  RunOrdinalRow,
} from "./repositories/result-atoms.repository.ts";
export type { RawRunConfigurationRow } from "./repositories/run-configurations.repository.ts";
export type { SimulationClickHouseClient } from "./repositories/clickhouse/simulation-clickhouse.repository.ts";
export type { ScenarioRepositories } from "./repositories/scenario.repositories.ts";
export { scenarioProcessModule } from "./scenario.module.ts";
export type { AgentTestServiceOptions } from "./services/agent-test.service.ts";
export {
  StalledRunsBackfillTask,
  backfillStalledRuns,
  type StalledRunFinder,
} from "./tasks/stalled-runs-backfill.task.ts";
export type {
  RunConfiguration,
  RunConfigurationEntry,
  RunConfigurationScope,
} from "./services/run-configurations.service.ts";
export type { ScenarioServiceOptions } from "./services/scenario.service.ts";
export { scenarioEventsRest } from "./transport/scenario-event.rest.ts";
export type { ScenarioGenerationDependencies } from "./services/scenario-generation.service.ts";
export { scenarioGenerateRest } from "./transport/scenario-generate.rest.ts";
export { scenarioRunExportRest } from "./transport/scenario-run-export.rest.ts";
export { createScenarioRest, scenarioRestSurface } from "./transport/scenario.rest.ts";
export { scenarioTrpcTransport } from "./transport/scenario.trpc.ts";
export {
  createSimulationRunsRest,
  type ScenarioRunPlatformUrlBuilder,
} from "./transport/simulation-run.rest.ts";

export type {
  ResolvedVoicePublicUrl,
  VoicePublicUrl,
} from "./services/voice-public-url.service.ts";
