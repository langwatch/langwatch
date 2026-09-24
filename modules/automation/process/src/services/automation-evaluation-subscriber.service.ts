import type {
  AutomationEvaluationActivityContext,
  AutomationEvaluationSubscriberContext,
  AutomationEvaluationSubscriberEvent,
} from "@langwatch/automation-contract";

import type {
  AutomationGraphActivity,
  AutomationEvaluationTraceSummary,
  AutomationEvaluationTriggerFilter,
  AutomationTriggerMatchRecorder,
} from "../app/automation.members.ts";
import { handleEvaluationAlertTriggerMatch } from "../eventing/evaluation-alert-trigger-match.subscriber.ts";
import { handleGraphTriggerActivity } from "../eventing/graph-trigger-activity.subscriber.ts";
import type { AutomationTraceTriggerCatalogue } from "../repositories/automation-trace-trigger-catalogue.repository.ts";

/**
 * Evaluation event subscribers using four narrow ports instead of two capability
 * services, enabling different composition for application vs. background contexts.
 */
export class AutomationEvaluationSubscriberService {
  static create(input: {
    triggers: AutomationTraceTriggerCatalogue;
    graphActivity: AutomationGraphActivity;
    traces: AutomationEvaluationTraceSummary;
    evaluationFilters: AutomationEvaluationTriggerFilter;
    triggerMatches: AutomationTriggerMatchRecorder;
  }): AutomationEvaluationSubscriberService {
    return new AutomationEvaluationSubscriberService(input);
  }

  private constructor(
    private readonly deps: {
      triggers: AutomationTraceTriggerCatalogue;
      graphActivity: AutomationGraphActivity;
      traces: AutomationEvaluationTraceSummary;
      evaluationFilters: AutomationEvaluationTriggerFilter;
      triggerMatches: AutomationTriggerMatchRecorder;
    },
  ) {}

  handleEvaluationTriggerMatch(
    event: AutomationEvaluationSubscriberEvent,
    context: AutomationEvaluationSubscriberContext,
  ): Promise<void> {
    return handleEvaluationAlertTriggerMatch(
      {
        automation: this.deps.triggers,
        traces: this.deps.traces,
        evaluationFilters: this.deps.evaluationFilters,
        triggerMatches: this.deps.triggerMatches,
      },
      event,
      context,
    );
  }

  handleEvaluationGraphTriggerActivity(
    event: AutomationEvaluationSubscriberEvent,
    context: AutomationEvaluationActivityContext,
  ): Promise<void> {
    return handleGraphTriggerActivity(this.deps.graphActivity, event, context);
  }
}
