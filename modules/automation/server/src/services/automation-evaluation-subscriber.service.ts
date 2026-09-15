import {
  AutomationEvaluationSubscriberService as AutomationEvaluationSubscriberCapability,
  type AutomationEvaluationActivityContext,
  type AutomationEvaluationSubscriberContext,
  type AutomationEvaluationSubscriberEvent,
} from "@langwatch/automation-contract";
import { handleEvaluationAlertTriggerMatch } from "../subscribers/evaluation-alert-trigger-match.subscriber.ts";
import { handleGraphTriggerActivity } from "../subscribers/graph-trigger-activity.subscriber.ts";
import type { AutomationGraphActivity } from "../app/automation.members.ts";
import type { AutomationTraceTriggerCatalogue } from "../repositories/automation-trace-trigger-catalogue.repository.ts";
import type {
  AutomationEvaluationTraceSummary,
  AutomationEvaluationTriggerFilter,
  AutomationTriggerMatchRecorder,
} from "../app/automation.members.ts";

/**
 * Evaluation event subscribers using four narrow ports instead of two capability
 * services, enabling different composition for application vs. background contexts.
 */
export class AutomationEvaluationSubscriberService extends AutomationEvaluationSubscriberCapability {
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
  ) {
    super();
  }

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
