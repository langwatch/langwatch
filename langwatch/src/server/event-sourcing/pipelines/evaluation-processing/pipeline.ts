import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import { definePipeline } from "../../";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import type { ReactorDefinition } from "../../reactors/reactor.types";
import {
  StartEvaluationCommand,
  CompleteEvaluationCommand,
  ReportEvaluationCommand,
} from "./commands";
import { ExecuteEvaluationCommand } from "./commands/executeEvaluation.command";
import { EvaluationRunFoldProjection } from "./projections/evaluationRun.foldProjection";
import type { EvaluationProcessingEvent } from "./schemas/events";

export interface EvaluationProcessingPipelineDeps {
  evalRunStore: FoldProjectionStore<EvaluationRunData>;
  executeEvaluationCommand: ExecuteEvaluationCommand;
  esSyncReactor: ReactorDefinition<EvaluationProcessingEvent, EvaluationRunData>;
  customerIoEvaluationSyncReactor?: ReactorDefinition<EvaluationProcessingEvent, EvaluationRunData>;
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
  let builder = definePipeline<EvaluationProcessingEvent>()
    .withName("evaluation_processing")
    .withAggregateType("evaluation")
    .withFoldProjection("evaluationRun", new EvaluationRunFoldProjection({
      store: deps.evalRunStore,
    }))
    .withReactor("evaluationRun", "evaluationEsSync", deps.esSyncReactor);

  if (deps.customerIoEvaluationSyncReactor) {
    builder = builder.withReactor(
      "evaluationRun",
      "customerIoEvaluationSync",
      deps.customerIoEvaluationSyncReactor,
    );
  }

  return builder
    .withCommandInstance("executeEvaluation", ExecuteEvaluationCommand, deps.executeEvaluationCommand, {
      delay: 30_000,
      deduplication: {
        makeId: ExecuteEvaluationCommand.makeJobId,
        ttlMs: 30_000,
      },
    })
    .withCommand("startEvaluation", StartEvaluationCommand)
    .withCommand("completeEvaluation", CompleteEvaluationCommand)
    .withCommand("reportEvaluation", ReportEvaluationCommand)
    .build();
}
