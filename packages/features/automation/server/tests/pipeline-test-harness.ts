import type { ProcessManagerDefinition } from "@langwatch/eventing";
import type {
  GraphTriggerEvaluationReason,
  GraphTriggerEvaluationResult,
  GraphTriggerSweepCandidate,
} from "@langwatch/automation-contract";
import {
  type AutomationsPipelineDeps,
  createAutomationsPipeline,
} from "../src/adapters/eventing.automation.adapter";
import { AutomationIntentRetentionPort } from "../src/ports/automation-intent-retention.port";
import { AutomationScheduledIntentPort } from "../src/ports/automation-scheduled-intent.port";
import { AutomationSettlementExecutorPort } from "../src/ports/automation-settlement.port";

class InertSettlementExecutor extends AutomationSettlementExecutorPort {
  async notifyDigest(): Promise<void> {}

  async persistMatch(): Promise<void> {}

  async logOverflow(): Promise<void> {}
}

export class InertScheduledIntents extends AutomationScheduledIntentPort {
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

  async pruneWebhookDeliveries(): Promise<number> {
    return 0;
  }
}

export class InertIntentRetention extends AutomationIntentRetentionPort {
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
}: {
  name: "triggerSettlement" | "graphAlertSweep" | "webhookDeliveryPrune";
  scheduledIntents?: AutomationScheduledIntentPort;
  retention?: AutomationIntentRetentionPort;
}): ProcessManagerDefinition {
  const dependencies: AutomationsPipelineDeps = {
    settlement: new InertSettlementExecutor(),
    scheduledIntents,
    retention,
  };
  const pipeline = createAutomationsPipeline(dependencies);
  const definition = pipeline.processManagers.get(name);
  if (!definition) throw new Error(`Unknown process manager: ${name}`);
  return definition;
}
