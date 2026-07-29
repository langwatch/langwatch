import type { TriggerService } from "~/server/app-layer/automations/trigger.service";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { createEvaluationAlertTriggerMatchSubscriber } from "~/server/event-sourcing/pipelines/automations/subscribers/evaluationAlertTriggerMatch.subscriber";
import { createGraphTriggerActivitySubscriber } from "~/server/event-sourcing/pipelines/automations/subscribers/graphTriggerActivity.subscriber";
import { definePipeline } from "../../";
import type { CommandBus } from "../../commands/commandBus";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import type { AppendStore } from "../../projections/mapProjection.types";
import { RecordTriggerMatchCommand } from "../automations/commands/recordTriggerMatch.command";
import { ReportUsageForMonthCommand } from "../billing-reporting/commands/reportUsageForMonth.command";
import { createBillingMeterPokeSubscriber } from "../billing-reporting/subscribers/billingMeterPoke.subscriber";
import { ReportEvaluationCommand, StartEvaluationCommand } from "./commands";
import {
  ExecuteEvaluationCommand,
  type ExecuteEvaluationCommandDeps,
} from "./commands/executeEvaluation.command";
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
  /**
   * What `executeEvaluation` runs on — monitors, the two trace readers, the
   * execution service, the cost recorder and the two optional function ports.
   * The command is constructed below from these; the layer-3 services stay
   * services rather than being dressed up as repositories, and naming them
   * here is more honest than hiding them in the composition root (ADR-082
   * "What does not move", migration step 6). Typed as the command's own
   * published contract, so this file cannot drift from what it takes.
   */
  executeEvaluation: ExecuteEvaluationCommandDeps;
  /** ADR-082 §5 — the cross-pipeline port the billing poke dispatches through. */
  commands: CommandBus;
  /** Usage reporting is SaaS-only; the poke is off everywhere else. */
  isSaas: boolean;
  automations: {
    /**
     * The project's automations, for matching a finished evaluation against
     * (ADR-082 layer 3). The subscriber that reads them is constructed below;
     * only the service it asks comes in as a dep.
     */
    triggers: TriggerService;
    /**
     * The committed trace summary, read by identity — the same narrow port the
     * evaluation trigger's dispatch takes (ADR-082 layer 4). A function rather
     * than the `FoldProjectionStore` so this reader cannot write through it,
     * and so every reader of the summary agrees on the tier.
     */
    readTraceSummary: (params: {
      tenantId: string;
      traceId: string;
      occurredAtMs?: number;
    }) => Promise<TraceSummaryData | null>;
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
    // The delay, the dedup key and the enqueue filter belong to the subscriber
    // itself, so this mount states only that it runs here and over what
    // (ADR-082 Rule 1). `recordTriggerMatch` is a command-bus port into the
    // automations pipeline: it binds now and resolves on first dispatch, so
    // that pipeline's registration order relative to this one carries no
    // meaning.
    .withEventSubscriber(
      "triggerMatch",
      createEvaluationAlertTriggerMatchSubscriber({
        triggers: deps.automations.triggers,
        readTraceSummary: deps.automations.readTraceSummary,
        recordTriggerMatch: {
          send: deps.commands.port(RecordTriggerMatchCommand),
        },
      }),
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
      new ExecuteEvaluationCommand(deps.executeEvaluation),
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
