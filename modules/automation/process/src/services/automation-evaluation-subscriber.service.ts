import type {
  AutomationEvaluationActivityContext,
  AutomationEvaluationSubscriberContext,
  AutomationEvaluationSubscriberEvent,
  AutomationTraceSubscriberContext,
} from "@langwatch/automation-contract";
import type { EvaluationApi, EvaluationStatus } from "@langwatch/evaluation-contract";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import { passesTraceOriginGuards } from "@langwatch/trace-contract";

import { handleEvaluationAlertTriggerMatch } from "../eventing/evaluation-alert-trigger-match.subscriber.ts";
import { handleGraphTriggerActivity } from "../eventing/graph-trigger-activity.subscriber.ts";
import { handleTraceAlertTriggerMatch } from "../eventing/trace-alert-trigger-match.subscriber.ts";
import type { AutomationTraceTriggerCatalogueRepository } from "../repositories/automation-trace-trigger-catalogue.repository.ts";
import type { AutomationEvaluationTriggerFilter } from "./automation-evaluation-trigger-filter.service.ts";
import type { AutomationGraphActivity } from "./automation-graph-activity.service.ts";
import type { AutomationMatchRecordMetricsSink } from "./automation-match-record-metrics.service.ts";
import type { AutomationTriggerMatchRecorder } from "./automation-trigger-match-dispatcher.service.ts";

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
    runs: Pick<EvaluationApi, "findRunByEvaluationId">;
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
      runs: Pick<EvaluationApi, "findRunByEvaluationId">;
    },
  ) {}

  /** Trace's span or origin event, settled: guards on the folded summary, then matches. */
  async handleTraceActivity(input: {
    projectId: string;
    traceId: string;
    eventType: string;
    occurredAt: number;
  }): Promise<void> {
    const { projectId, traceId, occurredAt } = input;
    const summary = await this.deps.traces.findSummary({ projectId, traceId });
    if (!summary) return;
    if (!passesTraceOriginGuards({ type: input.eventType, occurredAt }, summary)) return;
    await this.handleTraceTriggerMatch(
      { occurredAt },
      { tenantId: projectId, aggregateId: traceId },
    );
  }

  /** Evaluation's completed or reported event, settled; a completed run's trace is read. */
  async handleEvaluationSettled(input: {
    projectId: string;
    evaluationId: string;
    status: EvaluationStatus;
    traceId?: string | null;
    occurredAt: number;
  }): Promise<void> {
    const { projectId, evaluationId } = input;
    const traceId =
      input.traceId ??
      (await this.deps.runs.findRunByEvaluationId({ tenantId: projectId, evaluationId }))?.traceId;
    await this.handleEvaluationTriggerMatch(
      { occurredAt: input.occurredAt },
      { tenantId: projectId, state: { status: input.status, traceId } },
    );
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

/**
 * Trace summary read by evaluation alert subscriber; narrower than full TraceService
 * which carries unused paths.
 */
export interface AutomationEvaluationTraceSummary {
  findSummary(input: { projectId: string; traceId: string }): Promise<TraceSummaryData | null>;
}
