import {
  AutomationEvaluationSubscriberService as AutomationEvaluationSubscriberCapability,
  type AutomationService,
  type AutomationEvaluationActivityContext,
  type AutomationEvaluationSubscriberContext,
  type AutomationEvaluationSubscriberEvent,
} from "@langwatch/automation-contract";
import type { TraceService } from "@langwatch/trace-contract";
import { handleEvaluationAlertTriggerMatch } from "../subscribers/evaluation-alert-trigger-match.subscriber";
import { handleGraphTriggerActivity } from "../subscribers/graph-trigger-activity.subscriber";
import {
  AutomationEvaluationTriggerFilterPort,
  AutomationTriggerMatchRecorderPort,
} from "../ports/automation-evaluation-subscriber.port";

/**
 * Process-lifetime Automation implementation of Evaluation's two terminal
 * event subscribers. The pipeline supplies redelivery and deduplication.
 */
export class AutomationEvaluationSubscriberService extends AutomationEvaluationSubscriberCapability {
  static create(input: {
    automation: AutomationService;
    traces: TraceService;
    evaluationFilters: AutomationEvaluationTriggerFilterPort;
    triggerMatches: AutomationTriggerMatchRecorderPort;
  }): AutomationEvaluationSubscriberService {
    return new AutomationEvaluationSubscriberService(input);
  }

  private constructor(
    private readonly deps: {
      automation: AutomationService;
      traces: TraceService;
      evaluationFilters: AutomationEvaluationTriggerFilterPort;
      triggerMatches: AutomationTriggerMatchRecorderPort;
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
        automation: this.deps.automation,
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
    return handleGraphTriggerActivity(this.deps.automation, event, context);
  }
}
