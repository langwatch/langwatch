import type { AutomationApi } from "@langwatch/automation-contract";
import {
  type CompleteEvaluationCommandData,
  type EvaluationRunData,
  EVALUATION_COMPLETED_EVENT_TYPE,
  EVALUATION_REPORTED_EVENT_TYPE,
  type EvaluationProcessingEvent,
  evaluationScheduledEventSchema,
  evaluationStartedEventSchema,
  evaluationCompletedEventSchema,
  evaluationReportedEventSchema,
  type ExecuteEvaluationCommandData,
  type ReportEvaluationCommandData,
  type StartEvaluationCommandData,
} from "@langwatch/evaluation-contract";
import {
  type AppendStore,
  defineAggregate,
  definePipeline,
  type FoldProjectionStore,
  type Projection,
  type RetentionPolicyResolver,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import { EvaluationCommandService } from "../services/evaluation-command.service.ts";
import type { EvaluationLifecycleService } from "../services/evaluation-lifecycle.service.ts";
import {
  type EvaluationAnalyticsData,
  EvaluationAnalyticsFoldProjection,
} from "./evaluation-analytics-fold.projection.ts";
import {
  EvaluationAnalyticsRollupMapProjection,
  type EvaluationAnalyticsRollupRow,
} from "./evaluation-analytics-rollup.projection.ts";
import { ExecuteEvaluationCommand } from "./evaluation-execution.intent.ts";
import { EvaluationRunFoldProjection } from "./evaluation-run.projection.ts";

const GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS = 5_000;
/**
 * Main's CIO_SYNC_DEBOUNCE_TTL_MS: an evaluation's completed and reported events tell
 * nurturing once.
 */
const LIFECYCLE_COMPLETED_DEDUP_TTL_MS = 300_000;

/** evaluation_processing as registered, its four commands named so their senders are typed. */
export type EvaluationProcessingPipeline = StaticPipelineDefinition<
  EvaluationProcessingEvent,
  Record<string, Projection>,
  | { name: "executeEvaluation"; payload: ExecuteEvaluationCommandData }
  | { name: "startEvaluation"; payload: StartEvaluationCommandData }
  | { name: "completeEvaluation"; payload: CompleteEvaluationCommandData }
  | { name: "reportEvaluation"; payload: ReportEvaluationCommandData }
>;

export interface EvaluationProcessingPipelineDeps {
  evalRunStore: FoldProjectionStore<EvaluationRunData>;
  evaluationAnalyticsStore: FoldProjectionStore<EvaluationAnalyticsData>;
  evaluationAnalyticsRollupAppendStore: AppendStore<EvaluationAnalyticsRollupRow>;
  executeEvaluationCommand: ExecuteEvaluationCommand;
  automations: EvaluationAutomationReactions;
  /** Records that an evaluation settled; absent where nothing composes a lifecycle. */
  lifecycle?: Pick<EvaluationLifecycleService, "completed">;
  /** Each tenant's retention; a producer, which projects nothing, declares none. */
  retention?: RetentionPolicyResolver;
}

/** The two automation reactions a terminal evaluation wakes. */
export type EvaluationAutomationReactions = Pick<
  AutomationApi,
  "handleEvaluationTriggerMatch" | "handleEvaluationGraphTriggerActivity"
>;

/** Tracks evaluation lifecycle (scheduled → completed) via evaluation-level aggregates. */
export class EvaluationProcessingPipelineAdapter {
  static create(deps: EvaluationProcessingPipelineDeps): EvaluationProcessingPipelineAdapter {
    return new EvaluationProcessingPipelineAdapter(deps);
  }

  static createPipeline(
    deps: EvaluationProcessingPipelineDeps,
  ): ReturnType<EvaluationProcessingPipelineAdapter["build"]> {
    return EvaluationProcessingPipelineAdapter.create(deps).build();
  }

  private constructor(private readonly deps: EvaluationProcessingPipelineDeps) {}

  build(): EvaluationProcessingPipeline {
    const commands = EvaluationCommandService.create();

    const pipeline = definePipeline({
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
          this.deps.automations.handleEvaluationTriggerMatch({ event, context }),
      })
      .withProjectionSubscriber("lifecycleCompleted", {
        fold: "evaluationRun",
        events: [EVALUATION_COMPLETED_EVENT_TYPE, EVALUATION_REPORTED_EVENT_TYPE],
        dedupId: (event) => `${event.tenantId}:${event.aggregateId}`,
        ttl: LIFECYCLE_COMPLETED_DEDUP_TTL_MS,
        handler: async (event, context) => {
          await this.deps.lifecycle?.completed({
            projectId: context.tenantId,
            run: context.state,
            occurredAt: event.occurredAt,
          });
        },
      })
      .withEventSubscriber("graphTriggerActivity", {
        events: [EVALUATION_COMPLETED_EVENT_TYPE, EVALUATION_REPORTED_EVENT_TYPE],
        delay: GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS,
        dedup: {
          makeId: EvaluationProcessingPipelineAdapter.graphTriggerActivityGroupKey.bind(
            EvaluationProcessingPipelineAdapter,
          ),
          ttlMs: GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS,
          extend: false,
          replace: false,
        },
        // Same tenant lane as the trace-processing registration: the group id
        // carries no pipeline segment, so both pipelines' sweeps serialize in
        // ONE lane per tenant — a sweep evaluates all of the tenant's graph
        // triggers regardless of which event kind woke it.
        groupKeyFn: EvaluationProcessingPipelineAdapter.graphTriggerActivityGroupKey.bind(
          EvaluationProcessingPipelineAdapter,
        ),
        handler: (event, context) =>
          this.deps.automations.handleEvaluationGraphTriggerActivity({ event, context }),
      })
      .withCommandInstance({
        name: "executeEvaluation",
        handlerClass: ExecuteEvaluationCommand,
        instance: this.deps.executeEvaluationCommand,
        options: {
          serializeByAggregate: true,
          delay: 30_000,
          deduplication: {
            makeId: ExecuteEvaluationCommand.makeJobId.bind(ExecuteEvaluationCommand),
            ttlMs: 30_000,
          },
        },
      })
      .withCommand("startEvaluation", commands.start, {
        serializeByAggregate: true,
      })
      .withCommand("completeEvaluation", commands.complete, {
        serializeByAggregate: true,
      })
      .withCommand("reportEvaluation", commands.report, {
        serializeByAggregate: true,
      });
    const { retention } = this.deps;
    return (retention === undefined ? pipeline : pipeline.withRetention(retention)).build();
  }

  private static graphTriggerActivityGroupKey(event: { tenantId: string }): string {
    return `graph-trigger-activity:${event.tenantId}`;
  }
}

export const createEvaluationProcessingPipeline =
  EvaluationProcessingPipelineAdapter.createPipeline.bind(EvaluationProcessingPipelineAdapter);
