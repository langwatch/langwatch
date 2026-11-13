/**
 * Trigger matches are dropped at staging, before they reach the serial trigger group.
 * Spec: modules/automation/specs/automation-peer-subscribers.feature
 */
import {
  TriggerAction,
  type TriggerMatchRecordedEventData,
  type TriggerSummary,
} from "@langwatch/automation-contract";
import {
  EVALUATION_COMPLETED_EVENT_TYPE,
  EVALUATION_REPORTED_EVENT_TYPE,
} from "@langwatch/evaluation-contract";
import { createTenantId, type Event, type EventSubscriberDefinition } from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { SPAN_RECEIVED_EVENT_TYPE, type TraceSummaryData } from "@langwatch/trace-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  automationCommandOptions,
  automationPeerSubscribers,
  inertPeerReactions,
} from "../../__tests__/fixtures/pipeline-test-harness.ts";
import type { AutomationMatchRecordMetricsSink } from "../../features/runaway/services/automation-match-record-metrics.service.ts";
import type { AutomationTriggerMatchRecorder } from "../../features/settlement/services/automation-trigger-match-dispatcher.service.ts";
import type { AutomationTraceTriggerCatalogueRepository } from "../../repositories/automation-trace-trigger-catalogue.repository.ts";
import type { AutomationEvaluationTraceSummary } from "../../services/automation-evaluation-subscriber.service.ts";
import type { AutomationEvaluationTriggerFilter } from "../../services/automation-evaluation-trigger-filter.service.ts";
import {
  RECORD_TRIGGER_MATCH_DEDUP_TTL_MS,
  RecordTriggerMatchCommand,
  recordTriggerMatchDedupeId,
} from "../automation.pipeline.ts";
import { handleEvaluationAlertTriggerMatch } from "../evaluation-alert-trigger-match.subscriber.ts";
import { handleTraceAlertTriggerMatch } from "../trace-alert-trigger-match.subscriber.ts";

/** A settle-window boundary for a 30s debounce, so NOW..NOW+29s share one bucket. */
const NOW = 1_800_000_000_000;
const TENANT = "project-1";

type Match = TriggerMatchRecordedEventData & { tenantId: string; occurredAt: number };

function trigger(id: string): TriggerSummary {
  return {
    id,
    projectId: TENANT,
    name: id,
    action: "SEND_EMAIL",
    triggerKind: "AUTOMATION",
    actionParams: {},
    filters: {},
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

const TRIGGERS = [trigger("trigger-a"), trigger("trigger-b")];

function triggerCatalogue() {
  return createApiFixture<
    Pick<AutomationTraceTriggerCatalogueRepository, "findActiveTraceTriggersForProject">
  >({ findActiveTraceTriggersForProject: async () => TRIGGERS });
}

function recorderInto(sent: Match[]): AutomationTriggerMatchRecorder {
  return createApiFixture<AutomationTriggerMatchRecorder>({
    send: async (match) => void sent.push(match),
  });
}

function inertMetrics() {
  return createApiFixture<Pick<AutomationMatchRecordMetricsSink, "countRecorded">>({
    countRecorded: () => undefined,
  });
}

function event(input: {
  type: string;
  aggregateId: string;
  occurredAt: number;
  data: Record<string, unknown>;
}): Event {
  return {
    id: `${input.type}:${input.aggregateId}:${input.occurredAt}`,
    aggregateId: input.aggregateId,
    aggregateType: "owner",
    tenantId: createTenantId(TENANT),
    createdAt: input.occurredAt,
    occurredAt: input.occurredAt,
    type: input.type,
    version: "2026-01-01",
    data: input.data,
  };
}

/**
 * Stages payloads as the group queue does while they are pending: a payload whose dedup id
 * is already pending in its own group is squashed (its data replaced only when the lane
 * replaces); anything else stages as a new job.
 */
function stage<P>(input: {
  payloads: readonly P[];
  makeId: (payload: P) => string;
  groupOf: (payload: P) => string;
  replace: boolean;
}): P[] {
  const pending = new Map<string, P>();
  for (const payload of input.payloads) {
    const key = `${input.groupOf(payload)}|${input.makeId(payload)}`;
    if (!pending.has(key) || input.replace) pending.set(key, payload);
  }
  return [...pending.values()];
}

/** Stages events on a peer lane exactly as the automations pipeline registered it. */
function stageOnLane(lane: string, events: readonly Event[]): Event[] {
  const subscriber: EventSubscriberDefinition | undefined = automationPeerSubscribers(
    inertPeerReactions,
  ).get(`automations.${lane}`);
  const deduplication = subscriber?.options?.deduplication;
  if (!deduplication || deduplication === "aggregate") throw new Error(`${lane} has no dedup`);
  const groupKeyFn = subscriber?.options?.groupKeyFn;
  return stage({
    payloads: events,
    makeId: deduplication.makeId,
    groupOf: (staged) => groupKeyFn?.(staged) ?? staged.aggregateId,
    replace: deduplication.replace !== false,
  });
}

/** Stages trigger matches on the recordTriggerMatch command queue, grouped by trigger. */
function stageMatches(matches: readonly Match[]): Match[] {
  return stage({
    payloads: matches,
    makeId: recordTriggerMatchDedupeId,
    groupOf: (match) => match.triggerId,
    replace: false,
  });
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

/** Runs trace trigger matching for each staged span event; answers the matches it sent. */
async function matchTraces(events: readonly Event[]): Promise<Match[]> {
  const sent: Match[] = [];
  for (const staged of events) {
    await handleTraceAlertTriggerMatch(
      {
        triggers: triggerCatalogue(),
        triggerMatches: recorderInto(sent),
        metrics: inertMetrics(),
      },
      { occurredAt: staged.occurredAt },
      { tenantId: TENANT, aggregateId: staged.aggregateId },
    );
  }
  return sent;
}

/** Runs evaluation trigger matching for each staged evaluation; answers the matches it sent. */
async function matchEvaluations(
  evaluations: readonly { occurredAt: number; status: string; traceId: string }[],
): Promise<Match[]> {
  const sent: Match[] = [];
  const deps = {
    automation: triggerCatalogue(),
    traces: createApiFixture<AutomationEvaluationTraceSummary>({
      findSummary: async () => traceSummary(),
    }),
    triggerMatches: recorderInto(sent),
    evaluationFilters: createApiFixture<AutomationEvaluationTriggerFilter>({
      readsEvaluations: () => true,
    }),
    metrics: inertMetrics(),
  };
  for (const evaluation of evaluations) {
    await handleEvaluationAlertTriggerMatch(
      deps,
      { occurredAt: evaluation.occurredAt },
      { tenantId: TENANT, state: { status: evaluation.status, traceId: evaluation.traceId } },
    );
  }
  return sent;
}

function reported(input: { evaluationId: string; status: string; occurredAt: number }): Event {
  return event({
    type: EVALUATION_REPORTED_EVENT_TYPE,
    aggregateId: input.evaluationId,
    occurredAt: input.occurredAt,
    data: {
      evaluationId: input.evaluationId,
      evaluatorId: "evaluator-1",
      evaluatorType: "langevals",
      status: input.status,
      traceId: "trace-1",
    },
  });
}

function settledFrom(events: readonly Event[]) {
  return events.map((staged) => {
    const data = staged.data as { status: string };
    return { occurredAt: staged.occurredAt, status: data.status, traceId: "trace-1" };
  });
}

describe("trigger match deduplication before staging", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW + 60_000);
  });

  afterEach(() => vi.useRealTimers());

  describe("given the recordTriggerMatch command as the pipeline registers it", () => {
    it("dedupes on the idempotency key's twin, keeping the first job untouched", () => {
      expect(automationCommandOptions("recordTriggerMatch")?.deduplication).toEqual({
        makeId: recordTriggerMatchDedupeId,
        ttlMs: RECORD_TRIGGER_MATCH_DEDUP_TTL_MS,
        extend: false,
        replace: false,
      });
      expect(RECORD_TRIGGER_MATCH_DEDUP_TTL_MS).toBeGreaterThanOrEqual(10 * 60_000);
    });
  });

  describe("given N span events for one trace inside its settle window", () => {
    const spans = Array.from({ length: 20 }, (_, index) =>
      event({
        type: SPAN_RECEIVED_EVENT_TYPE,
        aggregateId: "trace-1",
        occurredAt: NOW + index * 1_000,
        data: {},
      }),
    );

    /** @scenario "A burst of span events for one trace stages one match per trigger" */
    it("stages one recordTriggerMatch per trigger", async () => {
      const woken = stageOnLane("traceSpanTriggerMatch", spans);
      const staged = stageMatches(await matchTraces(woken));

      expect(woken).toHaveLength(1);
      expect(staged.map((match) => match.triggerId).toSorted()).toEqual(["trigger-a", "trigger-b"]);
    });

    /** @scenario "A burst of span events for one trace stages one match per trigger" */
    it("still stages one per trigger when every span wakes matching on its own", async () => {
      const staged = stageMatches(await matchTraces(spans));

      expect(staged.map((match) => match.triggerId).toSorted()).toEqual(["trigger-a", "trigger-b"]);
    });
  });

  describe("given K settled evaluations of one trace", () => {
    /** @scenario "Settled evaluations of one trace stage one match per trigger" */
    it("wakes reported-evaluation matching once and stages one match per trigger", async () => {
      const evaluations = Array.from({ length: 5 }, (_, index) =>
        reported({ evaluationId: `eval-${index}`, status: "processed", occurredAt: NOW + index }),
      );

      const woken = stageOnLane("evaluationReportedTriggerMatch", evaluations);
      const staged = stageMatches(await matchEvaluations(settledFrom(woken)));

      expect(woken).toHaveLength(1);
      expect(staged.map((match) => match.triggerId).toSorted()).toEqual(["trigger-a", "trigger-b"]);
    });

    /** @scenario "Settled evaluations of one trace stage one match per trigger" */
    it("stages one match per trigger for completed evaluations, which name no trace", async () => {
      const completed = Array.from({ length: 5 }, (_, index) =>
        event({
          type: EVALUATION_COMPLETED_EVENT_TYPE,
          aggregateId: `eval-${index}`,
          occurredAt: NOW + index * 1_000,
          data: { evaluationId: `eval-${index}`, status: "processed" },
        }),
      );

      const woken = stageOnLane("evaluationCompletedTriggerMatch", completed);
      const staged = stageMatches(await matchEvaluations(settledFrom(woken)));

      expect(woken).toHaveLength(5);
      expect(staged.map((match) => match.triggerId).toSorted()).toEqual(["trigger-a", "trigger-b"]);
    });
  });

  describe("given a settled evaluation waiting in the lane", () => {
    describe("when a non-terminal event for the same evaluation and trace arrives", () => {
      /** @scenario "A non-terminal evaluation event never hides a settled one" */
      it("keeps the settled job, which still matches every trigger", async () => {
        const woken = stageOnLane("evaluationReportedTriggerMatch", [
          reported({ evaluationId: "eval-1", status: "processed", occurredAt: NOW }),
          reported({ evaluationId: "eval-1", status: "in_progress", occurredAt: NOW + 1 }),
          reported({ evaluationId: "eval-2", status: "scheduled", occurredAt: NOW + 2 }),
        ]);
        const staged = stageMatches(await matchEvaluations(settledFrom(woken)));

        expect(settledFrom(woken).map(({ status }) => status)).toContain("processed");
        expect(staged.map((match) => match.triggerId).toSorted()).toEqual([
          "trigger-a",
          "trigger-b",
        ]);
      });
    });

    describe("when a stale settled event for the same trace is redelivered", () => {
      /** @scenario "A stale evaluation event never hides a fresh settled one" */
      it("stages the stale event on its own, so the fresh job still matches", async () => {
        const fresh = reported({ evaluationId: "eval-1", status: "processed", occurredAt: NOW });
        const stale = reported({
          evaluationId: "eval-0",
          status: "processed",
          occurredAt: NOW - 2 * 60 * 60 * 1000,
        });

        const woken = stageOnLane("evaluationReportedTriggerMatch", [fresh, stale]);
        const staged = stageMatches(await matchEvaluations(settledFrom(woken)));

        expect(woken).toEqual([fresh, stale]);
        expect(staged.map((match) => match.triggerId).toSorted()).toEqual([
          "trigger-a",
          "trigger-b",
        ]);
      });
    });

    describe("when only a non-terminal event is left", () => {
      /** @scenario "A non-terminal evaluation event never hides a settled one" */
      it("matches nothing from it", async () => {
        const sent = await matchEvaluations([
          { occurredAt: NOW, status: "in_progress", traceId: "trace-1" },
        ]);

        expect(sent).toEqual([]);
      });
    });
  });

  describe("given two trigger matches for one trigger", () => {
    function match(input: { traceId: string; occurredAt: number; traceDebounceMs: number }) {
      return {
        tenantId: createTenantId(TENANT),
        triggerId: "trigger-a",
        traceId: input.traceId,
        occurredAt: input.occurredAt,
        traceDebounceMs: input.traceDebounceMs,
        action: TriggerAction.SEND_EMAIL,
        actionClass: "notify" as const,
        notificationCadence: "immediate" as const,
      };
    }

    function idempotencyKeyOf(payload: ReturnType<typeof match>): string | undefined {
      const result = new RecordTriggerMatchCommand().handle({
        type: "recordTriggerMatch",
        tenantId: payload.tenantId,
        aggregateId: payload.triggerId,
        data: payload,
      });
      if (result instanceof Promise)
        throw new Error("RecordTriggerMatchCommand must be synchronous");
      return result[0]?.idempotencyKey;
    }

    /** @scenario "The trigger match queue drops only what the match identity drops" */
    it("shares a queue dedup id exactly when it shares an idempotency key", () => {
      const candidates = ["trace-1", "trace-2"].flatMap((traceId) =>
        [0, 1_000, 30_000, 600_000].flatMap((traceDebounceMs) =>
          [0, 1, 29_999, 30_000, 59_999, 60_000, 600_001].map((offset) =>
            match({ traceId, traceDebounceMs, occurredAt: NOW + offset }),
          ),
        ),
      );

      for (const first of candidates) {
        for (const second of candidates) {
          const sameKey = idempotencyKeyOf(first) === idempotencyKeyOf(second);
          const sameId = recordTriggerMatchDedupeId(first) === recordTriggerMatchDedupeId(second);
          expect(sameId).toBe(sameKey);
        }
      }
    });
  });
});
