import type {
  AutomationEvaluationActivityContext,
  AutomationEvaluationSubscriberContext,
  AutomationEvaluationSubscriberEvent,
  AutomationTraceSubscriberContext,
} from "@langwatch/automation-contract";

import type {
  AutomationGraphActivity,
  AutomationEvaluationTraceSummary,
  AutomationEvaluationTriggerFilter,
  AutomationTriggerMatchRecorder,
} from "../app/automation.members.ts";
import { handleEvaluationAlertTriggerMatch } from "../eventing/evaluation-alert-trigger-match.subscriber.ts";
import { handleGraphTriggerActivity } from "../eventing/graph-trigger-activity.subscriber.ts";
import { handleTraceAlertTriggerMatch } from "../eventing/trace-alert-trigger-match.subscriber.ts";
import type { AutomationTraceTriggerCatalogueRepository } from "../repositories/automation-trace-trigger-catalogue.repository.ts";
import type { AutomationMatchRecordMetricsSink } from "./automation-match-record-metrics.service.ts";

/**
 * Evaluation event subscribers using four narrow ports instead of two capability
 * services, enabling different composition for application vs. background contexts.
 */
export class AutomationEvaluationSubscriberService {
  static create(input: {
    triggers: AutomationTraceTriggerCatalogueRepository;
    graphActivity: AutomationGraphActivity;
    traces: AutomationEvaluationTraceSummary;
    evaluationFilters: AutomationEvaluationTriggerFilter;
    triggerMatches: AutomationTriggerMatchRecorder;
    matchRecordMetrics: AutomationMatchRecordMetricsSink;
  }): AutomationEvaluationSubscriberService {
    return new AutomationEvaluationSubscriberService(input);
  }

  private constructor(
    private readonly deps: {
      triggers: AutomationTraceTriggerCatalogueRepository;
      graphActivity: AutomationGraphActivity;
      traces: AutomationEvaluationTraceSummary;
      evaluationFilters: AutomationEvaluationTriggerFilter;
      triggerMatches: AutomationTriggerMatchRecorder;
      matchRecordMetrics: AutomationMatchRecordMetricsSink;
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

  handleTraceTriggerMatch(
    event: AutomationEvaluationSubscriberEvent,
    context: AutomationTraceSubscriberContext,
  ): Promise<void> {
    return handleTraceAlertTriggerMatch(
      {
        triggers: this.deps.triggers,
        triggerMatches: this.deps.triggerMatches,
        metrics: this.deps.matchRecordMetrics,
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
