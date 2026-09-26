import {
  RECORD_TRIGGER_MATCH_COMMAND_TYPE,
  REPORT_SCHEDULE_EVENT_TYPES,
  TRIGGER_MATCH_COALESCE_MAX_BATCH,
  TRIGGER_MATCH_RECORDED_EVENT_TYPE,
  triggerMatchRecordedEventDataSchema,
} from "@langwatch/automation-contract";
import { defineAggregate, definePipeline, defineCommand, EventSchema } from "@langwatch/eventing";
import { z } from "zod";

import type {
  AutomationScheduledIntent,
  AutomationSettlementExecutor,
} from "../app/automation.members.ts";
import type { AutomationIntentRetentionRepository } from "../repositories/automation-intent-retention.repository.ts";
import { runGraphAlertSweep } from "./graph-alert-sweep.intent.ts";
import {
  GRAPH_ALERT_SWEEP_INTERVAL_MS,
  type GraphAlertSweepState,
  graphAlertSweepWake,
  sweepSchema,
} from "./graph-alert-sweep.process.ts";
import {
  ConfigureReportScheduleCommand,
  PauseReportScheduleCommand,
  RequestReportRunCommand,
  ResumeReportScheduleCommand,
} from "./report-schedule.commands.ts";
import { reportScheduleEventSchemas, type ReportScheduleEvent } from "./report-schedule.events.ts";
import {
  REPORT_SCHEDULE_INTENT_TYPES,
  reportDispatchIntentSchema,
  runReportDispatch,
  type ReportDispatcher,
} from "./report-schedule.intent.ts";
import {
  INITIAL_REPORT_SCHEDULE_STATE,
  REPORT_SCHEDULE_PROCESS_NAME,
  reportRunRequested,
  reportScheduleConfigured,
  reportSchedulePaused,
  reportScheduleResumed,
  reportScheduleWake,
  type ReportScheduleState,
} from "./report-schedule.process.ts";
import {
  logOverflowIntentSchema,
  notifyDigestIntentSchema,
  persistMatchIntentSchema,
  TRIGGER_SETTLEMENT_INTENT_TYPES,
} from "./trigger-settlement.intent.ts";
import {
  INITIAL_SETTLEMENT_STATE,
  type SettlementState,
  TriggerSettlement,
} from "./trigger-settlement.process.ts";
import { runWebhookDeliveryPrune } from "./webhook-delivery-prune.intent.ts";
import {
  pruneSchema,
  WEBHOOK_DELIVERY_PRUNE_INTERVAL_MS,
  type WebhookDeliveryPruneState,
  webhookDeliveryPruneWake,
} from "./webhook-delivery-prune.process.ts";

export const RecordTriggerMatchCommand = defineCommand({
  commandType: RECORD_TRIGGER_MATCH_COMMAND_TYPE,
  eventType: TRIGGER_MATCH_RECORDED_EVENT_TYPE,
  eventVersion: "2026-07-18",
  aggregateType: "trigger",
  schema: triggerMatchRecordedEventDataSchema,
  aggregateId: ({ triggerId }) => triggerId,
  groupKey: ({ triggerId }) => triggerId,
  idempotencyKey: ({ triggerId, traceId, occurredAt, traceDebounceMs }) =>
    `${triggerId}:${traceId}:${TriggerSettlement.settleWindowBucket({ occurredAt, traceDebounceMs })}`,
  spanAttributes: ({ triggerId, traceId, actionClass }) => ({
    "automation.trigger.id": triggerId,
    "automation.trace.id": traceId,
    "automation.action.class": actionClass,
  }),
});

const triggerMatchRecordedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(TRIGGER_MATCH_RECORDED_EVENT_TYPE),
  data: triggerMatchRecordedEventDataSchema,
});

export type TriggerMatchRecordedEvent = z.infer<typeof triggerMatchRecordedEventSchema>;
export type AutomationEvent = TriggerMatchRecordedEvent | ReportScheduleEvent;

/** Only the executor dependencies are injected — the process-manager
 *  topology itself (states, intents, evolve/wake handlers, outbox tuning)
 *  is defined inline below, ADR-052 "Approved builder API". */
export interface AutomationsPipelineDeps {
  scheduledIntents: AutomationScheduledIntent;
  settlement: AutomationSettlementExecutor;
  retention: AutomationIntentRetentionRepository;
  reports: ReportDispatcher;
}

/** The whole process-manager topology, factored out so its inferred return type can be named. */
const buildAutomationsPipeline = (deps: AutomationsPipelineDeps) => {
  return definePipeline({
    name: "automations",
    aggregate: defineAggregate({
      type: "trigger",
    }),
  })
    .withEvents([triggerMatchRecordedEventSchema, ...reportScheduleEventSchemas])
    .withCommand("recordTriggerMatch", RecordTriggerMatchCommand, {
      serializeByAggregate: true,
      // ADR-066 pillar 2: a hot trigger appends one match per trace. Coalesce a
      // backed-up trigger's matches into one multi-row insert instead of one
      // tiny insert per match.
      coalesceMaxBatch: TRIGGER_MATCH_COALESCE_MAX_BATCH,
    })
    .withCommand("configureReportSchedule", ConfigureReportScheduleCommand)
    .withCommand("pauseReportSchedule", PauseReportScheduleCommand)
    .withCommand("resumeReportSchedule", ResumeReportScheduleCommand)
    .withCommand("requestReportRun", RequestReportRunCommand)
    .withProcessManager("triggerSettlement", (pm) =>
      pm
        .state<SettlementState>(INITIAL_SETTLEMENT_STATE)
        .intent(
          TRIGGER_SETTLEMENT_INTENT_TYPES.NOTIFY_DIGEST,
          notifyDigestIntentSchema,
          (payload, context) => deps.settlement.notifyDigest(payload, context),
        )
        .intent(
          TRIGGER_SETTLEMENT_INTENT_TYPES.PERSIST_MATCH,
          persistMatchIntentSchema,
          (payload, context) => deps.settlement.persistMatch(payload, context),
        )
        .intent(
          TRIGGER_SETTLEMENT_INTENT_TYPES.LOG_OVERFLOW,
          logOverflowIntentSchema,
          (payload, context) => deps.settlement.logOverflow(payload, context),
        )
        .on(TRIGGER_MATCH_RECORDED_EVENT_TYPE, (state, data, ctx) => {
          const { state: nextState, flushed } = TriggerSettlement.addPending(state, data, ctx.at);
          const flushedPersist = flushed.filter(({ match }) => match.actionClass === "persist");
          const flushedNotify = flushed.filter(({ match }) => match.actionClass !== "persist");
          return {
            state: nextState,
            // Cap hit: the oldest matches dispatch NOW instead of being
            // discarded — degraded batching under extreme load, never loss.
            intents:
              flushed.length > 0
                ? [
                    ...TriggerSettlement.pagePersistMatches({
                      matches: flushedPersist.map(({ traceId, match }) => ({
                        traceId,
                        settleWindowBucket: match.settleWindowBucket,
                      })),
                    }).map((page) =>
                      ctx.intents.persistMatch(`persist:${page.pageKey}`, {
                        triggerId: ctx.key,
                        traceIds: page.traceIds,
                      }),
                    ),
                    ...flushedNotify.map(({ traceId, match }) =>
                      ctx.intents.notifyDigest(
                        `digest:${match.dispatchDueAt}:${TriggerSettlement.digestBatchKey([traceId])}`,
                        {
                          triggerId: ctx.key,
                          traceIds: [traceId],
                          boundary: match.dispatchDueAt,
                        },
                      ),
                    ),
                    // Message key for outbox deduplication; keyed on trigger +
                    // minute to coalesce storms to one row per trigger per minute.
                    ctx.intents.logOverflow(`overflow:${ctx.key}:${Math.floor(ctx.at / 60_000)}`, {
                      triggerId: ctx.key,
                      flushed: flushed.length,
                      totalFlushed: nextState.overflowFlushed,
                    }),
                  ]
                : undefined,
            nextWakeAt: TriggerSettlement.findNextBoundary(nextState),
          };
        })
        .onWake((state, ctx) => {
          const due = TriggerSettlement.drainDue(state, ctx.at);
          return {
            state: due.state,
            intents: [
              ...due.boundaries.map((boundary) =>
                ctx.intents.notifyDigest(
                  `digest:${boundary.key}:${TriggerSettlement.digestBatchKey(boundary.traceIds)}`,
                  {
                    triggerId: ctx.key,
                    traceIds: boundary.traceIds,
                    boundary: boundary.key,
                  },
                ),
              ),
              ...due.persistPages.map((page) =>
                ctx.intents.persistMatch(`persist:${page.pageKey}`, {
                  triggerId: ctx.key,
                  traceIds: page.traceIds,
                }),
              ),
            ],
            nextWakeAt: due.nextBoundary,
          };
        })
        // The lease covers a full page of degraded per-trace confirms with
        // room to spare (see PERSIST_PAGE_MAX); the dispatcher releases any
        // batch tail that would run past it.
        .outbox({ maxAttempts: 8, leaseDurationMs: 300_000 }),
    )
    .withProcessManager(REPORT_SCHEDULE_PROCESS_NAME, (pm) =>
      pm
        .state<ReportScheduleState>(INITIAL_REPORT_SCHEDULE_STATE)
        .intent(
          REPORT_SCHEDULE_INTENT_TYPES.DISPATCH,
          reportDispatchIntentSchema,
          runReportDispatch(deps.reports),
        )
        .on(REPORT_SCHEDULE_EVENT_TYPES.CONFIGURED, reportScheduleConfigured)
        .on(REPORT_SCHEDULE_EVENT_TYPES.PAUSED, reportSchedulePaused)
        .on(REPORT_SCHEDULE_EVENT_TYPES.RESUMED, reportScheduleResumed)
        .on(REPORT_SCHEDULE_EVENT_TYPES.RUN_REQUESTED, reportRunRequested)
        .onWake(reportScheduleWake)
        .outbox({ maxAttempts: 5, leaseDurationMs: 300_000 }),
    )
    .withProcessManager("graphAlertSweep", (pm) =>
      pm
        .state<GraphAlertSweepState>({ lastSweepAt: null })
        .schedule({ everyMs: GRAPH_ALERT_SWEEP_INTERVAL_MS })
        .onWake(graphAlertSweepWake)
        .intent(
          "evaluateGraph",
          sweepSchema,
          runGraphAlertSweep(deps.scheduledIntents, deps.retention),
        ),
    )
    .withProcessManager("webhookDeliveryPrune", (pm) =>
      pm
        .state<WebhookDeliveryPruneState>({ lastPruneAt: null })
        .schedule({ everyMs: WEBHOOK_DELIVERY_PRUNE_INTERVAL_MS })
        .onWake(webhookDeliveryPruneWake)
        .intent(
          "prune",
          pruneSchema,
          runWebhookDeliveryPrune(deps.scheduledIntents, deps.retention),
        ),
    )
    .build();
};

/** The `automations` pipeline definition, as its eventing module registers it. */
export type AutomationsPipeline = ReturnType<typeof buildAutomationsPipeline>;

export class AutomationsPipelineAdapter {
  private constructor(private readonly deps: AutomationsPipelineDeps) {}

  static create(deps: AutomationsPipelineDeps): AutomationsPipelineAdapter {
    return new AutomationsPipelineAdapter(deps);
  }

  static createPipeline(
    deps: AutomationsPipelineDeps,
  ): ReturnType<typeof buildAutomationsPipeline> {
    return AutomationsPipelineAdapter.create(deps).build();
  }

  build(): ReturnType<typeof buildAutomationsPipeline> {
    return buildAutomationsPipeline(this.deps);
  }
}

export const createAutomationsPipeline = AutomationsPipelineAdapter.createPipeline.bind(
  AutomationsPipelineAdapter,
);
