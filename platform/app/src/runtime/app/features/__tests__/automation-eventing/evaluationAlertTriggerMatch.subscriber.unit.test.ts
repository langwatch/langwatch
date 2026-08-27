import {
  AutomationService,
  RECORD_TRIGGER_MATCH_COMMAND_TYPE,
  type TriggerMatchRecordedEventData,
  type TriggerSummary,
} from "@langwatch/automation-contract";
import {
  AutomationEvaluationSubscriberService,
  AutomationEvaluationTriggerFilterService,
  AutomationTriggerMatchRecorderPort,
  RecordTriggerMatchCommand,
  settleWindowBucket,
} from "@langwatch/automation-server";
import { createTenantId, type TriggerContext } from "@langwatch/eventing";
import {
  EVALUATION_COMPLETED_EVENT_TYPE,
  EVALUATION_COMPLETED_EVENT_VERSION_LATEST,
  type EvaluationProcessingEvent,
  type EvaluationRunData,
} from "@langwatch/evaluation-contract";
import { TraceService, type TraceSummaryData } from "@langwatch/trace-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

function evaluation(
  input: {
    status?: EvaluationRunData["status"];
    traceId?: string | null;
  } = {},
): EvaluationRunData {
  const occurredAt = 1_750_000_000_000;
  return {
    evaluationId: "evaluation-1",
    evaluatorId: "evaluator-1",
    evaluatorType: "langevals",
    evaluatorName: null,
    traceId: input.traceId === undefined ? "trace-1" : input.traceId,
    isGuardrail: false,
    status: input.status ?? "processed",
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
  };
}

function event(occurredAt = Date.now()): EvaluationProcessingEvent {
  return {
    id: "event-1",
    aggregateId: "evaluation-1",
    aggregateType: "evaluation",
    tenantId: createTenantId("project-1"),
    occurredAt,
    createdAt: occurredAt,
    type: EVALUATION_COMPLETED_EVENT_TYPE,
    version: EVALUATION_COMPLETED_EVENT_VERSION_LATEST,
    data: { evaluationId: "evaluation-1", status: "processed" },
  };
}

function context(state = evaluation()): TriggerContext<EvaluationRunData> {
  return { tenantId: "project-1", aggregateId: "evaluation-1", state };
}

function trigger(input: Partial<TriggerSummary> = {}): TriggerSummary {
  return {
    id: "trigger-1",
    projectId: "project-1",
    name: "Evaluation automation",
    action: "ADD_TO_DATASET",
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
    ...input,
  };
}

function traceSummary(): TraceSummaryData {
  return {
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
  };
}

class TestTraceService extends TraceService {
  readonly reads: Array<{ projectId: string; traceId: string }> = [];
  summary: TraceSummaryData | null = traceSummary();

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
  tryGetSummary(input: { projectId: string; traceId: string }): Promise<TraceSummaryData | null> {
    this.reads.push(input);
    return Promise.resolve(this.summary);
  }
}

class TestAutomationService extends AutomationService {
  constructor(private readonly triggers: TriggerSummary[]) {
    super();
  }

  private unavailable(): never {
    throw new Error("not used by this subscriber");
  }

  validateTemplateDraft() {
    return this.unavailable();
  }
  testFire() {
    return this.unavailable();
  }
  evaluateGraphTrigger() {
    return this.unavailable();
  }
  decideGraphTriggerHeartbeat() {
    return this.unavailable();
  }
  handlePersistCapBreach() {
    return this.unavailable();
  }
  resolvePersistDailyCap() {
    return this.unavailable();
  }
  consumePersistCapSlot() {
    return this.unavailable();
  }
  readPersistCapCounts() {
    return this.unavailable();
  }
  getById() {
    return this.unavailable();
  }
  tryGetById() {
    return this.unavailable();
  }
  getAllForProject() {
    return this.unavailable();
  }
  create() {
    return this.unavailable();
  }
  update() {
    return this.unavailable();
  }
  archive() {
    return this.unavailable();
  }
  softDeleteById() {
    return this.unavailable();
  }
  tryGetByCustomGraphId() {
    return this.unavailable();
  }
  getByCustomGraphIds() {
    return this.unavailable();
  }
  getActiveTraceTriggersForProject(): Promise<TriggerSummary[]> {
    return Promise.resolve(this.triggers);
  }
  getActiveGraphTriggersForProject() {
    return this.unavailable();
  }
  claimSend() {
    return this.unavailable();
  }
  isSendClaimed() {
    return this.unavailable();
  }
  filterSendClaimed() {
    return this.unavailable();
  }
  updateLastRunAt() {
    return this.unavailable();
  }
  invalidate() {
    return this.unavailable();
  }
  getReportSchedules() {
    return this.unavailable();
  }
  syncReportSchedule() {
    return this.unavailable();
  }
  removeReportSchedule() {
    return this.unavailable();
  }
  reconcileReportSchedules() {
    return this.unavailable();
  }
  getFireStats() {
    return this.unavailable();
  }
  getRecentFires() {
    return this.unavailable();
  }
  recordFire() {
    return this.unavailable();
  }
  getSuppressions() {
    return this.unavailable();
  }
  getAllEnriched() {
    return this.unavailable();
  }
  suppressEmail() {
    return this.unavailable();
  }
  removeSuppression() {
    return this.unavailable();
  }
  filterSuppressed() {
    return this.unavailable();
  }
  tryResolveUnsubscribeView() {
    return this.unavailable();
  }
  confirmUnsubscribe() {
    return this.unavailable();
  }
  tryGetCustomGraph() {
    return this.unavailable();
  }
  customGraphExistsInProject() {
    return this.unavailable();
  }
  getCustomGraphNamesByIds() {
    return this.unavailable();
  }
  recordWebhookDelivery() {
    return this.unavailable();
  }
  getRecentWebhookDeliveries() {
    return this.unavailable();
  }
  pruneWebhookDeliveries() {
    return this.unavailable();
  }
}

type TriggerMatchInput = TriggerMatchRecordedEventData & {
  tenantId: string;
  occurredAt: number;
};

class TestTriggerMatchRecorderPort extends AutomationTriggerMatchRecorderPort {
  readonly sent: TriggerMatchInput[] = [];

  async send(input: TriggerMatchInput): Promise<void> {
    this.sent.push(input);
  }
}

function subscriber(input: {
  automation: TestAutomationService;
  traces: TestTraceService;
  recorder: TestTriggerMatchRecorderPort;
}): AutomationEvaluationSubscriberService {
  return AutomationEvaluationSubscriberService.create({
    automation: input.automation,
    traces: input.traces,
    evaluationFilters: AutomationEvaluationTriggerFilterService.create(input.traces),
    triggerMatches: input.recorder,
  });
}

function deps(rows: TriggerSummary[] = [trigger()]) {
  return {
    automation: new TestAutomationService(rows),
    traces: new TestTraceService(),
    recorder: new TestTriggerMatchRecorderPort(),
  };
}

describe("evaluation alert trigger match subscriber", () => {
  it("records every evaluation-filtered match with its action class", async () => {
    const dependencies = deps([
      trigger(),
      trigger({ id: "trigger-2", action: "SEND_EMAIL" }),
      trigger({ id: "trace-only", filters: { "traces.origin": ["application"] } }),
    ]);

    await subscriber(dependencies).handleEvaluationTriggerMatch(event(), context());

    expect(dependencies.recorder.sent).toHaveLength(2);
    expect(dependencies.recorder.sent[0]).toMatchObject({
      tenantId: "project-1",
      triggerId: "trigger-1",
      traceId: "trace-1",
      actionClass: "persist",
    });
    expect(dependencies.recorder.sent[1]).toMatchObject({
      triggerId: "trigger-2",
      actionClass: "notify",
    });
  });

  describe("given at-least-once delivery of a committed event", () => {
    afterEach(() => vi.useRealTimers());

    it("sends identical commands yielding one idempotency key regardless of wall-clock time", async () => {
      vi.useFakeTimers();
      const firstDeliveryAt = 1_750_000_000_000;
      vi.setSystemTime(firstDeliveryAt);
      const dependencies = deps();
      const handler = subscriber(dependencies);
      const committedEvent = event(firstDeliveryAt);

      await handler.handleEvaluationTriggerMatch(committedEvent, context());
      vi.advanceTimersByTime(120_000);
      await handler.handleEvaluationTriggerMatch(committedEvent, context());

      expect(dependencies.recorder.sent).toHaveLength(2);
      const [firstPayload, secondPayload] = dependencies.recorder.sent;
      expect(secondPayload).toEqual(firstPayload);
      expect(secondPayload?.occurredAt).toBe(firstDeliveryAt);

      const idempotencyKeys = await Promise.all(
        [firstPayload, secondPayload].map(async (payload) => {
          if (!payload) throw new Error("expected a trigger-match payload");
          const [producedEvent] = await new RecordTriggerMatchCommand().handle({
            tenantId: createTenantId(payload.tenantId),
            aggregateId: payload.triggerId,
            type: RECORD_TRIGGER_MATCH_COMMAND_TYPE,
            data: payload,
          });
          if (!producedEvent) throw new Error("expected a trigger-match event");
          return producedEvent.idempotencyKey;
        }),
      );
      expect(new Set(idempotencyKeys).size).toBe(1);
      expect(idempotencyKeys[0]).toBe(
        `trigger-1:trace-1:${settleWindowBucket({
          occurredAt: firstDeliveryAt,
          traceDebounceMs: 30_000,
        })}`,
      );
    });
  });

  describe.each([
    ["a stale event", event(Date.now() - 60 * 60 * 1000 - 1), context()],
    ["an in-progress evaluation", event(), context(evaluation({ status: "in_progress" }))],
    ["an evaluation without a trace", event(), context(evaluation({ traceId: null }))],
  ])("given %s", (_label, inputEvent, inputContext) => {
    it("does not read the trace or record a match", async () => {
      const dependencies = deps();

      await subscriber(dependencies).handleEvaluationTriggerMatch(inputEvent, inputContext);

      expect(dependencies.traces.reads).toEqual([]);
      expect(dependencies.recorder.sent).toEqual([]);
    });
  });

  it("drops the match before loading automations when the trace fold is unavailable", async () => {
    const dependencies = deps();
    dependencies.traces.summary = null;

    await subscriber(dependencies).handleEvaluationTriggerMatch(event(), context());

    expect(dependencies.traces.reads).toHaveLength(1);
    expect(dependencies.recorder.sent).toEqual([]);
  });
});
