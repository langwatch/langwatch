export { EvaluationApp } from "./app/evaluation.app.ts";
export { evaluationServer } from "./evaluation.server.ts";
export { ExecuteEvaluationCommand } from "./eventing/evaluation-execution.intent.ts";
export { EvaluationNameAutoslugService } from "./services/evaluation-name-autoslug.service.ts";

// Restored: these names have consumers outside this module.
export { ClickHouseEvaluationRepository } from "./repositories/clickhouse/evaluation.repository.ts";
export { EvaluationRunProjectionService } from "./services/evaluation-run-projection.service.ts";
export type {
  EvaluationExecution,
  EvaluationExecutionIntent,
  EvaluationCostRecorder,
  EvaluationInputStorage,
  EvaluationAzureSafetyCredentials,
  EvaluationSettingsRecovery,
  EvaluationInputsOffload,
  EvaluationInputsResolution,
  EvaluationRetentionFloor,
  EvaluationLangevals,
  EvaluationModelEnv,
  EvaluationSpanDigest,
  EvaluationWorkflowExecutor,
  EvaluationTraceProtections,
  LangevalsEvaluateParams,
} from "./app/evaluation.members.ts";
export type {
  EvaluationClickHouseResolver,
  EvaluationClickHouseClient,
} from "./repositories/clickhouse/evaluation-clickhouse-client.ts";
export {
  EvaluationInputsOffloadService,
  EVAL_INPUTS_INLINE_MAX_BYTES,
  EVAL_INPUTS_HARD_CEILING_BYTES,
  EVAL_INPUTS_PREVIEW_BYTES,
} from "./services/evaluation-inputs-offload.service.ts";
export { EvaluationExecutionIntentService } from "./services/evaluation-execution-intent.service.ts";
export { createEvaluationProcessingPipeline } from "./services/evaluation-processing.service.ts";
export { EvaluationCostService } from "./services/evaluation-cost.service.ts";
export {
  EvaluationExecutionService,
  type EvaluationExecutionDeps,
} from "./services/evaluation-execution.service.ts";
export { OtelEvaluationExecutionMetricsService } from "./services/otel.evaluation-execution-metrics.service.ts";
export { DirectEvaluationExecutionReceiptService } from "./services/direct.evaluation-execution-receipt.service.ts";
export { ClickhouseMonitorPerformanceRepository as MonitorPerformanceAdapter } from "./repositories/clickhouse/clickhouse.monitor-performance.repository.ts";
