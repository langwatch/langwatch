import { describe, expect, it } from "vitest";
import type { TriggerSummary } from "@langwatch/automation-contract";
import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import { EvaluationService } from "@langwatch/evaluation-contract";
import type { DerivedTraceEvent, TraceSummaryData } from "@langwatch/trace-contract";
import { TraceService } from "@langwatch/trace-contract";
import { AutomationSettlementFilterEvaluatorPort } from "../../ports/automation-settlement.port";
import { AutomationSettlementMatchConfirmationService } from "../automation-settlement-match-confirmation.service";

function unavailable(): never {
  throw new Error("not used by this test");
}

class TestEvaluations extends EvaluationService {
  readonly lookups: Array<{ tenantId: string; traceId: string }> = [];
  runs: EvaluationRunData[] = [];

  validateTemplateDraft(): never {
    return unavailable();
  }
  testFire(): never {
    return unavailable();
  }
  executeForTrace(): never {
    return unavailable();
  }
  upsertRun(): never {
    return unavailable();
  }
  upsertRuns(): never {
    return unavailable();
  }
  getRunByEvaluationId(): never {
    return unavailable();
  }
  tryGetRunByEvaluationId(): never {
    return unavailable();
  }
  findRunsByTraceId(input: { tenantId: string; traceId: string }): Promise<EvaluationRunData[]> {
    this.lookups.push(input);
    return Promise.resolve(this.runs);
  }
  findSummariesByTraceIds(): never {
    return unavailable();
  }
  findTraceEvaluations(): never {
    return unavailable();
  }
  tryGetInputs(): never {
    return unavailable();
  }
  getMonitorPerformance(): never {
    return unavailable();
  }
}

class TestTraces extends TraceService {
  // `TraceService` grew these and the fakes did not follow. A member left
  // off a double is a method the real service has that no test here would
  // notice going wrong.
  getFullRecord(): Promise<never> {
    return Promise.reject(new Error("not used by this test"));
  }

  getFullThread(): Promise<never> {
    return Promise.reject(new Error("not used by this test"));
  }

  classification = { evaluations: false, events: false, spans: false };
  readonly classifications: string[] = [];
  readonly eventRequests: Array<{
    projectId: string;
    traceId: string;
    occurredAtMs?: number;
    foldVersion?: number;
  }> = [];
  events: DerivedTraceEvent[] = [];

  getById(): never {
    return unavailable();
  }

  deriveEvents(input: {
    projectId: string;
    traceId: string;
    occurredAtMs?: number;
    foldVersion?: number;
  }): Promise<DerivedTraceEvent[]> {
    this.eventRequests.push(input);
    return Promise.resolve(this.events);
  }

  getEvaluationSpans(): never {
    return unavailable();
  }
  getEvaluationEvents(): never {
    return unavailable();
  }
  getSpanTreePage(): never {
    return unavailable();
  }
  getSpanTreeDelta(): never {
    return unavailable();
  }
  buildQueryFieldCatalogue(): never {
    return unavailable();
  }
  classifyQuery(input: { query: string }) {
    this.classifications.push(input.query);
    return this.classification;
  }
  resolveIngestWaitTimeout(): never {
    return unavailable();
  }
  tryGetSummary(): never {
    return unavailable();
  }
}

class TestFilterEvaluator extends AutomationSettlementFilterEvaluatorPort {
  filterQueryResult = true;
  traceFilterResult = true;
  evaluationFilterResult = true;
  filterQueryCalls: Array<{
    query: string;
    foldState: TraceSummaryData;
    evaluations: EvaluationRunData[] | null;
    events: DerivedTraceEvent[] | null;
  }> = [];
  traceFilterCalls: Array<{
    filters: Record<string, unknown>;
    foldState: TraceSummaryData;
    events: DerivedTraceEvent[] | null;
  }> = [];
  evaluationFilterCalls: Array<{
    filters: Record<string, unknown>;
    evaluations: EvaluationRunData[];
  }> = [];

  matchesFilterQuery(input: {
    query: string;
    foldState: TraceSummaryData;
    evaluations: EvaluationRunData[] | null;
    events: DerivedTraceEvent[] | null;
  }): boolean {
    this.filterQueryCalls.push(input);
    return this.filterQueryResult;
  }

  matchesTraceFilters(input: {
    filters: Record<string, unknown>;
    foldState: TraceSummaryData;
    events: DerivedTraceEvent[] | null;
  }): boolean {
    this.traceFilterCalls.push(input);
    return this.traceFilterResult;
  }

  matchesEvaluationFilters(input: {
    filters: Record<string, unknown>;
    evaluations: EvaluationRunData[];
  }): boolean {
    this.evaluationFilterCalls.push(input);
    return this.evaluationFilterResult;
  }
}

function traceSummary(): TraceSummaryData {
  return {
    traceId: "trace-1",
    traceName: "trace",
    spanCount: 3,
    totalDurationMs: 10,
    computedIOSchemaVersion: "1",
    computedInput: "input",
    computedOutput: "output",
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
    occurredAt: 123,
    createdAt: 100,
    updatedAt: 123,
    LastEventOccurredAt: 123,
  };
}

function trigger(overrides: Partial<TriggerSummary> = {}): TriggerSummary {
  return {
    id: "trigger-1",
    projectId: "project-1",
    name: "Automation",
    action: "SEND_EMAIL",
    triggerKind: "AUTOMATION",
    actionParams: {},
    filters: {},
    filterQuery: null,
    alertType: null,
    message: null,
    customGraphId: null,
    notificationCadence: "immediate",
    traceDebounceMs: 0,
    templates: {
      slackTemplateType: null,
      slackTemplate: null,
      emailSubjectTemplate: null,
      emailBodyTemplate: null,
    },
    ...overrides,
  };
}

function createService() {
  const evaluations = new TestEvaluations();
  const traces = new TestTraces();
  const filterEvaluator = new TestFilterEvaluator();
  const service = AutomationSettlementMatchConfirmationService.create({
    evaluations,
    traces,
    filterEvaluator,
  });

  return { service, evaluations, traces, filterEvaluator };
}

describe("AutomationSettlementMatchConfirmationService", () => {
  it("loads only the query dependencies before rejecting a settled notification match", async () => {
    const { service, evaluations, traces, filterEvaluator } = createService();
    traces.classification = { evaluations: true, events: true, spans: false };
    filterEvaluator.filterQueryResult = false;

    const confirmed = await service.confirms({
      trigger: trigger({ filterQuery: "evaluation:failed AND event:tool" }),
      projectId: "project-1",
      traceId: "trace-1",
      foldState: traceSummary(),
    });

    expect(confirmed).toBe(false);
    expect(traces.classifications).toEqual(["evaluation:failed AND event:tool"]);
    expect(evaluations.lookups).toEqual([{ tenantId: "project-1", traceId: "trace-1" }]);
    expect(traces.eventRequests).toEqual([
      { projectId: "project-1", traceId: "trace-1", occurredAtMs: 123, foldVersion: 3 },
    ]);
    expect(filterEvaluator.filterQueryCalls).toHaveLength(1);
  });

  it("does not consume evaluation reads or delivery eligibility when a legacy trace filter fails", async () => {
    const { service, evaluations, traces, filterEvaluator } = createService();
    filterEvaluator.traceFilterResult = false;

    const confirmed = await service.confirms({
      trigger: trigger({
        filters: {
          "events.event_type": ["tool"],
          "evaluations.passed": ["true"],
        },
      }),
      projectId: "project-1",
      traceId: "trace-1",
      foldState: traceSummary(),
    });

    expect(confirmed).toBe(false);
    expect(traces.eventRequests).toEqual([
      { projectId: "project-1", traceId: "trace-1", occurredAtMs: 123, foldVersion: 3 },
    ]);
    expect(evaluations.lookups).toEqual([]);
    expect(filterEvaluator.traceFilterCalls).toHaveLength(1);
    expect(filterEvaluator.evaluationFilterCalls).toEqual([]);
  });

  it("requires both legacy trace and evaluation filters before a persist match can dispatch", async () => {
    const { service, evaluations, filterEvaluator } = createService();
    filterEvaluator.evaluationFilterResult = false;

    const confirmed = await service.confirms({
      trigger: trigger({
        action: "ADD_TO_DATASET",
        filters: {
          "traces.origin": ["application"],
          "evaluations.passed": ["true"],
        },
      }),
      projectId: "project-1",
      traceId: "trace-1",
      foldState: traceSummary(),
    });

    expect(confirmed).toBe(false);
    expect(evaluations.lookups).toEqual([{ tenantId: "project-1", traceId: "trace-1" }]);
    expect(filterEvaluator.traceFilterCalls).toHaveLength(1);
    expect(filterEvaluator.evaluationFilterCalls).toHaveLength(1);
  });
});
