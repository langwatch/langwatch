import type {
  GraphTriggerEvaluationReason,
  GraphTriggerEvaluationResult,
  GraphTriggerSweepCandidate,
} from "@langwatch/automation-contract";
import type { Instant } from "@langwatch/time";

export abstract class AutomationScheduledIntentPort {
  abstract decideGraphTriggerHeartbeat(input: {
    now: Instant;
  }): Promise<GraphTriggerSweepCandidate[]>;

  abstract evaluateGraphTrigger(input: {
    triggerId: string;
    projectId: string;
    reason: GraphTriggerEvaluationReason;
  }): Promise<GraphTriggerEvaluationResult>;

  abstract pruneWebhookDeliveries(now?: Instant): Promise<number>;
}
