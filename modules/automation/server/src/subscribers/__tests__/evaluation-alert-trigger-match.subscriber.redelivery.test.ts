import {
  type GraphTriggerEvaluationReason,
  type GraphTriggerEvaluationResult,
  type TriggerSummary,
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
} from "../../index.ts";
import type { AutomationGraphActivityPort } from "../../ports/automation-graph-activity.port.ts";
import type { AutomationTraceTriggerCataloguePort } from "../../ports/automation-trace-trigger-catalogue.port.ts";

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

/**
 * The redelivery test only exercises the trace-catalogue read; graph
 * evaluation is unreached but the double still satisfies the port so
 * `AutomationEvaluationSubscriberService.create` type-checks against the
 * same two narrow ports production composes over.
 */
class TestAutomationService
  implements AutomationTraceTriggerCataloguePort, AutomationGraphActivityPort
{
  private readonly unavailable = (): never => {
    throw new Error("not used by this subscriber");
  };

  getActiveTraceTriggersForProject(_projectId: string): Promise<TriggerSummary[]> {
    return Promise.resolve([trigger()]);
  }
  getActiveGraphTriggersForProject(_projectId: string): Promise<TriggerSummary[]> {
    return this.unavailable();
  }
  evaluateGraphTrigger(_input: {
    triggerId: string;
    projectId: string;
    reason: GraphTriggerEvaluationReason;
  }): Promise<GraphTriggerEvaluationResult> {
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
      triggers: new TestAutomationService(),
      graphActivity: new TestAutomationService(),
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
