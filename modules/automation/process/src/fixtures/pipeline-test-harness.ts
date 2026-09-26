import type {
  GraphTriggerEvaluationReason,
  GraphTriggerEvaluationResult,
  GraphTriggerSweepCandidate,
} from "@langwatch/automation-contract";
import type { ProcessManagerDefinition } from "@langwatch/eventing";

import { AutomationScheduledIntent, AutomationSettlementExecutor } from "../app/automation.members.ts";
import {
  type AutomationsPipelineDeps,
  createAutomationsPipeline,
} from "../eventing/automation.pipeline.ts";
import type { ReportDispatcher } from "../eventing/report-schedule.intent.ts";
import { AutomationIntentRetentionRepository } from "../repositories/automation-intent-retention.repository.ts";

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

  async pruneWebhookDeliveries(): Promise<number> {
    return 0;
  }
}

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
}: {
  name: "triggerSettlement" | "graphAlertSweep" | "webhookDeliveryPrune" | "reportSchedule";
  scheduledIntents?: AutomationScheduledIntent;
  retention?: AutomationIntentRetentionRepository;
  reports?: ReportDispatcher;
}): ProcessManagerDefinition {
  const dependencies: AutomationsPipelineDeps = {
    settlement: new InertSettlementExecutor(),
    scheduledIntents,
    retention,
    reports,
  };
  const pipeline = createAutomationsPipeline(dependencies);
  const definition = pipeline.processManagers.get(name);
  if (!definition) throw new Error(`Unknown process manager: ${name}`);
  return definition;
}
