import {
  type AutomationPersistCapBreach,
  AutomationService,
  type CreateTriggerCommand,
  type CustomGraph,
  type CustomGraphNameRef,
  type EmailSuppression,
  type GraphTriggerEvaluationReason,
  type GraphTriggerEvaluationResult,
  type GraphTriggerSweepCandidate,
  type ReportSchedule,
  type SuppressEmailCommand,
  type TestFireInput,
  type TestFireResult,
  type TestFireTemplateDraft,
  type Trigger,
  type TriggerFire,
  type TriggerFireStats,
  type TriggerSummary,
  type UpdateTriggerCommand,
  type WebhookDeliveryInput,
  type WebhookDeliveryRow,
} from "@langwatch/automation-contract";
import { createTenantId, type TriggerContext } from "@langwatch/eventing";
import {
  EVALUATION_COMPLETED_EVENT_TYPE,
  EVALUATION_COMPLETED_EVENT_VERSION_LATEST,
  type EvaluationProcessingEvent,
  type EvaluationRunData,
} from "@langwatch/evaluation-contract";
import { TraceService, type TraceSummaryData } from "@langwatch/trace-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AutomationEvaluationSubscriberService,
  AutomationEvaluationTriggerFilterService,
  AutomationTriggerMatchRecorderPort,
} from "../index";

function trigger(): TriggerSummary {
  return {
    id: "trigger-1",
    projectId: "project-1",
    name: "Evaluation automation",
    action: "SEND_EMAIL",
    triggerKind: "AUTOMATION",
    actionParams: {},
    filters: { "evaluations.passed": { "evaluator-1": ["true"] } },
    filterQuery: null,
    alertType: "WARNING",
    message: "",
    customGraphId: null,
    notificationCadence: "immediate",
    traceDebounceMs: 30_000,
    templates: {
      slackTemplateType: null,
      slackTemplate: null,
      emailSubjectTemplate: null,
      emailBodyTemplate: null,
    },
  };
}

function evaluationEvent(occurredAt: number): EvaluationProcessingEvent {
  return {
    id: "event-1",
    aggregateId: "evaluation-1",
    aggregateType: "evaluation",
    tenantId: createTenantId("project-1"),
    createdAt: occurredAt,
    occurredAt,
    type: EVALUATION_COMPLETED_EVENT_TYPE,
    version: EVALUATION_COMPLETED_EVENT_VERSION_LATEST,
    data: {
      evaluationId: "evaluation-1",
      status: "processed",
    },
  };
}

class TestTraceService extends TraceService {
  // `TraceService` grew these and the fakes did not follow. A member left
  // off a double is a method the real service has that no test here would
  // notice going wrong.
  getFullRecord(): Promise<never> {
    return Promise.reject(new Error("not used by this subscriber"));
  }

  getFullThread(): Promise<never> {
    return Promise.reject(new Error("not used by this subscriber"));
  }

  classifyQuery() {
    return { evaluations: true, events: false, spans: false };
  }

  getById(): Promise<never> {
    return Promise.reject(new Error("not used by this subscriber"));
  }

  deriveEvents(): Promise<never> {
    return Promise.reject(new Error("not used by this subscriber"));
  }

  getEvaluationSpans(): Promise<never> {
    return Promise.reject(new Error("not used by this subscriber"));
  }

  getEvaluationEvents(): Promise<never> {
    return Promise.reject(new Error("not used by this subscriber"));
  }

  getSpanTreePage(): Promise<never> {
    return Promise.reject(new Error("not used by this subscriber"));
  }

  getSpanTreeDelta(): Promise<never> {
    return Promise.reject(new Error("not used by this subscriber"));
  }

  buildQueryFieldCatalogue(): Promise<never> {
    return Promise.reject(new Error("not used by this subscriber"));
  }

  resolveIngestWaitTimeout(): Promise<never> {
    return Promise.reject(new Error("not used by this subscriber"));
  }

  tryGetSummary(): Promise<TraceSummaryData> {
    return Promise.resolve({
      traceId: "trace-1",
      spanCount: 1,
      totalDurationMs: 1,
      computedIOSchemaVersion: "1",
      computedInput: null,
      computedOutput: null,
      timeToFirstTokenMs: null,
      timeToLastTokenMs: null,
      tokensPerSecond: null,
      containsErrorStatus: false,
      containsOKStatus: true,
      errorMessage: null,
      models: [],
      totalCost: null,
      nonBilledCost: null,
      tokensEstimated: false,
      totalPromptTokenCount: null,
      totalCompletionTokenCount: null,
      outputFromRootSpan: false,
      outputSpanEndTimeMs: 0,
      blockedByGuardrail: false,
      rootSpanType: null,
      containsAi: false,
      containsPrompt: false,
      selectedPromptId: null,
      selectedPromptSpanId: null,
      selectedPromptStartTimeMs: null,
      lastUsedPromptId: null,
      lastUsedPromptVersionNumber: null,
      lastUsedPromptVersionId: null,
      lastUsedPromptSpanId: null,
      lastUsedPromptStartTimeMs: null,
      topicId: null,
      subTopicId: null,
      annotationIds: [],
      attributes: {},
      traceName: "trace",
      occurredAt: 0,
      createdAt: 0,
      updatedAt: 0,
      LastEventOccurredAt: 0,
    });
  }
}

class TestAutomationService extends AutomationService {
  private readonly unavailable = (): never => {
    throw new Error("not used by this subscriber");
  };

  validateTemplateDraft(_input: TestFireTemplateDraft): void {
    this.unavailable();
  }
  testFire(_input: TestFireInput): Promise<TestFireResult> {
    return this.unavailable();
  }
  evaluateGraphTrigger(_input: {
    triggerId: string;
    projectId: string;
    reason: GraphTriggerEvaluationReason;
  }): Promise<GraphTriggerEvaluationResult> {
    return this.unavailable();
  }
  decideGraphTriggerHeartbeat(_input: { now: Date }): Promise<GraphTriggerSweepCandidate[]> {
    return this.unavailable();
  }
  handlePersistCapBreach(_input: AutomationPersistCapBreach): Promise<void> {
    return this.unavailable();
  }
  resolvePersistDailyCap(_projectId: string): Promise<number> {
    return this.unavailable();
  }
  consumePersistCapSlot(_input: {
    projectId: string;
    triggerId: string;
    now: Date;
    cap: number;
    dedupKey: string;
  }) {
    return this.unavailable();
  }
  readPersistCapCounts(_input: {
    projectId: string;
    triggerIds: readonly string[];
    now: Date;
    cap: number;
  }) {
    return this.unavailable();
  }
  getById(_input: { triggerId: string; projectId: string }): Promise<Trigger> {
    return this.unavailable();
  }
  tryGetById(_input: { triggerId: string; projectId: string }): Promise<Trigger | null> {
    return this.unavailable();
  }
  getAllForProject(_input: { projectId: string }): Promise<Trigger[]> {
    return this.unavailable();
  }
  create(_input: CreateTriggerCommand): Promise<Trigger> {
    return this.unavailable();
  }
  update(_input: UpdateTriggerCommand): Promise<Trigger> {
    return this.unavailable();
  }
  archive(_input: { triggerId: string; projectId: string }): Promise<Trigger> {
    return this.unavailable();
  }
  softDeleteById(_input: { triggerId: string; projectId: string }): Promise<Trigger> {
    return this.unavailable();
  }
  tryGetByCustomGraphId(_input: {
    projectId: string;
    customGraphId: string;
  }): Promise<Trigger | null> {
    return this.unavailable();
  }
  getByCustomGraphIds(_input: { projectId: string; customGraphIds: string[] }): Promise<Trigger[]> {
    return this.unavailable();
  }
  getActiveTraceTriggersForProject(_projectId: string): Promise<TriggerSummary[]> {
    return Promise.resolve([trigger()]);
  }
  getActiveGraphTriggersForProject(_projectId: string): Promise<TriggerSummary[]> {
    return this.unavailable();
  }
  claimSend(_input: { triggerId: string; traceId: string; projectId: string }): Promise<boolean> {
    return this.unavailable();
  }
  isSendClaimed(_input: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean> {
    return this.unavailable();
  }
  filterSendClaimed(_input: {
    triggerId: string;
    traceIds: string[];
    projectId: string;
  }): Promise<Set<string>> {
    return this.unavailable();
  }
  updateLastRunAt(_input: { triggerId: string; projectId: string }): Promise<void> {
    return this.unavailable();
  }
  invalidate(_projectId: string): Promise<void> {
    return this.unavailable();
  }
  getReportSchedules(_input: { projectId: string }): Promise<ReportSchedule[]> {
    return this.unavailable();
  }
  syncReportSchedule(_input: {
    projectId: string;
    triggerId: string;
    cron: string;
    timezone: string;
  }): Promise<void> {
    return this.unavailable();
  }
  removeReportSchedule(_input: { projectId: string; triggerId: string }): Promise<void> {
    return this.unavailable();
  }
  reconcileReportSchedules(): Promise<{ repaired: number }> {
    return this.unavailable();
  }
  getFireStats(_input: { projectId: string }): Promise<TriggerFireStats[]> {
    return this.unavailable();
  }
  getRecentFires(_input: {
    projectId: string;
    triggerId?: string;
    limit: number;
  }): Promise<TriggerFire[]> {
    return this.unavailable();
  }
  recordFire(_input: {
    projectId: string;
    triggerId: string;
    traceId?: string | null;
    customGraphId?: string | null;
    createdAt: Date;
    resolvedAt?: Date | null;
  }): Promise<TriggerFire> {
    return this.unavailable();
  }
  getSuppressions(_input: { projectId: string }): Promise<EmailSuppression[]> {
    return this.unavailable();
  }
  getAllEnriched(_input: {
    projectId: string;
  }): Promise<Array<EmailSuppression & { triggerName: string | null }>> {
    return this.unavailable();
  }
  suppressEmail(_input: SuppressEmailCommand): Promise<EmailSuppression> {
    return this.unavailable();
  }
  removeSuppression(_input: { id: string; projectId: string }): Promise<void> {
    return this.unavailable();
  }
  filterSuppressed(_input: {
    projectId: string;
    triggerId: string;
    emails: string[];
  }): Promise<string[]> {
    return this.unavailable();
  }
  tryResolveUnsubscribeView(_input: { token: string }): Promise<{
    projectName: string;
    triggerName: string | null;
    email: string;
  } | null> {
    return this.unavailable();
  }
  confirmUnsubscribe(_input: { token: string; scope: "trigger" | "project" }): Promise<void> {
    return this.unavailable();
  }
  tryGetCustomGraph(_input: {
    customGraphId: string;
    projectId: string;
  }): Promise<CustomGraph | null> {
    return this.unavailable();
  }
  customGraphExistsInProject(_input: {
    customGraphId: string;
    projectId: string;
  }): Promise<boolean> {
    return this.unavailable();
  }
  getCustomGraphNamesByIds(_input: {
    customGraphIds: string[];
    projectId: string;
  }): Promise<CustomGraphNameRef[]> {
    return this.unavailable();
  }
  recordWebhookDelivery(_input: WebhookDeliveryInput): Promise<void> {
    return this.unavailable();
  }
  getRecentWebhookDeliveries(_input: {
    projectId: string;
    triggerId: string;
    limit: number;
  }): Promise<WebhookDeliveryRow[]> {
    return this.unavailable();
  }
  pruneWebhookDeliveries(_now?: Date): Promise<number> {
    return this.unavailable();
  }
}

class TestTriggerMatchRecorderPort extends AutomationTriggerMatchRecorderPort {
  readonly sent: Array<Record<string, unknown>> = [];
  readonly committed = new Set<string>();

  async send(input: {
    tenantId: string;
    occurredAt: number;
    triggerId: string;
    traceId: string;
  }): Promise<void> {
    this.sent.push(input);
    this.committed.add(`${input.triggerId}:${input.traceId}:${input.occurredAt}`);
  }
}

describe("evaluation alert trigger-match subscriber redelivery", () => {
  afterEach(() => vi.useRealTimers());

  it("emits byte-identical match commands so the durable command boundary deduplicates redelivery", async () => {
    vi.useFakeTimers();
    const occurredAt = 1_750_000_000_000;
    vi.setSystemTime(occurredAt);
    const recordTriggerMatch = new TestTriggerMatchRecorderPort();
    const service = AutomationEvaluationSubscriberService.create({
      automation: new TestAutomationService(),
      traces: new TestTraceService(),
      evaluationFilters: AutomationEvaluationTriggerFilterService.create(new TestTraceService()),
      triggerMatches: recordTriggerMatch,
    });
    const context: TriggerContext<EvaluationRunData> = {
      tenantId: "project-1",
      aggregateId: "evaluation-1",
      state: {
        evaluationId: "evaluation-1",
        evaluatorId: "evaluator-1",
        evaluatorType: "langevals",
        evaluatorName: null,
        traceId: "trace-1",
        isGuardrail: false,
        status: "processed",
        score: null,
        passed: null,
        label: null,
        details: null,
        inputs: null,
        error: null,
        errorDetails: null,
        createdAt: occurredAt,
        updatedAt: occurredAt,
        LastEventOccurredAt: occurredAt,
        archivedAt: null,
        scheduledAt: occurredAt,
        startedAt: occurredAt,
        completedAt: occurredAt,
        costId: null,
      },
    };

    await service.handleEvaluationTriggerMatch(evaluationEvent(occurredAt), context);
    await service.handleEvaluationTriggerMatch(evaluationEvent(occurredAt), context);

    expect(recordTriggerMatch.sent).toHaveLength(2);
    expect(recordTriggerMatch.sent[1]).toEqual(recordTriggerMatch.sent[0]);
    expect(recordTriggerMatch.committed).toHaveLength(1);
  });
});
