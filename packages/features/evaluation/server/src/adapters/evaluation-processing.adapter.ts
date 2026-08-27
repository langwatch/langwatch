import {
  type AppendStore,
  defineAggregate,
  defineEvents,
  definePipeline,
  type FoldProjectionStore,
} from "@langwatch/eventing";
import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import type { AutomationEvaluationSubscriberService } from "@langwatch/automation-contract";
import {
  EVALUATION_COMPLETED_EVENT_TYPE,
  EVALUATION_PROCESSING_EVENT_TYPES,
  EVALUATION_REPORTED_EVENT_TYPE,
  type EvaluationProcessingEvent,
} from "@langwatch/evaluation-contract";
import {
  type EvaluationAnalyticsData,
  EvaluationAnalyticsFoldProjection,
} from "../projections/evaluation-analytics-fold.projection";
import {
  EvaluationAnalyticsRollupMapProjection,
  type EvaluationAnalyticsRollupRow,
} from "../projections/evaluation-analytics-rollup.projection";
import { EvaluationRunFoldProjection } from "../projections/evaluation-run.projection";
import { ExecuteEvaluationCommand } from "../intents/evaluation-execution.intent";
import { EvaluationCommandAdapter } from "./evaluation-command.adapter";

const GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS = 5_000;

export interface EvaluationProcessingPipelineDeps {
  evalRunStore: FoldProjectionStore<EvaluationRunData>;
  evaluationAnalyticsStore: FoldProjectionStore<EvaluationAnalyticsData>;
  evaluationAnalyticsRollupAppendStore: AppendStore<EvaluationAnalyticsRollupRow>;
  executeEvaluationCommand: ExecuteEvaluationCommand;
  automations: AutomationEvaluationSubscriberService;
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
export class EvaluationProcessingAdapter {
  static create(deps: EvaluationProcessingPipelineDeps): EvaluationProcessingAdapter {
    return new EvaluationProcessingAdapter(deps);
  }

  static createPipeline(deps: EvaluationProcessingPipelineDeps) {
    return EvaluationProcessingAdapter.create(deps).build();
  }

  private constructor(private readonly deps: EvaluationProcessingPipelineDeps) {}

  build() {
    const commands = EvaluationCommandAdapter.create();

    return definePipeline<EvaluationProcessingEvent>({
      name: "evaluation_processing",
      aggregate: defineAggregate({
        type: "evaluation",
        events: defineEvents(EVALUATION_PROCESSING_EVENT_TYPES),
      }),
    })
      .withClickHouseFoldProjection(
        EvaluationRunFoldProjection.create({
          store: this.deps.evalRunStore,
        }),
      )
      .withClickHouseFoldProjection(
        EvaluationAnalyticsFoldProjection.create({
          store: this.deps.evaluationAnalyticsStore,
        }),
      )
      .withClickHouseMapProjection(
        EvaluationAnalyticsRollupMapProjection.create({
          store: this.deps.evaluationAnalyticsRollupAppendStore,
        }),
      )
      .withProjectionSubscriber("triggerMatch", {
        fold: "evaluationRun",
        events: [EVALUATION_COMPLETED_EVENT_TYPE, EVALUATION_REPORTED_EVENT_TYPE],
        delay: 10_000,
        ttl: 30_000,
        handler: (event, context) =>
          this.deps.automations.handleEvaluationTriggerMatch(event, context),
      })
      .withEventSubscriber("graphTriggerActivity", {
        events: [EVALUATION_COMPLETED_EVENT_TYPE, EVALUATION_REPORTED_EVENT_TYPE],
        delay: GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS,
        dedup: {
          makeId: EvaluationProcessingAdapter.graphTriggerActivityGroupKey,
          ttlMs: GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS,
          extend: false,
          replace: false,
        },
        // Same tenant lane as the trace-processing registration: the group id
        // carries no pipeline segment, so both pipelines' sweeps serialize in
        // ONE lane per tenant — a sweep evaluates all of the tenant's graph
        // triggers regardless of which event kind woke it.
        groupKeyFn: EvaluationProcessingAdapter.graphTriggerActivityGroupKey,
        handler: (event, context) =>
          this.deps.automations.handleEvaluationGraphTriggerActivity(event, context),
      })
      .withCommandInstance(
        "executeEvaluation",
        ExecuteEvaluationCommand,
        this.deps.executeEvaluationCommand,
        {
          serializeByAggregate: true,
          delay: 30_000,
          deduplication: {
            makeId: ExecuteEvaluationCommand.makeJobId,
            ttlMs: 30_000,
          },
        },
      )
      .withCommand("startEvaluation", commands.start, {
        serializeByAggregate: true,
      })
      .withCommand("completeEvaluation", commands.complete, {
        serializeByAggregate: true,
      })
      .withCommand("reportEvaluation", commands.report, {
        serializeByAggregate: true,
      })
      .build();
  }

  private static graphTriggerActivityGroupKey(event: { tenantId: string }): string {
    return `graph-trigger-activity:${event.tenantId}`;
  }
}

export const createEvaluationProcessingPipeline = EvaluationProcessingAdapter.createPipeline;
