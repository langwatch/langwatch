import { definePipeline } from "../../library";
import { CompleteBatchEvaluationCommand } from "./commands/completeBatchEvaluation.command";
import { RecordEvaluatorResultCommand } from "./commands/recordEvaluatorResult.command";
import { RecordTargetResultCommand } from "./commands/recordTargetResult.command";
import { StartBatchEvaluationCommand } from "./commands/startBatchEvaluation.command";
import { BatchEvaluationResultStorageHandler } from "./handlers";
import { BatchEvaluationRunStateProjectionHandler } from "./projections";
import {
  EVALUATOR_RESULT_RECEIVED_EVENT_TYPE,
  TARGET_RESULT_RECEIVED_EVENT_TYPE,
} from "./schemas/constants";
import type { BatchEvaluationProcessingEvent } from "./schemas/events";

/**
 * Batch evaluation processing pipeline definition (static, no runtime dependencies).
 *
 * This pipeline uses batch_evaluation_run aggregates (aggregateId = runId).
 * It tracks the lifecycle of batch evaluation runs (evaluations-v3 feature):
 * - started -> target results received -> evaluator results received -> completed
 *
 * Projection: batchEvaluationRunState
 * - Computes summary statistics (progress, costs, scores, pass rate)
 * - Stored in batch_evaluation_runs ClickHouse table
 *
 * Event Handler: batchEvaluationResultStorage
 * - Writes individual results to batch_evaluation_results for query-optimized access
 * - Enables efficient filtering/sorting of detailed results
 *
 * Commands:
 * - startBatchEvaluation: Emits BatchEvaluationStartedEvent when run begins
 * - recordTargetResult: Emits TargetResultReceivedEvent per row/target
 * - recordEvaluatorResult: Emits EvaluatorResultReceivedEvent per row/evaluator
 * - completeBatchEvaluation: Emits BatchEvaluationCompletedEvent when run finishes
 *
 * This is a static definition that can be safely imported without triggering
 * ClickHouse/Redis connections. It gets registered with the runtime in
 * the eventSourcing.ts file.
 */
export const batchEvaluationProcessingPipelineDefinition =
  definePipeline<BatchEvaluationProcessingEvent>()
    .withName("batch_evaluation_processing")
    .withAggregateType("batch_evaluation_run")
    .withProjection(
      "batchEvaluationRunState",
      BatchEvaluationRunStateProjectionHandler,
      {
        // Dedupe by aggregate to process only the latest event per run
        deduplication: "aggregate",
        // Balance of real-time feel + batching; projection is lightweight
        delay: 500,
      },
    )
    .withEventHandler(
      "batchEvaluationResultStorage",
      BatchEvaluationResultStorageHandler,
      {
        eventTypes: [
          TARGET_RESULT_RECEIVED_EVENT_TYPE,
          EVALUATOR_RESULT_RECEIVED_EVENT_TYPE,
        ],
      },
    )
    .withCommand("startBatchEvaluation", StartBatchEvaluationCommand)
    .withCommand("recordTargetResult", RecordTargetResultCommand)
    .withCommand("recordEvaluatorResult", RecordEvaluatorResultCommand)
    .withCommand("completeBatchEvaluation", CompleteBatchEvaluationCommand)
    .build();
