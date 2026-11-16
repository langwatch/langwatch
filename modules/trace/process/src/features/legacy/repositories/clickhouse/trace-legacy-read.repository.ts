import { annotationSuggestedOutput } from "@langwatch/annotation-contract";
import { type Authorization, ProjectPermissionDeniedError } from "@langwatch/authorization";
import {
  type AuthorizedClickHouse,
  type ClickHouseQueryClient,
  DEFAULT_PARTITION_WINDOW_MS,
  queryWindowed,
  RetentionFloorService,
  type RetentionDaysProvider,
  type WindowFragment,
} from "@langwatch/clickhouse-client";
import {
  type ClickHouseRead,
  clickhouseRead,
  cond,
  type Condition,
  type Expression,
  fn,
  type ReaderScope,
  tenantScope as builtTenantScope,
} from "@langwatch/clickhouse-client/builder";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "@langwatch/data-retention-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import type {
  Protections,
  TraceSummaryData,
  NormalizedSpan,
  NormalizedSpanKind,
  NormalizedStatusCode,
  Event,
  ProjectedAnnotation,
  CustomersAndLabelsResult,
  DistinctFieldNamesResult,
  PromptStudioSpanResult,
  TopicCountsResult,
  AggregationFiltersInput,
  GetAllTracesForProjectInput,
  GetAllTracesForProjectOptions,
  TraceDateField,
  TraceSummaryListQuery,
  TraceSummaryPage,
} from "@langwatch/trace-contract";
import { isStorageAnchoredVersion } from "@langwatch/trace-contract";
import { getLangWatchTracer } from "langwatch";
import { z } from "zod";

import { evaluationRuns } from "../../../../repositories/clickhouse/clickhouse.evaluation-runs.table.ts";
import { storedSpans } from "../../../../repositories/clickhouse/clickhouse.stored-spans.table.ts";
import { traceSummaries } from "../../../../repositories/clickhouse/clickhouse.trace-summaries.table.ts";
import {
  chBoolean,
  chNumber,
  chString,
  chStringMap,
  deserializeAttributes,
  ensureStringRecord,
} from "../../../../repositories/clickhouse/stored-span-row.mapper.ts";
import type { TraceAnnotationScoresReadRepository } from "../../../../repositories/trace-annotation-scores.repository.ts";
import type { TraceAnnotationsReadRepository } from "../../../../repositories/trace-annotations.repository.ts";
import { type ClickHouseEvaluationRunRow } from "../../../../rules/trace-evaluation-mapping.rules.ts";
import { mapEventAttrsToEvent } from "../../../../rules/trace-event-attribute-mapping.rules.ts";
import { type EventSpanRow } from "../../../../rules/trace-event-attribute-mapping.rules.ts";
import type { TraceFilterCondition } from "../../../query/repositories/clickhouse/clickhouse.trace-filter-condition.mapper.ts";
import { proofGrantsProject } from "../../rules/trace-legacy-project-grant.rules.ts";
import {
  type PromptStudioSpanRow,
  derivePromptStudioSpan,
} from "../../rules/trace-legacy-prompt-studio-span.rules.ts";
import { traceStartedAt } from "../../rules/trace-legacy-summary-mapping.rules.ts";
import {
  TraceLegacyReadRepository,
  type TraceLegacyListOptions,
  type TraceLegacyPage,
  type TraceLegacyRow,
  type TraceLegacySummaryListOptions,
} from "../trace-legacy-read.repository.ts";
import { legacyTraceFilterTerms } from "./clickhouse.trace-legacy-filter-condition.mapper.ts";

const attributeMapSchema = z.record(z.string(), z.unknown());
const traceIdRowsSchema = z.array(z.looseObject({ TraceId: chString }));
const totalRowsSchema = z.array(z.looseObject({ total: chString }));
const topicCountRowsSchema = z.array(
  z.looseObject({ TopicId: chString.nullable(), SubTopicId: chString.nullable(), count: chString }),
);
const customerRowsSchema = z.array(z.looseObject({ customer_id: chString }));
const labelsRowsSchema = z.array(z.looseObject({ labels_json: chString }));
const spanNameRowsSchema = z.array(z.looseObject({ SpanName: chString }));
const metadataKeyRowsSchema = z.array(z.looseObject({ key: chString }));
const evaluatorNameRowsSchema = z.array(z.looseObject({ id: chString, name: chString.nullable() }));
const occurredAtRangeRowsSchema = z.array(
  z.looseObject({ fromMs: chNumber.nullable(), toMs: chNumber.nullable() }),
);
const promptStudioSpanRowsSchema: z.ZodType<PromptStudioSpanRow[]> = z.array(
  z
    .looseObject({
      SpanId: chString,
      TraceId: chString,
      ParentSpanId: chString.nullable(),
      SpanName: chString,
      SpanAttributes: attributeMapSchema,
      StartTimeMs: chNumber,
      EndTimeMs: chNumber,
      DurationMs: chNumber,
      StatusCode: chNumber.nullable(),
      StatusMessage: chString.nullable(),
    })
    .transform(({ StartTimeMs, EndTimeMs, ...row }) => ({
      ...row,
      StartTime: StartTimeMs,
      EndTime: EndTimeMs,
    })),
);
const eventSpanRowsSchema: z.ZodType<EventSpanRow[]> = z.array(
  z.looseObject({
    TraceId: chString,
    SpanId: chString,
    StartTimeMs: chNumber,
    EndTimeMs: chNumber,
    EventAttrs: chStringMap,
  }),
);
const evaluationRunRowsSchema: z.ZodType<ClickHouseEvaluationRunRow[]> = z.array(
  z.looseObject({
    ProjectionId: chString,
    TenantId: chString,
    EvaluationId: chString,
    Version: chString,
    EvaluatorId: chString,
    EvaluatorType: chString,
    EvaluatorName: chString.nullable(),
    TraceId: chString.nullable(),
    IsGuardrail: chNumber,
    Status: chString,
    Score: chNumber.nullable(),
    Passed: chNumber.nullable(),
    Label: chString.nullable(),
    Details: chString.nullable(),
    Error: chString.nullable(),
    Inputs: chString.nullable(),
    ScheduledAt: chString.nullable(),
    StartedAt: chString.nullable(),
    CompletedAt: chString.nullable(),
    LastProcessedEventId: chString,
    UpdatedAt: chString,
  }),
);

/**
 * Cursor structure for keyset pagination.
 * Encoded as base64 JSON in the scrollId.
 */
interface ClickHouseScrollCursor {
  /**
   * Last seen sort timestamp (epoch ms). The occurred axis pages on OccurredAt,
   * the updated axis on the latest-version UpdatedAt.
   */
  lastTimestamp: number;
  /** Last seen trace ID for tie-breaking */
  lastTraceId: string;
  /** Page size for consistency */
  pageSize: number;
  /** Sort direction */
  sortDirection: "asc" | "desc";
  /** Time axis the cursor pages on. Absent = legacy "occurred". */
  dateField?: TraceDateField;
  /**
   * Epoch ms at which this scroll started, pinned on the first page and carried
   * unchanged through every later one. Updated-axis only.
   */
  scrollStart?: number;
}

/**
 * Approximate occurrence-time bounds (epoch ms), used to prune `trace_summaries` partitions
 * when a read is otherwise filtered only by `TraceId` (which cannot prune on its own). Widened
 * by a safety margin, so callers may pass an exact point range (`from === to`).
 */
interface OccurredAtRange {
  /** Earliest trace occurrence time in the set (epoch ms). */
  from: number;
  /** Latest trace occurrence time in the set (epoch ms). */
  to: number;
}

interface TopicCountRow {
  TopicId: string | null;
  SubTopicId: string | null;
  count: string;
}

function aggregateTopicCounts(rows: TopicCountRow[]): TopicCountsResult {
  const topicCountsMap = new Map<string, number>();
  const subtopicCountsMap = new Map<string, number>();

  for (const row of rows) {
    if (row.TopicId) {
      const current = topicCountsMap.get(row.TopicId) ?? 0;
      topicCountsMap.set(row.TopicId, current + parseInt(row.count, 10));
    }
    if (row.SubTopicId) {
      const current = subtopicCountsMap.get(row.SubTopicId) ?? 0;
      subtopicCountsMap.set(row.SubTopicId, current + parseInt(row.count, 10));
    }
  }

  return {
    topicCounts: Array.from(topicCountsMap.entries()).map(([key, count]) => ({
      key,
      count,
    })),
    subtopicCounts: Array.from(subtopicCountsMap.entries()).map(([key, count]) => ({
      key,
      count,
    })),
  };
}

/**
 * Upper bound on distinct field names returned for the mapping dropdowns. Real projects are
 * low-cardinality (hundreds); this only guards against pathological cardinality (e.g. dynamic
 * IDs in span names) flooding the response.
 */
const DISTINCT_FIELD_NAMES_LIMIT = 10_000;

/**
 * Upper bound on spans returned per trace by the spans-join read path — high enough not to
 * truncate a real agentic trace while still bounding a pathologically large one's payload. A
 * trace that reaches this many spans is logged as a potential truncation.
 */
const MAX_SPANS_PER_TRACE = 10_000;

/** Caps the joined span read's own memory instead of drawing on the server's total budget. */
const JOINED_SPAN_READ_SETTINGS = {
  // ClickHouse settings are string-typed over the wire.
  max_memory_usage: String(2 * 1024 * 1024 * 1024), // 2 GiB
} as const;

/**
 * Floor the joined span read bounds itself to when nothing else can supply a window: no caller
 * paging range, and no matched summary with a usable `OccurredAt`. Runs `now - this … now + 2d`
 * instead of no time predicate at all.
 */
const SPAN_READ_FLOOR_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;
/** Per-trace cap on projected events (events are a small subset of spans). */
const MAX_EVENTS_PER_TRACE = 1_000;

/** Traces one thread read may return when the caller names no ceiling. */
const DEFAULT_THREAD_TRACES_LIMIT = 1_000;

/**
 * How many spans the traces-with-spans OOM fallback will hold in memory before it
 * gives up on the read.
 */
const MAX_SPANS_PER_JOINED_FALLBACK = 50_000;
/** Bounds the bounded events stored_spans scan to the page's occurrence weeks. */
const EVENT_PARTITION_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

/** Object keys that would corrupt the prototype chain if assigned. */
const FORBIDDEN_SCORE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Adds the labels named by one `trace_summaries` row's `labels_json` value into `labelsSet`. */
function addLabelsFromRow(labelsJson: string, labelsSet: Set<string>): void {
  try {
    const labels = JSON.parse(labelsJson);
    if (!Array.isArray(labels)) {
      return;
    }
    for (const label of labels) {
      if (typeof label === "string") {
        labelsSet.add(label);
      }
    }
  } catch {
    // If not valid JSON, treat as single label
    labelsSet.add(labelsJson);
  }
}

/**
 * Bounds the events stored_spans scan to the partitions the page's traces occurred in, clustered
 * into tight ranges (OR'd by the read) so a page mixing old and recent traces doesn't scan every
 * partition.
 */
function eventOccurrenceWindows(occurredAts: number[]): { from: number; to: number }[] {
  const sorted = [...occurredAts].toSorted((a, b) => a - b);
  // Merge points whose ±window ranges would overlap; split when farther apart.
  const clusterGap = 2 * EVENT_PARTITION_WINDOW_MS;
  const clusters: { from: number; to: number }[] = [];
  for (const ts of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && ts - last.to <= clusterGap) {
      last.to = ts;
    } else {
      clusters.push({ from: ts, to: ts });
    }
  }
  return clusters.map((c) => ({
    from: c.from - EVENT_PARTITION_WINDOW_MS,
    to: c.to + EVENT_PARTITION_WINDOW_MS,
  }));
}

/**
 * Thrown when no ClickHouse client can be resolved for a project — always a configuration
 * problem (e.g. CLICKHOUSE_URL unset), never missing data. Callers surface it as such.
 */
/** Refuses, before any read, a project the proof does not grant: the proof decides the tenant. */
function refuseUngranted({
  authorization,
  projectId,
}: {
  authorization: Authorization;
  projectId: string;
}): void {
  if (!proofGrantsProject({ authorization, projectId })) {
    throw new ProjectPermissionDeniedError("traces:view");
  }
}

class ClickHouseClientUnavailableError extends Error {
  constructor(projectId: string) {
    super(
      `No ClickHouse client could be resolved for project "${projectId}" — check ClickHouse client configuration (CLICKHOUSE_URL)`,
    );
    this.name = "ClickHouseClientUnavailableError";
  }
}

/** The registry's store under the legacy trace read. */
export type ClickHouseTraceLegacyReadOptions = {
  /** The proof-checked reader the fenced reads go through (ADR-177); absent, they refuse. */
  clickhouse?: AuthorizedClickHouse | undefined;
  /** The reader the built reads go through (ADR-202); absent, they refuse. */
  reader?: Pick<ClickHouseQueryClient, "read"> | undefined;
  /** Annotation's rows and score names via its shared tables (R40), for the projection join. */
  annotations?:
    | {
        rows: Pick<TraceAnnotationsReadRepository, "findForTraces">;
        scores: Pick<TraceAnnotationScoresReadRepository, "findScoreNames">;
      }
    | undefined;
};

/**
 * Pinned once on the first page and carried by the cursor so every later page resolves the same
 * versions (updated axis only; OccurredAt is immutable), and the requested endDate clamped to it:
 * returned as `updatedThrough` so the next pull starts where this one stopped.
 */
function resolveScrollWindow({
  dateField,
  cursor,
  endDate,
}: {
  dateField: TraceDateField;
  cursor: ClickHouseScrollCursor | null;
  endDate: number | undefined;
}): { scrollStart: number | undefined; effectiveEndDate: number | undefined } {
  if (dateField !== "updated") return { scrollStart: undefined, effectiveEndDate: endDate };
  const scrollStart = cursor ? cursor.scrollStart : nowInstant().epochMilliseconds;
  if (scrollStart === undefined) return { scrollStart, effectiveEndDate: endDate };
  return { scrollStart, effectiveEndDate: Math.min(endDate ?? scrollStart, scrollStart) };
}

/** What a failed list read logs: the project, and the error's message and stack. */
function listFailureLogFields({ projectId, error }: { projectId: string; error: unknown }) {
  return {
    projectId,
    error: error instanceof Error ? error.message : error,
    stack: error instanceof Error ? error.stack : undefined,
  };
}

/** The list page's last trace as the cursor seeks it: its time on the paged axis, and its id. */
function sortKeyOf({ last, dateField }: { last: TraceSummaryData; dateField: TraceDateField }): {
  timestamp: number;
  traceId: string;
} {
  const timestamp = dateField === "updated" ? last.updatedAt : traceStartedAt(last);
  return { timestamp, traceId: last.traceId };
}

/** A bare summary's keyset position on the paged axis, as the summaries-only page seeks it. */
function summarySortKey({
  last,
  dateField,
}: {
  last: TraceSummaryData;
  dateField: TraceDateField;
}): {
  timestamp: number;
  traceId: string;
} {
  return {
    timestamp: dateField === "updated" ? last.updatedAt : last.occurredAt,
    traceId: last.traceId,
  };
}

/** What narrows a list page: the window, the filter's terms, the asked ids and the search. */
interface PageFilter<S extends ReaderScope> {
  scope: S;
  startDate: number;
  endDate: number;
  terms: readonly TraceFilterCondition[];
  traceIds: readonly string[] | undefined;
  /** Already lowercased and LIKE-escaped, `%`-wrapped. */
  search: { pattern: string; protections: Protections } | undefined;
  /** Updated-axis snapshot point; caps the version election. */
  scrollStart: number | undefined;
  dateField: TraceDateField;
}

type PageRead<S extends ReaderScope, Row extends Record<string, unknown>> = ClickHouseRead<
  S,
  "trace_summaries",
  Row,
  Record<never, never>
>;

/** The page's starting read: the proof's windows where it reads under one. */
function pageStart<S extends ReaderScope>(scope: S) {
  const read = clickhouseRead({ scope }).from(traceSummaries);
  return scope.kind === "proof" ? read.withinWindows() : read;
}

/**
 * Free text over the captured I/O the viewer may see and the trace name, or any span's name in
 * the window: trace and span names are operation names, not captured content.
 */
function searchTerm<S extends ReaderScope>({
  search,
  startDate,
  endDate,
  windowed,
}: {
  search: NonNullable<PageFilter<S>["search"]>;
  startDate: number;
  endDate: number;
  windowed: boolean;
}): TraceFilterCondition {
  const { pattern, protections } = search;
  const lowered = (of: Expression<string | null, "trace_summaries">) =>
    fn.like(fn.lower(fn.ifNull(of, "")), pattern);
  const columns = [
    ...(protections.canSeeCapturedInput !== false ? [lowered(traceSummaries.ComputedInput)] : []),
    ...(protections.canSeeCapturedOutput !== false ? [lowered(traceSummaries.ComputedOutput)] : []),
    lowered(traceSummaries.TraceName),
  ];
  return (ops) =>
    ops.or(
      ...columns,
      ops.within(fn.tuple(traceSummaries.TenantId, traceSummaries.TraceId), (sub) => {
        const spans = sub
          .from(storedSpans)
          .select({ TenantId: storedSpans.TenantId, TraceId: storedSpans.TraceId })
          .where(({ and, gte, lte }) =>
            and(
              gte(storedSpans.StartTime, startDate),
              lte(storedSpans.StartTime, endDate),
              fn.like(fn.lower(storedSpans.SpanName), pattern),
            ),
          );
        return windowed ? spans.withinWindows() : spans;
      }),
    );
}

/** The page's terms past the window: filter, asked ids and search; empty narrows nothing. */
function pageTerms<S extends ReaderScope>(page: PageFilter<S>): TraceFilterCondition[] {
  return [
    ...page.terms,
    ...(page.traceIds && page.traceIds.length > 0
      ? [constantTerm(cond.oneOf(traceSummaries.TraceId, [...page.traceIds]))]
      : []),
    ...(page.search
      ? [
          searchTerm({
            search: page.search,
            startDate: page.startDate,
            endDate: page.endDate,
            windowed: page.scope.kind === "proof",
          }),
        ]
      : []),
  ];
}

function constantTerm(condition: Condition<"trace_summaries">): TraceFilterCondition {
  return () => condition;
}

/** `(time, TraceId)` past the cursor in the page's direction, compared as main's tuple did. */
function cursorSeek({
  time,
  cursor,
  sortDirection,
}: {
  time: Expression<number, "trace_summaries">;
  cursor: ClickHouseScrollCursor;
  sortDirection: "asc" | "desc";
}): Condition<"trace_summaries"> {
  const past = sortDirection === "desc" ? cond.lt : cond.gt;
  return cond.or(
    past(time, cursor.lastTimestamp),
    cond.and(cond.eq(time, cursor.lastTimestamp), past(traceSummaries.TraceId, cursor.lastTraceId)),
  );
}

/**
 * The page's rows. occurred: windowed on the immutable OccurredAt, every version. updated: each
 * trace's latest version (capped at the scroll's snapshot) elected first, then the window, terms
 * and cursor on that row, so a stale version never satisfies a filter the latest does not.
 */
function narrowedPage<S extends ReaderScope, Row extends Record<string, unknown>>({
  read,
  page,
  cursor,
  sortDirection,
}: {
  read: PageRead<S, Row>;
  page: PageFilter<S>;
  cursor: ClickHouseScrollCursor | null;
  sortDirection: "asc" | "desc";
}): PageRead<S, Row> {
  const terms = pageTerms(page);
  const filtered = (narrowed: PageRead<S, Row>, inElection: boolean) =>
    terms.length === 0
      ? narrowed
      : narrowed.where((ops) => ops.and(...terms.map((term) => term(ops))), { inElection });
  if (page.dateField !== "updated") {
    const occurred = filtered(
      read.where(({ and, gte, lte }) =>
        and(
          gte(traceSummaries.OccurredAt, page.startDate),
          lte(traceSummaries.OccurredAt, page.endDate),
        ),
      ),
      true,
    );
    return cursor
      ? occurred.where(() =>
          cursorSeek({
            time: fn.toUnixTimestamp64Milli(traceSummaries.OccurredAt),
            cursor,
            sortDirection,
          }),
        )
      : occurred;
  }
  const { scrollStart } = page;
  const elected = read
    .where(({ gte }) => gte(traceSummaries.UpdatedAt, page.startDate))
    .where(() =>
      scrollStart === undefined ? cond.always() : cond.lte(traceSummaries.UpdatedAt, scrollStart),
    )
    .latestVersion()
    .where(({ lte }) => lte(traceSummaries.UpdatedAt, page.endDate), { inElection: false });
  const updated = filtered(elected, false);
  return cursor
    ? updated.where(
        () =>
          cursorSeek({
            time: fn.toUnixTimestamp64Milli(traceSummaries.UpdatedAt),
            cursor,
            sortDirection,
          }),
        { inElection: false },
      )
    : updated;
}

/** How many traces the page's filter matches: HyperLogLog on occurred, exact on updated. */
function pageCountStatement<S extends ReaderScope>(page: PageFilter<S>) {
  const total =
    page.dateField === "updated"
      ? fn.uniqExact(traceSummaries.TraceId)
      : fn.uniq(traceSummaries.TraceId);
  return narrowedPage({
    read: pageStart(page.scope).select({ total }),
    page,
    cursor: null,
    sortDirection: "desc",
  }).build();
}

/** The page's trace ids, keyset-sorted on the paged axis, then by id. */
function pageIdStatement<S extends ReaderScope>({
  page,
  cursor,
  sortDirection,
  pageSize,
}: {
  page: PageFilter<S>;
  cursor: ClickHouseScrollCursor | null;
  sortDirection: "asc" | "desc";
  pageSize: number;
}) {
  const direction = sortDirection === "desc" ? "DESC" : "ASC";
  const sortTime =
    page.dateField === "updated"
      ? fn.max(fn.toUnixTimestamp64Milli(traceSummaries.UpdatedAt))
      : fn.argMax(traceSummaries.OccurredAt, traceSummaries.UpdatedAt);
  return narrowedPage({
    read: pageStart(page.scope).select({ TraceId: traceSummaries.TraceId, sortTime }),
    page,
    cursor,
    sortDirection,
  })
    .groupBy(traceSummaries.TraceId)
    .orderBy("sortTime", direction)
    .orderBy(traceSummaries.TraceId, direction)
    .limit(pageSize)
    .build();
}

/**
 * The page's traces' latest summaries. occurred: the window on OccurredAt in the rows and the
 * election; updated: no window (the ids were chosen on the global latest), the snapshot cap only.
 */
function pageSummariesStatement<S extends ReaderScope>({
  scope,
  traceIds,
  startDate,
  endDate,
  dateColumn,
  scrollStart,
  sortDirection,
  fetchInput,
  fetchOutput,
}: {
  scope: S;
  traceIds: readonly string[];
  startDate: number;
  endDate: number;
  dateColumn: "OccurredAt" | "UpdatedAt";
  scrollStart: number | undefined;
  sortDirection: "asc" | "desc";
  fetchInput: boolean;
  fetchOutput: boolean;
}) {
  const { ts_ComputedInput, ts_ComputedOutput, ...light } = JOINED_SUMMARY_SELECTION;
  const direction = sortDirection === "desc" ? "DESC" : "ASC";
  const read = pageStart(scope)
    .select({
      ...light,
      ...(fetchInput ? { ts_ComputedInput } : {}),
      ...(fetchOutput ? { ts_ComputedOutput } : {}),
    })
    .where(({ oneOf }) => oneOf(traceSummaries.TraceId, [...traceIds]));
  const updatedCap = scrollStart;
  const bounded =
    dateColumn === "OccurredAt"
      ? read.where(({ and, gte, lte }) =>
          and(gte(traceSummaries.OccurredAt, startDate), lte(traceSummaries.OccurredAt, endDate)),
        )
      : read.where(({ lte }) =>
          updatedCap === undefined ? cond.always() : lte(traceSummaries.UpdatedAt, updatedCap),
        );
  return bounded
    .latestVersion()
    .orderBy(traceSummaries[dateColumn], direction)
    .orderBy(traceSummaries.TraceId, direction)
    .build();
}

/** Stored-span rows as the joined read selects them. */
const joinedSpanRowSchema = z
  .looseObject({
    SpanId: chString,
    TraceId: chString,
    TenantId: chString,
    ParentSpanId: chString.nullable(),
    ParentTraceId: chString.nullable(),
    ParentIsRemote: chBoolean.nullable(),
    Sampled: chBoolean,
    StartTimeMs: chNumber,
    EndTimeMs: chNumber,
    DurationMs: chNumber,
    SpanName: chString,
    SpanKind: chNumber,
    ResourceAttributes: attributeMapSchema,
    SpanAttributes: attributeMapSchema,
    StatusCode: chNumber.nullable(),
    StatusMessage: chString.nullable(),
    ScopeName: chString.nullable(),
    ScopeVersion: chString.nullable(),
    Events_Timestamp: z.array(chNumber),
    Events_Name: z.array(chString),
    Events_Attributes: z.array(attributeMapSchema),
    Links_TraceId: z.array(chString),
    Links_SpanId: z.array(chString),
    Links_Attributes: z.array(attributeMapSchema),
  })
  .transform(({ EndTimeMs, ...row }) => ({ ...row, EndTime: EndTimeMs }));

type JoinedSpanRow = z.infer<typeof joinedSpanRowSchema>;

const joinedSpanRowsSchema = z.array(joinedSpanRowSchema);

/**
 * Bounds the stored_spans scan to the weeks the matched traces occurred in, falling back to the
 * summary window the read already used; undefined leaves the scan to the retention floor.
 */
function deriveSpanRange({
  summaryRows,
  hasSummaryWindow,
  effectiveOccurredAt,
}: {
  summaryRows: TraceSummaryRow[];
  hasSummaryWindow: boolean;
  effectiveOccurredAt: OccurredAtRange | undefined;
}): { from: number; to: number } | undefined {
  // Bounds the stored_spans scan to the weeks the matched traces occurred in. Same
  // range->window mapping as the summary read above: centre on the range midpoint,
  // half-width = half that range + the ±2-day margin.
  const occurredAts = summaryRows
    .map((r) => r.ts_OccurredAt)
    .filter((t): t is number => typeof t === "number" && t > 0);
  if (occurredAts.length > 0) {
    return { from: Math.min(...occurredAts), to: Math.max(...occurredAts) };
  }
  return hasSummaryWindow ? effectiveOccurredAt : undefined;
}

/**
 * The summary read's window in queryWindowed's centre and half-width form: the filed range plus
 * the ±2-day margin, the epoch alone ([0, 0], the sentinel partition) for an unfiled batch, or
 * no hint, which reads every partition.
 */
function summaryReadWindow({
  filed,
  unfiled,
}: {
  filed: OccurredAtRange | undefined;
  unfiled: boolean;
}): { hintMs: number | null; windowMs: number } {
  if (filed) {
    return {
      hintMs: (filed.from + filed.to) / 2,
      windowMs: (filed.to - filed.from) / 2 + DEFAULT_PARTITION_WINDOW_MS,
    };
  }

  if (unfiled) {
    return { hintMs: 0, windowMs: 0 };
  }

  return { hintMs: null, windowMs: DEFAULT_PARTITION_WINDOW_MS };
}

const retentionFloorLogger = createLogger("langwatch:clickhouse:retention-floor");

const THREAD_ID = (summaries: typeof traceSummaries) =>
  fn.mapGet(summaries.Attributes, "gen_ai.conversation.id");

/** The distinct trace ids of a project's summaries whose id starts with `prefix`, in a window. */
function traceIdsByPrefixStatement({
  projectId,
  prefix,
  occurredAt,
  limit,
}: {
  projectId: string;
  prefix: string;
  occurredAt: { from: number; to: number };
  limit: number;
}) {
  return clickhouseRead({ scope: builtTenantScope.single({ tenantId: projectId }) })
    .from(traceSummaries)
    .select({ TraceId: traceSummaries.TraceId })
    .distinct()
    .where(({ and, gte, lte }) =>
      and(
        gte(traceSummaries.OccurredAt, occurredAt.from),
        lte(traceSummaries.OccurredAt, occurredAt.to),
        fn.startsWith(traceSummaries.TraceId, prefix),
      ),
    )
    .limit(limit)
    .build();
}

/**
 * The distinct trace ids of the thread (`=`) or threads (`IN`) asked, oldest first, under the
 * proof's OccurredAt fence, as main's two reads compared them.
 */
function threadTraceIdsStatement({
  authorization,
  threads,
  limit,
}: {
  authorization: Authorization;
  threads: string | readonly string[];
  limit: number;
}) {
  return clickhouseRead({
    scope: builtTenantScope.fromProof({ authorization, reads: "traces" }),
  })
    .from(traceSummaries)
    .withinWindows()
    .select({ TraceId: traceSummaries.TraceId })
    .distinct()
    .where(({ eq, oneOf }) =>
      typeof threads === "string"
        ? eq(THREAD_ID(traceSummaries), threads)
        : oneOf(THREAD_ID(traceSummaries), [...threads]),
    )
    .orderBy(traceSummaries.CreatedAt, "ASC")
    .limit(limit)
    .build();
}

type AggregationWindow = { projectId: string; startDate?: number; endDate?: number };

/** A project's summaries, created inside the bounds given; an unset bound does not filter. */
function summariesCreatedWithin({ projectId, startDate, endDate }: AggregationWindow) {
  let read = clickhouseRead({ scope: builtTenantScope.single({ tenantId: projectId }) }).from(
    traceSummaries,
  );
  if (startDate) read = read.where(({ gte }) => gte(traceSummaries.CreatedAt, startDate));
  if (endDate) read = read.where(({ lte }) => lte(traceSummaries.CreatedAt, endDate));
  return read;
}

/** Each topic and subtopic pair's trace count in the window. */
function topicCountsStatement(window: AggregationWindow) {
  return summariesCreatedWithin(window)
    .select({
      TopicId: traceSummaries.TopicId,
      SubTopicId: traceSummaries.SubTopicId,
      count: fn.count(),
    })
    .where(({ isNotNull, or }) =>
      or(isNotNull(traceSummaries.TopicId), isNotNull(traceSummaries.SubTopicId)),
    )
    .groupBy(traceSummaries.TopicId, traceSummaries.SubTopicId)
    .limit(10_000)
    .build();
}

/** The distinct non-empty values of one summary attribute in the window, as `alias`. */
function distinctAttributeStatement<const Alias extends string>({
  window,
  attribute,
  alias,
}: {
  window: AggregationWindow;
  attribute: string;
  alias: Alias;
}) {
  const value = fn.mapGet(traceSummaries.Attributes, attribute);
  return summariesCreatedWithin(window)
    .select({ [alias]: value } as Record<Alias, typeof value>)
    .distinct()
    .where(({ ne }) => ne(value, ""))
    .limit(10_000)
    .build();
}

/** Every stored span version of the trace holding `spanId`, as main read them (no election). */
function promptStudioSpansStatement({ projectId, spanId }: { projectId: string; spanId: string }) {
  return clickhouseRead({ scope: builtTenantScope.single({ tenantId: projectId }) })
    .from(storedSpans)
    .select({
      SpanId: storedSpans.SpanId,
      TraceId: storedSpans.TraceId,
      ParentSpanId: storedSpans.ParentSpanId,
      SpanName: storedSpans.SpanName,
      SpanAttributes: storedSpans.SpanAttributes,
      StartTimeMs: fn.toUnixTimestamp64Milli(storedSpans.StartTime),
      EndTimeMs: fn.toUnixTimestamp64Milli(storedSpans.EndTime),
      DurationMs: storedSpans.DurationMs,
      StatusCode: storedSpans.StatusCode,
      StatusMessage: storedSpans.StatusMessage,
    })
    .where(({ eq, scalar }) =>
      eq(
        storedSpans.TraceId,
        scalar((sub) =>
          sub
            .from(storedSpans)
            .select({ TraceId: storedSpans.TraceId })
            .where(({ eq: same }) => same(storedSpans.SpanId, spanId))
            .limit(1),
        ),
      ),
    )
    .limit(1000)
    .build();
}

/**
 * The OccurredAt span of the asked traces under the proof, epoch sentinels excluded; no row when
 * none matches. An id the index has never seen reads every partition (`onMiss: "unbounded"`).
 */
function occurredAtRangeStatement({
  authorization,
  traceIds,
}: {
  authorization: Authorization;
  traceIds: readonly string[];
}) {
  return clickhouseRead({
    scope: builtTenantScope.fromProof({ authorization, reads: "traces" }),
  })
    .from(traceSummaries)
    .withinWindows()
    .select({
      fromMs: fn.toUnixTimestamp64Milli(fn.min(traceSummaries.OccurredAt)),
      toMs: fn.toUnixTimestamp64Milli(fn.max(traceSummaries.OccurredAt)),
    })
    .where(({ and, gt, idBound }) =>
      and(idBound(traceSummaries.TraceId, [...traceIds]), gt(traceSummaries.OccurredAt, 0)),
    )
    .having(({ gt }) => gt(fn.count(), 0))
    .build();
}

/** Each evaluation's latest version on the asked traces, under the proof, `Inputs` included. */
function evaluationRowsStatement({
  authorization,
  traceIds,
}: {
  authorization: Authorization;
  traceIds: readonly string[];
}) {
  return clickhouseRead({
    scope: builtTenantScope.fromProof({ authorization, reads: "traces" }),
  })
    .from(evaluationRuns)
    .withinWindows()
    .select({
      ProjectionId: evaluationRuns.ProjectionId,
      TenantId: evaluationRuns.TenantId,
      EvaluationId: evaluationRuns.EvaluationId,
      Version: evaluationRuns.Version,
      EvaluatorId: evaluationRuns.EvaluatorId,
      EvaluatorType: evaluationRuns.EvaluatorType,
      EvaluatorName: evaluationRuns.EvaluatorName,
      TraceId: evaluationRuns.TraceId,
      IsGuardrail: evaluationRuns.IsGuardrail,
      Status: evaluationRuns.Status,
      Score: evaluationRuns.Score,
      Passed: evaluationRuns.Passed,
      Label: evaluationRuns.Label,
      Details: evaluationRuns.Details,
      Error: evaluationRuns.Error,
      ScheduledAt: evaluationRuns.ScheduledAt,
      StartedAt: evaluationRuns.StartedAt,
      CompletedAt: evaluationRuns.CompletedAt,
      LastProcessedEventId: evaluationRuns.LastProcessedEventId,
      UpdatedAt: evaluationRuns.UpdatedAt,
      Inputs: evaluationRuns.Inputs,
    })
    .where(({ oneOf }) => oneOf(evaluationRuns.TraceId, [...traceIds]))
    .latestVersion({ repeat: [evaluationRuns.TraceId] })
    .build();
}

/**
 * The event spans (an `event.type` attribute) of the asked traces under the proof, in the
 * occurrence windows, latest version each, at most `maxEvents` per trace, `event.*` entries only.
 */
function eventSpansStatement({
  authorization,
  traceIds,
  windows,
  maxEvents,
}: {
  authorization: Authorization;
  traceIds: readonly string[];
  windows: readonly { from: number; to: number }[];
  maxEvents: number;
}) {
  return (
    clickhouseRead({ scope: builtTenantScope.fromProof({ authorization, reads: "traces" }) })
      .from(storedSpans)
      .withinWindows()
      .select({
        TraceId: storedSpans.TraceId,
        SpanId: storedSpans.SpanId,
        StartTimeMs: fn.toUnixTimestamp64Milli(storedSpans.StartTime),
        EndTimeMs: fn.toUnixTimestamp64Milli(storedSpans.EndTime),
        EventAttrs: fn.mapFilter((key) => fn.startsWith(key, "event."), storedSpans.SpanAttributes),
      })
      .where(({ and, gte, lte, oneOf, or }) =>
        and(
          oneOf(storedSpans.TraceId, [...traceIds]),
          or(
            ...windows.map(({ from, to }) =>
              and(gte(storedSpans.StartTime, from), lte(storedSpans.StartTime, to)),
            ),
          ),
          fn.mapContains(storedSpans.SpanAttributes, "event.type"),
        ),
      )
      // Main's election filtered on `event.type` too: repeating it keeps the same versions.
      .latestVersion({ repeat: [storedSpans.SpanAttributes] })
      .orderBy(storedSpans.TraceId, "ASC")
      .orderBy(storedSpans.StartTime, "ASC")
      .limitBy(maxEvents, storedSpans.TraceId)
      .build()
  );
}

/** The joined page read's summary columns, `ts_`-prefixed as its row schema reads them. */
const JOINED_SUMMARY_SELECTION = {
  ts_TraceId: traceSummaries.TraceId,
  ts_SpanCount: traceSummaries.SpanCount,
  ts_TotalDurationMs: traceSummaries.TotalDurationMs,
  ts_ComputedIOSchemaVersion: traceSummaries.ComputedIOSchemaVersion,
  ts_ComputedInput: traceSummaries.ComputedInput,
  ts_ComputedOutput: traceSummaries.ComputedOutput,
  ts_TimeToFirstTokenMs: traceSummaries.TimeToFirstTokenMs,
  ts_TimeToLastTokenMs: traceSummaries.TimeToLastTokenMs,
  ts_TokensPerSecond: traceSummaries.TokensPerSecond,
  ts_ContainsErrorStatus: traceSummaries.ContainsErrorStatus,
  ts_ContainsOKStatus: traceSummaries.ContainsOKStatus,
  ts_ErrorMessage: traceSummaries.ErrorMessage,
  ts_Models: traceSummaries.Models,
  ts_TotalCost: traceSummaries.TotalCost,
  ts_NonBilledCost: traceSummaries.NonBilledCost,
  ts_TokensEstimated: traceSummaries.TokensEstimated,
  ts_TotalPromptTokenCount: traceSummaries.TotalPromptTokenCount,
  ts_TotalCompletionTokenCount: traceSummaries.TotalCompletionTokenCount,
  ts_TopicId: traceSummaries.TopicId,
  ts_SubTopicId: traceSummaries.SubTopicId,
  ts_HasAnnotation: traceSummaries.HasAnnotation,
  ts_AnnotationIds: traceSummaries.AnnotationIds,
  ts_Attributes: traceSummaries.Attributes,
  ts_TraceName: traceSummaries.TraceName,
  ts_Version: traceSummaries.Version,
  ts_EarliestSpanStartMs: traceSummaries.EarliestSpanStartMs,
  ts_OccurredAt: fn.toUnixTimestamp64Milli(traceSummaries.OccurredAt),
  ts_CreatedAt: fn.toUnixTimestamp64Milli(traceSummaries.CreatedAt),
  ts_UpdatedAt: fn.toUnixTimestamp64Milli(traceSummaries.UpdatedAt),
};

/** The asked traces' latest summaries under the proof, inside `window` when one is given. */
function joinedSummariesStatement({
  authorization,
  traceIds,
  window,
}: {
  authorization: Authorization;
  traceIds: readonly string[];
  window: WindowFragment | null;
}) {
  const read = clickhouseRead({
    scope: builtTenantScope.fromProof({ authorization, reads: "traces" }),
  })
    .from(traceSummaries)
    .withinWindows()
    .select(JOINED_SUMMARY_SELECTION)
    .where(({ oneOf }) => oneOf(traceSummaries.TraceId, [...traceIds]));
  const windowed =
    window === null
      ? read
      : read.where(({ and, gte, lte }) =>
          and(
            gte(traceSummaries.OccurredAt, window.fromMs),
            lte(traceSummaries.OccurredAt, window.toMs),
          ),
        );
  return windowed.latestVersion().orderBy(traceSummaries.TraceId, "ASC").build();
}

/** The joined page read's span columns; `EndTimeMs` is read back as `EndTime` by its schema. */
const JOINED_SPAN_SELECTION = {
  SpanId: storedSpans.SpanId,
  TraceId: storedSpans.TraceId,
  TenantId: storedSpans.TenantId,
  ParentSpanId: storedSpans.ParentSpanId,
  ParentTraceId: storedSpans.ParentTraceId,
  ParentIsRemote: storedSpans.ParentIsRemote,
  Sampled: storedSpans.Sampled,
  StartTimeMs: fn.toUnixTimestamp64Milli(storedSpans.StartTime),
  EndTimeMs: fn.toUnixTimestamp64Milli(storedSpans.EndTime),
  DurationMs: storedSpans.DurationMs,
  SpanName: storedSpans.SpanName,
  SpanKind: storedSpans.SpanKind,
  ResourceAttributes: storedSpans.ResourceAttributes,
  SpanAttributes: storedSpans.SpanAttributes,
  StatusCode: storedSpans.StatusCode,
  StatusMessage: storedSpans.StatusMessage,
  ScopeName: storedSpans.ScopeName,
  ScopeVersion: storedSpans.ScopeVersion,
  Events_Timestamp: fn.arrayMap(
    (at) => fn.toUnixTimestamp64Milli(at),
    storedSpans["Events.Timestamp"],
  ),
  Events_Name: storedSpans["Events.Name"],
  Events_Attributes: storedSpans["Events.Attributes"],
  Links_TraceId: storedSpans["Links.TraceId"],
  Links_SpanId: storedSpans["Links.SpanId"],
  Links_Attributes: storedSpans["Links.Attributes"],
};

/** The asked traces' latest spans under the proof, in `window`, at most the per-trace cap each. */
function joinedSpansStatement({
  authorization,
  traceIds,
  window,
  settings,
}: {
  authorization: Authorization;
  traceIds: readonly string[];
  window: WindowFragment | null;
  settings: Record<string, string>;
}) {
  const read = clickhouseRead({
    scope: builtTenantScope.fromProof({ authorization, reads: "traces" }),
  })
    .from(storedSpans)
    .withinWindows()
    .select(JOINED_SPAN_SELECTION)
    .where(({ oneOf }) => oneOf(storedSpans.TraceId, [...traceIds]));
  const windowed =
    window === null
      ? read
      : read.where(({ and, gte, lte }) =>
          and(gte(storedSpans.StartTime, window.fromMs), lte(storedSpans.StartTime, window.toMs)),
        );
  return (
    windowed
      // stored_spans replaces by StartTime (goose 00002): main elected max(StartTime) here.
      .latestVersion({ version: storedSpans.StartTime })
      .orderBy(storedSpans.TraceId, "ASC")
      .orderBy(storedSpans.StartTime, "ASC")
      .limitBy(MAX_SPANS_PER_TRACE, storedSpans.TraceId)
      .settings(settings)
      .build()
  );
}

type FieldWindow = { projectId: string; startDate: number; endDate: number };

/** The distinct non-empty span names started in the window. */
function spanNamesStatement({ projectId, startDate, endDate }: FieldWindow) {
  return clickhouseRead({ scope: builtTenantScope.single({ tenantId: projectId }) })
    .from(storedSpans)
    .select({ SpanName: storedSpans.SpanName })
    .distinct()
    .where(({ and, gte, lte, ne }) =>
      and(
        gte(storedSpans.StartTime, startDate),
        lte(storedSpans.StartTime, endDate),
        ne(storedSpans.SpanName, ""),
      ),
    )
    .orderBy(storedSpans.SpanName, "ASC")
    .limit(DISTINCT_FIELD_NAMES_LIMIT)
    .build();
}

/** The distinct attribute keys of the summaries created in the window; keys only, no values. */
function metadataKeysStatement({ projectId, startDate, endDate }: FieldWindow) {
  return clickhouseRead({ scope: builtTenantScope.single({ tenantId: projectId }) })
    .from(traceSummaries)
    .select({ key: fn.arrayJoin(fn.mapKeys(traceSummaries.Attributes)) })
    .distinct()
    .where(({ and, gte, lte }) =>
      and(gte(traceSummaries.CreatedAt, startDate), lte(traceSummaries.CreatedAt, endDate)),
    )
    .orderBy("key", "ASC")
    .limit(DISTINCT_FIELD_NAMES_LIMIT)
    .build();
}

/** Each evaluator scheduled in the window, by id, with its most recent name. */
function evaluatorNamesStatement({ projectId, startDate, endDate }: FieldWindow) {
  return clickhouseRead({ scope: builtTenantScope.single({ tenantId: projectId }) })
    .from(evaluationRuns)
    .select({
      id: evaluationRuns.EvaluatorId,
      name: fn.argMax(evaluationRuns.EvaluatorName, evaluationRuns.ScheduledAt),
    })
    .where(({ and, gte, lte, ne }) =>
      and(
        gte(evaluationRuns.ScheduledAt, startDate),
        lte(evaluationRuns.ScheduledAt, endDate),
        ne(evaluationRuns.EvaluatorId, ""),
      ),
    )
    .groupBy(evaluationRuns.EvaluatorId)
    .orderBy("name", "ASC")
    .limit(DISTINCT_FIELD_NAMES_LIMIT)
    .build();
}

export class TraceLegacyReadClickHouseRepository extends TraceLegacyReadRepository {
  private readonly logger = createLogger("langwatch:traces:clickhouse-service");
  private readonly tracer = getLangWatchTracer("langwatch.traces.clickhouse-service");

  private readonly store: ClickHouseTraceLegacyReadOptions;
  private readonly annotations: ClickHouseTraceLegacyReadOptions["annotations"];

  constructor(options: ClickHouseTraceLegacyReadOptions) {
    super();
    const { clickhouse, reader, annotations } = options;
    this.store = { clickhouse, reader, annotations };
    this.annotations = annotations;
  }

  static create(options: ClickHouseTraceLegacyReadOptions): TraceLegacyReadClickHouseRepository {
    return new TraceLegacyReadClickHouseRepository(options);
  }

  /** One floor per tenant policy the caller passes, so its cache outlives a read. */
  private readonly floors = new WeakMap<RetentionDaysProvider, RetentionFloorService>();
  private readonly defaultFloor = this.newFloor(undefined);

  private floorOver(retentionDays: RetentionDaysProvider | undefined): RetentionFloorService {
    if (!retentionDays) return this.defaultFloor;
    const floor = this.floors.get(retentionDays) ?? this.newFloor(retentionDays);
    this.floors.set(retentionDays, floor);
    return floor;
  }

  private newFloor(provider: RetentionDaysProvider | undefined): RetentionFloorService {
    return new RetentionFloorService({
      defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
      provider,
      logger: retentionFloorLogger,
    });
  }

  /** The fenced reader for one proof; refuses by name where no ClickHouse was composed. */
  private reader({
    authorization,
    projectId,
  }: {
    authorization: Authorization;
    projectId: string;
  }) {
    refuseUngranted({ authorization, projectId });
    if (!this.store.clickhouse) throw new ClickHouseClientUnavailableError(projectId);
    return this.store.clickhouse.as(authorization, { reads: "traces" });
  }

  /** The reader for built reads; refuses by name where no ClickHouse was composed. */
  private builtReader(projectId: string): Pick<ClickHouseQueryClient, "read"> {
    if (!this.store.reader) throw new ClickHouseClientUnavailableError(projectId);
    return this.store.reader;
  }

  /** @param occurredAt approximate time range bounding the partition scan. */
  async findTracesWithSpans({
    authorization,
    projectId,
    traceIds,
    occurredAt,
    retentionDays,
  }: {
    authorization: Authorization;
    projectId: string;
    traceIds: string[];
    occurredAt?: OccurredAtRange | undefined;
    retentionDays: RetentionDaysProvider | undefined;
  }): Promise<TraceLegacyRow[]> {
    return this.tracer.withActiveSpan(
      "TraceLegacyReadClickHouseRepository.getTracesWithSpans",
      {
        attributes: { "tenant.id": projectId },
      },
      async () => {
        // Up front so a missing store or a refused proof surfaces by name,
        // not as the generic fetch failure from the try/catch below.
        this.reader({ authorization, projectId });

        if (traceIds.length === 0) {
          return [];
        }

        this.logger.debug(
          { projectId, traceIdCount: traceIds.length },
          "Fetching traces with spans from ClickHouse",
        );

        try {
          // Fetch trace summaries with spans using JOIN
          const tracesWithSpans = await this.fetchTracesWithSpansJoined({
            authorization,
            projectId,
            traceIds,
            occurredAt,
            retentionDays,
          });
          const traces = [...tracesWithSpans.values()];

          this.logger.debug(
            { projectId, traceCount: traces.length },
            "Successfully fetched traces from ClickHouse",
          );

          return traces;
        } catch (error) {
          if (HandledError.isHandled(error)) throw error;
          this.logger.warn(
            {
              projectId,
              error: error instanceof Error ? error.message : error,
            },
            "Failed to fetch traces from ClickHouse",
          );
          // Keep the cause. Without it the only record of WHY this failed is
          // the warn line above, so a caller that logs the throw — or a test
          // that asserts on it — sees a message that could mean anything.
          throw new Error("Failed to fetch traces with spans", {
            cause: error,
          });
        }
      },
    );
  }

  /**
   * Resolve a trace ID prefix to matching full trace IDs within a project.
   */
  async resolveTraceIdByPrefix({
    projectId,
    prefix,
    occurredAt,
    limit = 2,
  }: {
    /** The project ID (scoped via TenantId) */
    projectId: string;
    /** The trace ID prefix to search for */
    prefix: string;
    /** Partition-key bound (epoch millis) — required for partition pruning */
    occurredAt: { from: number; to: number };
    /** Maximum distinct trace IDs to return (default 2 — enough to detect ambiguity) */
    limit?: number;
  }): Promise<string[]> {
    return this.tracer.withActiveSpan(
      "TraceLegacyReadClickHouseRepository.resolveTraceIdByPrefix",
      { attributes: { "tenant.id": projectId, "trace.id.prefix": prefix } },
      async () => {
        const reader = this.builtReader(projectId);

        try {
          const result = await reader.read({
            statement: traceIdsByPrefixStatement({ projectId, prefix, occurredAt, limit }),
            table: traceSummaries.$table.name,
          });

          const rows = traceIdRowsSchema.parse(result.rows);
          return rows.map((r) => r.TraceId);
        } catch (error) {
          if (HandledError.isHandled(error)) throw error;
          this.logger.warn(
            {
              projectId,
              prefix,
              error: error instanceof Error ? error.message : error,
            },
            "Failed to resolve trace ID by prefix from ClickHouse",
          );
          throw new Error("Failed to resolve trace ID by prefix");
        }
      },
    );
  }

  async findTracesByThreadId({
    authorization,
    projectId,
    threadId,
    retentionDays,
  }: {
    authorization: Authorization;
    projectId: string;
    threadId: string;
    retentionDays: RetentionDaysProvider | undefined;
  }): Promise<TraceLegacyRow[]> {
    return this.tracer.withActiveSpan(
      "TraceLegacyReadClickHouseRepository.getTracesByThreadId",
      {
        attributes: { "tenant.id": projectId, "thread.id": threadId },
      },
      async () => {
        refuseUngranted({ authorization, projectId });
        const reader = this.builtReader(projectId);

        this.logger.debug({ projectId, threadId }, "Fetching traces by thread ID from ClickHouse");

        try {
          // Query trace_summaries for traces with matching thread_id
          // Thread ID can be stored under different attribute keys
          const result = await reader.read({
            statement: threadTraceIdsStatement({
              authorization,
              threads: threadId,
              limit: 1000,
            }),
            table: traceSummaries.$table.name,
          });

          const rows = traceIdRowsSchema.parse(result.rows);
          const traceIds = rows.map((r) => r.TraceId);

          if (traceIds.length === 0) {
            return [];
          }

          return await this.findTracesWithSpans({
            authorization,
            projectId,
            traceIds,
            retentionDays,
          });
        } catch (error) {
          if (HandledError.isHandled(error)) throw error;
          this.logger.warn(
            {
              projectId,
              threadId,
              error: error instanceof Error ? error.message : error,
            },
            "Failed to fetch traces by thread ID from ClickHouse",
          );
          throw new Error("Failed to fetch traces by thread ID");
        }
      },
    );
  }

  /**
   * @param maxTraces traces the read may return across every thread asked
   *   for; a ceiling below what they hold drops the rest without a word.
   */
  async findTracesWithSpansByThreadIds({
    authorization,
    projectId,
    threadIds,
    maxTraces,
    retentionDays,
  }: {
    authorization: Authorization;
    projectId: string;
    threadIds: string[];
    maxTraces?: number | undefined;
    retentionDays: RetentionDaysProvider | undefined;
  }): Promise<TraceLegacyRow[]> {
    return this.tracer.withActiveSpan(
      "TraceLegacyReadClickHouseRepository.getTracesWithSpansByThreadIds",
      {
        attributes: {
          "tenant.id": projectId,
          "thread.count": threadIds.length,
        },
      },
      async () => {
        refuseUngranted({ authorization, projectId });
        const reader = this.builtReader(projectId);

        if (threadIds.length === 0) {
          return [];
        }

        this.logger.debug(
          { projectId, threadIdCount: threadIds.length },
          "Fetching traces by thread IDs from ClickHouse",
        );

        try {
          // Query trace_summaries for traces with matching thread_ids
          // Thread ID can be stored under different attribute keys
          const result = await reader.read({
            statement: threadTraceIdsStatement({
              authorization,
              threads: threadIds,
              limit: maxTraces ?? DEFAULT_THREAD_TRACES_LIMIT,
            }),
            table: traceSummaries.$table.name,
          });

          const rows = traceIdRowsSchema.parse(result.rows);
          const traceIds = rows.map((r) => r.TraceId);

          if (traceIds.length === 0) {
            return [];
          }

          return await this.findTracesWithSpans({
            authorization,
            projectId,
            traceIds,
            retentionDays,
          });
        } catch (error) {
          if (HandledError.isHandled(error)) throw error;
          this.logger.warn(
            {
              projectId,
              threadIds,
              error: error instanceof Error ? error.message : error,
            },
            "Failed to fetch traces by thread IDs from ClickHouse",
          );
          throw new Error("Failed to fetch traces by thread IDs");
        }
      },
    );
  }

  private decodeScrollCursor({
    scrollId,
    sortDirection,
    pageSize,
    dateField,
  }: {
    scrollId: string | null | undefined;
    sortDirection: "asc" | "desc";
    pageSize: number;
    dateField: TraceDateField;
  }): ClickHouseScrollCursor | null {
    let cursor: ClickHouseScrollCursor | null = null;
    if (scrollId) {
      this.logger.debug({ scrollId: scrollId }, "Parsing scrollId from request");
      try {
        cursor = JSON.parse(Buffer.from(scrollId, "base64").toString("utf-8"));

        cursor = this.matchingScrollCursor({ cursor, sortDirection, pageSize, dateField });

        this.logger.debug(
          {
            cursorParsed: !!cursor,
            cursorLastTimestamp: cursor?.lastTimestamp,
            cursorLastTraceId: cursor?.lastTraceId,
            cursorSortDirection: cursor?.sortDirection,
            cursorPageSize: cursor?.pageSize,
          },
          "Cursor parsing and validation result",
        );
      } catch (e) {
        this.logger.warn(
          {
            scrollId,
            error: e instanceof Error ? e.message : e,
          },
          "Invalid scrollId, starting from beginning",
        );
      }
    } else {
      this.logger.debug("No scrollId provided in request");
    }
    return cursor;
  }

  /** Drops a cursor minted for another sort, page size or date axis, or carrying a bad snapshot. */
  private matchingScrollCursor({
    cursor,
    sortDirection,
    pageSize,
    dateField,
  }: {
    cursor: ClickHouseScrollCursor | null;
    sortDirection: "asc" | "desc";
    pageSize: number;
    dateField: TraceDateField;
  }): ClickHouseScrollCursor | null {
    if (!cursor) return null;
    if (cursor.sortDirection !== sortDirection) {
      this.logger.warn(
        {
          cursorSortDirection: cursor.sortDirection,
          requestSortDirection: sortDirection,
        },
        "Sort direction mismatch in cursor, ignoring cursor",
      );
      return null;
    }
    if (cursor.pageSize !== pageSize) {
      this.logger.warn(
        {
          cursorPageSize: cursor.pageSize,
          requestPageSize: pageSize,
        },
        "Page size mismatch in cursor, ignoring cursor",
      );
      return null;
    }
    if (cursor.scrollStart !== undefined) {
      const scrollStart = cursor.scrollStart;
      const hasInvalidType = typeof scrollStart !== "number";
      const hasInvalidInteger = !Number.isSafeInteger(scrollStart);
      const isNonPositive = scrollStart <= 0;
      if (hasInvalidType || hasInvalidInteger || isNonPositive) {
        // scrollStart binds as {scrollStart:UInt64}; a bad value would fail the query
        // outright instead of degrading, so drop the cursor like every other mismatch.
        // Safe INTEGER, not merely finite — UInt64 rejects 1.5 and 2**53 alike.
        this.logger.warn(
          { cursorScrollStart: scrollStart },
          "Invalid scrollStart in cursor, ignoring cursor",
        );
        return null;
      }
      return cursor;
    }
    if ((cursor.dateField ?? "occurred") !== dateField) {
      this.logger.warn(
        {
          cursorDateField: cursor.dateField ?? "occurred",
          requestDateField: dateField,
        },
        "Date axis mismatch in cursor, ignoring cursor",
      );
      return null;
    }
    return cursor;
  }

  private buildNextScrollId({
    last,
    traceCount,
    pageSize,
    sortDirection,
    dateField,
    scrollStart,
  }: {
    /** The page's last row: its sort timestamp on the paged axis and its trace id. */
    last: { timestamp: number; traceId: string } | null;
    traceCount: number;
    pageSize: number;
    sortDirection: "asc" | "desc";
    dateField: TraceDateField;
    scrollStart: number | undefined;
  }): string | undefined {
    if (!last || traceCount !== pageSize) return undefined;
    const newCursor: ClickHouseScrollCursor = {
      lastTimestamp: last.timestamp,
      lastTraceId: last.traceId,
      pageSize,
      sortDirection,
      dateField,
      // Carried forward unchanged: the snapshot must be the one the
      // scroll started from, not a fresh reading per page.
      ...(scrollStart !== undefined ? { scrollStart } : {}),
    };
    const newScrollId = Buffer.from(JSON.stringify(newCursor)).toString("base64");

    this.logger.debug(
      {
        lastTraceTimestamp: last.timestamp,
        lastTraceId: last.traceId,
        tracesCount: traceCount,
        pageSize,
        newScrollId,
      },
      "Generated new scrollId",
    );
    return newScrollId;
  }

  /** The page's evaluations, and the child collections its projection asked for. */
  private async readPageCollections({
    authorization,
    projectId,
    summaries,
    projection,
  }: {
    authorization: Authorization;
    projectId: string;
    summaries: TraceSummaryData[];
    projection: GetAllTracesForProjectOptions["projection"];
  }): Promise<Pick<TraceLegacyPage, "evaluations" | "events" | "annotations">> {
    if (summaries.length === 0) return { evaluations: [] };
    const traceIds = summaries.map((summary) => summary.traceId);
    const evaluations = await this.fetchEvaluationRows({ authorization, projectId, traceIds });
    // Scoped to this page, never table-wide.
    const events = projection?.needsEvents
      ? await this.findEventsForProjection({ authorization, projectId, summaries })
      : undefined;
    const annotations = projection?.needsAnnotations
      ? await this.findAnnotationsForProjection({ projectId, traceIds })
      : undefined;
    return { evaluations, events, annotations };
  }

  /** The page's spans, read only where the caller wants spans or full IO. */
  private async readRequestedSpans({
    authorization,
    summaries,
    projectId,
    wanted,
    retentionDays,
  }: {
    authorization: Authorization;
    summaries: TraceSummaryData[];
    projectId: string;
    wanted: boolean;
    retentionDays: RetentionDaysProvider | undefined;
  }): Promise<Map<string, TraceLegacyRow>> {
    if (!wanted || summaries.length === 0) return new Map();
    // The summaries carry their own timestamps, so the partition window costs nothing.
    const startedAts = summaries.map(traceStartedAt).filter((t) => t > 0);
    const occurredAt =
      startedAts.length > 0
        ? { from: Math.min(...startedAts), to: Math.max(...startedAts) }
        : undefined;
    return this.fetchTracesWithSpansJoined({
      authorization,
      projectId,
      traceIds: summaries.map((s) => s.traceId),
      occurredAt,
      retentionDays,
    });
  }

  async listAllTracesForProject({
    input,
    protections,
    options,
    retentionDays,
    ownRead,
  }: {
    input: GetAllTracesForProjectInput;
    protections: Protections;
    options: TraceLegacyListOptions;
    retentionDays: RetentionDaysProvider | undefined;
    ownRead: Authorization;
  }): Promise<TraceLegacyPage> {
    return this.tracer.withActiveSpan(
      "TraceLegacyReadClickHouseRepository.getAllTracesForProject",
      async (_span) => {
        this.reader({ authorization: ownRead, projectId: input.projectId });

        try {
          const pageSize = input.pageSize ?? 25;
          const sortDirection = (input.sortDirection as "asc" | "desc") ?? "desc";

          // Projection DSL plan (from/select). When absent, behavior is the
          // legacy full-trace response. When present, it drives heavy-column
          // pruning and which child collections are JOINed (events, annotations).
          const projection = options.projection;
          // Fetch each heavy Computed* column only when the legacy path runs
          // or the projection selects that io field — independently, so an
          // output-only select never materializes ComputedInput.
          const fetchInput = !projection || projection.needsInput;
          const fetchOutput = !projection || projection.needsOutput;

          // Time axis the date window + keyset cursor page on. Default "occurred"
          // keeps the legacy OccurredAt behavior; "updated" pages by last
          // mutation time for incremental ETL (CDC) pulls.
          const dateField: TraceDateField = options.dateField ?? "occurred";

          // Parse cursor from scrollId if present (matches ES service contract)
          const cursor = this.decodeScrollCursor({
            scrollId: options.scrollId,
            sortDirection,
            pageSize,
            dateField,
          });

          // The page reads under the own-read proof; the legacy filter map's terms bound their
          // stored_spans subqueries to the dashboard window, and the query-language filter is
          // compiled for that scope (Decided 25), both ANDed into the read.
          const scope = builtTenantScope.fromProof({ authorization: ownRead, reads: "traces" });
          const legacy = legacyTraceFilterTerms({
            filters: input.filters ?? {},
            window: { startDate: input.startDate, endDate: input.endDate },
            scope,
          });
          if (legacy.hasUnsupportedFilters) {
            throw new Error("Filters contain unsupported fields for ClickHouse");
          }
          const compiled = options.compileFilter?.({ scope });
          const terms = [
            ...legacy.terms,
            ...(compiled?.kind === "compiled" ? [compiled.where] : []),
          ];

          // Pinned once on the first page and carried by the cursor so every later page
          // resolves the same versions. Only the updated axis needs it — OccurredAt is immutable.
          // A cursor minted before this field existed carries no snapshot; leave that
          // scroll uncapped rather than pinning it to a point it never read from.
          const { scrollStart, effectiveEndDate } = resolveScrollWindow({
            dateField,
            cursor,
            endDate: input.endDate,
          });

          // Build the query with keyset pagination
          const { summaries, totalHits } = await this.fetchTracesWithPagination({
            projectId: input.projectId,
            scope,
            pageSize,
            sortDirection,
            cursor,
            protections,
            startDate: input.startDate,
            endDate: effectiveEndDate,
            terms,
            traceIds: input.traceIds,
            query: input.query,
            fetchInput,
            fetchOutput,
            dateField,
            scrollStart,
          });
          const spans = await this.readRequestedSpans({
            authorization: ownRead,
            summaries,
            projectId: input.projectId,
            wanted: options.includeSpans === true || options.resolveBlobs === true,
            retentionDays,
          });

          const last = summaries.at(-1);
          // The cursor seeks on the axis paged by and records it, so the next page rejects
          // a cursor from a different axis.
          const newScrollId = this.buildNextScrollId({
            last: last ? sortKeyOf({ last, dateField }) : null,
            traceCount: summaries.length,
            pageSize,
            sortDirection,
            dateField,
            scrollStart,
          });
          const { evaluations, events, annotations } = await this.readPageCollections({
            authorization: ownRead,
            projectId: input.projectId,
            summaries,
            projection,
          });

          return {
            summaries,
            spans,
            evaluations,
            events,
            annotations,
            totalHits,
            scrollId: newScrollId,
            ...(effectiveEndDate !== undefined && scrollStart !== undefined
              ? { updatedThrough: effectiveEndDate }
              : {}),
          };
        } catch (error) {
          this.logger.warn(
            listFailureLogFields({ projectId: input.projectId, error }),
            "Failed to fetch all traces from ClickHouse",
          );
          throw error;
        }
      },
    );
  }

  /**
   * The list read's keyset page as bare summaries, for a system reader: the id statement and
   * the summary rows with content pruned, oldest first; no count, evaluations or protections.
   */
  async findTraceSummaries(
    input: TraceSummaryListQuery,
    options: TraceLegacySummaryListOptions = {},
  ): Promise<TraceSummaryPage> {
    return this.tracer.withActiveSpan(
      "TraceLegacyReadClickHouseRepository.findTraceSummaries",
      { attributes: { "tenant.id": input.projectId } },
      async () => {
        const pageSize = input.pageSize ?? 25;
        const sortDirection = "asc";
        const dateField: TraceDateField = options.dateField ?? "occurred";
        const cursor = this.decodeScrollCursor({
          scrollId: options.scrollId,
          sortDirection,
          pageSize,
          dateField,
        });
        const { scrollStart, effectiveEndDate } = resolveScrollWindow({
          dateField,
          cursor,
          endDate: input.endDate,
        });
        const scope = builtTenantScope.single({ tenantId: input.projectId });
        const compiled = options.compileFilter?.({ scope });
        const page: PageFilter<typeof scope> = {
          scope,
          startDate: input.startDate ?? 0,
          endDate: effectiveEndDate ?? nowInstant().epochMilliseconds,
          terms: compiled?.kind === "compiled" ? [compiled.where] : [],
          traceIds: undefined,
          search: undefined,
          scrollStart,
          dateField,
        };
        const idResult = await this.builtReader(input.projectId).read({
          statement: pageIdStatement({ page, cursor, sortDirection, pageSize }),
          table: traceSummaries.$table.name,
        });
        const traceIds = traceIdRowsSchema.parse(idResult.rows).map((row) => row.TraceId);
        const rows =
          traceIds.length === 0
            ? []
            : await this.fetchTraceSummaryRows({
                scope,
                projectId: input.projectId,
                startDate: page.startDate,
                endDate: page.endDate,
                traceIds,
                sortDirection,
                fetchInput: false,
                fetchOutput: false,
                dateColumn: dateField === "updated" ? "UpdatedAt" : "OccurredAt",
                scrollStart,
              });
        const summaries = rows.map((row) => this.rowToTraceSummaryData(row));
        const last = summaries.at(-1);
        const scrollId = this.buildNextScrollId({
          last: last ? summarySortKey({ last, dateField }) : null,
          traceCount: summaries.length,
          pageSize,
          sortDirection,
          dateField,
          scrollStart,
        });
        return {
          summaries,
          ...(scrollId ? { scrollId } : {}),
          ...(effectiveEndDate !== undefined && scrollStart !== undefined
            ? { updatedThrough: effectiveEndDate }
            : {}),
        };
      },
    );
  }

  /**
   * Get topic and subtopic counts for a project.
   * @param input - Filter parameters including projectId and date range
   * @returns TopicCountsResult
   */
  async findTopicCounts(input: AggregationFiltersInput): Promise<TopicCountsResult> {
    return this.tracer.withActiveSpan(
      "TraceLegacyReadClickHouseRepository.getTopicCounts",
      { attributes: { "tenant.id": input.projectId } },
      async () => {
        const reader = this.builtReader(input.projectId);

        try {
          const result = await reader.read({
            statement: topicCountsStatement(input),
            table: traceSummaries.$table.name,
          });

          const rows = topicCountRowsSchema.parse(result.rows);

          return aggregateTopicCounts(rows);
        } catch (error) {
          if (HandledError.isHandled(error)) throw error;
          this.logger.warn(
            {
              projectId: input.projectId,
              error: error instanceof Error ? error.message : error,
            },
            "Failed to fetch topic counts from ClickHouse",
          );
          throw new Error("Failed to fetch topic counts");
        }
      },
    );
  }

  /**
   * Get unique customers and labels for a project.
   * @param input - Filter parameters including projectId and date range
   * @returns CustomersAndLabelsResult
   */
  async findCustomersAndLabels(input: AggregationFiltersInput): Promise<CustomersAndLabelsResult> {
    return this.tracer.withActiveSpan(
      "TraceLegacyReadClickHouseRepository.getCustomersAndLabels",
      { attributes: { "tenant.id": input.projectId } },
      async () => {
        const reader = this.builtReader(input.projectId);

        try {
          const customerResult = await reader.read({
            statement: distinctAttributeStatement({
              window: input,
              attribute: "langwatch.customer_id",
              alias: "customer_id",
            }),
            table: traceSummaries.$table.name,
          });

          const customerRows = customerRowsSchema.parse(customerResult.rows);

          // Labels are stored as JSON array in langwatch.labels attribute
          const labelsResult = await reader.read({
            statement: distinctAttributeStatement({
              window: input,
              attribute: "langwatch.labels",
              alias: "labels_json",
            }),
            table: traceSummaries.$table.name,
          });

          const labelsRows = labelsRowsSchema.parse(labelsResult.rows);

          // Parse labels from JSON arrays
          const labelsSet = new Set<string>();
          for (const row of labelsRows) {
            addLabelsFromRow(row.labels_json, labelsSet);
          }

          return {
            customers: customerRows.map((r) => r.customer_id),
            labels: Array.from(labelsSet),
          };
        } catch (error) {
          if (HandledError.isHandled(error)) throw error;
          this.logger.warn(
            {
              projectId: input.projectId,
              error: error instanceof Error ? error.message : error,
            },
            "Failed to fetch customers and labels from ClickHouse",
          );
          throw new Error("Failed to fetch customers and labels");
        }
      },
    );
  }

  async findSpanForPromptStudio({
    projectId,
    spanId,
  }: {
    projectId: string;
    spanId: string;
    protections: Protections;
  }): Promise<PromptStudioSpanResult | null> {
    return this.tracer.withActiveSpan(
      "TraceLegacyReadClickHouseRepository.findSpanForPromptStudio",
      { attributes: { "tenant.id": projectId, "span.id": spanId } },
      async () => {
        const reader = this.builtReader(projectId);

        try {
          // Every span of the trace in one read: the LLM data and the ancestors' prompt reference.
          const queryResult = await reader.read({
            statement: promptStudioSpansStatement({ projectId, spanId }),
            table: storedSpans.$table.name,
          });

          const rows = promptStudioSpanRowsSchema.parse(queryResult.rows);
          return derivePromptStudioSpan({ rows, spanId }) ?? null;
        } catch (error) {
          if (HandledError.isHandled(error)) throw error;
          this.logger.warn(
            {
              projectId,
              spanId,
              error: error instanceof Error ? error.message : error,
            },
            "Failed to fetch span for prompt studio from ClickHouse",
          );
          throw new Error("Failed to fetch span for prompt studio");
        }
      },
    );
  }

  /**
   * Get distinct span names and metadata keys for a project.
   *
   * @throws ClickHouseClientUnavailableError when no ClickHouse client resolves
   */
  async findDistinctFieldNames(
    projectId: string,
    startDate: number,
    endDate: number,
  ): Promise<DistinctFieldNamesResult> {
    return this.tracer.withActiveSpan(
      "TraceLegacyReadClickHouseRepository.getDistinctFieldNames",
      { attributes: { "tenant.id": projectId } },
      async () => {
        const reader = this.builtReader(projectId);
        const window = { projectId, startDate, endDate };

        try {
          const spanResult = await reader.read({
            statement: spanNamesStatement(window),
            table: storedSpans.$table.name,
          });
          const spanRows = spanNameRowsSchema.parse(spanResult.rows);
          const spanNames = spanRows.map((row) => ({ key: row.SpanName, label: row.SpanName }));

          const metaResult = await reader.read({
            statement: metadataKeysStatement(window),
            table: traceSummaries.$table.name,
          });
          const metaRows = metadataKeyRowsSchema.parse(metaResult.rows);
          const metadataKeys = metaRows.map((row) => ({ key: row.key, label: row.key }));

          // Deduped by evaluator id (a renamed evaluator keeps its id), latest name kept.
          const evalResult = await reader.read({
            statement: evaluatorNamesStatement(window),
            table: evaluationRuns.$table.name,
          });
          const evalRows = evaluatorNameRowsSchema.parse(evalResult.rows);

          const evaluationNames = evalRows.map((row) => ({
            key: row.id,
            label: row.name ?? row.id,
          }));

          return { spanNames, metadataKeys, evaluationNames };
        } catch (error) {
          if (HandledError.isHandled(error)) throw error;
          this.logger.warn(
            {
              projectId,
              error: error instanceof Error ? error.message : error,
            },
            "Failed to fetch distinct field names from ClickHouse",
          );
          throw new Error("Failed to fetch distinct field names");
        }
      },
    );
  }

  /**
   * Fetch traces with keyset pagination.
   * @internal
   */
  private async fetchTracesWithPagination<S extends ReaderScope>({
    projectId,
    scope,
    pageSize,
    sortDirection,
    cursor,
    protections,
    startDate,
    endDate,
    terms,
    traceIds,
    query,
    fetchInput = true,
    fetchOutput = true,
    dateField = "occurred",
    scrollStart,
  }: {
    projectId: string;
    /** The scope the page reads, and its filter compiled, under. */
    scope: S;
    pageSize: number;
    sortDirection: "asc" | "desc";
    cursor: ClickHouseScrollCursor | null;
    protections: Protections;
    startDate?: number;
    endDate?: number;
    terms: readonly TraceFilterCondition[];
    traceIds?: string[];
    query?: string;
    /** Fetch the heavy ComputedInput column. False prunes it. */
    fetchInput?: boolean;
    /** Fetch the heavy ComputedOutput column. False prunes it. */
    fetchOutput?: boolean;
    /** Time axis for the date window + keyset cursor. Default "occurred". */
    dateField?: TraceDateField;
    /** Updated-axis snapshot point (epoch ms): every page of one scroll sees the same versions. */
    scrollStart?: number;
  }): Promise<{ summaries: TraceSummaryData[]; totalHits: number }> {
    return this.tracer.withActiveSpan(
      "TraceLegacyReadClickHouseRepository.fetchTracesWithPagination",
      { attributes: { "tenant.id": projectId } },
      async () => {
        // lower(ifNull(...)) matches the ngrambf_v1 indexed expression.
        const effectiveQuery = query && query.length >= 3 ? query : undefined;
        // If the user can't see input/output, searching their content is not allowed
        if (
          effectiveQuery &&
          protections.canSeeCapturedInput === false &&
          protections.canSeeCapturedOutput === false
        ) {
          return { summaries: [], totalHits: 0 };
        }
        const page: PageFilter<S> = {
          scope,
          startDate: startDate ?? 0,
          endDate: endDate ?? nowInstant().epochMilliseconds,
          terms,
          traceIds,
          search: effectiveQuery
            ? {
                pattern: `%${effectiveQuery.replace(/[%_\\]/g, "\\$&").toLowerCase()}%`,
                protections,
              }
            : undefined,
          scrollStart,
          dateField,
        };
        const reader = this.builtReader(projectId);
        const [countResult, idsResult] = await Promise.all([
          reader.read({ statement: pageCountStatement(page), table: traceSummaries.$table.name }),
          reader.read({
            statement: pageIdStatement({ page, cursor, sortDirection, pageSize }),
            table: traceSummaries.$table.name,
          }),
        ]);
        const totalHits = Number.parseInt(
          totalRowsSchema.parse(countResult.rows)[0]?.total ?? "0",
          10,
        );
        const pageTraceIds = traceIdRowsSchema.parse(idsResult.rows).map((r) => r.TraceId);
        if (pageTraceIds.length === 0) return { summaries: [], totalHits };

        // Step 2: the page's own traces' full rows, the election scoped to those ids.
        const summaryRows = await this.fetchTraceSummaryRows({
          scope,
          projectId,
          startDate: page.startDate,
          endDate: page.endDate,
          traceIds: pageTraceIds,
          sortDirection,
          fetchInput,
          fetchOutput,
          dateColumn: dateField === "updated" ? "UpdatedAt" : "OccurredAt",
          scrollStart,
        });
        return {
          summaries: summaryRows.map((row) => this.rowToTraceSummaryData(row)),
          totalHits,
        };
      },
    );
  }

  private static readonly SUMMARY_BATCH_SIZE = 25;

  /**
   * On ClickHouse MEMORY_LIMIT_EXCEEDED, retries in smaller batches so heavy
   * ComputedInput/ComputedOutput columns don't blow the per-query memory cap.
   */
  private async fetchTraceSummaryRows<S extends ReaderScope>({
    scope,
    projectId,
    startDate,
    endDate,
    traceIds,
    sortDirection,
    fetchInput = true,
    fetchOutput = true,
    dateColumn = "OccurredAt",
    scrollStart,
  }: {
    scope: S;
    projectId: string;
    startDate: number;
    endDate: number;
    traceIds: string[];
    sortDirection: "asc" | "desc";
    /** Fetch the heavy Computed* columns independently. False reads '' for that column. */
    fetchInput?: boolean;
    fetchOutput?: boolean;
    /** Column the date window + ORDER BY run on (must match the page-ID query). */
    dateColumn?: "OccurredAt" | "UpdatedAt";
    /** Updated-axis snapshot point (epoch ms), the id read's, so both elect the same version. */
    scrollStart?: number;
  }): Promise<TraceSummaryRow[]> {
    const runQuery = async (ids: string[]) => {
      const result = await this.builtReader(projectId).read({
        statement: pageSummariesStatement({
          scope,
          traceIds: ids,
          startDate,
          endDate,
          dateColumn,
          scrollStart,
          sortDirection,
          fetchInput,
          fetchOutput,
        }),
        table: traceSummaries.$table.name,
      });
      return traceSummaryRowsSchema.parse(result.rows).map((row) => ({
        ...row,
        ts_ComputedInput: fetchInput ? row.ts_ComputedInput : "",
        ts_ComputedOutput: fetchOutput ? row.ts_ComputedOutput : "",
      }));
    };

    try {
      return await runQuery(traceIds);
    } catch (error) {
      if (!TraceLegacyReadClickHouseRepository.isClickHouseMemoryLimitError(error)) {
        throw error;
      }
      return this.fetchTraceSummaryRowsInBatches({
        traceIds,
        orderDirection: sortDirection === "desc" ? "DESC" : "ASC",
        sortColumn: dateColumn === "UpdatedAt" ? "ts_UpdatedAt" : "ts_OccurredAt",
        runQuery,
      });
    }
  }

  private async fetchTraceSummaryRowsInBatches({
    traceIds,
    orderDirection,
    sortColumn,
    runQuery,
  }: {
    traceIds: string[];
    orderDirection: string;
    sortColumn: "ts_UpdatedAt" | "ts_OccurredAt";
    runQuery: (traceIds: string[]) => Promise<TraceSummaryRow[]>;
  }): Promise<TraceSummaryRow[]> {
    this.logger.warn(
      `Summary query OOM for ${traceIds.length} traces, retrying in batches of ${TraceLegacyReadClickHouseRepository.SUMMARY_BATCH_SIZE}`,
    );

    const allRows: TraceSummaryRow[] = [];
    for (
      let i = 0;
      i < traceIds.length;
      i += TraceLegacyReadClickHouseRepository.SUMMARY_BATCH_SIZE
    ) {
      const batch = traceIds.slice(i, i + TraceLegacyReadClickHouseRepository.SUMMARY_BATCH_SIZE);
      const batchRows = await runQuery(batch);
      allRows.push(...batchRows);
    }

    const dir = orderDirection === "DESC" ? -1 : 1;
    allRows.sort((a, b) => {
      const timeDiff = a[sortColumn] - b[sortColumn];
      if (timeDiff !== 0) return timeDiff * dir;
      if (a.ts_TraceId === b.ts_TraceId) return 0;
      return a.ts_TraceId < b.ts_TraceId ? -dir : dir;
    });

    return allRows;
  }

  /**
   * Projection JOIN: attach events to a page of traces.
   */
  private async findEventsForProjection({
    authorization,
    projectId,
    summaries,
  }: {
    authorization: Authorization;
    projectId: string;
    summaries: TraceSummaryData[];
  }): Promise<Map<string, Event[]>> {
    const traceIds = summaries.map((s) => s.traceId);
    if (traceIds.length === 0) return new Map();

    // Occurrence anchor per trace: started_at, falling back to updated_at for
    // legacy/corrupt rows missing it — the scan must NEVER run time-unbounded
    // (that is the exact blowup the windowing prevents). Traces with no usable
    // timestamp at all get an empty events[] rather than an unbounded scan.
    const occurredAts = summaries.map((s) => traceStartedAt(s) || s.updatedAt).filter((t) => t > 0);
    if (occurredAts.length === 0) {
      this.logger.warn(
        { projectId, traceCount: summaries.length },
        "No usable timestamps on page traces; skipping events projection rather than scanning unbounded",
      );
      return new Map();
    }
    // Cluster the occurrence times so the stored_spans scan is bounded to the
    // partitions the page's traces ACTUALLY occurred in. The updated axis can
    // put traces months apart on one page; a single min/max window would span
    // every weekly partition between them — so OR per-cluster windows instead,
    // each tight, with no single range crossing unrelated history.
    const result = await this.builtReader(projectId).read({
      statement: eventSpansStatement({
        authorization,
        traceIds,
        windows: eventOccurrenceWindows(occurredAts),
        maxEvents: MAX_EVENTS_PER_TRACE,
      }),
      table: storedSpans.$table.name,
    });

    const rows = eventSpanRowsSchema.parse(result.rows);
    const byTrace = new Map<string, Event[]>();
    for (const row of rows) {
      const event = mapEventAttrsToEvent({ row, projectId });
      if (!event) continue;
      const list = byTrace.get(row.TraceId) ?? [];
      list.push(event);
      byTrace.set(row.TraceId, list);
    }
    // The `LIMIT {maxEvents} BY t.TraceId` cap silently clips a trace's events.
    // Surface it (same posture as the span-cap) so callers know the projected
    // events[] is truncated rather than silently incomplete.
    const truncated = [...byTrace.entries()]
      .filter(([, events]) => events.length >= MAX_EVENTS_PER_TRACE)
      .map(([traceId]) => traceId);
    if (truncated.length > 0) {
      this.logger.warn(
        { projectId, maxEvents: MAX_EVENTS_PER_TRACE, traceIds: truncated },
        `Projected events[] hit the per-trace cap (${MAX_EVENTS_PER_TRACE}); some events were not returned`,
      );
    }
    return byTrace;
  }

  /** Projection JOIN: a page's annotations by trace id. */
  private async findAnnotationsForProjection({
    projectId,
    traceIds,
  }: {
    projectId: string;
    traceIds: string[];
  }): Promise<Map<string, ProjectedAnnotation[]>> {
    if (traceIds.length === 0) return new Map();

    // scoreOptions is keyed by AnnotationScore id, but the public contract is
    // name-addressable (annotations.scores.<name>), so fetch the score
    // definitions to remap id -> name. Deleted definitions are included so
    // historical scoreOptions still resolve.
    if (!this.annotations) {
      throw new Error("Annotation's shared reads are required for trace annotation projection");
    }
    const [rows, scoreDefs] = await Promise.all([
      this.annotations.rows.findForTraces({ projectId, traceIds }),
      this.annotations.scores.findScoreNames({ projectId }),
    ]);
    const scoreNameById = new Map(scoreDefs.map((s) => [s.id, s.name]));

    const byTrace = new Map<string, ProjectedAnnotation[]>();
    for (const row of rows) {
      const list = byTrace.get(row.traceId) ?? [];
      const suggestion = annotationSuggestedOutput({ annotation: row, traceId: row.traceId });
      list.push({
        id: row.id,
        is_thumbs_up: row.isThumbsUp ?? null,
        comment: row.comment ?? null,
        expected_output: suggestion.suggested ? suggestion.output : null,
        scores: TraceLegacyReadClickHouseRepository.remapScoreOptionsToNames(
          row.scoreOptions,
          scoreNameById,
        ),
        created_at: row.createdAt.getTime(),
      });
      byTrace.set(row.traceId, list);
    }
    return byTrace;
  }

  /**
   * Fetch evaluation rows for a set of trace IDs.
   * Same OOM-resilient pattern as fetchTraceSummaryRows.
   */
  private async fetchEvaluationRows({
    authorization,
    projectId,
    traceIds,
  }: {
    authorization: Authorization;
    projectId: string;
    traceIds: string[];
  }): Promise<ClickHouseEvaluationRunRow[]> {
    const reader = this.builtReader(projectId);
    const runQuery = async (ids: string[]) => {
      // ID_BOUND_SKIP: evaluation's index, registered by evaluation; moves there with trace-review.
      const result = await reader.read({
        statement: evaluationRowsStatement({ authorization, traceIds: ids }),
        table: evaluationRuns.$table.name,
        // As on main: a trace's evaluations by id, kept unbounded so none is dropped.
        declaresFullScan: true,
      });
      return evaluationRunRowsSchema.parse(result.rows);
    };

    try {
      return await runQuery(traceIds);
    } catch (error) {
      if (!TraceLegacyReadClickHouseRepository.isClickHouseMemoryLimitError(error)) {
        throw error;
      }

      this.logger.warn(
        `Evaluations query OOM for ${traceIds.length} traces, retrying in batches of ${TraceLegacyReadClickHouseRepository.SUMMARY_BATCH_SIZE}`,
      );

      const allRows: ClickHouseEvaluationRunRow[] = [];
      for (
        let i = 0;
        i < traceIds.length;
        i += TraceLegacyReadClickHouseRepository.SUMMARY_BATCH_SIZE
      ) {
        const batch = traceIds.slice(i, i + TraceLegacyReadClickHouseRepository.SUMMARY_BATCH_SIZE);
        const batchRows = await runQuery(batch);
        allRows.push(...batchRows);
      }

      return allRows;
    }
  }

  /**
   * Convert a summary row to TraceSummaryData.
   * @internal
   */
  private rowToTraceSummaryData(row: TraceSummaryRow): TraceSummaryData {
    return {
      traceId: row.ts_TraceId,
      spanCount: row.ts_SpanCount,
      totalDurationMs: row.ts_TotalDurationMs,
      computedIOSchemaVersion: row.ts_ComputedIOSchemaVersion,
      computedInput: row.ts_ComputedInput ?? null,
      computedOutput: row.ts_ComputedOutput ?? null,
      timeToFirstTokenMs: row.ts_TimeToFirstTokenMs,
      timeToLastTokenMs: row.ts_TimeToLastTokenMs,
      tokensPerSecond: row.ts_TokensPerSecond,
      containsErrorStatus: row.ts_ContainsErrorStatus,
      containsOKStatus: row.ts_ContainsOKStatus,
      errorMessage: row.ts_ErrorMessage,
      models: row.ts_Models,
      totalCost: row.ts_TotalCost,
      nonBilledCost: row.ts_NonBilledCost ?? null,
      tokensEstimated: row.ts_TokensEstimated,
      totalPromptTokenCount: row.ts_TotalPromptTokenCount,
      totalCompletionTokenCount: row.ts_TotalCompletionTokenCount,
      outputFromRootSpan: row.ts_OutputFromRootSpan ?? false,
      outputSpanEndTimeMs: row.ts_OutputSpanEndTimeMs ?? 0,
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
      topicId: row.ts_TopicId,
      subTopicId: row.ts_SubTopicId,
      annotationIds: row.ts_AnnotationIds ?? [],
      traceName: row.ts_TraceName ?? "",
      attributes: row.ts_Attributes,
      LastEventOccurredAt: 0,
      ...traceSummaryTimesFromRow(row),
      createdAt: row.ts_CreatedAt,
      updatedAt: row.ts_UpdatedAt,
    };
  }

  /**
   * Resolve the OccurredAt span of a set of traces from a cheap sort-key seek.
   * Pre-anchor sentinel rows (`OccurredAt = 0`, ADR-087) are excluded in SQL
   * @internal
   */
  private async resolveOccurredAtRange({
    authorization,
    projectId,
    traceIds,
  }: {
    authorization: Authorization;
    projectId: string;
    traceIds: string[];
  }): Promise<OccurredAtRange | undefined> {
    if (traceIds.length === 0) {
      return undefined;
    }
    const result = await this.builtReader(projectId).read({
      statement: occurredAtRangeStatement({ authorization, traceIds }),
      table: traceSummaries.$table.name,
      // A trace the index has never seen is resolved over every partition, as before the index.
      // No match answers no row (`HAVING`), so emptiness, the fallback and the miss count hold.
      idBound: { onMiss: "unbounded" },
    });
    const rows = occurredAtRangeRowsSchema.parse(result.rows);
    const row = rows[0];
    if (!row || !(Number(row.fromMs) > 0) || !(Number(row.toMs) > 0)) {
      return undefined;
    }
    return { from: Number(row.fromMs), to: Number(row.toMs) };
  }

  /**
   * Fetch trace summaries with their spans using a JOIN query. This is more
   * efficient than two separate queries.
   * @internal
   */
  private async fetchTracesWithSpansJoined({
    authorization,
    projectId,
    traceIds,
    occurredAt,
    retentionDays,
  }: {
    authorization: Authorization;
    projectId: string;
    traceIds: string[];
    occurredAt: OccurredAtRange | undefined;
    retentionDays: RetentionDaysProvider | undefined;
  }): Promise<Map<string, TraceLegacyRow>> {
    return this.tracer.withActiveSpan(
      "TraceLegacyReadClickHouseRepository.fetchTracesWithSpansJoined",
      {
        attributes: { "tenant.id": projectId },
      },
      async (_span) => {
        const resolved = occurredAt
          ? { range: occurredAt, unfiled: false }
          : await this.resolveOccurredAtOrNone({ authorization, projectId, traceIds });
        const batchRead = {
          authorization,
          projectId,
          effectiveOccurredAt: resolved.range,
          unfiled: resolved.unfiled,
          retentionDays,
        };

        try {
          return await this.readJoinedTraceBatch({ ...batchRead, batchTraceIds: traceIds });
        } catch (error) {
          if (!TraceLegacyReadClickHouseRepository.isClickHouseMemoryLimitError(error)) {
            throw error;
          }
          return this.readJoinedTracesInBatches({ ...batchRead, traceIds });
        }
      },
    );
  }

  private async resolveOccurredAtOrNone({
    authorization,
    projectId,
    traceIds,
  }: {
    authorization: Authorization;
    projectId: string;
    traceIds: string[];
  }): Promise<{ range: OccurredAtRange | undefined; unfiled: boolean }> {
    // Callers that already know the traces' time pass `occurredAt`; thread-view paths only
    // have trace ids. Without a window the summary read below filters on TraceId alone, which
    // cannot prune partitions, so resolve the OccurredAt span from a cheap sort-key seek first.
    // A resolve that answers no filed summary leaves only epoch sentinel rows to find (ADR-087):
    // `unfiled` bounds the summary read to that one partition instead of every partition.
    const resolved = this.resolveOccurredAtRange({ authorization, projectId, traceIds }).then(
      (range) => ({
        range,
        unfiled: range === undefined,
      }),
    );
    return resolved.catch((error) => {
      // Fail open: the resolve is a pure optimization, so a transient
      // failure must not break a read that previously succeeded. Fall
      // back to the unbounded (slower but correct) summary read.
      this.logger.warn(
        {
          projectId,
          error: error instanceof Error ? error.message : error,
        },
        "OccurredAt resolve for batch trace read failed; falling back to unbounded summary read",
      );
      return { range: undefined, unfiled: false };
    });
  }

  /**
   * On OOM, re-reads in fixed-size batches under a span budget; see
   * {@link MAX_SPANS_PER_JOINED_FALLBACK}.
   */
  private async readJoinedTracesInBatches({
    authorization,
    projectId,
    effectiveOccurredAt,
    unfiled,
    retentionDays,
    traceIds,
  }: {
    authorization: Authorization;
    projectId: string;
    effectiveOccurredAt: OccurredAtRange | undefined;
    unfiled: boolean;
    retentionDays: RetentionDaysProvider | undefined;
    traceIds: string[];
  }): Promise<Map<string, TraceLegacyRow>> {
    const batchRead = { authorization, projectId, effectiveOccurredAt, unfiled, retentionDays };

    this.logger.warn(
      `Traces-with-spans join OOM for ${traceIds.length} traces, retrying in batches of ${TraceLegacyReadClickHouseRepository.SUMMARY_BATCH_SIZE}`,
    );

    const merged = new Map<string, TraceLegacyRow>();
    let mergedSpanCount = 0;
    for (
      let i = 0;
      i < traceIds.length;
      i += TraceLegacyReadClickHouseRepository.SUMMARY_BATCH_SIZE
    ) {
      const batch = traceIds.slice(i, i + TraceLegacyReadClickHouseRepository.SUMMARY_BATCH_SIZE);

      // Batching caps ClickHouse's peak memory, not ours — the merge rebuilds the whole
      // result here. The budget goes into the read so an over-budget batch is refused by
      // ClickHouse instead of arriving in this process first. See
      // {@link MAX_SPANS_PER_JOINED_FALLBACK}.
      const remainingSpanBudget = MAX_SPANS_PER_JOINED_FALLBACK - mergedSpanCount;
      let batchMap: Map<string, TraceLegacyRow>;
      try {
        batchMap = await this.readJoinedTraceBatch({
          ...batchRead,
          batchTraceIds: batch,
          maxSpanRows: remainingSpanBudget,
        });
      } catch (batchError) {
        if (!TraceLegacyReadClickHouseRepository.isClickHouseResultOverflowError(batchError))
          throw batchError;
        throw new Error(
          `Traces-with-spans join fallback exceeded ${MAX_SPANS_PER_JOINED_FALLBACK} spans ` +
            `(${mergedSpanCount} already merged across ${merged.size} of ${traceIds.length} traces, ` +
            `and the next batch of ${batch.length} overran the remaining ${remainingSpanBudget}); ` +
            `refusing to materialise the rest`,
          { cause: batchError },
        );
      }

      for (const [traceId, value] of batchMap) {
        merged.set(traceId, value);
        mergedSpanCount += value.spans.length;
      }

      // Belt to the query's braces: the read is bounded per batch, so
      // this only trips if a batch landed exactly on its budget and the
      // total still cleared the cap.
      if (mergedSpanCount > MAX_SPANS_PER_JOINED_FALLBACK) {
        throw new Error(
          `Traces-with-spans join fallback exceeded ${MAX_SPANS_PER_JOINED_FALLBACK} spans ` +
            `(${mergedSpanCount} across ${merged.size} of ${traceIds.length} traces); ` +
            `refusing to materialise the rest`,
        );
      }
    }
    return merged;
  }

  private async readJoinedTraceBatch({
    authorization,
    projectId,
    effectiveOccurredAt,
    unfiled,
    retentionDays,
    batchTraceIds,
    maxSpanRows,
  }: {
    authorization: Authorization;
    projectId: string;
    effectiveOccurredAt: OccurredAtRange | undefined;
    /** No summary of these traces is filed after the epoch, per the resolve. */
    unfiled: boolean;
    retentionDays: RetentionDaysProvider | undefined;
    batchTraceIds: string[];
    /** Rows the span read may return before ClickHouse refuses it. */
    maxSpanRows?: number;
  }): Promise<Map<string, TraceLegacyRow>> {
    const { summaryRows, hasSummaryWindow } = await this.readJoinedSummaryRows({
      authorization,
      projectId,
      effectiveOccurredAt,
      unfiled,
      batchTraceIds,
    });
    // No matched summaries: the result map is built solely from summary
    // rows, so the spans would be discarded anyway. Return early to skip the
    // (otherwise unbounded) stored_spans scan — the very cold scan this path
    // is meant to avoid.
    if (summaryRows.length === 0) {
      return new Map();
    }

    const spanRows = await this.readJoinedSpanRows({
      authorization,
      projectId,
      batchTraceIds,
      spanRange: deriveSpanRange({ summaryRows, hasSummaryWindow, effectiveOccurredAt }),
      maxSpanRows,
      retentionDays,
    });

    // Group spans by TraceId
    const spansByTrace = new Map<string, NormalizedSpan[]>();
    for (const row of spanRows) {
      const spans = spansByTrace.get(row.TraceId) ?? [];
      spans.push(this.mapSpanRow(row, projectId));
      spansByTrace.set(row.TraceId, spans);
    }

    // Surface (rather than silently swallow) traces large enough to hit the
    // per-trace span cap — their span list may be truncated.
    for (const [traceId, spans] of spansByTrace) {
      if (spans.length >= MAX_SPANS_PER_TRACE) {
        this.logger.warn(
          {
            projectId,
            traceId,
            spanCount: spans.length,
            cap: MAX_SPANS_PER_TRACE,
          },
          "Trace reached the per-trace span cap; span list may be truncated",
        );
      }
    }

    // Build the tracesMap by combining summaries + spans
    const tracesMap = new Map<string, TraceLegacyRow>();

    for (const row of summaryRows) {
      const traceId = row.ts_TraceId;
      const summary = this.rowToTraceSummaryData(row);
      tracesMap.set(traceId, {
        summary,
        spans: spansByTrace.get(traceId) ?? [],
      });
    }

    return tracesMap;
  }

  private async readJoinedSummaryRows({
    authorization,
    projectId,
    effectiveOccurredAt,
    unfiled,
    batchTraceIds,
  }: {
    authorization: Authorization;
    projectId: string;
    effectiveOccurredAt: OccurredAtRange | undefined;
    unfiled: boolean;
    batchTraceIds: string[];
  }): Promise<{ summaryRows: TraceSummaryRow[]; hasSummaryWindow: boolean }> {
    // When the caller knows the traces' approximate time, bound the summary read to those
    // weekly partitions with a ±2-day safety margin; an unfiled batch reads the epoch sentinel
    // partition alone; with neither, keep the unbounded read. Fallback "none": an empty result
    // is authoritative here, and the caller below skips the span scan rather than widening it.
    const hasSummaryWindow =
      effectiveOccurredAt !== undefined &&
      effectiveOccurredAt.from > 0 &&
      effectiveOccurredAt.to > 0;
    const { hintMs: summaryHintMs, windowMs: summaryWindowMs } = summaryReadWindow({
      filed: hasSummaryWindow ? effectiveOccurredAt : undefined,
      unfiled,
    });

    // Summaries first (light, one row per trace): they carry OccurredAt, which bounds the
    // heavy stored_spans scan below to the traces' weekly partitions. A span's StartTime
    // always falls within its trace's lifetime, so a ±2-day window is safe headroom; when
    // no summary row is found we fall back to an unbounded span scan.
    const summaryRows = await queryWindowed<TraceSummaryRow[]>({
      table: "trace_summaries",
      hintMs: summaryHintMs,
      windowMs: summaryWindowMs,
      fallback: "none",
      isEmpty: (rows) => rows.length === 0,
      run: async (window) => {
        // ID_BOUND_SKIP: bounded by the occurred range the index-bounded resolver found.
        const summaryResult = await this.builtReader(projectId).read({
          statement: joinedSummariesStatement({ authorization, traceIds: batchTraceIds, window }),
          table: traceSummaries.$table.name,
        });
        return traceSummaryRowsSchema.parse(summaryResult.rows);
      },
    });
    return { summaryRows, hasSummaryWindow };
  }

  private async readJoinedSpanRows({
    authorization,
    projectId,
    batchTraceIds,
    spanRange,
    maxSpanRows,
    retentionDays,
  }: {
    authorization: Authorization;
    projectId: string;
    retentionDays: RetentionDaysProvider | undefined;
    batchTraceIds: string[];
    spanRange: { from: number; to: number } | undefined;
    maxSpanRows: number | undefined;
  }): Promise<JoinedSpanRow[]> {
    const spanHintMs = spanRange ? (spanRange.from + spanRange.to) / 2 : null;
    const spanWindowMs = spanRange
      ? (spanRange.to - spanRange.from) / 2 + DEFAULT_PARTITION_WINDOW_MS
      : DEFAULT_PARTITION_WINDOW_MS;

    // Resolved here, not inside `run` below, since the budget doesn't vary with the window.
    // `throw`, never `break`: `break` would silently hand back a partial span list as
    // complete. One row of headroom so an exactly-at-budget batch still succeeds.
    const spanReadSettings =
      maxSpanRows === undefined
        ? JOINED_SPAN_READ_SETTINGS
        : {
            ...JOINED_SPAN_READ_SETTINGS,
            max_result_rows: String(maxSpanRows + 1),
            result_overflow_mode: "throw" as const,
          };

    return queryWindowed<JoinedSpanRow[]>({
      table: "stored_spans",
      hintMs: spanHintMs,
      windowMs: spanWindowMs,
      fallback: spanRange
        ? "none"
        : {
            // Per tenant, floored at the historical 90-day reach so this
            // can only widen. A project on a 400-day policy previously
            // got 90 days here and simply could not see its own older
            // spans; one on a short policy no longer pays for a reach it
            // has no rows in. See {@link SPAN_READ_FLOOR_LOOKBACK_MS}.
            lookbackMs: await this.floorOver(retentionDays).getLookbackMs({
              table: "stored_spans",
              tenantId: projectId,
              minLookbackMs: SPAN_READ_FLOOR_LOOKBACK_MS,
            }),
          },
      isEmpty: (rows) => rows.length === 0,
      run: async (window) => {
        // ID_BOUND_SKIP: bounded by the summaries' own occurred times read just above.
        const spansResult = await this.builtReader(projectId).read({
          statement: joinedSpansStatement({
            authorization,
            traceIds: batchTraceIds,
            window,
            settings: spanReadSettings,
          }),
          table: storedSpans.$table.name,
        });
        return joinedSpanRowsSchema.parse(spansResult.rows);
      },
    });
  }

  /**
   * Extract TraceSummaryData from a joined row.
   * @internal
   */
  private extractTraceSummaryFromRow(row: JoinedTraceSpanRow): TraceSummaryData {
    return {
      traceId: row.ts_TraceId,
      spanCount: row.ts_SpanCount,
      totalDurationMs: row.ts_TotalDurationMs,
      computedIOSchemaVersion: row.ts_ComputedIOSchemaVersion,
      computedInput: row.ts_ComputedInput ?? null,
      computedOutput: row.ts_ComputedOutput ?? null,
      timeToFirstTokenMs: row.ts_TimeToFirstTokenMs,
      timeToLastTokenMs: row.ts_TimeToLastTokenMs,
      tokensPerSecond: row.ts_TokensPerSecond,
      containsErrorStatus: row.ts_ContainsErrorStatus,
      containsOKStatus: row.ts_ContainsOKStatus,
      errorMessage: row.ts_ErrorMessage,
      models: row.ts_Models,
      totalCost: row.ts_TotalCost,
      nonBilledCost: row.ts_NonBilledCost ?? null,
      tokensEstimated: row.ts_TokensEstimated,
      totalPromptTokenCount: row.ts_TotalPromptTokenCount,
      totalCompletionTokenCount: row.ts_TotalCompletionTokenCount,
      outputFromRootSpan: row.ts_OutputFromRootSpan ?? false,
      outputSpanEndTimeMs: row.ts_OutputSpanEndTimeMs ?? 0,
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
      topicId: row.ts_TopicId,
      subTopicId: row.ts_SubTopicId,
      annotationIds: row.ts_AnnotationIds ?? [],
      traceName: row.ts_TraceName ?? "",
      attributes: row.ts_Attributes,
      LastEventOccurredAt: 0,
      ...traceSummaryTimesFromRow(row),
      createdAt: row.ts_CreatedAt,
      updatedAt: row.ts_UpdatedAt,
    };
  }

  /**
   * Map a span row from a standalone spans query (no JOIN prefix) to NormalizedSpan.
   * @internal
   */
  private mapSpanRow(
    row: {
      SpanId: string;
      TraceId: string;
      TenantId: string;
      ParentSpanId: string | null;
      ParentTraceId: string | null;
      ParentIsRemote: boolean | null;
      Sampled: boolean;
      StartTimeMs: number;
      EndTime: number;
      DurationMs: number;
      SpanName: string;
      SpanKind: number;
      ResourceAttributes: Record<string, unknown>;
      SpanAttributes: Record<string, unknown>;
      StatusCode: number | null;
      StatusMessage: string | null;
      ScopeName: string | null;
      ScopeVersion: string | null;
      Events_Timestamp: number[];
      Events_Name: string[];
      Events_Attributes: Record<string, unknown>[];
      Links_TraceId: string[];
      Links_SpanId: string[];
      Links_Attributes: Record<string, unknown>[];
    },
    tenantId: string,
  ): NormalizedSpan {
    const events = (row.Events_Timestamp ?? []).map((timestamp, index) => ({
      name: row.Events_Name?.[index] ?? "",
      timeUnixMs: timestamp,
      attributes: deserializeAttributes(
        ensureStringRecord(row.Events_Attributes?.[index] ?? {}),
      ) as NormalizedSpan["events"][number]["attributes"],
    }));

    const links = (row.Links_TraceId ?? []).map((linkTraceId, index) => ({
      traceId: linkTraceId,
      spanId: row.Links_SpanId?.[index] ?? "",
      attributes: deserializeAttributes(
        ensureStringRecord(row.Links_Attributes?.[index] ?? {}),
      ) as NormalizedSpan["links"][number]["attributes"],
    }));

    return {
      id: "",
      traceId: row.TraceId,
      spanId: row.SpanId,
      tenantId,
      parentSpanId: row.ParentSpanId,
      parentTraceId: row.ParentTraceId,
      parentIsRemote: row.ParentIsRemote,
      sampled: row.Sampled,
      startTimeUnixMs: row.StartTimeMs,
      endTimeUnixMs: row.EndTime,
      durationMs: row.DurationMs,
      name: row.SpanName,
      kind: row.SpanKind as NormalizedSpanKind,
      resourceAttributes: deserializeAttributes(
        ensureStringRecord(row.ResourceAttributes),
      ) as NormalizedSpan["resourceAttributes"],
      spanAttributes: deserializeAttributes(
        ensureStringRecord(row.SpanAttributes),
      ) as NormalizedSpan["spanAttributes"],
      statusCode: row.StatusCode as NormalizedStatusCode | null,
      statusMessage: row.StatusMessage,
      instrumentationScope: {
        name: row.ScopeName ?? "",
        version: row.ScopeVersion,
      },
      events,
      links,
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
      cost: null,
      nonBilledCost: null,
    };
  }

  /**
   * Remaps `scoreOptions` keyed by AnnotationScore id to the public `annotations.scores.<name>`
   * contract. An id with no matching score keeps its id as the key so data is never silently
   * dropped. Prototype-polluting keys are skipped.
   */
  static remapScoreOptionsToNames(
    scoreOptions: unknown,
    scoreNameById: Map<string, string>,
  ): Record<string, unknown> {
    if (!scoreOptions || typeof scoreOptions !== "object") return {};
    const remapped: Record<string, unknown> = {};
    for (const [scoreId, value] of Object.entries(scoreOptions as Record<string, unknown>)) {
      const name = scoreNameById.get(scoreId) ?? scoreId;
      if (FORBIDDEN_SCORE_KEYS.has(name)) continue;
      // AnnotationScore names are not unique. On a collision the first entry keeps the plain
      // name and later ones get an id-suffixed key — deterministic and lossless.
      const key = name in remapped ? `${name} (${scoreId})` : name;
      if (FORBIDDEN_SCORE_KEYS.has(key)) continue;
      remapped[key] = value;
    }
    return remapped;
  }

  /**
   * ClickHouse refused a query because its result exceeded `max_result_rows`
   * under `result_overflow_mode = 'throw'` (TOO_MANY_ROWS_OR_BYTES, code 396).
   */
  static isClickHouseResultOverflowError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    if (HandledError.isHandled(error)) {
      return (error.reasons ?? []).some((reason) =>
        TraceLegacyReadClickHouseRepository.isClickHouseResultOverflowError(reason),
      );
    }
    return (
      error.message.includes("TOO_MANY_ROWS_OR_BYTES") ||
      (error as { type?: string }).type === "TOO_MANY_ROWS_OR_BYTES" ||
      (error as { code?: string | number }).code === 396 ||
      (error as { code?: string | number }).code === "396"
    );
  }

  static isClickHouseMemoryLimitError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    // The resilient client translates the raw driver error into a handled
    // `query_memory_exceeded`, wrapping the original in `reasons`.
    if (HandledError.isHandled(error)) {
      return (
        error.code === "query_memory_exceeded" ||
        (error.reasons ?? []).some((reason) =>
          TraceLegacyReadClickHouseRepository.isClickHouseMemoryLimitError(reason),
        )
      );
    }
    return (
      error.message.includes("MEMORY_LIMIT_EXCEEDED") ||
      error.message.toLowerCase().includes("memory limit exceeded") ||
      (error as { type?: string }).type === "MEMORY_LIMIT_EXCEEDED"
    );
  }
}

/**
 * Type for trace summary rows from the summary-only query.
 */
const traceSummaryRowSchema = z.looseObject({
  ts_TraceId: chString,
  ts_SpanCount: chNumber,
  ts_TotalDurationMs: chNumber,
  ts_ComputedIOSchemaVersion: chString,
  ts_ComputedInput: chString.nullish(),
  ts_ComputedOutput: chString.nullish(),
  ts_TimeToFirstTokenMs: chNumber.nullable(),
  ts_TimeToLastTokenMs: chNumber.nullable(),
  ts_TokensPerSecond: chNumber.nullable(),
  ts_ContainsErrorStatus: chBoolean,
  ts_ContainsOKStatus: chBoolean,
  ts_ErrorMessage: chString.nullable(),
  ts_Models: z.array(chString),
  ts_TotalCost: chNumber.nullable(),
  ts_NonBilledCost: chNumber.nullable(),
  ts_TokensEstimated: chBoolean,
  ts_TotalPromptTokenCount: chNumber.nullable(),
  ts_TotalCompletionTokenCount: chNumber.nullable(),
  ts_OutputFromRootSpan: chBoolean.optional(),
  ts_OutputSpanEndTimeMs: chNumber.optional(),
  ts_TopicId: chString.nullable(),
  ts_SubTopicId: chString.nullable(),
  ts_HasAnnotation: chBoolean.nullable(),
  ts_AnnotationIds: z.array(chString),
  ts_Attributes: chStringMap,
  ts_TraceName: chString.nullish(),
  /**
   * The row's projection stamp. Read only to tell a pre-anchor row's `OccurredAt`
   * (which was `min(span start)`) from a post-anchor one's (the frozen storage
   * anchor). See {@link traceSummaryTimesFromRow}.
   */
  ts_Version: chString.optional(),
  /** The span timing baseline column added by migration 00072; absent on older rows. */
  ts_EarliestSpanStartMs: chNumber.optional(),
  ts_OccurredAt: chNumber,
  ts_CreatedAt: chNumber,
  ts_UpdatedAt: chNumber,
});

type TraceSummaryRow = z.infer<typeof traceSummaryRowSchema>;

const traceSummaryRowsSchema = z.array(traceSummaryRowSchema);

/**
 * Splits a summary row's two times back apart: `OccurredAt` is the frozen storage anchor (the
 * partition/TTL address the list read pages on), `occurredAt` on `TraceSummaryData` is the span
 * timing baseline the trace reports as its start. See ADR-087.
 */
function traceSummaryTimesFromRow(row: TraceSummaryRow): {
  storageAnchorMs: number;
  occurredAt: number;
} {
  const isAnchored = isStorageAnchoredVersion(row.ts_Version);
  return {
    storageAnchorMs: row.ts_OccurredAt,
    occurredAt: isAnchored ? Number(row.ts_EarliestSpanStartMs ?? 0) : row.ts_OccurredAt,
  };
}

/**
 * Type representing a row from the JOIN query between trace_summaries and stored_spans.
 * All fields are prefixed with ts_ (trace summary) or ss_ (stored span).
 */
interface JoinedTraceSpanRow extends TraceSummaryRow {
  // Span fields (nullable due to LEFT JOIN)
  ss_Id: string | null;
  ss_TraceId: string | null;
  ss_SpanId: string | null;
  ss_TenantId: string | null;
  ss_ParentSpanId: string | null;
  ss_ParentTraceId: string | null;
  ss_ParentIsRemote: boolean | null;
  ss_Sampled: boolean | null;
  ss_StartTime: number | null;
  ss_EndTime: number | null;
  ss_DurationMs: number | null;
  ss_SpanName: string | null;
  ss_SpanKind: number | null;
  ss_ResourceAttributes: Record<string, unknown> | null;
  ss_SpanAttributes: Record<string, unknown> | null;
  ss_StatusCode: number | null;
  ss_StatusMessage: string | null;
  ss_ScopeName: string | null;
  ss_ScopeVersion: string | null;
  ss_Events_Timestamp: number[] | null;
  ss_Events_Name: string[] | null;
  ss_Events_Attributes: Record<string, unknown>[] | null;
  ss_Links_TraceId: string[] | null;
  ss_Links_SpanId: string[] | null;
  ss_Links_Attributes: Record<string, unknown>[] | null;
  ss_DroppedAttributesCount: number | null;
  ss_DroppedEventsCount: number | null;
  ss_DroppedLinksCount: number | null;
}
