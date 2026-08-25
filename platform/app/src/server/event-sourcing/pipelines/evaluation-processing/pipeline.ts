import {
  type AppendStore,
  defineAggregate,
  defineEvents,
  definePipeline,
  type FoldProjectionStore,
  type TriggerContext,
} from "@langwatch/eventing";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import {
  GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS,
  graphTriggerActivityGroupKey,
} from "~/server/event-sourcing/pipelines/automations/subscribers/graphTriggerActivity.subscriber";
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
  EVALUATION_PROCESSING_EVENT_TYPES,
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
}

/**
 * Creates the evaluation processing pipeline definition.
 *
 * This pipeline uses evaluation-level aggregates (aggregateId = evaluationId).
 * It tracks the lifecycle of individual evaluations (scheduled -> completed)
 * and enables detection of stuck evaluations.
 *
 * Commands:
 * - executeEvaluation: Preconditions + sampling + run eval + emit events (subscriber path)
 * - startEvaluation: Records eval start to CH (API handler path)
 * - completeEvaluation: Records eval result to CH (API handler path)
 */
export function createEvaluationProcessingPipeline(
  deps: EvaluationProcessingPipelineDeps,
) {
  return definePipeline<EvaluationProcessingEvent>({
    name: "evaluation_processing",
    aggregate: defineAggregate({
      type: "evaluation",
      events: defineEvents(EVALUATION_PROCESSING_EVENT_TYPES),
    }),
  })
    .withClickHouseFoldProjection(
      new EvaluationRunFoldProjection({
        store: deps.evalRunStore,
      }),
    )
    .withClickHouseFoldProjection(
      new EvaluationAnalyticsFoldProjection({
        store: deps.evaluationAnalyticsStore,
      }),
    )
    .withClickHouseMapProjection(
      new EvaluationAnalyticsRollupMapProjection({
        store: deps.evaluationAnalyticsRollupAppendStore,
      }),
    )
    .withProjectionSubscriber("triggerMatch", {
      fold: "evaluationRun",
      events: [EVALUATION_COMPLETED_EVENT_TYPE, EVALUATION_REPORTED_EVENT_TYPE],
      delay: 10_000,
      ttl: 30_000,
      handler: (event, context) => deps.automations.triggerMatchHandler(event, context),
    })
    .withEventSubscriber("graphTriggerActivity", {
      events: [EVALUATION_COMPLETED_EVENT_TYPE, EVALUATION_REPORTED_EVENT_TYPE],
      delay: GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS,
      dedup: {
        makeId: (event) => `graph-trigger-activity:${event.tenantId}`,
        ttlMs: GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS,
        extend: false,
        replace: false,
      },
      // Same tenant lane as the trace-processing registration: the group id
      // carries no pipeline segment, so both pipelines' sweeps serialize in
      // ONE lane per tenant — a sweep evaluates all of the tenant's graph
      // triggers regardless of which event kind woke it.
      groupKeyFn: graphTriggerActivityGroupKey,
      handler: (event, context) => deps.automations.graphActivityHandler(event, context),
    })
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
