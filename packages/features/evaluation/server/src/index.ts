export {
  EvaluationAdapter,
  type EvaluationAdapterOptions,
} from "./adapters/evaluation.clickhouse.adapter.ts";
export { EvaluationApp, type EvaluationInfrastructure } from "./app/evaluation.app.ts";
export { evaluationServer } from "./evaluation.server.ts";
/**
 * The `evaluation_runs` repository, for a process that needs one read and not the service
 * around it.
 */
export { ClickHouseEvaluationRepository } from "./repositories/clickhouse/evaluation.repository.ts";
/**
 * The monitors page's seven-day trend, for a process that reads it and executes nothing.
 */
export { MonitorPerformanceAdapter } from "./adapters/monitor-performance.clickhouse.adapter.ts";
export { MonitorPerformanceService } from "./services/monitor-performance.service.ts";
export {
  EvaluationEventingAdapter,
  type EvaluationEventingStores,
} from "./adapters/evaluation.eventing.adapter.ts";
export { EvaluationRunProjectionPort } from "./ports/evaluation-run-projection.port.ts";
export { EvaluationRunProjectionService } from "./services/evaluation-run-projection.service.ts";
export {
  EvaluationExecutionPort,
  EvaluationExecutionIntentPort,
  EvaluationExecutionReceiptPort,
  EvaluationAnalyticsAttributePolicy,
  EvaluationCostRecorderPort,
  EvaluationInputStoragePort,
  EvaluationInputOffloadAvailabilityPort,
  EvaluationAzureSafetyCredentialsPort,
  EvaluationSettingsRecoveryPort,
  EvaluationInputsOffloadPort,
  EvaluationInputsResolutionPort,
  EvaluationRetentionFloorPort,
  type EvaluationClickHouseResolver,
  type EvaluationClickHouseClient,
  type EvaluationClickHouseInsert,
  type EvaluationClickHouseQuery,
  type EvaluationClickHouseResult,
} from "./ports/evaluation.port.ts";
export {
  EvaluationInputsOffloadService,
  EVALUATION_INPUTS_STORED_OBJECT_MARKER_KEY,
  STORED_OBJECT_MARKER_KEY,
  type EvaluationInputOffloadConfig,
  type StoredObjectInputsMarker,
} from "./services/evaluation-inputs-offload.service.ts";
export {
  EVAL_INPUTS_INLINE_MAX_BYTES,
  EVAL_INPUTS_HARD_CEILING_BYTES,
  EVAL_INPUTS_PREVIEW_BYTES,
  EVAL_INPUTS_STORED_OBJECT_PURPOSE,
} from "./services/evaluation-inputs-offload.service.ts";
export { ExecuteEvaluationCommand } from "./intents/evaluation-execution.intent.ts";
export { EvaluationService, type EvaluationServiceOptions } from "./services/evaluation.service.ts";
export {
  EvaluationExecutionIntentService,
  type ExecuteEvaluationCommandDeps,
} from "./services/evaluation-execution-intent.service.ts";
export {
  createEvaluationProcessingPipeline,
  type EvaluationProcessingPipelineDeps,
} from "./adapters/evaluation-processing.adapter.ts";
export { EvaluationProcessingProducerAdapter } from "./adapters/evaluation-processing-producer.adapter.ts";
export {
  EvaluatorAvailabilityService,
  LINGUA_ENABLE_ENV_VAR,
  PRESIDIO_ENABLE_ENV_VAR,
  type EvaluatorInstallEnvironment,
} from "./services/evaluator-availability.service.ts";
export type { EvaluationRunData } from "@langwatch/evaluation-contract";
export { evaluationTrpcTransport } from "./transport/evaluation.trpc.ts";
export {
  EvaluationCustomEvaluatorsPort,
  EvaluationInstallEnvironmentPort,
  EvaluationReportPort,
  EvaluationRescorePort,
  EvaluationRunAnalyticsPort,
  EvaluationWarmupPort,
} from "./ports/evaluation-rescore.port.ts";
export { EvaluationNameAutoslugService } from "./services/evaluation-name-autoslug.service.ts";
export {
  EvaluationPreconditionService,
  PRECONDITION_FIELDS,
} from "./services/evaluation-precondition.service.ts";

/** The cost ledger an evaluation run writes into, over the repositories it is handed. */
export { EvaluationCostService } from "./services/evaluation-cost.service.ts";
export { evaluationRepositories } from "./repositories/evaluation-repositories.registry.ts";

/**
 * The ONLINE execution path: rendering a stored trace through its evaluator
 * mappings and running the evaluator over the result. Was
 * `platform/app/src/server/app-layer/evaluations/evaluation-execution.service.ts`.
 */
export {
  EvaluationExecutionService,
  type EvaluationExecutionDeps,
} from "./services/evaluation-execution.service.ts";
export {
  EvaluationThreadMappingService,
  type GetThreadTraces,
} from "./services/evaluation-thread-mapping.service.ts";
export {
  EvaluationMonitorLookupPort,
  EvaluationTraceEvidencePort,
  EvaluationExecutionTelemetryPort,
  EvaluationLangevalsPort,
  EvaluationModelEnvPort,
  EvaluationSpanDigestPort,
  EvaluationTraceReadPort,
  EvaluationWorkflowExecutorPort,
  type EvaluationTraceProtections,
  type LangevalsEvaluateParams,
} from "./ports/evaluation-execution.port.ts";
export {
  HttpLangevalsEvaluatorAdapter,
  NullLangevalsEvaluatorClient,
  type LangevalsRuntimeConfig,
} from "./adapters/http.langevals-evaluator.adapter.ts";
export {
  EVALUATION_DURATION_METRIC_NAME,
  EVALUATION_STATUS_METRIC_NAME,
  OtelEvaluationExecutionMetricsAdapter,
} from "./adapters/otel.evaluation-execution-metrics.adapter.ts";
export { DirectEvaluationExecutionReceiptAdapter } from "./adapters/direct.evaluation-execution-receipt.adapter.ts";

// --------------------------------------------------------------------------- The legacy
// evaluation REST doors The evaluator catalogue, the batch result log and the four evaluate
// paths. The catalogue needs nothing; the other two halves take what they cannot own as port
// groups, so a process mounts the ones its own graph can answer.
// ---------------------------------------------------------------------------
export {
  createEvaluationsLegacyRestApp,
  type DataForEvaluation,
  type EvaluationBatchExperimentPort,
  type EvaluationBatchRestPorts,
  type EvaluationRunCustomEvaluator,
  type EvaluationRunMonitor,
  type EvaluationRunRestPorts,
  type EvaluationsLegacyCredential,
  type EvaluationsLegacyCredentialPort,
  type EvaluationsLegacyRestPorts,
} from "./transport/api-rest/evaluations-legacy.api.ts";
