import {
  defineAggregate,
  defineEvents,
  definePipeline,
} from "@langwatch/eventing";
import { RecordTriggerMatchCommand } from "./commands/recordTriggerMatch.command";
import {
  GRAPH_ALERT_SWEEP_INTERVAL_MS,
  type GraphAlertSweepDeps,
  type GraphAlertSweepState,
  graphAlertSweepWake,
  runGraphAlertSweep,
  sweepSchema,
} from "./process-manager/graphAlertSweep.process";
import {
  addPending,
  digestBatchKey,
  drainDue,
  INITIAL_SETTLEMENT_STATE,
  pagePersistMatches,
  type SettlementState,
  settleBoundary,
} from "./process-manager/triggerSettlement.process";
import {
  createLogOverflowHandler,
  createNotifyDigestHandler,
  createPersistMatchHandler,
  type TriggerSettlementDispatchDeps,
} from "./process-manager/triggerSettlementIntentHandlers";
import {
  logOverflowIntentSchema,
  notifyDigestIntentSchema,
  persistMatchIntentSchema,
  TRIGGER_SETTLEMENT_INTENT_TYPES,
} from "./process-manager/triggerSettlementProcess.types";
import {
  pruneSchema,
  runWebhookDeliveryPrune,
  WEBHOOK_DELIVERY_PRUNE_INTERVAL_MS,
  type WebhookDeliveryPruneDeps,
  type WebhookDeliveryPruneState,
  webhookDeliveryPruneWake,
} from "./process-manager/webhookDeliveryPrune.process";
import {
  AUTOMATIONS_EVENT_TYPES,
  TRIGGER_MATCH_COALESCE_MAX_BATCH,
  TRIGGER_MATCH_RECORDED_EVENT_TYPE,
} from "./schemas/constants";
import type { AutomationEvent } from "./schemas/events";

/** Only the executor dependencies are injected — the process-manager
 *  topology itself (states, intents, evolve/wake handlers, outbox tuning)
 *  is defined inline below, ADR-052 "Approved builder API". */
export interface AutomationsPipelineDeps {
  dispatch: TriggerSettlementDispatchDeps;
  sweep: GraphAlertSweepDeps;
  prune: WebhookDeliveryPruneDeps;
}

export function createAutomationsPipeline(deps: AutomationsPipelineDeps) {
  return definePipeline<AutomationEvent>({
    name: "automations",
    aggregate: defineAggregate({
      type: "trigger",
      events: defineEvents(AUTOMATIONS_EVENT_TYPES),
    }),
  })
    .withCommand("recordTriggerMatch", RecordTriggerMatchCommand, {
      serializeByAggregate: true,
      // ADR-066 pillar 2: a hot trigger appends one match per trace. Coalesce a
      // backed-up trigger's matches into one multi-row insert instead of one
      // tiny insert per match.
      coalesceMaxBatch: TRIGGER_MATCH_COALESCE_MAX_BATCH,
    })
    .withProcessManager("triggerSettlement", (pm) =>
      pm
        .state<SettlementState>(INITIAL_SETTLEMENT_STATE)
        .intent(
          TRIGGER_SETTLEMENT_INTENT_TYPES.NOTIFY_DIGEST,
          notifyDigestIntentSchema,
          createNotifyDigestHandler(deps.dispatch),
        )
        .intent(
          TRIGGER_SETTLEMENT_INTENT_TYPES.PERSIST_MATCH,
          persistMatchIntentSchema,
          createPersistMatchHandler(deps.dispatch),
        )
        .intent(
          TRIGGER_SETTLEMENT_INTENT_TYPES.LOG_OVERFLOW,
          logOverflowIntentSchema,
          createLogOverflowHandler(),
        )
        .on(TRIGGER_MATCH_RECORDED_EVENT_TYPE, (state, data, ctx) => {
          const { state: nextState, flushed } = addPending(state, data, ctx.at);
          const flushedPersist = flushed.filter(
            ({ match }) => match.actionClass === "persist",
          );
          const flushedNotify = flushed.filter(
            ({ match }) => match.actionClass !== "persist",
          );
          return {
            state: nextState,
            // Cap hit: the oldest matches dispatch NOW instead of being
            // discarded — degraded batching under extreme load, never loss.
            intents:
              flushed.length > 0
                ? [
                    ...pagePersistMatches({
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
                        `digest:${match.dispatchDueAt}:${digestBatchKey([traceId])}`,
                        {
                          triggerId: ctx.key,
                          traceIds: [traceId],
                          boundary: match.dispatchDueAt,
                        },
                      ),
                    ),
                    // The message key is what the outbox dedups on, so it
                    // decides how many DURABLE ROWS a log line costs. Keyed on
                    // the cumulative counter it was unique every single time,
                    // which meant one row per overflowed match: 119,665 rows in
                    // one project-day, whose entire content was "we flushed
                    // early again". Keyed on the trigger and the minute of
                    // EVENT time, a storm coalesces to at most one row per
                    // trigger per minute, and a redelivery of the same event
                    // produces a byte-identical key so it dedups rather than
                    // adding a row. The payload still carries the running
                    // total, so the storm rate is recoverable from any single
                    // surviving row.
                    //
                    // A key written here only has to be unique inside ONE
                    // trigger: the outbox unique index is (processName,
                    // projectId, messageKey), and the runtime prefixes every
                    // builder-authored key with `process:<processKey>:`, so
                    // two triggers never collide on identical bodies.
                    ctx.intents.logOverflow(
                      `overflow:${ctx.key}:${Math.floor(ctx.at / 60_000)}`,
                      {
                        triggerId: ctx.key,
                        flushed: flushed.length,
                        totalFlushed: nextState.overflowFlushed,
                      },
                    ),
                  ]
                : undefined,
            nextWakeAt: settleBoundary(nextState),
          };
        })
        .onWake((state, ctx) => {
          const due = drainDue(state, ctx.at);
          return {
            state: due.state,
            intents: [
              ...due.boundaries.map((boundary) =>
                ctx.intents.notifyDigest(
                  `digest:${boundary.key}:${digestBatchKey(boundary.traceIds)}`,
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
    .withProcessManager("graphAlertSweep", (pm) =>
      pm
        .state<GraphAlertSweepState>({ lastSweepAt: null })
        .schedule({ everyMs: GRAPH_ALERT_SWEEP_INTERVAL_MS })
        .onWake(graphAlertSweepWake)
        .intent("evaluateGraph", sweepSchema, runGraphAlertSweep(deps.sweep)),
    )
    .withProcessManager("webhookDeliveryPrune", (pm) =>
      pm
        .state<WebhookDeliveryPruneState>({ lastPruneAt: null })
        .schedule({ everyMs: WEBHOOK_DELIVERY_PRUNE_INTERVAL_MS })
        .onWake(webhookDeliveryPruneWake)
        .intent("prune", pruneSchema, runWebhookDeliveryPrune(deps.prune)),
    )
    .build();
}
