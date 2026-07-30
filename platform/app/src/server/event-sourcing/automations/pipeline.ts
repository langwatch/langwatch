import { triggerAggregate } from "./aggregate";
import {
  recordMatchGroupKey,
  singletonProcessManagerGroupKey,
  triggerSettlementGroupKey,
} from "./groupKeys";
import {
  GRAPH_ALERT_SWEEP_PROCESS_NAME,
  createEvaluateGraphHandler,
  graphAlertSweepDefinition,
  type GraphAlertSweepPorts,
} from "./process-managers/graphAlertSweep";
import {
  TRIGGER_SETTLEMENT_PROCESS_NAME,
  triggerSettlementDefinition,
} from "./process-managers/triggerSettlement";
import type { TriggerDispatchPorts } from "./process-managers/triggerSettlement.dispatchPorts";
import {
  createLogOverflowHandler,
  createNotifyDigestHandler,
  createPersistMatchHandler,
} from "./process-managers/triggerSettlement.intentHandlers";
import {
  WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME,
  createPruneHandler,
  webhookDeliveryPruneDefinition,
  type WebhookDeliveryPrunePorts,
} from "./process-managers/webhookDeliveryPrune";
import {
  createEvaluationTriggerMatchSubscriber,
  type EvaluationTriggerMatchPorts,
} from "./subscribers/evaluationTriggerMatch.subscriber";
import {
  createGraphTriggerActivitySubscriber,
  type GraphTriggerActivityPorts,
} from "./subscribers/graphTriggerActivity.subscriber";

/**
 * The `automations` pipeline's whole topology, in one file (ADR-102 decision
 * 5): a `Deps` interface naming every collaborator, then one function that
 * assembles the aggregate, the process managers and the subscribers from the
 * factories declared beside them.
 *
 * This does not call a `definePipeline(...)` mount — that builder does not
 * exist in `@langwatch/event-sourcing` yet (nothing under
 * `packages/event-sourcing/src/pipeline/` to import), the same gap this
 * pipeline's other files already flag for the process-manager and subscriber
 * runtimes. What this function returns is the topology DESCRIPTOR a future
 * mount call needs: the aggregate, each process manager's definition +
 * group-key + intent handlers, each subscriber. A composition root (also not
 * built — nothing wires these `Deps` to real app-layer services yet) is what
 * turns this into a running pipeline.
 */
export interface AutomationsPipelineDeps {
  dispatch: TriggerDispatchPorts;
  sweep: GraphAlertSweepPorts;
  prune: WebhookDeliveryPrunePorts;
  evaluationTriggerMatch: EvaluationTriggerMatchPorts;
  graphTriggerActivity: GraphTriggerActivityPorts;
  /** Event types on the (unconverted) trace pipeline whose commits should
   *  nudge graph-threshold triggers — supplied by the composition root,
   *  since this pipeline cannot see another pipeline's event vocabulary
   *  (ADR-102 decision 5: dependencies point downward only). */
  graphTriggerActivityEventTypes: readonly string[];
}

export function createAutomationsPipeline(deps: AutomationsPipelineDeps) {
  return {
    name: "automations" as const,
    aggregateType: triggerAggregate.name,
    aggregate: triggerAggregate,

    commands: {
      recordMatch: {
        groupKey: (params: { tenantId: string; triggerId: string }) =>
          recordMatchGroupKey(params),
        // ADR-099: a hot trigger appends one match per trace. Coalescing
        // several matches for one trigger into a single multi-row insert —
        // the old pipeline's `TRIGGER_MATCH_COALESCE_MAX_BATCH` — is a
        // batching-scope decision that belongs at the mount point a real
        // executor provides; there is none to configure yet.
      },
    },

    // `groupKey` is a function on the per-trigger process and a constant
    // value on the two singletons — a real asymmetry, not an
    // inconsistency: `triggerSettlement` has one lane per trigger id, which
    // is only known per instance, while the sweep and the prune have
    // exactly one lane each for the whole deployment (`groupKeys.ts`).
    processManagers: {
      [TRIGGER_SETTLEMENT_PROCESS_NAME]: {
        definition: triggerSettlementDefinition,
        groupKey: (params: { tenantId: string; triggerId: string }) =>
          triggerSettlementGroupKey(params),
        intentHandlers: {
          notifyDigest: createNotifyDigestHandler(deps.dispatch),
          persistMatch: createPersistMatchHandler(deps.dispatch),
          logOverflow: createLogOverflowHandler(),
        },
      },
      [GRAPH_ALERT_SWEEP_PROCESS_NAME]: {
        definition: graphAlertSweepDefinition,
        groupKey: singletonProcessManagerGroupKey(GRAPH_ALERT_SWEEP_PROCESS_NAME),
        intentHandlers: {
          evaluateGraph: createEvaluateGraphHandler(deps.sweep),
        },
      },
      [WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME]: {
        definition: webhookDeliveryPruneDefinition,
        groupKey: singletonProcessManagerGroupKey(WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME),
        intentHandlers: {
          prune: createPruneHandler(deps.prune),
        },
      },
    },

    subscribers: {
      triggerMatch: createEvaluationTriggerMatchSubscriber(deps.evaluationTriggerMatch),
      graphTriggerActivity: createGraphTriggerActivitySubscriber({
        eventTypes: deps.graphTriggerActivityEventTypes,
        ports: deps.graphTriggerActivity,
      }),
    },
  };
}

export type AutomationsPipeline = ReturnType<typeof createAutomationsPipeline>;
