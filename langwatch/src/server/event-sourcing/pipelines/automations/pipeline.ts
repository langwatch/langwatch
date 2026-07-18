import { definePipeline } from "../../pipeline/staticBuilder";
import type { AppendStore } from "../../projections/mapProjection.types";
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
  runWebhookDeliveryPrune,
  WEBHOOK_DELIVERY_PRUNE_INTERVAL_MS,
  type WebhookDeliveryPruneDeps,
  type WebhookDeliveryPruneState,
  pruneSchema,
  webhookDeliveryPruneWake,
} from "./process-manager/webhookDeliveryPrune.process";
import {
  createAutomationAuditMapProjection,
  type AutomationAuditRecord,
} from "./projections/automationAudit.mapProjection";
import { TRIGGER_MATCH_RECORDED_EVENT_TYPE } from "./schemas/constants";
import type { AutomationEvent } from "./schemas/events";

/** Only the executor dependencies are injected — the process-manager
 *  topology itself (states, intents, evolve/wake handlers, outbox tuning)
 *  is defined inline below, ADR-052 "Approved builder API". */
export interface AutomationsPipelineDeps {
  automationAuditStore: AppendStore<AutomationAuditRecord>;
  dispatch: TriggerSettlementDispatchDeps;
  sweep: GraphAlertSweepDeps;
  prune: WebhookDeliveryPruneDeps;
}

export function createAutomationsPipeline(deps: AutomationsPipelineDeps) {
  return definePipeline<AutomationEvent>()
    .withName("automations")
    .withAggregateType("trigger")
    .withMapProjection(
      "automationAudit",
      createAutomationAuditMapProjection({ store: deps.automationAuditStore }),
    )
    .withCommand("recordTriggerMatch", RecordTriggerMatchCommand, {
      serializeByAggregate: true,
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
          return {
            state: nextState,
            // Cap hit: the oldest matches dispatch NOW instead of being
            // discarded — degraded batching under extreme load, never loss.
            intents:
              flushed.length > 0
                ? [
                    ...flushed.map(({ traceId, match }) =>
                      match.actionClass === "persist"
                        ? ctx.intents.persistMatch(
                            `persist:${traceId}:${match.settleWindowBucket}`,
                            { triggerId: ctx.key, traceId },
                          )
                        : ctx.intents.notifyDigest(
                            `digest:${match.dispatchDueAt}:${digestBatchKey([traceId])}`,
                            {
                              triggerId: ctx.key,
                              traceIds: [traceId],
                              boundary: match.dispatchDueAt,
                            },
                          ),
                    ),
                    ctx.intents.logOverflow(
                      `overflow:${nextState.overflowFlushed}`,
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
              ...due.settledMatches.map((match) =>
                ctx.intents.persistMatch(
                  `persist:${match.traceId}:${match.settleWindowBucket}`,
                  {
                    triggerId: ctx.key,
                    traceId: match.traceId,
                  },
                ),
              ),
            ],
            nextWakeAt: due.nextBoundary,
          };
        })
        .outbox({ maxAttempts: 8, leaseDurationMs: 120_000 }),
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
