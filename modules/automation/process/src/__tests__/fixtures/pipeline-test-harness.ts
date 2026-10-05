import type {
  GraphTriggerEvaluationReason,
  GraphTriggerEvaluationResult,
  GraphTriggerSweepCandidate,
} from "@langwatch/automation-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { EventSubscriberDefinition, ProcessManagerDefinition } from "@langwatch/eventing";

import { AutomationScheduledIntent } from "../../eventing/graph-alert-sweep.intent.ts";
import { AutomationSettlementExecutor } from "../../eventing/trigger-settlement.intent.ts";
import {
  type AutomationsPipelineDeps,
  createAutomationsPipeline,
} from "../../eventing/automation.pipeline.ts";
import type {
  ReportDispatcher,
  ReportRunSettlement,
} from "../../eventing/report-schedule.intent.ts";
import { AutomationIntentRetentionRepository } from "../../repositories/automation-intent-retention.repository.ts";

class InertSettlementExecutor extends AutomationSettlementExecutor {
  async notifyDigest(): Promise<void> {}

  async persistMatch(): Promise<void> {}

  async logOverflow(): Promise<void> {}
}

export class InertScheduledIntents extends AutomationScheduledIntent {
  async decideGraphTriggerHeartbeat(): Promise<GraphTriggerSweepCandidate[]> {
    return [];
  }

  async evaluateGraphTrigger(input: {
    triggerId: string;
    projectId: string;
    reason: GraphTriggerEvaluationReason;
  }): Promise<GraphTriggerEvaluationResult> {
    return { ...input, status: "skipped" as const };
  }
}

/** The trigger-matching and graph reactions, inert unless a test hands its own. */
export const inertPeerReactions: AutomationsPipelineDeps["peerReactions"] = {
  handleTraceActivity: async () => undefined,
  handleEvaluationSettled: async () => undefined,
  handleEvaluationGraphTriggerActivity: async () => undefined,
};

export class InertIntentRetention extends AutomationIntentRetentionRepository {
  async deleteDispatchedBefore(): Promise<number> {
    return 0;
  }
}

/** Pull one process-manager definition out of the real automations pipeline
 *  with inert stub deps — the PM topology lives inline in the Eventing adapter
 *  (ADR-052), so tests exercise the exact registered definition instead of
 *  re-assembling their own. Override only the deps the test asserts on. */
export function automationProcessDefinition({
  name,
  scheduledIntents = new InertScheduledIntents(),
  retention = new InertIntentRetention(),
  reports = { dispatch: async () => {} },
  reportRuns = { settleRun: async () => {} },
}: {
  name: "triggerSettlement" | "graphAlertSweep" | "reportSchedule";
  scheduledIntents?: AutomationScheduledIntent;
  retention?: AutomationIntentRetentionRepository;
  reports?: ReportDispatcher;
  reportRuns?: ReportRunSettlement;
}): ProcessManagerDefinition {
  const dependencies: AutomationsPipelineDeps = {
    settlement: new InertSettlementExecutor(),
    scheduledIntents,
    retention,
    reports,
    reportRuns,
    peerReactions: inertPeerReactions,
  };
  const pipeline = createAutomationsPipeline(dependencies);
  const definition = pipeline.processManagers.get(name);
  if (!definition) throw new Error(`Unknown process manager: ${name}`);
  return definition;
}

/** The peer subscribers the real automations pipeline registers, by lane name. */
export function automationPeerSubscribers(
  peerReactions: AutomationsPipelineDeps["peerReactions"],
): Map<string, EventSubscriberDefinition> {
  const pipeline = createAutomationsPipeline({
    settlement: new InertSettlementExecutor(),
    scheduledIntents: new InertScheduledIntents(),
    retention: new InertIntentRetention(),
    reports: { dispatch: async () => {} },
    reportRuns: { settleRun: async () => {} },
    peerReactions,
  });
  const subscribers = new Map<string, EventSubscriberDefinition>();
  const registry = createApiFixture<
    Parameters<NonNullable<typeof pipeline.globalProjections>[number]["register"]>[0]
  >({
    registerEventSubscriber: (subscriber) => void subscribers.set(subscriber.name, subscriber),
  });
  for (const projection of pipeline.globalProjections ?? []) projection.register(registry);
  return subscribers;
}
