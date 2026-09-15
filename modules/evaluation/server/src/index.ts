export type { EvaluationAdapterOptions } from "./repositories/clickhouse/clickhouse.evaluation.repository.ts";
export { EvaluationApp, type EvaluationInfrastructure } from "./app/evaluation.app.ts";
export { evaluationServer } from "./evaluation.server.ts";

// --------------------------------------------------------------------------- Evaluation's
// composition seam: how a process builds this feature's runtime from its own substrates,
// without naming one of the module's repositories or services.
// ---------------------------------------------------------------------------
export {
  createEvaluationCostLedger,
  createEvaluationEngine,
  createEvaluationEventingStores,
  createEvaluationExecutionIntent,
  createEvaluationInputsOffload,
  createEvaluationRunReads,
  createMonitorPerformanceReads,
  deriveEvaluationEvaluatorId,
  type EvaluationClickHouseAccess,
  type EvaluationCostLedger,
  type EvaluationEngine,
  type EvaluationInputsOffloadStore,
  type EvaluationRunReads,
  type MonitorPerformanceReads,
} from "./evaluation.server.ts";
/**
 * The `evaluation_runs` repository, for a process that needs one read and not the service
 * around it.
 */
export { ClickHouseEvaluationRepository } from "./repositories/clickhouse/evaluation.repository.ts";
/**
 * The monitors page's seven-day trend, for a process that reads it and executes nothing.
 */
export { ClickhouseMonitorPerformanceRepository as MonitorPerformanceAdapter } from "./repositories/clickhouse/clickhouse.monitor-performance.repository.ts";
export {
  EvaluationEventingAdapter,
  type EvaluationEventingStores,
} from "./services/evaluation.eventing.service.ts";
export { EvaluationRunProjectionService } from "./services/evaluation-run-projection.service.ts";
export type {
  EvaluationExecution,
  EvaluationExecutionIntent,
  EvaluationExecutionReceipt,
  EvaluationAnalyticsAttributePolicy,
  EvaluationCostRecorder,
  EvaluationInputStorage,
  EvaluationInputOffloadAvailability,
  EvaluationAzureSafetyCredentials,
  EvaluationSettingsRecovery,
  EvaluationInputsOffload,
  EvaluationInputsResolution,
  EvaluationRetentionFloor,
} from "./app/evaluation.members.ts";
export type {
  EvaluationClickHouseResolver,
  EvaluationClickHouseClient,
  EvaluationClickHouseInsert,
  EvaluationClickHouseQuery,
  EvaluationClickHouseResult,
} from "./repositories/clickhouse/evaluation-clickhouse-client.ts";
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
export { ExecuteEvaluationCommand } from "./eventing/evaluation-execution.intent.ts";
export type { EvaluationServiceOptions } from "./services/evaluation.service.ts";
export {
  EvaluationExecutionIntentService,
  type ExecuteEvaluationCommandDeps,
} from "./services/evaluation-execution-intent.service.ts";
export {
  createEvaluationProcessingPipeline,
  type EvaluationProcessingPipelineDeps,
} from "./services/evaluation-processing.service.ts";
export { EvaluationProcessingProducerAdapter } from "./services/evaluation-processing-producer.service.ts";
export type { EvaluatorInstallEnvironment } from "./services/evaluator-availability.service.ts";
export type { EvaluationRunData } from "@langwatch/evaluation-contract";
export { evaluationTrpcTransport } from "./transport/evaluation.trpc.ts";
export type {
  EvaluationCustomEvaluators,
  EvaluationInstallEnvironment,
  EvaluationReport,
  EvaluationRescore,
  EvaluationRunAnalytics,
  EvaluationWarmupProbe,
} from "./app/evaluation.members.ts";
export { EvaluationNameAutoslugService } from "./services/evaluation-name-autoslug.service.ts";

/** The cost ledger an evaluation run writes into, over the repositories it is handed. */
export { EvaluationCostService } from "./services/evaluation-cost.service.ts";

/**
 * The ONLINE execution path: rendering a stored trace through its evaluator
 * mappings and running the evaluator over the result. Was
 * `platform/app/src/server/app-layer/evaluations/evaluation-execution.service.ts`.
 */
export {
  EvaluationExecutionService,
  type EvaluationExecutionDeps,
} from "./services/evaluation-execution.service.ts";
export type { GetThreadTraces } from "./services/evaluation-thread-mapping.service.ts";
export type {
  EvaluationMonitorLookup,
  EvaluationTraceEvidence,
  EvaluationExecutionTelemetry,
  EvaluationLangevals,
  EvaluationModelEnv,
  EvaluationSpanDigest,
  EvaluationTraceRead,
  EvaluationWorkflowExecutor,
  EvaluationTraceProtections,
  LangevalsEvaluateParams,
} from "./app/evaluation.members.ts";
export {
  HttpLangevalsEvaluatorAdapter,
  type LangevalsRuntimeConfig,
} from "./services/http.langevals-evaluator.service.ts";
export { NullLangevalsEvaluatorClient } from "./services/null.langevals-evaluator.service.ts";
export {
  EVALUATION_DURATION_METRIC_NAME,
  EVALUATION_STATUS_METRIC_NAME,
  OtelEvaluationExecutionMetricsAdapter,
} from "./services/otel.evaluation-execution-metrics.service.ts";
export { DirectEvaluationExecutionReceiptAdapter } from "./services/direct.evaluation-execution-receipt.service.ts";

// --------------------------------------------------------------------------- The public
// evaluation REST doors: the evaluator catalogue, the batch result log, the three evaluate
// paths and the dataset evaluation, as one declaration the process mounts.
// ---------------------------------------------------------------------------
export { evaluationsLegacyRest } from "./transport/evaluations-legacy.rest.ts";
