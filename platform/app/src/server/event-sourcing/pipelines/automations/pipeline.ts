import { definePipeline } from "../../pipeline/staticBuilder";
import { RecordTriggerMatchCommand } from "./commands/recordTriggerMatch.command";
import {
  GRAPH_ALERT_SWEEP_PROCESS_NAME,
  type GraphAlertSweepDeps,
  graphAlertSweepPM,
} from "./process-manager/graphAlertSweep.process";
import {
  TRIGGER_SETTLEMENT_PROCESS_NAME,
  triggerSettlementPM,
} from "./process-manager/triggerSettlement.process";
import type { TriggerSettlementDispatchDeps } from "./process-manager/triggerSettlementIntentHandlers";
import {
  WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME,
  type WebhookDeliveryPruneDeps,
  webhookDeliveryPrunePM,
} from "./process-manager/webhookDeliveryPrune.process";
import { TRIGGER_MATCH_COALESCE_MAX_BATCH } from "./schemas/constants";
import type { AutomationEvent } from "./schemas/events";

/** Only the executor dependencies are injected — the process-manager
 *  topology itself (states, intents, evolve/wake handlers, outbox tuning)
 *  is defined by the `*PM` factory beside each process module, ADR-052
 *  "Approved builder API" and ADR-082 Rule 1. */
export interface AutomationsPipelineDeps {
  dispatch: TriggerSettlementDispatchDeps;
  sweep: GraphAlertSweepDeps;
  prune: WebhookDeliveryPruneDeps;
}

export function createAutomationsPipeline(deps: AutomationsPipelineDeps) {
  return (
    definePipeline<AutomationEvent>()
      .withName("automations")
      .withAggregateType("trigger")
      .withCommand("recordTriggerMatch", RecordTriggerMatchCommand, {
        serializeByAggregate: true,
        // ADR-066 pillar 2: a hot trigger appends one match per trace. Coalesce a
        // backed-up trigger's matches into one multi-row insert instead of one
        // tiny insert per match.
        coalesceMaxBatch: TRIGGER_MATCH_COALESCE_MAX_BATCH,
      })
      .withProcessManager(
        TRIGGER_SETTLEMENT_PROCESS_NAME,
        triggerSettlementPM(deps.dispatch),
      )
      .withProcessManager(
        GRAPH_ALERT_SWEEP_PROCESS_NAME,
        graphAlertSweepPM(deps.sweep),
      )
      // Its daily wake also carries triggerSettlement's outbox retention, which
      // has no singleton schedule of its own to hang it off.
      .withProcessManager(
        WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME,
        webhookDeliveryPrunePM(deps.prune),
      )
      .build()
  );
}
