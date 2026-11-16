/**
 * Seed rows and asks for the filter-picker row-equality cases: two tenants sharing trace ids,
 * tenant A's values starting `a-` and B's `b-`; the expected options are in
 * built-reads.expected.fixture.json.
 */
import { randomUUID } from "node:crypto";

import type { FilterField } from "@langwatch/analytics-contract";

import { analyticsProof } from "../../__tests__/analytics-proof.fixture.ts";
import type { AnalyticsFilterInput } from "../clickhouse.filter-conditions.mapper.ts";

export const RUN = randomUUID();
export const TENANT_A = `test-picker-proof-a-${RUN}`;
export const TENANT_B = `test-picker-proof-b-${RUN}`;
export const AGGREGATE = `test-picker-proof-agg-${RUN}`;
export const SEEDED_TABLES = ["trace_summaries", "stored_spans", "evaluation_runs"] as const;
export const START = Date.UTC(2026, 5, 15, 6);
export const END = Date.UTC(2026, 5, 15, 14);
export const EVENT = "thumbs_up_down";
/** Trace 4 occurs after the window, so every picker shows the window holds. */
export const TRACE_COUNT = 5;

const traceIdOf = (index: number) => `trace-${RUN}-${index}`;
const timeOf = (index: number) => new Date(Date.UTC(2026, 5, 15, index === 4 ? 15 : 8 + index));
/** One trace, span and evaluation; tenant A's values start `a-`, B's `b-`, ids are shared. */
export function seedRows(tenantId: string, index: number) {
  const tag = tenantId === TENANT_A ? "a" : "b";
  const odd = index % 2 === 1;
  const scoreOffset = tag === "a" ? 0 : 100;
  const at = timeOf(index);
  const origin: Record<string, string> =
    [{}, { "langwatch.origin": "evaluation" }, { "langwatch.origin": "" }, {}, {}][index] ?? {};
  return {
    summary: {
      ProjectionId: `proj-${randomUUID()}`,
      TenantId: tenantId,
      TraceId: traceIdOf(index),
      Version: "v1",
      Attributes: {
        "langwatch.user_id": `${tag}-user-${index % 2}`,
        "gen_ai.conversation.id": `${tag}-thread-${index}`,
        "langwatch.customer_id": index === 0 ? "" : `${tag}-customer`,
        "langwatch.labels": JSON.stringify([`${tag}-label-${index % 2}`, "", null, "null"]),
        "langwatch.prompt_ids":
          index === 3 ? "[]" : JSON.stringify([`${tag}-prompt-${index}`, "", "null"]),
        plan: `${tag}-plan-${index % 2}`,
        [`${tag}.custom.key`]: "v",
        "langwatch.internal": "x",
        ...origin,
      },
      OccurredAt: at,
      CreatedAt: at,
      UpdatedAt: at,
      ComputedIOSchemaVersion: "",
      TotalDurationMs: 200,
      SpanCount: 1,
      ContainsErrorStatus: odd ? 1 : 0,
      ContainsOKStatus: 1,
      Models: [`${tag}-model-${index % 2}`, ""],
      TokensEstimated: false,
      OutputFromRootSpan: 0,
      OutputSpanEndTimeMs: 0,
      BlockedByGuardrail: 0,
      TopicId: index === 2 ? null : `${tag}-topic-${index % 2}`,
      SubTopicId: index === 1 ? "" : `${tag}-sub`,
      HasAnnotation: [null, 1, 0, 1, 0][index],
      TraceName: `${tag}-name-${index % 2}`,
    },
    span: {
      ProjectionId: `proj-span-${randomUUID()}`,
      TenantId: tenantId,
      TraceId: traceIdOf(index),
      SpanId: `span-${RUN}-${index}`,
      Sampled: 1,
      StartTime: at,
      EndTime: at,
      DurationMs: 1,
      SpanName: "span",
      SpanKind: 1,
      ServiceName: "test-service",
      ResourceAttributes: {},
      SpanAttributes: {
        "langwatch.span.type": `${tag}-type-${index % 2}`,
        "event.type": index < 3 ? EVENT : `${tag}-event`,
        "event.metrics.vote": tag === "a" ? String(index) : String(10 * index + 0.5),
        [`event.metrics.${tag}_only`]: "1",
        "event.details.comment": `${tag}-comment`,
        [`event.details.${tag}_detail`]: "d",
      },
      ScopeName: "",
      "Events.Timestamp": [],
      "Events.Name": [],
      "Events.Attributes": [],
      "Links.TraceId": [],
      "Links.SpanId": [],
      "Links.Attributes": [],
      DroppedAttributesCount: 0,
      DroppedEventsCount: 0,
      DroppedLinksCount: 0,
    },
    run: {
      ProjectionId: `proj-${randomUUID()}`,
      TenantId: tenantId,
      EvaluationId: `eval-${randomUUID()}`,
      Version: "1",
      EvaluatorId: `ev-${index % 2}`,
      EvaluatorName: [null, `${tag}-evaluator`, "", `${tag}-evaluator`, `${tag}-evaluator`][index],
      EvaluatorType: "langevals/exact_match",
      IsGuardrail: odd ? 1 : 0,
      TraceId: traceIdOf(index),
      Status: ["processed", "error", "skipped", "scheduled", "processed"][index],
      Score: index === 1 ? null : index + scoreOffset,
      Passed: [null, 1, 0, 1, 0][index],
      Label: [`${tag}-first`, "succeeded", "", `${tag}-other`, null][index],
      LastProcessedEventId: `evt-${randomUUID()}`,
      ScheduledAt: at.toISOString(),
      UpdatedAt: at.toISOString(),
    },
  };
}

/** Each picker's key and subkey; a keyed evaluation picker is asked for both evaluators. */
export const KEYS: Partial<Record<FilterField, { key: string; subkey?: string }[]>> = {
  "metadata.value": [{ key: "plan" }],
  "evaluations.passed": [{ key: "ev-0" }, { key: "ev-1" }],
  "evaluations.score": [{ key: "ev-0" }, { key: "ev-1" }],
  "evaluations.state": [{ key: "ev-0" }, { key: "ev-1" }],
  "evaluations.label": [{ key: "ev-0" }, { key: "ev-1" }],
  "events.metrics.key": [{ key: EVENT }],
  "events.event_details.key": [{ key: EVENT }],
  "events.metrics.value": [{ key: EVENT, subkey: "vote" }],
};

/** Every picker the built repository answers. */
export const FIELDS: FilterField[] = [
  "annotations.hasAnnotation",
  "evaluations.evaluator_id",
  "evaluations.evaluator_id.guardrails_only",
  "evaluations.evaluator_id.has_label",
  "evaluations.evaluator_id.has_passed",
  "evaluations.evaluator_id.has_score",
  "evaluations.label",
  "evaluations.passed",
  "evaluations.score",
  "evaluations.state",
  "events.event_details.key",
  "events.event_type",
  "events.metrics.key",
  "events.metrics.value",
  "metadata.customer_id",
  "metadata.key",
  "metadata.labels",
  "metadata.prompt_ids",
  "metadata.thread_id",
  "metadata.user_id",
  "metadata.value",
  "spans.model",
  "spans.type",
  "topics.subtopics",
  "topics.topics",
  "traces.error",
  "traces.name",
  "traces.origin",
];

export type Ask = { query?: string; key?: string; subkey?: string; filters?: AnalyticsFilterInput };

export const asksFor = (field: FilterField): Ask[] => KEYS[field] ?? [{}];

export const ownProof = () => analyticsProof({ projectId: TENANT_A });
export const bothProof = () =>
  analyticsProof({
    projectId: AGGREGATE,
    shared: [
      { projectId: TENANT_A, from: 0 },
      { projectId: TENANT_B, from: 0 },
    ],
  });
