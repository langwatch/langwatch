import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import { definePipeline } from "../../";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import type { ReactorDefinition } from "../../reactors/reactor.types";
import { CompleteEvaluationCommand } from "./commands/completeEvaluation.command";
import { StartEvaluationCommand } from "./commands/startEvaluation.command";
import { createEvaluationRunFoldProjection } from "./projections/evaluationRun.foldProjection";
import type { EvaluationProcessingEvent } from "./schemas/events";

export interface EvaluationProcessingPipelineDeps {
  evalRunStore: FoldProjectionStore<EvaluationRunData>;
  ExecuteEvaluationCommand: {
    new (): any;
    readonly schema: any;
    getAggregateId(payload: any): string;
    getSpanAttributes?(payload: any): Record<string, string | number | boolean>;
    makeJobId(payload: any): string;
  };
  esSyncReactor: ReactorDefinition<EvaluationProcessingEvent, EvaluationRunData>;
}

/**
 * Creates the evaluation processing pipeline definition.
 *
 * This pipeline uses evaluation-level aggregates (aggregateId = evaluationId).
 * It tracks the lifecycle of individual evaluations (scheduled -> completed)
 * and enables detection of stuck evaluations.
 *
 * Commands:
 * - executeEvaluation: Preconditions + sampling + run eval + ES write + emit events (reactor path)
 * - startEvaluation: Records eval start to CH (API handler path)
 * - completeEvaluation: Records eval result to CH (API handler path)
 */
export function createEvaluationProcessingPipeline(deps: EvaluationProcessingPipelineDeps) {
  return definePipeline<EvaluationProcessingEvent>()
    .withName("evaluation_processing")
    .withAggregateType("evaluation")
    .withFoldProjection("evaluationRun", createEvaluationRunFoldProjection({
      store: deps.evalRunStore,
    }))
    .withReactor("evaluationRun", "evaluationEsSync", deps.esSyncReactor)
    .withCommand("executeEvaluation", deps.ExecuteEvaluationCommand, {
      delay: 30_000,
      deduplication: {
        makeId: deps.ExecuteEvaluationCommand.makeJobId,
        ttlMs: 30_000,
      },
    })
    .withCommand("startEvaluation", StartEvaluationCommand)
    .withCommand("completeEvaluation", CompleteEvaluationCommand)
    .build();
}
