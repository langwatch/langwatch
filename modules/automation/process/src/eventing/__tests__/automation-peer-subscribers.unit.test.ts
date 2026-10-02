import type { TriggerSummary } from "@langwatch/automation-contract";
import {
  EVALUATION_COMPLETED_EVENT_TYPE,
  EVALUATION_REPORTED_EVENT_TYPE,
  type EvaluationApi,
  type EvaluationRunData,
} from "@langwatch/evaluation-contract";
import { createTenantId, type Event } from "@langwatch/eventing";
/**
 * @vitest-environment node
 * Automation reacts to trace's and evaluation's existing events from its own side (§9).
 * Spec: modules/automation/specs/automation-peer-subscribers.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import {
  ORIGIN_RESOLVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
  type TraceSummaryData,
} from "@langwatch/trace-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { automationPeerSubscribers } from "../../__tests__/fixtures/pipeline-test-harness.ts";
import type {
  AutomationEvaluationTraceSummary,
  AutomationEvaluationTriggerFilter,
  AutomationGraphActivity,
  AutomationTriggerMatchRecorder,
} from "../../app/automation.members.ts";
import type { AutomationTraceTriggerCatalogueRepository } from "../../repositories/automation-trace-trigger-catalogue.repository.ts";
import { AutomationEvaluationSubscriberService } from "../../services/automation-evaluation-subscriber.service.ts";
import type { AutomationMatchRecordMetricsSink } from "../../services/automation-match-record-metrics.service.ts";

const NOW = 1_800_000_000_000;

type Call = { reaction: string; input: unknown };

function routed() {
  const calls: Call[] = [];
  const subscribers = automationPeerSubscribers({
    handleTraceActivity: async (input) => void calls.push({ reaction: "trace", input }),
    handleEvaluationSettled: async (input) => void calls.push({ reaction: "evaluation", input }),
    handleEvaluationGraphTriggerActivity: async (event, context) =>
      void calls.push({ reaction: "graph", input: { event, context } }),
  });
  return { calls, subscribers };
}

function event(input: { type: string; aggregateId: string; data: Record<string, unknown> }): Event {
  return {
    id: `event-${input.type}`,
    aggregateId: input.aggregateId,
    aggregateType: "owner",
    tenantId: createTenantId("project-1"),
    createdAt: NOW,
    occurredAt: NOW,
    type: input.type,
    version: "2026-01-01",
    data: input.data,
  };
}

/** Delivers one event twice, as an at-least-once redelivery would. */
async function deliverTwice(input: { lane: string; event: Event }) {
  const { calls, subscribers } = routed();
  const subscriber = subscribers.get(`automations.${input.lane}`);
  expect(subscriber, `no peer subscriber named ${input.lane}`).toBeDefined();
  const context = { tenantId: "project-1", aggregateId: input.event.aggregateId };
  await subscriber?.handle(input.event, context);
  await subscriber?.handle(input.event, context);
  return calls;
}

describe("automation's peer subscribers", () => {
  describe("when they register", () => {
    /** @scenario "Automation carries main's settle windows on its own peer lanes" */
    it("debounces trigger matching per aggregate and graph sweeps per tenant, as main did", () => {
      const { subscribers } = routed();
      const lane = (name: string) => subscribers.get(`automations.${name}`);
      const spanMatch = lane("traceSpanTriggerMatch");
      const evaluationMatch = lane("evaluationCompletedTriggerMatch");
      const graph = lane("traceSpanGraphActivity");
      const spanEvent = event({ type: SPAN_RECEIVED_EVENT_TYPE, aggregateId: "trace-1", data: {} });

      expect(spanMatch?.eventTypes).toEqual([SPAN_RECEIVED_EVENT_TYPE]);
      expect(spanMatch?.options?.delay).toBe(30_000);
      expect(evaluationMatch?.options?.delay).toBe(10_000);
      expect(graph?.options?.delay).toBe(5_000);
      expect(graph?.options?.groupKeyFn?.(spanEvent)).toBe("graph-trigger-activity:project-1");
      expect([...subscribers.keys()].toSorted()).toEqual(
        [
          "traceSpanTriggerMatch",
          "traceOriginTriggerMatch",
          "evaluationCompletedTriggerMatch",
          "evaluationReportedTriggerMatch",
          "traceSpanGraphActivity",
          "traceOriginGraphActivity",
          "evaluationCompletedGraphActivity",
          "evaluationReportedGraphActivity",
        ]
          .map((name) => `automations.${name}`)
          .toSorted(),
      );
    });
  });

  describe("when trace's span event is delivered twice", () => {
    /** @scenario "A trace's span event wakes trace trigger matching, the same on redelivery" */
    it("hands trace matching the same trace, type and instant both times", async () => {
      const calls = await deliverTwice({
        lane: "traceSpanTriggerMatch",
        event: event({ type: SPAN_RECEIVED_EVENT_TYPE, aggregateId: "trace-1", data: {} }),
      });

      const expected = {
        reaction: "trace",
        input: {
          projectId: "project-1",
          traceId: "trace-1",
          eventType: SPAN_RECEIVED_EVENT_TYPE,
          occurredAt: NOW,
        },
      };
      expect(calls).toEqual([expected, expected]);
    });
  });

  describe("when evaluation's reported event is delivered twice", () => {
    /** @scenario "An evaluation's settling event wakes evaluation trigger matching, the same on redelivery" */
    it("hands evaluation matching the same status and trace both times", async () => {
      const calls = await deliverTwice({
        lane: "evaluationReportedTriggerMatch",
        event: event({
          type: EVALUATION_REPORTED_EVENT_TYPE,
          aggregateId: "eval-1",
          data: { status: "processed", traceId: "trace-1", evaluatorId: "e", evaluatorType: "t" },
        }),
      });

      const expected = {
        reaction: "evaluation",
        input: {
          projectId: "project-1",
          evaluationId: "eval-1",
          status: "processed",
          traceId: "trace-1",
          occurredAt: NOW,
        },
      };
      expect(calls).toEqual([expected, expected]);
    });
  });

  describe.each([
    { lane: "traceSpanGraphActivity", type: SPAN_RECEIVED_EVENT_TYPE, data: {} },
    {
      lane: "traceOriginGraphActivity",
      type: ORIGIN_RESOLVED_EVENT_TYPE,
      data: { origin: "application", reason: "root" },
    },
    {
      lane: "evaluationCompletedGraphActivity",
      type: EVALUATION_COMPLETED_EVENT_TYPE,
      data: { evaluationId: "eval-1", status: "processed" },
    },
  ])("when $type reaches $lane twice", ({ lane, type, data }) => {
    /** @scenario "Project activity wakes the graph-alert sweep, the same on redelivery" */
    it("sweeps the project's graph triggers with the same inputs both times", async () => {
      const calls = await deliverTwice({
        lane,
        event: event({ type, aggregateId: "agg-1", data }),
      });

      const expected = {
        reaction: "graph",
        input: { event: { occurredAt: NOW }, context: { tenantId: "project-1" } },
      };
      expect(calls).toEqual([expected, expected]);
    });
  });
});

function trigger(filters: Record<string, unknown>): TriggerSummary {
  return {
    id: "trigger-1",
    projectId: "project-1",
    name: "Automation",
    action: "SEND_EMAIL",
    triggerKind: "AUTOMATION",
    actionParams: {},
    filters,
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

function summary(overrides: Partial<TraceSummaryData> = {}): TraceSummaryData {
  return {
    traceId: "trace-1",
    spanCount: 1,
    totalDurationMs: 10,
    computedIOSchemaVersion: "1",
    computedInput: "in",
    computedOutput: "out",
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
    outputFromRootSpan: true,
    outputSpanEndTimeMs: NOW,
    blockedByGuardrail: false,
    rootSpanType: null,
    containsAi: true,
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
    attributes: { "langwatch.origin": "application" },
    traceName: "trace",
    occurredAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    LastEventOccurredAt: NOW,
    ...overrides,
  };
}

function run(traceId: string | null): EvaluationRunData {
  return {
    evaluationId: "eval-1",
    evaluatorId: "evaluator-1",
    evaluatorType: "custom/test",
    evaluatorName: null,
    traceId,
    isGuardrail: false,
    status: "processed",
    score: null,
    passed: null,
    label: null,
    details: null,
    inputs: null,
    error: null,
    errorDetails: null,
    createdAt: NOW,
    updatedAt: NOW,
    LastEventOccurredAt: NOW,
    archivedAt: null,
    scheduledAt: NOW,
    startedAt: NOW,
    completedAt: NOW,
    costId: null,
  };
}

function service(input: { found?: TraceSummaryData | null; runTraceId?: string | null } = {}) {
  const sent: Parameters<AutomationTriggerMatchRecorder["send"]>[0][] = [];
  const findRunByEvaluationId = vi.fn<EvaluationApi["findRunByEvaluationId"]>(async () =>
    input.runTraceId === undefined ? null : run(input.runTraceId),
  );
  const reactions = AutomationEvaluationSubscriberService.create({
    triggers: createApiFixture<AutomationTraceTriggerCatalogueRepository>({
      findActiveTraceTriggersForProject: async () => [
        trigger({}),
        { ...trigger({ "evaluations.passed": { "evaluator-1": ["true"] } }), id: "trigger-2" },
      ],
    }),
    graphActivity: createApiFixture<AutomationGraphActivity>(),
    traces: createApiFixture<AutomationEvaluationTraceSummary>({
      findSummary: async () => (input.found === undefined ? summary() : input.found),
    }),
    evaluationFilters: createApiFixture<AutomationEvaluationTriggerFilter>({
      readsEvaluations: ({ filters }) => Object.keys(filters).length > 0,
    }),
    triggerMatches: createApiFixture<AutomationTriggerMatchRecorder>({
      send: async (match) => void sent.push(match),
    }),
    matchRecordMetrics: createApiFixture<AutomationMatchRecordMetricsSink>({
      countRecorded: () => undefined,
    }),
    runs: createApiFixture<EvaluationApi>({ findRunByEvaluationId }),
  });
  return { reactions, sent, findRunByEvaluationId };
}

describe("AutomationEvaluationSubscriberService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  const traceActivity = {
    projectId: "project-1",
    traceId: "trace-1",
    eventType: SPAN_RECEIVED_EVENT_TYPE,
    occurredAt: NOW,
  };

  describe("given a settled trace that passes the origin guard", () => {
    /** @scenario "A trace's span event wakes trace trigger matching, the same on redelivery" */
    it("records one match identity per trace trigger, the same on redelivery", async () => {
      const { reactions, sent } = service();

      await reactions.handleTraceActivity(traceActivity);
      await reactions.handleTraceActivity(traceActivity);

      expect(
        sent.map(({ triggerId, traceId, occurredAt }) => [triggerId, traceId, occurredAt]),
      ).toEqual([
        ["trigger-1", "trace-1", NOW],
        ["trigger-1", "trace-1", NOW],
      ]);
    });
  });

  describe("given a trace the origin guard refuses", () => {
    /** @scenario "Automation applies trace's origin guard to the folded summary" */
    it("records nothing for a trace with no resolved origin", async () => {
      const { reactions, sent } = service({ found: summary({ attributes: {} }) });

      await reactions.handleTraceActivity(traceActivity);

      expect(sent).toEqual([]);
    });

    it("records nothing for a stale event", async () => {
      const { reactions, sent } = service();

      await reactions.handleTraceActivity({
        ...traceActivity,
        occurredAt: NOW - 60 * 60 * 1000 - 1,
      });

      expect(sent).toEqual([]);
    });

    it("records nothing while the trace has no summary", async () => {
      const { reactions, sent } = service({ found: null });

      await reactions.handleTraceActivity(traceActivity);

      expect(sent).toEqual([]);
    });
  });

  describe("given a completed evaluation whose event carries no trace", () => {
    /** @scenario "A completed evaluation's trace is read through EvaluationApi" */
    it("reads the run's trace and matches the triggers that read evaluations", async () => {
      const { reactions, sent, findRunByEvaluationId } = service({ runTraceId: "trace-1" });

      await reactions.handleEvaluationSettled({
        projectId: "project-1",
        evaluationId: "eval-1",
        status: "processed",
        occurredAt: NOW,
      });

      expect(findRunByEvaluationId).toHaveBeenCalledWith({
        tenantId: "project-1",
        evaluationId: "eval-1",
      });
      expect(sent.map(({ triggerId, traceId }) => [triggerId, traceId])).toEqual([
        ["trigger-2", "trace-1"],
      ]);
    });
  });
});
