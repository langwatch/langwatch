/**
 * The facet suites' rows: a member, the aggregate it shares into and another tenant holding the
 * same trace ids, over summaries (one trace re-projected), evaluation runs and spans.
 */
import type { Authorization } from "@langwatch/authorization";

import {
  aggregateProof,
  ownProof,
} from "../../../../__tests__/support/authorization-proofs.fixture.ts";

const MINUTE = 60_000;

export interface FacetSeed {
  aggregate: string;
  member: string;
  other: string;
  window: { from: number; to: number };
  /** The member's share into the aggregate starts here; its pre-share rows are older. */
  shareFrom: number;
}

export function facetSeedOf({ run, now }: { run: string; now: number }): FacetSeed {
  const base = now - 60 * MINUTE;
  return {
    aggregate: `proj_facet_agg_${run}`,
    member: `proj_facet_member_${run}`,
    other: `proj_facet_other_${run}`,
    window: { from: base - 120 * MINUTE, to: base + 30 * MINUTE },
    shareFrom: base - 30 * MINUTE,
  };
}

/** The three scopes every facet answer is held under. */
export function facetScopesOf(seed: FacetSeed): [string, () => Authorization][] {
  return [
    ["the member's own proof", () => ownProof({ projectId: seed.member })],
    [
      "an aggregate's tenant set",
      () =>
        aggregateProof({
          projectId: seed.aggregate,
          members: [{ projectId: seed.member, from: 0 }],
        }),
    ],
    [
      "a windowed share",
      () =>
        aggregateProof({
          projectId: seed.aggregate,
          members: [{ projectId: seed.member, from: seed.shareFrom }],
        }),
    ],
  ];
}

const at = (ms: number) => new Date(ms).toISOString().replace("T", " ").replace("Z", "");

interface TraceSpec {
  tenant: string;
  traceId: string;
  service: string;
  models: string[];
  cost: number;
  spans: number;
  error: boolean;
  occurredAtMs: number;
  updatedAtMs?: number;
  labels: string[];
  metadata?: Record<string, string>;
}

/** One span event: its name and attributes (`event.metrics.*` keys feed the event facet). */
type SpanEvent = [name: string, attributes: Record<string, string>];

const summary = (trace: TraceSpec) => ({
  TenantId: trace.tenant,
  TraceId: trace.traceId,
  OccurredAt: at(trace.occurredAtMs),
  CreatedAt: at(trace.occurredAtMs),
  UpdatedAt: at(trace.updatedAtMs ?? trace.occurredAtMs),
  _retention_days: 0,
  ComputedInput: "",
  ComputedOutput: "",
  Models: trace.models,
  TotalCost: trace.cost,
  SpanCount: trace.spans,
  ContainsErrorStatus: trace.error,
  Attributes: {
    "service.name": trace.service,
    "langwatch.labels": JSON.stringify(trace.labels),
    ...trace.metadata,
  },
});

const span = (trace: TraceSpec, type: string, kind: string, events: SpanEvent[] = []) => ({
  TenantId: trace.tenant,
  TraceId: trace.traceId,
  SpanId: `s_${trace.traceId}_${type}`,
  StartTime: at(trace.occurredAtMs),
  EndTime: at(trace.occurredAtMs + 1_000),
  UpdatedAt: at(trace.occurredAtMs),
  SpanAttributes: { "langwatch.span.type": type, kind },
  "Events.Timestamp": events.map(() => at(trace.occurredAtMs)),
  "Events.Name": events.map(([name]) => name),
  "Events.Attributes": events.map(([, attributes]) => attributes),
});

const evaluation = (
  trace: TraceSpec,
  run: { status: string; passed: number | null; score: number | null; label: string | null },
) => ({
  ProjectionId: `p_${trace.tenant}_${trace.traceId}`,
  TenantId: trace.tenant,
  EvaluationId: `e_${trace.traceId}_${trace.service}`,
  Version: "1",
  EvaluatorId: "evaluator-1",
  EvaluatorType: "custom",
  EvaluatorName: "Judge",
  TraceId: trace.traceId,
  IsGuardrail: 0,
  Status: run.status,
  Score: run.score,
  Passed: run.passed,
  Label: run.label,
  CreatedAt: at(trace.occurredAtMs),
  UpdatedAt: at(trace.occurredAtMs),
  ScheduledAt: at(trace.occurredAtMs),
  Attempts: 1,
});

/**
 * Inserts the rows. The member's t1 has an older version (`api-stale`) the election drops; its t0
 * predates the share; the other tenant reuses t1 and t2 with values no proof here may count.
 */
export async function seedFacetRows({
  seed,
  now,
  insert,
}: {
  seed: FacetSeed;
  now: number;
  insert: (table: string, values: Record<string, unknown>[]) => Promise<unknown>;
}): Promise<void> {
  const base = now - 60 * MINUTE;
  const preShare = base - 60 * MINUTE;
  const traces = {
    t1: {
      labels: ["prod", "beta"],
      metadata: { "metadata.team": "red" },
      tenant: seed.member,
      traceId: "t1",
      service: "api-a",
      models: ["gpt-4"],
      cost: 1,
      spans: 2,
      error: false,
      occurredAtMs: base,
      updatedAtMs: base + 1_000,
    },
    t1Stale: {
      labels: ["stale"],
      tenant: seed.member,
      traceId: "t1",
      service: "api-stale",
      models: ["gpt-stale"],
      cost: 100,
      spans: 40,
      error: false,
      occurredAtMs: base,
    },
    t2: {
      labels: ["prod"],
      tenant: seed.member,
      traceId: "t2",
      service: "api-b",
      models: ["gpt-4", "claude"],
      cost: 3,
      spans: 5,
      error: true,
      occurredAtMs: base,
    },
    t0: {
      labels: ["old"],
      tenant: seed.member,
      traceId: "t0",
      service: "api-old",
      models: ["gpt-old"],
      cost: 7,
      spans: 9,
      error: false,
      occurredAtMs: preShare,
    },
    t3: {
      labels: ["agg"],
      metadata: { "metadata.team": "blue" },
      tenant: seed.aggregate,
      traceId: "t3",
      service: "api-agg",
      models: ["claude"],
      cost: 2,
      spans: 2,
      error: false,
      occurredAtMs: base,
    },
    o1: {
      labels: ["other"],
      metadata: { "metadata.secret": "x" },
      tenant: seed.other,
      traceId: "t1",
      service: "api-other",
      models: ["gpt-other"],
      cost: 50,
      spans: 7,
      error: false,
      occurredAtMs: base,
    },
    o2: {
      labels: ["prod", "private"],
      tenant: seed.other,
      traceId: "t2",
      service: "api-b",
      models: ["gpt-private"],
      cost: 60,
      spans: 5,
      error: true,
      occurredAtMs: base,
    },
  } satisfies Record<string, TraceSpec>;
  await insert("trace_summaries", Object.values(traces).map(summary));
  await insert("stored_spans", [
    span(traces.t1, "llm", "keep", [["feedback", { "event.metrics.vote": "1", note: "x" }]]),
    span(traces.t2, "tool", "drop", [["feedback", { "event.metrics.vote": "0" }]]),
    span(traces.t0, "chain", "keep", [["retry", { attempt: "2" }]]),
    span(traces.t3, "agent", "keep", [["feedback", { "event.metrics.vote": "1" }]]),
    span(traces.o1, "rag", "keep", [["leak", { "event.metrics.leak": "9" }]]),
    span(traces.o2, "tool", "keep"),
  ]);
  await insert("evaluation_runs", [
    evaluation(traces.t1, { status: "processed", passed: 1, score: 0.9, label: "good" }),
    evaluation(traces.t2, { status: "error", passed: null, score: null, label: null }),
    evaluation(traces.t0, { status: "processed", passed: 0, score: 0.1, label: "bad" }),
    evaluation(traces.t3, { status: "processed", passed: 0, score: 0.5, label: "meh" }),
    evaluation(traces.o1, { status: "processed", passed: 1, score: 0.99, label: "other" }),
  ]);
}
