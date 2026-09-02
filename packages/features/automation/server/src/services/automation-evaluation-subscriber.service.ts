import {
  AutomationEvaluationSubscriberService as AutomationEvaluationSubscriberCapability,
  type AutomationEvaluationActivityContext,
  type AutomationEvaluationSubscriberContext,
  type AutomationEvaluationSubscriberEvent,
} from "@langwatch/automation-contract";
import { handleEvaluationAlertTriggerMatch } from "../subscribers/evaluation-alert-trigger-match.subscriber";
import { handleGraphTriggerActivity } from "../subscribers/graph-trigger-activity.subscriber";
import type { AutomationGraphActivityPort } from "../ports/automation-graph-activity.port";
import type { AutomationTraceTriggerCataloguePort } from "../ports/automation-trace-trigger-catalogue.port";
import {
  AutomationEvaluationTraceSummaryPort,
  AutomationEvaluationTriggerFilterPort,
  AutomationTriggerMatchRecorderPort,
} from "../ports/automation-evaluation-subscriber.port";

/**
 * Process-lifetime Automation implementation of Evaluation's two terminal
 * event subscribers. The pipeline supplies redelivery and deduplication.
 *
 * FOUR NARROW PORTS RATHER THAN TWO CAPABILITY SERVICES. The two handlers
 * below reach exactly four methods — the trace-trigger catalogue read, the
 * graph-trigger listing, one graph evaluation and one trace-summary read —
 * and the two services that used to be named here (`AutomationService`,
 * `TraceService`) demand between them a mailer, a cipher, an analytics
 * capability and the whole trace read path. Both services still satisfy these
 * ports structurally, so an application composition passes exactly what it
 * passed before, while a background process composes the catalogue over one
 * Prisma client and the summary over the fold it already holds.
 */
export class AutomationEvaluationSubscriberService extends AutomationEvaluationSubscriberCapability {
  static create(input: {
    triggers: AutomationTraceTriggerCataloguePort;
    graphActivity: AutomationGraphActivityPort;
    traces: AutomationEvaluationTraceSummaryPort;
    evaluationFilters: AutomationEvaluationTriggerFilterPort;
    triggerMatches: AutomationTriggerMatchRecorderPort;
  }): AutomationEvaluationSubscriberService {
    return new AutomationEvaluationSubscriberService(input);
  }

  private constructor(
    private readonly deps: {
      triggers: AutomationTraceTriggerCataloguePort;
      graphActivity: AutomationGraphActivityPort;
      traces: AutomationEvaluationTraceSummaryPort;
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
