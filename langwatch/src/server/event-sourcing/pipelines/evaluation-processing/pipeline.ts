import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import { definePipeline } from "../../";
import type { OutboxReactorDefinition } from "../../outbox/outboxReactor.types";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import type { AppendStore } from "../../projections/mapProjection.types";
import type { ReactorDefinition } from "../../reactors/reactor.types";
import {
  CompleteEvaluationCommand,
  ReportEvaluationCommand,
  StartEvaluationCommand,
} from "./commands";
import { ExecuteEvaluationCommand } from "./commands/executeEvaluation.command";
import {
  type EvaluationAnalyticsData,
  EvaluationAnalyticsFoldProjection,
} from "./projections/evaluationAnalytics.foldProjection";
import {
  type EvaluationAnalyticsRollupRow,
  EvaluationAnalyticsRollupMapProjection,
} from "./projections/evaluationAnalyticsRollup.mapProjection";
import { EvaluationRunFoldProjection } from "./projections/evaluationRun.foldProjection";
import type { EvaluationProcessingEvent } from "./schemas/events";

export interface EvaluationProcessingPipelineDeps {
  evalRunStore: FoldProjectionStore<EvaluationRunData>;
  /** ADR-034 Phase 6: slim per-evaluation fold writer (eval mirror of
   *  `traceAnalyticsStore`). */
  evaluationAnalyticsStore: FoldProjectionStore<EvaluationAnalyticsData>;
  /** ADR-034 Phase 6: per-evaluation rollup writer (eval mirror of
   *  `traceAnalyticsRollupAppendStore`). */
  evaluationAnalyticsRollupAppendStore: AppendStore<EvaluationAnalyticsRollupRow>;
  executeEvaluationCommand: ExecuteEvaluationCommand;
  esSyncReactor: ReactorDefinition<
    EvaluationProcessingEvent,
    EvaluationRunData
  >;
  /** PERSIST-class branch of the evaluation alert trigger, routed
   *  through the framework's `.withOutbox` plumbing (ADR-030 + ADR-035).
   *  Emits settle payloads stamped `actionClass: "persist"`. */
  evaluationAlertTriggerReactor: OutboxReactorDefinition<
    EvaluationProcessingEvent,
    EvaluationRunData
  >;
  /** NOTIFY-class branch of the evaluation alert trigger, routed
   *  through the framework's `.withOutbox` plumbing (ADR-030). */
  evaluationAlertTriggerNotifyOutboxReactor: OutboxReactorDefinition<
    EvaluationProcessingEvent,
    EvaluationRunData
  >;
  /**
   * ADR-034 Phase 6: real-time path for eval-metric custom-graph threshold
   * alerts. Attached on `evaluationAnalytics` (the slim eval fold) so it
   * fires on every slim-fold update; debounced per (triggerId, projectId)
   * inside the reactor's `decide`. Flag-gated per project via the same
   * `release_es_graph_triggers_firing` flag the trace pipeline uses —
   * disabled = empty decide; cron handles the project's graph triggers
   * as today.
   */
  graphTriggerEvaluationOutboxReactor: OutboxReactorDefinition<
    EvaluationProcessingEvent,
    EvaluationAnalyticsData
  >;
  customerIoEvaluationSyncReactor?: ReactorDefinition<
    EvaluationProcessingEvent,
    EvaluationRunData
  >;
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
export function createEvaluationProcessingPipeline(
  deps: EvaluationProcessingPipelineDeps,
) {
  let builder = definePipeline<EvaluationProcessingEvent>()
    .withName("evaluation_processing")
    .withAggregateType("evaluation")
    .withFoldProjection(
      "evaluationRun",
      new EvaluationRunFoldProjection({
        store: deps.evalRunStore,
      }),
    )
    .withFoldProjection(
      "evaluationAnalytics",
      new EvaluationAnalyticsFoldProjection({
        store: deps.evaluationAnalyticsStore,
      }),
    )
    .withMapProjection(
      "evaluationAnalyticsRollup",
      new EvaluationAnalyticsRollupMapProjection({
        store: deps.evaluationAnalyticsRollupAppendStore,
      }),
    )
    .withReactor("evaluationRun", "evaluationEsSync", deps.esSyncReactor)
    .withOutbox(
      "evaluationRun",
      "evaluationAlertTrigger",
      deps.evaluationAlertTriggerReactor,
    )
    .withOutbox(
      "evaluationRun",
      "evaluationAlertTriggerNotifyOutbox",
      deps.evaluationAlertTriggerNotifyOutboxReactor,
    )
    .withOutbox(
      "evaluationAnalytics",
      "graphTriggerEvaluation",
      deps.graphTriggerEvaluationOutboxReactor,
    );

  if (deps.customerIoEvaluationSyncReactor) {
    builder = builder.withReactor(
      "evaluationRun",
      "customerIoEvaluationSync",
      deps.customerIoEvaluationSyncReactor,
    );
  }

  return builder
    .withCommandInstance(
      "executeEvaluation",
      ExecuteEvaluationCommand,
      deps.executeEvaluationCommand,
      {
        delay: 30_000,
        deduplication: {
          makeId: ExecuteEvaluationCommand.makeJobId,
          ttlMs: 30_000,
        },
      },
    )
    .withCommand("startEvaluation", StartEvaluationCommand)
    .withCommand("completeEvaluation", CompleteEvaluationCommand)
    .withCommand("reportEvaluation", ReportEvaluationCommand)
    .build();
}
