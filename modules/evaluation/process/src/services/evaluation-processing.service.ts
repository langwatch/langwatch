import type { AutomationEvaluationSubscriberService } from "@langwatch/automation-contract";
import {
  type EvaluationRunData,
  EVALUATION_COMPLETED_EVENT_TYPE,
  EVALUATION_REPORTED_EVENT_TYPE,
  type EvaluationProcessingEvent,
  evaluationScheduledEventSchema,
  evaluationStartedEventSchema,
  evaluationCompletedEventSchema,
  evaluationReportedEventSchema,
} from "@langwatch/evaluation-contract";
import {
  type AppendStore,
  defineAggregate,
  definePipeline,
  type FoldProjectionStore,
  type Projection,
  type RegisteredCommand,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import {
  type EvaluationAnalyticsData,
  EvaluationAnalyticsFoldProjection,
} from "../eventing/evaluation-analytics-fold.projection.ts";
import {
  EvaluationAnalyticsRollupMapProjection,
  type EvaluationAnalyticsRollupRow,
} from "../eventing/evaluation-analytics-rollup.projection.ts";
import { ExecuteEvaluationCommand } from "../eventing/evaluation-execution.intent.ts";
import { EvaluationRunFoldProjection } from "../eventing/evaluation-run.projection.ts";
import { EvaluationCommandAdapter } from "./evaluation-command.service.ts";

const GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS = 5_000;

export interface EvaluationProcessingPipelineDeps {
  evalRunStore: FoldProjectionStore<EvaluationRunData>;
  evaluationAnalyticsStore: FoldProjectionStore<EvaluationAnalyticsData>;
  evaluationAnalyticsRollupAppendStore: AppendStore<EvaluationAnalyticsRollupRow>;
  executeEvaluationCommand: ExecuteEvaluationCommand;
  automations: AutomationEvaluationSubscriberService;
}

/** Tracks evaluation lifecycle (scheduled → completed) via evaluation-level aggregates. */
export class EvaluationProcessingAdapter {
  static create(deps: EvaluationProcessingPipelineDeps): EvaluationProcessingAdapter {
    return new EvaluationProcessingAdapter(deps);
  }

  static createPipeline(
    deps: EvaluationProcessingPipelineDeps,
  ): ReturnType<EvaluationProcessingAdapter["build"]> {
    return EvaluationProcessingAdapter.create(deps).build();
  }

  private constructor(private readonly deps: EvaluationProcessingPipelineDeps) {}

  build(): StaticPipelineDefinition<
    EvaluationProcessingEvent,
    Record<string, Projection>,
    RegisteredCommand
  > {
    const commands = EvaluationCommandAdapter.create();

    return definePipeline<EvaluationProcessingEvent>({
      name: "evaluation_processing",
      aggregate: defineAggregate({
        type: "evaluation",
      }),
    })
      .withEvents([
        evaluationScheduledEventSchema,
        evaluationStartedEventSchema,
        evaluationCompletedEventSchema,
        evaluationReportedEventSchema,
      ])
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
          makeId: EvaluationProcessingAdapter.graphTriggerActivityGroupKey.bind(
            EvaluationProcessingAdapter,
          ),
          ttlMs: GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS,
          extend: false,
          replace: false,
        },
        // Same tenant lane as the trace-processing registration: the group id
        // carries no pipeline segment, so both pipelines' sweeps serialize in
        // ONE lane per tenant — a sweep evaluates all of the tenant's graph
        // triggers regardless of which event kind woke it.
        groupKeyFn: EvaluationProcessingAdapter.graphTriggerActivityGroupKey.bind(
          EvaluationProcessingAdapter,
        ),
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
            makeId: ExecuteEvaluationCommand.makeJobId.bind(ExecuteEvaluationCommand),
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

export const createEvaluationProcessingPipeline = EvaluationProcessingAdapter.createPipeline.bind(
  EvaluationProcessingAdapter,
);
