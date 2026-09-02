export {
  EvaluationAdapter,
  type EvaluationAdapterOptions,
} from "./adapters/evaluation.clickhouse.adapter";
/**
 * The `evaluation_runs` repository, for a process that needs one read and not
 * the service around it.
 *
 * Automation settlement re-checks a matched trace against its evaluation runs;
 * that is one ClickHouse read, and reaching it through `EvaluationAdapter`
 * would make the caller synthesise an executor and a whole workflow capability
 * it never touches. Exported so the read is reused rather than written twice.
 */
export { ClickHouseEvaluationRepository } from "./repositories/clickhouse/evaluation.repository";
export {
  EvaluationEventingAdapter,
  type EvaluationEventingStores,
} from "./adapters/evaluation.eventing.adapter";
export { EvaluationRunProjectionPort } from "./ports/evaluation-run-projection.port";
export { EvaluationRunProjectionService } from "./services/evaluation-run-projection.service";
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
} from "./ports/evaluation.port";
export {
  EvaluationInputsOffloadService,
  EVALUATION_INPUTS_STORED_OBJECT_MARKER_KEY,
  STORED_OBJECT_MARKER_KEY,
  isStoredObjectMarker,
  type EvaluationInputOffloadConfig,
  type StoredObjectInputsMarker,
} from "./services/evaluation-inputs-offload.service";
export {
  EVAL_INPUTS_INLINE_MAX_BYTES,
  EVAL_INPUTS_HARD_CEILING_BYTES,
  EVAL_INPUTS_PREVIEW_BYTES,
  EVAL_INPUTS_STORED_OBJECT_PURPOSE,
} from "./services/evaluation-inputs-offload.service";
export { ExecuteEvaluationCommand } from "./intents/evaluation-execution.intent";
export { EvaluationService, type EvaluationServiceOptions } from "./services/evaluation.service";
export {
  EvaluationExecutionIntentService,
  type ExecuteEvaluationCommandDeps,
} from "./services/evaluation-execution-intent.service";
export {
  createEvaluationProcessingPipeline,
  type EvaluationProcessingPipelineDeps,
} from "./adapters/evaluation-processing.adapter";
export { createEvaluationProcessingProducerPipeline } from "./adapters/evaluation-processing-producer.adapter";
export {
  evaluatorUnavailability,
  unavailableEvaluatorMessage,
  LINGUA_ENABLE_ENV_VAR,
  PRESIDIO_ENABLE_ENV_VAR,
  type EvaluatorInstallEnvironment,
} from "./services/evaluator-availability.service";
export type { EvaluationRunData } from "@langwatch/evaluation-contract";
export {
  EvaluationTrpcApi,
  type EvaluationTrpcContext,
  type EvaluationTrpcPorts,
  type EvaluationRunOutcome,
  type EvaluatorUnavailability,
} from "./transport/api-trpc/evaluation.api";
export { EvaluationNameAutoslugService } from "./services/evaluation-name-autoslug.service";
export {
  EvaluationPreconditionService,
  PRECONDITION_FIELDS,
} from "./services/evaluation-precondition.service";

/** The Postgres cost ledger an evaluation run writes into. Was
 * `platform/app/src/server/app-layer/evaluations/evaluation-cost.recorder.ts`. */
export { PrismaEvaluationCostRecorder } from "./adapters/prisma.evaluation-cost-recorder.adapter";

/**
 * The ONLINE execution path: rendering a stored trace through its evaluator
 * mappings and running the evaluator over the result. Was
 * `platform/app/src/server/app-layer/evaluations/evaluation-execution.service.ts`.
 */
export {
  EvaluationExecutionService,
  type EvaluationExecutionDeps,
  extractParentTraceForNlpgo,
  maxCausalityDepthOfSpans,
} from "./services/evaluation-execution.service";
export {
  hasThreadMappings,
  resolveThreadMappingsIntoData,
  type GetThreadTraces,
} from "./services/evaluation-thread-mapping.service";
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
} from "./ports/evaluation-execution.port";
export {
  HttpLangevalsEvaluatorAdapter,
  NullLangevalsEvaluatorClient,
  type LangevalsRuntimeConfig,
} from "./adapters/http.langevals-evaluator.adapter";
export { DirectEvaluationExecutionReceipt } from "./adapters/direct.evaluation-execution-receipt.adapter";
