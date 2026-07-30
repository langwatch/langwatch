import type { GroupKey } from "@langwatch/event-sourcing";
import { triggerAggregate } from "./aggregate";
import {
  createEvaluateGraphHandler,
  GRAPH_ALERT_SWEEP_PROCESS_NAME,
  type GraphAlertSweepPorts,
  graphAlertSweep,
} from "./process-managers/graphAlertSweep";
import {
  TRIGGER_SETTLEMENT_PROCESS_NAME,
  triggerSettlement,
} from "./process-managers/triggerSettlement";
import {
  createLogOverflowHandler,
  createNotifyDigestHandler,
  createPersistMatchHandler,
  type TriggerDispatchPorts,
} from "./process-managers/triggerSettlement.intentHandlers";
import {
  createPruneHandler,
  WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME,
  type WebhookDeliveryPrunePorts,
  webhookDeliveryPrune,
} from "./process-managers/webhookDeliveryPrune";
import {
  createEvaluationTriggerMatchSubscriber,
  createGraphTriggerActivitySubscriber,
  type EvaluationTriggerMatchPorts,
  type GraphTriggerActivityPorts,
} from "./subscribers";

export type {
  MatchRecordedData,
  TriggerActionClass,
  TriggerAggregate,
  TriggerAggregateState,
} from "./aggregate";
export { triggerAggregate } from "./aggregate";
export type { IntentContext, IntentHandler } from "./intentDispatch";
export {
  isTerminalDispatchError,
  TerminalDispatchError,
} from "./intentDispatch";
export type {
  EvaluateGraphIntent,
  GraphAlertSweepCandidate,
  GraphAlertSweepPorts,
  GraphAlertSweepState,
} from "./process-managers/graphAlertSweep";
export {
  createEvaluateGraphHandler,
  GRAPH_ALERT_SWEEP_INTERVAL_MS,
  GRAPH_ALERT_SWEEP_PROCESS_NAME,
  graphAlertSweep,
} from "./process-managers/graphAlertSweep";
export type {
  LogOverflowIntent,
  NotifyDigestIntent,
  PendingMatch,
  PersistMatchIntent,
  TriggerSettlementState,
} from "./process-managers/triggerSettlement";
export {
  addPending,
  digestBatchKey,
  drainDue,
  MAX_PENDING_MATCHES,
  settleBoundary,
  TRIGGER_SETTLEMENT_PROCESS_NAME,
  triggerSettlement,
} from "./process-managers/triggerSettlement";
export type { TriggerDispatchPorts } from "./process-managers/triggerSettlement.intentHandlers";
export {
  createLogOverflowHandler,
  createNotifyDigestHandler,
  createPersistMatchHandler,
} from "./process-managers/triggerSettlement.intentHandlers";
export type {
  PruneIntent,
  WebhookDeliveryPrunePorts,
  WebhookDeliveryPruneState,
} from "./process-managers/webhookDeliveryPrune";
export {
  createPruneHandler,
  WEBHOOK_DELIVERY_PRUNE_INTERVAL_MS,
  WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME,
  webhookDeliveryPrune,
} from "./process-managers/webhookDeliveryPrune";
export { settleWindowBucket } from "./settleWindow";
export type {
  AutomationSubscriber,
  EvaluationOutcomeEvent,
  EvaluationTriggerMatchPorts,
  GraphTriggerActivityPorts,
  TraceActivityEvent,
} from "./subscribers";
export {
  createEvaluationTriggerMatchSubscriber,
  createGraphTriggerActivitySubscriber,
  DEDUP_TTL_MS,
  GRAPH_TRIGGER_ACTIVITY_DEBOUNCE_MS,
  graphTriggerActivityDedupId,
  MATCH_DELAY_MS,
} from "./subscribers";

/**
 * A `__global__` tenant marker, not a real tenant id. `GroupKey.tenantId` is
 * always present so no scope can place two tenants' work in one lane; a
 * singleton process has no owning tenant, so it needs an unmistakable
 * placeholder rather than an empty string.
 */
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
      aggregateType: triggerAggregate.name,
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
  return {
    tenantId: params.tenantId,
    lane: { kind: "processManager", name: TRIGGER_SETTLEMENT_PROCESS_NAME },
    scope: {
      kind: "aggregate",
      aggregateType: triggerAggregate.name,
      aggregateId: params.triggerId,
    },
  };
}

/** The sweep and the prune are one instance for the whole deployment, waking
 *  on a fixed interval rather than on any trigger's events — the one case
 *  ADR-100 says `scope: global` is correct rather than dangerous. */
export function singletonProcessManagerGroupKey(processName: string): GroupKey {
  return {
    tenantId: GLOBAL_TENANT,
    lane: { kind: "processManager", name: processName },
    scope: { kind: "global" },
  };
}

export interface AutomationsPipelineDeps {
  dispatch: TriggerDispatchPorts;
  sweep: GraphAlertSweepPorts;
  prune: WebhookDeliveryPrunePorts;
  evaluationTriggerMatch: EvaluationTriggerMatchPorts;
  graphTriggerActivity: GraphTriggerActivityPorts;
  /**
   * Event types owned by other pipelines, supplied by the composition root
   * from their own declarations: this pipeline cannot see another pipeline's
   * event vocabulary (ADR-102 decision 5, dependencies point downward only).
   * `evaluationOutcome` is the evaluation pipeline's terminal outcomes;
   * `graphTriggerActivity` is whatever trace-side commits should nudge
   * graph-threshold triggers.
   */
  evaluationOutcomeEventTypes: readonly string[];
  graphTriggerActivityEventTypes: readonly string[];
}

/**
 * The whole topology in one place: the aggregate, each process manager with
 * its group key and intent handlers, each subscriber. `groupKey` is a function
 * on the per-trigger process and a value on the two singletons — a real
 * asymmetry: settlement has one lane per trigger, the sweep and the prune have
 * exactly one lane each.
 */
export function createAutomationsPipeline(deps: AutomationsPipelineDeps) {
  return {
    name: "automations" as const,
    aggregate: triggerAggregate,

    commands: {
      recordMatch: { groupKey: recordMatchGroupKey },
    },

    processManagers: {
      [TRIGGER_SETTLEMENT_PROCESS_NAME]: {
        process: triggerSettlement,
        groupKey: triggerSettlementGroupKey,
        intentHandlers: {
          notifyDigest: createNotifyDigestHandler(deps.dispatch),
          persistMatch: createPersistMatchHandler(deps.dispatch),
          logOverflow: createLogOverflowHandler(),
        },
      },
      [GRAPH_ALERT_SWEEP_PROCESS_NAME]: {
        process: graphAlertSweep,
        groupKey: singletonProcessManagerGroupKey(
          GRAPH_ALERT_SWEEP_PROCESS_NAME,
        ),
        intentHandlers: {
          evaluateGraph: createEvaluateGraphHandler(deps.sweep),
        },
      },
      [WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME]: {
        process: webhookDeliveryPrune,
        groupKey: singletonProcessManagerGroupKey(
          WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME,
        ),
        intentHandlers: {
          prune: createPruneHandler(deps.prune),
        },
      },
    },

    subscribers: {
      triggerMatch: createEvaluationTriggerMatchSubscriber({
        eventTypes: deps.evaluationOutcomeEventTypes,
        ports: deps.evaluationTriggerMatch,
      }),
      graphTriggerActivity: createGraphTriggerActivitySubscriber({
        eventTypes: deps.graphTriggerActivityEventTypes,
        ports: deps.graphTriggerActivity,
      }),
    },
  };
}

export type AutomationsPipeline = ReturnType<typeof createAutomationsPipeline>;
