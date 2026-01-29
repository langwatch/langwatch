import { definePipeline } from "../../library";
import { CompleteEvaluationCommand } from "./commands/completeEvaluation.command";
import { ScheduleEvaluationCommand } from "./commands/scheduleEvaluation.command";
import { StartEvaluationCommand } from "./commands/startEvaluation.command";
import { EvaluationStateProjectionHandler } from "./projections";
import type { EvaluationProcessingEvent } from "./schemas/events";

/**
 * Evaluation processing pipeline definition (static, no runtime dependencies).
 *
 * This pipeline uses evaluation-level aggregates (aggregateId = evaluationId).
 * It tracks the lifecycle of individual evaluations (scheduled → started → completed)
 * and enables detection of stuck evaluations.
 *
 * Commands:
 * - scheduleEvaluation: Emits EvaluationScheduledEvent when job is queued
 * - startEvaluation: Emits EvaluationStartedEvent when execution begins
 * - completeEvaluation: Emits EvaluationCompletedEvent when execution finishes
 *
 * This is a static definition that can be safely imported without triggering
 * ClickHouse/Redis connections. It gets registered with the runtime in
 * the eventSourcing.ts file.
 */
export const evaluationProcessingPipelineDefinition =
  definePipeline<EvaluationProcessingEvent>()
    .withName("evaluation_processing")
    .withAggregateType("evaluation")
    .withProjection("evaluationState", EvaluationStateProjectionHandler, {
      // Dedupe by aggregate to process only the latest event per evaluation
      deduplication: "aggregate",
      // Small delay to batch multiple rapid updates to the same evaluation
      delay: 500,
    })
    .withCommand("scheduleEvaluation", ScheduleEvaluationCommand)
    .withCommand("startEvaluation", StartEvaluationCommand)
    .withCommand("completeEvaluation", CompleteEvaluationCommand)
    .build();
