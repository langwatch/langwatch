import type {
  GraphTriggerEvaluationReason,
  GraphTriggerEvaluationResult,
  GraphTriggerSweepCandidate,
} from "@langwatch/automation-contract";

export abstract class AutomationScheduledIntentPort {
  abstract decideGraphTriggerHeartbeat(input: { now: Date }): Promise<GraphTriggerSweepCandidate[]>;

  abstract evaluateGraphTrigger(input: {
    triggerId: string;
    projectId: string;
    reason: GraphTriggerEvaluationReason;
  }): Promise<GraphTriggerEvaluationResult>;

  abstract pruneWebhookDeliveries(now?: Date): Promise<number>;
}
