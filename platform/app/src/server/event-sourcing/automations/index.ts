import {
  definePipeline,
  type GroupKey,
  processGroupKey,
} from "@langwatch/event-sourcing";
import {
  AUTOMATIONS_PIPELINE_NAME,
  AUTOMATIONS_PIPELINE_PREFIX,
  automationsEvents,
  matchRecordedDataSchema,
} from "./events";
import {
  GRAPH_ALERT_SWEEP_PROCESS_NAME,
  type GraphAlertSweepPorts,
  graphAlertSweepIntents,
  graphAlertSweepOn,
  graphAlertSweepOnWake,
  graphAlertSweepStateSchema,
  initGraphAlertSweepState,
} from "./graphAlertSweep.process";
import { recordMatch } from "./recordMatch.command";
import {
  initTriggerSettlementState,
  TRIGGER_SETTLEMENT_PROCESS_NAME,
  type TriggerDispatchPorts,
  triggerSettlementIntents,
  triggerSettlementOn,
  triggerSettlementOnWake,
  triggerSettlementStateSchema,
} from "./triggerSettlement.process";
import {
  initWebhookDeliveryPruneState,
  WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME,
  type WebhookDeliveryPrunePorts,
  webhookDeliveryPruneIntents,
  webhookDeliveryPruneOn,
  webhookDeliveryPruneOnWake,
  webhookDeliveryPruneStateSchema,
} from "./webhookDeliveryPrune.process";

/** A `__global__` tenant marker, not a real tenant id: `GroupKey.tenantId` is
 *  always present so no scope can place two tenants' work in one lane, and a
 *  singleton process has no owning tenant. */
export const GLOBAL_TENANT = "__global__";

/** ADR-100 decision 4: a command lane is scoped to the aggregate, so every
 *  command type for one trigger serialises into a single lane. */
export function recordMatchGroupKey(params: {
  tenantId: string;
  triggerId: string;
}): GroupKey {
  return {
    tenantId: params.tenantId,
    lane: { kind: "command" },
    scope: {
      kind: "aggregate",
      aggregateType: AUTOMATIONS_PIPELINE_NAME,
      aggregateId: params.triggerId,
    },
  };
}

/** One settlement instance per trigger: two triggers matching the same trace
 *  have independent settle windows, caps and send claims, so they must never
 *  share a lane. */
export function triggerSettlementGroupKey(params: {
  tenantId: string;
  triggerId: string;
}): GroupKey {
  return processGroupKey(
    { name: TRIGGER_SETTLEMENT_PROCESS_NAME },
    { tenantId: params.tenantId, processKey: params.triggerId },
  );
}

/** The sweep and the prune are one instance for the whole deployment, waking
 *  on a fixed interval rather than on any trigger's events — the one case
 *  where `scope: global` is correct rather than dangerous. */
export function singletonProcessManagerGroupKey(processName: string): GroupKey {
  return {
    tenantId: GLOBAL_TENANT,
    lane: { kind: "processManager", name: processName },
    scope: { kind: "global" },
  };
}

export function graphAlertSweepGroupKey(): GroupKey {
  return singletonProcessManagerGroupKey(GRAPH_ALERT_SWEEP_PROCESS_NAME);
}

export function webhookDeliveryPruneGroupKey(): GroupKey {
  return singletonProcessManagerGroupKey(WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME);
}

export interface AutomationsPipelineDeps {
  readonly dispatch: TriggerDispatchPorts;
  readonly sweep: GraphAlertSweepPorts;
  readonly prune: WebhookDeliveryPrunePorts;
}

/**
 * The whole `trigger` topology: one command recording a match, and three
 * process managers reacting to it — `triggerSettlement` per trigger, and the
 * two singleton schedulers `graphAlertSweep` / `webhookDeliveryPrune`
 * (ADR-105 §12; group keys above are hand-written because `.id()`'s per-event
 * extractor governs a fold's own row key, not a process manager's, which the
 * dispatch plane supplies as `ctx.processKey`).
 *
 * `triggerMatch` and `graphTriggerActivity` (`subscribers.ts`) are not mounted
 * here: they consume other pipelines' own events, which `.events()` cannot
 * see (ADR-105 consequences — cross-pipeline subscription is not
 * expressible), so they stay standalone factories the composition root
 * registers against each source pipeline.
 */
export function createAutomationsPipeline(deps: AutomationsPipelineDeps) {
  return definePipeline(AUTOMATIONS_PIPELINE_NAME)
    .prefix(AUTOMATIONS_PIPELINE_PREFIX)
    .events(automationsEvents)
    .id({ matchRecorded: (data) => data.triggerId })
    .withCommand("recordMatch", {
      input: matchRecordedDataSchema,
      handle: recordMatch,
    })
    .withProcessManager("triggerSettlement", {
      state: triggerSettlementStateSchema,
      init: initTriggerSettlementState,
      intents: triggerSettlementIntents(deps.dispatch),
      on: triggerSettlementOn,
      onWake: triggerSettlementOnWake,
    })
    .withProcessManager("graphAlertSweep", {
      state: graphAlertSweepStateSchema,
      init: initGraphAlertSweepState,
      intents: graphAlertSweepIntents(deps.sweep),
      on: graphAlertSweepOn,
      onWake: graphAlertSweepOnWake,
    })
    .withProcessManager("webhookDeliveryPrune", {
      state: webhookDeliveryPruneStateSchema,
      init: initWebhookDeliveryPruneState,
      intents: webhookDeliveryPruneIntents(deps.prune),
      on: webhookDeliveryPruneOn,
      onWake: webhookDeliveryPruneOnWake,
    })
    .build();
}
