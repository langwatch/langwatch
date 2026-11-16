import type { GetAllTracesForProjectInput, TraceDateField } from "@langwatch/trace-contract";

const MINUTE = 60_000;

/** The two tenants: the read's, and another reusing its trace ids with values that would match. */
export function legacyFilterTenantsOf({ run }: { run: string }) {
  return { own: `lf-own-${run}`, other: `lf-other-${run}` };
}

const at = (ms: number) => new Date(ms).toISOString().replace("T", " ").replace("Z", "");

interface TraceSpec {
  tenant: string;
  traceId: string;
  /** Minutes before `base` the trace occurred, and after `base` its summary was last updated. */
  occurredAgo: number;
  updatedAfter: number;
  name: string;
  input: string;
  error: boolean;
  models: string[];
  topic?: string;
  annotated?: boolean;
  attributes: Record<string, string>;
  spans: Record<string, string>[];
  runs: {
    evaluator: string;
    guardrail?: boolean;
    passed: number | null;
    score: number | null;
    label: string | null;
    status: string;
  }[];
}

function rowsOf({ trace, base }: { trace: TraceSpec; base: number }) {
  const occurredAt = base - trace.occurredAgo * MINUTE;
  const updatedAt = base + trace.updatedAfter * MINUTE;
  const summary = {
    TenantId: trace.tenant,
    TraceId: trace.traceId,
    Version: "v1",
    OccurredAt: at(occurredAt),
    CreatedAt: at(occurredAt),
    UpdatedAt: at(updatedAt),
    LastEventOccurredAt: at(occurredAt),
    _retention_days: 0,
    ComputedIOSchemaVersion: "v1",
    ComputedInput: trace.input,
    ComputedOutput: "done",
    TotalDurationMs: 100,
    SpanCount: trace.spans.length,
    ContainsErrorStatus: trace.error,
    ContainsOKStatus: !trace.error,
    Models: trace.models,
    TraceName: trace.name,
    TopicId: trace.topic ?? null,
    HasAnnotation: trace.annotated ?? null,
    Attributes: trace.attributes,
  };
  const spans = trace.spans.map((attributes, index) => ({
    TenantId: trace.tenant,
    TraceId: trace.traceId,
    SpanId: `s_${trace.traceId}_${index}`,
    StartTime: at(occurredAt),
    EndTime: at(occurredAt + 1_000),
    UpdatedAt: at(occurredAt),
    SpanAttributes: attributes,
  }));
  const runs = trace.runs.map((run) => ({
    ProjectionId: `p_${trace.tenant}_${trace.traceId}_${run.evaluator}`,
    TenantId: trace.tenant,
    EvaluationId: `e_${trace.traceId}_${run.evaluator}`,
    Version: "1",
    EvaluatorId: run.evaluator,
    EvaluatorType: "custom",
    EvaluatorName: run.evaluator,
    TraceId: trace.traceId,
    IsGuardrail: run.guardrail ? 1 : 0,
    Status: run.status,
    Score: run.score,
    Passed: run.passed,
    Label: run.label,
    CreatedAt: at(occurredAt),
    UpdatedAt: at(occurredAt),
    ScheduledAt: at(occurredAt),
    Attempts: 1,
  }));
  return { summary, spans, runs };
}

const labels = (values: string[]) => JSON.stringify(values);

/**
 * The own tenant's t1 to t4, and the other tenant's t1 to t4 and t9 whose values would match the
 * filters the own traces miss, so a leak shows as an extra id. The updated axis orders as the
 * occurred one.
 */
function tracesOf({ own, other }: { own: string; other: string }): TraceSpec[] {
  return [
    {
      tenant: own,
      traceId: "t1",
      occurredAgo: 10,
      updatedAfter: 4,
      name: "checkout",
      input: "where is my parcel",
      error: false,
      models: ["gpt-4"],
      topic: "topic-a",
      attributes: {
        "langwatch.user_id": "u1",
        "langwatch.customer_id": "c1",
        "gen_ai.conversation.id": "th1",
        "langwatch.labels": labels(["prod", "beta"]),
        "metadata.team": "red",
      },
      spans: [
        { "langwatch.span.type": "llm" },
        { "langwatch.span.type": "event", "event.type": "thumbs", "event.metrics.vote": "1" },
      ],
      runs: [{ evaluator: "ev-1", passed: 1, score: 0.9, label: "good", status: "processed" }],
    },
    {
      tenant: own,
      traceId: "t2",
      occurredAgo: 20,
      updatedAfter: 3,
      name: "refund",
      input: "refund please",
      error: true,
      models: ["claude"],
      attributes: {
        "langwatch.user_id": "u2",
        "langwatch.labels": labels(["beta"]),
        "langwatch.origin": "evaluation",
      },
      spans: [{ "langwatch.span.type": "tool" }],
      runs: [
        { evaluator: "ev-1", passed: 0, score: 0.2, label: "bad", status: "processed" },
        {
          evaluator: "ev-2",
          guardrail: true,
          passed: 1,
          score: null,
          label: null,
          status: "processed",
        },
      ],
    },
    {
      tenant: own,
      traceId: "t3",
      occurredAgo: 30,
      updatedAfter: 2,
      name: "checkout",
      input: "hello",
      error: false,
      models: [],
      attributes: {
        "langwatch.user_id": "u1",
        "langwatch.labels": labels([]),
        "langwatch.origin": "simulation",
        "langwatch.metadata.team": "blue",
      },
      spans: [
        { "langwatch.span.type": "agent" },
        {
          "langwatch.span.type": "event",
          "event.type": "feedback",
          "event.details.comment": "nice",
        },
      ],
      runs: [{ evaluator: "ev-1", passed: null, score: null, label: null, status: "skipped" }],
    },
    {
      tenant: own,
      traceId: "t4",
      occurredAgo: 40,
      updatedAfter: 1,
      name: "search",
      input: "refund status",
      error: true,
      models: ["gpt-4", "claude"],
      annotated: true,
      attributes: {
        "langwatch.user_id": "u3",
        "langwatch.labels": labels(["prod"]),
        "langwatch.prompt_ids": labels(["p1"]),
        "langwatch.origin": "application",
      },
      spans: [{ "langwatch.span.type": "llm" }],
      runs: [],
    },
    ...[1, 2, 3, 4, 9].map((n): TraceSpec => ({
      tenant: other,
      traceId: `t${n}`,
      occurredAgo: 10 * n - 5,
      updatedAfter: 5 - Math.min(n, 4),
      name: "refund",
      input: "refund where hello",
      error: n % 2 === 1,
      models: ["claude", "gpt-4"],
      topic: "topic-a",
      annotated: n % 2 === 0,
      attributes: {
        "langwatch.user_id": "u1",
        "langwatch.customer_id": "c1",
        "gen_ai.conversation.id": "th1",
        "langwatch.labels": labels(["beta", "prod"]),
        "langwatch.prompt_ids": labels(["p1"]),
        "metadata.team": "red",
        ...(n === 4 ? { "langwatch.origin": "evaluation" } : {}),
      },
      spans: [
        { "langwatch.span.type": "tool" },
        { "langwatch.span.type": "event", "event.type": "thumbs", "event.metrics.vote": "3" },
        { "langwatch.span.type": "event", "event.type": "feedback", "event.details.comment": "x" },
      ],
      runs: [
        { evaluator: "ev-1", passed: 0, score: 0.7, label: "good", status: "processed" },
        {
          evaluator: "ev-2",
          guardrail: true,
          passed: 1,
          score: 1,
          label: "ok",
          status: "processed",
        },
      ],
    })),
  ];
}

/** Inserts both tenants' summaries, spans and evaluation runs. */
export async function seedLegacyFilterRows({
  tenants,
  base,
  insert,
}: {
  tenants: { own: string; other: string };
  base: number;
  insert: (table: string, values: Record<string, unknown>[]) => Promise<unknown>;
}): Promise<void> {
  const rows = tracesOf(tenants).map((trace) => rowsOf({ trace, base }));
  await insert(
    "trace_summaries",
    rows.map((row) => row.summary),
  );
  await insert(
    "stored_spans",
    rows.flatMap((row) => row.spans),
  );
  await insert(
    "evaluation_runs",
    rows.flatMap((row) => row.runs),
  );
}

type LegacyFilters = GetAllTracesForProjectInput["filters"];

/** One legacy filter family per case, plus combinations, search and the explicit id list. */
export const LEGACY_FILTER_CASES: Record<
  string,
  { filters: LegacyFilters; query?: string; traceIds?: string[] }
> = {
  none: { filters: {} },
  "metadata.user_id": { filters: { "metadata.user_id": ["u1"] } },
  "metadata.customer_id": { filters: { "metadata.customer_id": ["c1"] } },
  "metadata.thread_id": { filters: { "metadata.thread_id": ["th1"] } },
  "metadata.labels": { filters: { "metadata.labels": ["beta"] } },
  "metadata.key": { filters: { "metadata.key": ["team"] } },
  "metadata.value": { filters: { "metadata.value": { team: ["blue"] } } },
  "metadata.prompt_ids": { filters: { "metadata.prompt_ids": ["p1"] } },
  "traces.origin application": { filters: { "traces.origin": ["application"] } },
  "traces.origin named": { filters: { "traces.origin": ["evaluation", "simulation"] } },
  "traces.error": { filters: { "traces.error": ["true"] } },
  "traces.name": { filters: { "traces.name": ["refund"] } },
  "topics.topics": { filters: { "topics.topics": ["topic-a"] } },
  "spans.model": { filters: { "spans.model": ["claude"] } },
  "annotations.hasAnnotation false": { filters: { "annotations.hasAnnotation": ["false"] } },
  "spans.type": { filters: { "spans.type": ["tool"] } },
  "evaluations.evaluator_id": { filters: { "evaluations.evaluator_id": ["ev-1"] } },
  "evaluations.evaluator_id.guardrails_only": {
    filters: { "evaluations.evaluator_id.guardrails_only": ["ev-2"] },
  },
  "evaluations.evaluator_id.has_score": {
    filters: { "evaluations.evaluator_id.has_score": ["ev-1"] },
  },
  "evaluations.passed": { filters: { "evaluations.passed": { "ev-1": ["false"] } } },
  "evaluations.score": { filters: { "evaluations.score": { "ev-1": ["0.5", "1"] } } },
  "evaluations.label": { filters: { "evaluations.label": { "ev-1": ["good"] } } },
  "evaluations.state": { filters: { "evaluations.state": { "ev-1": ["skipped"] } } },
  "events.event_type": { filters: { "events.event_type": ["thumbs"] } },
  "events.metrics.key": { filters: { "events.metrics.key": { thumbs: ["vote"] } } },
  "events.metrics.value": { filters: { "events.metrics.value": { thumbs: { vote: ["0", "2"] } } } },
  "events.event_details.key": {
    filters: { "events.event_details.key": { feedback: ["comment"] } },
  },
  "user and error": { filters: { "metadata.user_id": ["u1"], "traces.error": ["false"] } },
  search: { filters: {}, query: "refund" },
  "trace ids": { filters: { "metadata.user_id": ["u1", "u2"] }, traceIds: ["t1", "t2", "t9"] },
};

/** LangWatchQL fields on the summary read (listTraceSummaries). */
export const SUMMARY_FILTERS = ["user:u1", "origin:evaluation OR traceName:search"] as const;

export const DATE_FIELDS: TraceDateField[] = ["occurred", "updated"];

/** The read window around the seed: every own trace on either axis. */
export function legacyWindowOf({ base }: { base: number }) {
  return { startDate: base - 120 * MINUTE, endDate: base + 30 * MINUTE };
}

/** The two legacy reads either store answers, as the capture and the suite both drive them. */
export interface LegacyFilterReads {
  list(input: {
    input: GetAllTracesForProjectInput;
    dateField: TraceDateField;
    scrollId: string | undefined;
  }): Promise<{ ids: string[]; totalHits: number; scrollId?: string | undefined }>;
  summaries(input: {
    filter: string;
    dateField: TraceDateField;
    scrollId: string | undefined;
    window: { startDate: number; endDate: number };
  }): Promise<{ ids: string[]; scrollId?: string | null | undefined }>;
}

const PAGE_SIZE = 2;
const MAX_PAGES = 6;

async function pagesOf(
  read: (
    scrollId: string | undefined,
  ) => Promise<{ ids: string[]; scrollId?: string | null | undefined }>,
): Promise<string[][]> {
  const pages: string[][] = [];
  let scrollId: string | undefined;
  do {
    const page = await read(scrollId);
    if (page.ids.length > 0) pages.push(page.ids);
    scrollId = page.ids.length > 0 ? (page.scrollId ?? undefined) : undefined;
  } while (scrollId && pages.length < MAX_PAGES);
  return pages;
}

/** Every case on both axes, paged two at a time, keyed `<case>:<axis>`. */
export async function legacyFilterAnswers({
  reads,
  projectId,
  base,
}: {
  reads: LegacyFilterReads;
  projectId: string;
  base: number;
}): Promise<Record<string, unknown>> {
  const window = legacyWindowOf({ base });
  const answers: Record<string, unknown> = {};
  for (const dateField of DATE_FIELDS) {
    for (const [name, each] of Object.entries(LEGACY_FILTER_CASES)) {
      let totalHits = -1;
      const pages = await pagesOf(async (scrollId) => {
        const page = await reads.list({
          input: {
            projectId,
            ...window,
            filters: each.filters,
            pageSize: PAGE_SIZE,
            ...(each.query ? { query: each.query } : {}),
            ...(each.traceIds ? { traceIds: each.traceIds } : {}),
          },
          dateField,
          scrollId,
        });
        if (totalHits < 0) totalHits = page.totalHits;
        return page;
      });
      answers[`${name}:${dateField}`] = { pages, totalHits };
    }
    for (const filter of SUMMARY_FILTERS) {
      answers[`summary ${filter}:${dateField}`] = {
        pages: await pagesOf((scrollId) =>
          reads.summaries({ filter, dateField, scrollId, window }),
        ),
      };
    }
  }
  return answers;
}
