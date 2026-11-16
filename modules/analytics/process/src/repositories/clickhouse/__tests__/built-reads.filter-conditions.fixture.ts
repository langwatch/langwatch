/**
 * Seed rows and cases for the filter-condition row-equality cases: tenant A's even traces and
 * B's odd ones carry the matching values, ids shared; the expected pairs are in
 * built-reads.expected.fixture.json.
 */
import { randomUUID } from "node:crypto";

import { analyticsProof } from "../../__tests__/analytics-proof.fixture.ts";
import type { AnalyticsFilterInput } from "../clickhouse.filter-conditions.mapper.ts";

export const RUN = randomUUID();
export const TENANT_A = `test-filter-proof-a-${RUN}`;
export const TENANT_B = `test-filter-proof-b-${RUN}`;
export const AGGREGATE = `test-filter-proof-agg-${RUN}`;
export const SEEDED_TABLES = ["trace_summaries", "stored_spans", "evaluation_runs"] as const;
export const START = new Date("2026-06-15T06:00:00Z");
export const END = new Date("2026-06-15T14:00:00Z");
export const TRACE_COUNT = 4;

/** Tenant A's even traces and tenant B's odd ones carry the matching values; ids are shared. */
export const matches = (tenantId: string, index: number) =>
  tenantId === TENANT_A ? index % 2 === 0 : index % 2 === 1;
export const traceIdOf = (index: number) => `trace-${RUN}-${index}`;
export const timeOf = (index: number) => new Date(Date.UTC(2026, 5, 15, 8 + index));

export function seedRows(tenantId: string, index: number) {
  const on = matches(tenantId, index);
  const at = timeOf(index);
  const attributes: Record<string, string> = {
    "langwatch.user_id": on ? "user-on" : "user-off",
    "gen_ai.conversation.id": on ? "thread-on" : "thread-off",
    "langwatch.customer_id": on ? "customer-on" : "customer-off",
    "langwatch.labels": on ? '["label-on","x"]' : '["y"]',
    "langwatch.prompt_ids": on ? '["prompt-on"]' : '["prompt-off"]',
    "langwatch.metadata.plan": on ? "pro" : "free",
    ...(on ? { "metadata.tier": "gold" } : { "metadata.tier": "" }),
    ...(on ? {} : { "langwatch.origin": "evaluation" }),
  };
  return {
    summary: {
      ProjectionId: `proj-${randomUUID()}`,
      TenantId: tenantId,
      TraceId: traceIdOf(index),
      Version: "v1",
      Attributes: attributes,
      OccurredAt: at,
      CreatedAt: at,
      UpdatedAt: at,
      ComputedIOSchemaVersion: "",
      TotalDurationMs: 200,
      SpanCount: 1,
      ContainsErrorStatus: on ? 1 : 0,
      ContainsOKStatus: 1,
      Models: [],
      TokensEstimated: false,
      OutputFromRootSpan: 0,
      OutputSpanEndTimeMs: 0,
      BlockedByGuardrail: 0,
      TopicId: on ? "topic-on" : "topic-off",
      SubTopicId: on ? "sub-on" : null,
      HasAnnotation: on ? 1 : 0,
      TraceName: on ? "name-on" : "name-off",
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
        "langwatch.span.type": on ? "llm" : "tool",
        "gen_ai.request.model": on ? "gpt-on" : "gpt-off",
      },
      ScopeName: "",
      "Events.Timestamp": [at],
      "Events.Name": [on ? "thumbs_up_down" : "other"],
      "Events.Attributes": [{ vote: "1" }],
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
      EvaluatorId: on ? "ev-on" : "ev-off",
      EvaluatorName: "check",
      EvaluatorType: "langevals/exact_match",
      TraceId: traceIdOf(index),
      Status: on ? "processed" : "error",
      Score: on ? 0.9 : null,
      Passed: on ? 1 : null,
      Label: on ? "good" : "succeeded",
      LastProcessedEventId: `evt-${randomUUID()}`,
      ScheduledAt: at.toISOString(),
      UpdatedAt: at.toISOString(),
    },
  };
}

/** One case per handler branch; each picks a strict, non-empty subset of the seeded traces. */
export const CASES: [string, AnalyticsFilterInput][] = [
  ["topics.topics", { "topics.topics": ["topic-on"] }],
  ["topics.subtopics", { "topics.subtopics": ["sub-on"] }],
  ["metadata.user_id", { "metadata.user_id": ["user-on"] }],
  ["metadata.thread_id", { "metadata.thread_id": ["thread-on"] }],
  ["metadata.customer_id", { "metadata.customer_id": ["customer-on"] }],
  ["metadata.labels", { "metadata.labels": ["label-on"] }],
  ["metadata.key", { "metadata.key": ["tier"] }],
  ["metadata.value", { "metadata.value": { plan: ["pro"] } }],
  ["metadata.prompt_ids", { "metadata.prompt_ids": ["prompt-on"] }],
  ["traces.origin application", { "traces.origin": ["application"] }],
  ["traces.origin evaluation", { "traces.origin": ["evaluation"] }],
  ["traces.error true", { "traces.error": ["true"] }],
  ["traces.error false", { "traces.error": ["false"] }],
  ["traces.name", { "traces.name": ["name-on"] }],
  ["spans.type", { "spans.type": ["llm"] }],
  ["spans.model", { "spans.model": ["gpt-on"] }],
  ["evaluations.evaluator_id", { "evaluations.evaluator_id": ["ev-on"] }],
  ["guardrails_only", { "evaluations.evaluator_id.guardrails_only": ["ev-on"] }],
  ["has_passed", { "evaluations.evaluator_id.has_passed": ["ev-on", "ev-off"] }],
  ["has_score", { "evaluations.evaluator_id.has_score": ["ev-on", "ev-off"] }],
  ["has_label", { "evaluations.evaluator_id.has_label": ["ev-on", "ev-off"] }],
  ["evaluations.passed keyed", { "evaluations.passed": { "ev-on": ["true"] } }],
  ["evaluations.passed", { "evaluations.passed": ["true"] }],
  ["evaluations.score", { "evaluations.score": { "ev-on": ["0.5", "1"] } }],
  ["evaluations.label", { "evaluations.label": { "ev-on": ["good"] } }],
  ["evaluations.state", { "evaluations.state": ["processed"] }],
  ["events.event_type", { "events.event_type": ["thumbs_up_down"] }],
  ["events.metrics.key keyed", { "events.metrics.key": { thumbs_up_down: ["vote"] } }],
  ["events.metrics.value", { "events.metrics.value": { thumbs_up_down: { vote: ["0.5", "2"] } } }],
  ["events.event_details.key", { "events.event_details.key": { thumbs_up_down: ["vote"] } }],
  ["annotations true", { "annotations.hasAnnotation": ["true"] }],
  ["annotations false", { "annotations.hasAnnotation": ["false"] }],
  [
    "three filters together",
    {
      "topics.topics": ["topic-on", "topic-off"],
      "spans.type": ["llm"],
      "evaluations.state": ["processed"],
    },
  ],
];

export const ownProof = () => analyticsProof({ projectId: TENANT_A });
export const bothProof = () =>
  analyticsProof({
    projectId: AGGREGATE,
    shared: [
      { projectId: TENANT_A, from: 0 },
      { projectId: TENANT_B, from: 0 },
    ],
  });
