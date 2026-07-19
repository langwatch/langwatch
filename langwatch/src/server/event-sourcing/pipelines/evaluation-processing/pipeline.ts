import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import { GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS } from "~/server/event-sourcing/pipelines/automations/subscribers/graphTriggerActivity.subscriber";
import { definePipeline } from "../../";
import type { TriggerContext } from "../../pipeline/processManagerDefinition";
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
  EvaluationAnalyticsRollupMapProjection,
  type EvaluationAnalyticsRollupRow,
} from "./projections/evaluationAnalyticsRollup.mapProjection";
import { EvaluationRunFoldProjection } from "./projections/evaluationRun.foldProjection";
import {
  EVALUATION_COMPLETED_EVENT_TYPE,
  EVALUATION_REPORTED_EVENT_TYPE,
} from "./schemas/constants";
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
  automations: {
    triggerMatchHandler: (
      event: EvaluationProcessingEvent,
      context: TriggerContext<EvaluationRunData>,
    ) => Promise<void>;
    graphActivityHandler: (
      event: EvaluationProcessingEvent,
      context: { tenantId: string },
    ) => Promise<void>;
  };
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
 * - executeEvaluation: Preconditions + sampling + run eval + emit events (reactor path)
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
    .withSubscriber("triggerMatch", {
      fold: "evaluationRun",
      events: [
        EVALUATION_COMPLETED_EVENT_TYPE,
        EVALUATION_REPORTED_EVENT_TYPE,
      ],
      delay: 10_000,
      ttl: 30_000,
      handler: (event, context) =>
        deps.automations.triggerMatchHandler(event, context),
    })
    .withSubscriber("graphTriggerActivity", {
      events: [
        EVALUATION_COMPLETED_EVENT_TYPE,
        EVALUATION_REPORTED_EVENT_TYPE,
      ],
      delay: GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS,
      dedup: {
        makeId: (event) => `graph-trigger-activity:${event.tenantId}`,
        ttlMs: GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS,
        extend: false,
        replace: false,
      },
      handler: (event, context) =>
        deps.automations.graphActivityHandler(event, context),
    });

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
        serializeByAggregate: true,
        delay: 30_000,
        deduplication: {
          makeId: ExecuteEvaluationCommand.makeJobId,
          ttlMs: 30_000,
        },
      },
    )
    .withCommand("startEvaluation", StartEvaluationCommand, {
      serializeByAggregate: true,
    })
    .withCommand("completeEvaluation", CompleteEvaluationCommand, {
      serializeByAggregate: true,
    })
    .withCommand("reportEvaluation", ReportEvaluationCommand, {
      serializeByAggregate: true,
    })
    .build();
}
