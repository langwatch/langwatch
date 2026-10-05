import type {
  GraphTriggerEvaluationReason,
  GraphTriggerEvaluationResult,
  GraphTriggerSweepCandidate,
} from "@langwatch/automation-contract";
import { DispatchError } from "@langwatch/eventing";
import type { Instant } from "@langwatch/time";

import { AutomationScheduledIntent } from "../eventing/graph-alert-sweep.intent.ts";
import type { AutomationGraphActivity } from "./automation-graph-activity.service.ts";
import type { GraphTriggerHeartbeatService } from "./graph-trigger-heartbeat.service.ts";

/** The two schedules, and the graph re-check one of them drives. */
export class AutomationScheduledIntentsService extends AutomationScheduledIntent {
  static create(input: {
    heartbeat: GraphTriggerHeartbeatService;
    graphActivity: AutomationGraphActivity | undefined;
  }): AutomationScheduledIntentsService {
    return new AutomationScheduledIntentsService(input.heartbeat, input.graphActivity);
  }

  private constructor(
    private readonly heartbeat: GraphTriggerHeartbeatService,
    private readonly graphActivity: AutomationGraphActivity | undefined,
  ) {
    super();
  }

  decideGraphTriggerHeartbeat(now: { now: Instant }): Promise<GraphTriggerSweepCandidate[]> {
    return this.heartbeat.decide(now);
  }

  evaluateGraphTrigger(candidate: {
    triggerId: string;
    projectId: string;
    reason: GraphTriggerEvaluationReason;
  }): Promise<GraphTriggerEvaluationResult> {
    if (!this.graphActivity) {
      return Promise.reject(
        new DispatchError({
          message:
            "This process composes no graph-alert vertical, so a sweep candidate cannot be evaluated here. Set BASE_HOST to compose one.",
          retryable: false,
        }),
      );
    }

    return this.graphActivity.evaluateGraphTrigger(candidate);
  }
}
