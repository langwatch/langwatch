import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import { createGraphTriggerActivitySubscriber } from "~/server/event-sourcing/pipelines/automations/subscribers/graphTriggerActivity.subscriber";
import { definePipeline } from "../../";
import type { CommandBus } from "../../commands/commandBus";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import type { AppendStore } from "../../projections/mapProjection.types";
import type { EventSubscriberDefinition } from "../../subscribers/eventSubscriber.types";
import { ReportUsageForMonthCommand } from "../billing-reporting/commands/reportUsageForMonth.command";
import { createBillingMeterPokeSubscriber } from "../billing-reporting/subscribers/billingMeterPoke.subscriber";
import { ReportEvaluationCommand, StartEvaluationCommand } from "./commands";
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
  /** ADR-082 §5 — the cross-pipeline port the billing poke dispatches through. */
  commands: CommandBus;
  /** Usage reporting is SaaS-only; the poke is off everywhere else. */
  isSaas: boolean;
  automations: {
    /**
     * Matches a finished evaluation against the project's automations. A
     * subscriber definition rather than a handler: the delay, the dedup key and
     * the enqueue filter belong to the subscriber now, not to this mount.
     */
    triggerMatchSubscriber: EventSubscriberDefinition<EvaluationProcessingEvent>;
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
 * - executeEvaluation: Preconditions + sampling + run eval + emit events
 * - startEvaluation: Records eval start to CH (API handler path)
 * - reportEvaluation: Records one finished evaluation atomically
 *
 * `lw.evaluation.completed` has no command any more — nothing dispatched one.
 * The event type, its schema, its type guard and the fold's handling of it all
 * stay: historical `completed` events are in `event_log` and replay must keep
 * parsing them.
 */
export function createEvaluationProcessingPipeline(
  deps: EvaluationProcessingPipelineDeps,
) {
  const builder = definePipeline<EvaluationProcessingEvent>()
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
    .withEventSubscriber(
      "triggerMatch",
      deps.automations.triggerMatchSubscriber,
    )
    // `reported` is the only evaluation event `orgBillableEventsMeter` records,
    // so it is the only one worth poking on — a `completed` event bills nothing
    // and would mint a job that changes no total.
    .withEventSubscriber(
      "billingMeterPoke",
      createBillingMeterPokeSubscriber<EvaluationProcessingEvent>({
        eventTypes: [EVALUATION_REPORTED_EVENT_TYPE],
        reportUsageForMonth: deps.commands.port(ReportUsageForMonthCommand),
        isSaas: deps.isSaas,
      }),
    )
    .withEventSubscriber(
      "graphTriggerActivity",
      createGraphTriggerActivitySubscriber<EvaluationProcessingEvent>({
        eventTypes: [
          EVALUATION_COMPLETED_EVENT_TYPE,
          EVALUATION_REPORTED_EVENT_TYPE,
        ],
        handler: deps.automations.graphActivityHandler,
      }),
    );

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
    .withCommand("reportEvaluation", ReportEvaluationCommand, {
      serializeByAggregate: true,
    })
    .build();
}
