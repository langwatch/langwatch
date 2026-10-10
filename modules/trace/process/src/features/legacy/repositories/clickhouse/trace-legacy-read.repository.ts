import { annotationSuggestedOutput } from "@langwatch/annotation-contract";
import type { Authorization } from "@langwatch/authorization";
import {
  type AuthorizedClickHouse,
  DEFAULT_PARTITION_WINDOW_MS,
  expandFragment,
  fenceFor,
  queryWindowed,
  RetentionFloorService,
  type RetentionDaysProvider,
  type TenantScopedReader,
  tenantScope,
} from "@langwatch/clickhouse-client";
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
  TraceSummaryListOptions,
  TraceSummaryListQuery,
  TraceSummaryPage,
} from "@langwatch/trace-contract";
import { isStorageAnchoredVersion } from "@langwatch/trace-contract";
import { getLangWatchTracer } from "langwatch";
import { z } from "zod";

import type { TraceClickHouseClient } from "../../../../repositories/clickhouse/clickhouse.trace-member-client.repository.ts";
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
import {
  type ClickHouseEvaluationRunRow,
  EVALUATION_RUN_COLUMNS_WITH_INPUTS,
} from "../../../../rules/trace-evaluation-mapping.rules.ts";
import { mapEventAttrsToEvent } from "../../../../rules/trace-event-attribute-mapping.rules.ts";
import { type EventSpanRow } from "../../../../rules/trace-event-attribute-mapping.rules.ts";
import { translateLegacyFilters } from "../../rules/trace-legacy-filter-conditions.rules.ts";
import {
  type PromptStudioSpanRow,
  derivePromptStudioSpan,
} from "../../rules/trace-legacy-prompt-studio-span.rules.ts";
import { traceStartedAt } from "../../rules/trace-legacy-summary-mapping.rules.ts";
import {
  TraceLegacyReadRepository,
  type TraceLegacyPage,
  type TraceLegacyRow,
} from "../trace-legacy-read.repository.ts";

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
  z.looseObject({
    SpanId: chString,
    TraceId: chString,
    ParentSpanId: chString.nullable(),
    SpanName: chString,
    SpanAttributes: attributeMapSchema,
    StartTime: chNumber,
    EndTime: chNumber,
    DurationMs: chNumber,
    StatusCode: chNumber.nullable(),
    StatusMessage: chString.nullable(),
  }),
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

/**
 * Bounds the events stored_spans scan to the partitions the page's traces occurred in, clustered
 * into tight OR'd ranges so a page mixing old and recent traces doesn't scan every partition.
 */

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

function buildEventOccurrenceWindows(occurredAts: number[]): {
  outer: string;
  inner: string;
  params: Record<string, number>;
} {
  if (occurredAts.length === 0) return { outer: "", inner: "", params: {} };

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

  const params: Record<string, number> = {};
  const outerParts: string[] = [];
  const innerParts: string[] = [];
  clusters.forEach((c, i) => {
    const fromKey = `spanFrom${i}`;
    const toKey = `spanTo${i}`;
    params[fromKey] = c.from - EVENT_PARTITION_WINDOW_MS;
    params[toKey] = c.to + EVENT_PARTITION_WINDOW_MS;
    outerParts.push(
      `(t.StartTime >= fromUnixTimestamp64Milli({${fromKey}:Int64}) AND t.StartTime <= fromUnixTimestamp64Milli({${toKey}:Int64}))`,
    );
    innerParts.push(
      `(StartTime >= fromUnixTimestamp64Milli({${fromKey}:Int64}) AND StartTime <= fromUnixTimestamp64Milli({${toKey}:Int64}))`,
    );
  });

  return {
    outer: ` AND (${outerParts.join(" OR ")})`,
    inner: ` AND (${innerParts.join(" OR ")})`,
    params,
  };
}

/**
 * Thrown when no ClickHouse client can be resolved for a project — always a configuration
 * problem (e.g. CLICKHOUSE_URL unset), never missing data. Callers surface it as such.
 */
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
  /** The process's tenant-keyed connection; absent, every read refuses. */
  resolveClickHouseClient?: ((tenantId: string) => Promise<TraceClickHouseClient>) | undefined;
  /** The proof-checked reader the fenced reads go through (ADR-177); absent, they refuse. */
  clickhouse?: AuthorizedClickHouse | undefined;
  /** Annotation's rows and score names via its shared tables (R40), for the projection join. */
  annotations?:
    | {
        rows: Pick<TraceAnnotationsReadRepository, "findForTraces">;
        scores: Pick<TraceAnnotationScoresReadRepository, "findScoreNames">;
      }
    | undefined;
};

/** The compiled filter, its tenant markers expanded into the proof's fence (ADR-177 block C). */
function fenceFilterWhere({
  filterWhere,
  authorization,
}: {
  filterWhere: GetAllTracesForProjectOptions["filterWhere"];
  authorization: Authorization | undefined;
}): GetAllTracesForProjectOptions["filterWhere"] {
  if (!filterWhere) return undefined;
  if (!authorization) {
    throw new Error("A compiled trace filter needs the proof its tenant markers expand into");
  }
  return expandFragment({
    fragment: filterWhere.sql,
    queryParams: filterWhere.params,
    fence: fenceFor({ authorization, reads: "traces" }),
  });
}

function mergeFilterWhere({
  conditions,
  params,
  filterWhere,
}: {
  conditions: string[];
  params: Record<string, unknown>;
  filterWhere: GetAllTracesForProjectOptions["filterWhere"];
}): { filterConditions: string[]; filterParams: Record<string, unknown> } {
  if (!filterWhere) return { filterConditions: conditions, filterParams: params };
  return {
    filterConditions: [...conditions, `(${filterWhere.sql})`],
    filterParams: { ...params, ...filterWhere.params },
  };
}

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

function buildPageFilterClauses({
  filterConditions,
  traceIds,
}: {
  filterConditions: string[] | undefined;
  traceIds: string[] | undefined;
}): { extraFilters: string; traceIdFilter: string } {
  const extraFilters =
    filterConditions && filterConditions.length > 0 ? " AND " + filterConditions.join(" AND ") : "";

  // Explicit trace ID filter — when callers provide specific trace IDs
  const traceIdFilter =
    traceIds && traceIds.length > 0 ? " AND ts.TraceId IN ({traceIds:Array(String)})" : "";
  return { extraFilters, traceIdFilter };
}

function buildSearchFilter({
  effectiveQuery,
  protections,
}: {
  effectiveQuery: string | undefined;
  protections: Protections;
}): string {
  if (!effectiveQuery) return "";
  // Trace/span names are operation names, not captured content, so free text must reach
  // them too — alongside, not instead of, the I/O columns. `searchQuery` is already
  // lowercased and LIKE-escaped, so `lower(...)` on each side is the whole contract.
  const searchableColumns = [
    ...(protections.canSeeCapturedInput !== false ? ["lower(ifNull(ts.ComputedInput, ''))"] : []),
    ...(protections.canSeeCapturedOutput !== false ? ["lower(ifNull(ts.ComputedOutput, ''))"] : []),
    "lower(ifNull(ts.TraceName, ''))",
  ];

  // Non-root span names live in `stored_spans`, probed with the same
  // correlated EXISTS shape the span filters in `filter-conditions.ts`
  // use, bound to the tenant itself so the tenant guard sees its own read scoped.
  // The StartTime bound keeps it partition-pruned, matching `buildSpanTimeBound`.
  const spanNameSearch = `EXISTS (
                    SELECT 1 FROM stored_spans sp
                    WHERE sp.TenantId = {tenantId:String}
                      AND sp.TraceId = ts.TraceId
                      AND sp.StartTime >= fromUnixTimestamp64Milli({startDate:UInt64})
                      AND sp.StartTime <= fromUnixTimestamp64Milli({endDate:UInt64})
                      AND lower(sp.SpanName) LIKE {searchQuery:String}
                  )`;

  const alternatives = [
    ...searchableColumns.map((col) => `${col} LIKE {searchQuery:String}`),
    spanNameSearch,
  ];
  return ` AND (${alternatives.join(" OR ")})`;
}

function buildCursorSeeks({
  cursor,
  cmp,
}: {
  cursor: ClickHouseScrollCursor | null;
  cmp: "<" | ">";
}): { occurredCursor: string; updatedCursor: string } {
  if (!cursor) return { occurredCursor: "", updatedCursor: "" };
  return {
    occurredCursor: ` AND (toUnixTimestamp64Milli(ts.OccurredAt), ts.TraceId) ${cmp} ({lastTimestamp:UInt64}, {lastTraceId:String})`,
    updatedCursor: ` AND (toUnixTimestamp64Milli(ts.UpdatedAt), ts.TraceId) ${cmp} ({lastTimestamp:UInt64}, {lastTraceId:String})`,
  };
}

function buildPageSharedParams({
  projectId,
  startDate,
  endDate,
  filterParams,
  traceIds,
  effectiveQuery,
  scrollStart,
}: {
  projectId: string;
  startDate: number | undefined;
  endDate: number | undefined;
  filterParams: Record<string, unknown> | undefined;
  traceIds: string[] | undefined;
  effectiveQuery: string | undefined;
  scrollStart: number | undefined;
}) {
  return {
    tenantId: projectId,
    startDate: startDate ?? 0,
    endDate: endDate ?? nowInstant().epochMilliseconds,
    ...filterParams,
    ...(traceIds && traceIds.length > 0 ? { traceIds } : {}),
    ...(effectiveQuery
      ? {
          searchQuery: `%${effectiveQuery.replace(/[%_\\]/g, "\\$&").toLowerCase()}%`,
        }
      : {}),
    // Shared rather than cursor-scoped: the count query embeds
    // `latestVersionOnly` too and is bound with sharedParams alone, so a
    // cursor-scoped binding would leave {scrollStart} unbound there.
    // Only present when the SQL references it.
    ...(scrollStart !== undefined ? { scrollStart } : {}),
  };
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

/** The page's id and count statements over `trace_summaries`, shared by both list reads. */
function buildPageStatements({
  projectId,
  startDate,
  endDate,
  filterParams,
  traceIds,
  effectiveQuery,
  scrollStart,
  cursor,
  sortDirection,
  dateField,
  extraFilters,
  searchFilter,
  traceIdFilter,
}: {
  projectId: string;
  startDate: number | undefined;
  endDate: number | undefined;
  filterParams: Record<string, unknown> | undefined;
  traceIds: string[] | undefined;
  effectiveQuery: string | undefined;
  scrollStart: number | undefined;
  cursor: ClickHouseScrollCursor | null;
  sortDirection: "asc" | "desc";
  dateField: TraceDateField;
  extraFilters: string;
  searchFilter: string;
  traceIdFilter: string;
}) {
  // occurred (default): windows + seeks on the immutable OccurredAt (prunes partitions).
  // updated (CDC): restricts ts to each trace's latest version (global max UpdatedAt) first,
  // then applies window/filters/cursor to that row, so a stale version can never satisfy a
  // filter the latest version doesn't, and adjacent CDC windows stay mutually exclusive.
  const isUpdatedAxis = dateField === "updated";
  const dateColumn: "UpdatedAt" | "OccurredAt" = isUpdatedAxis ? "UpdatedAt" : "OccurredAt";
  const cmp = sortDirection === "desc" ? "<" : ">";
  const orderDirection = sortDirection === "desc" ? "DESC" : "ASC";

  const occurredWindow =
    " AND ts.OccurredAt >= fromUnixTimestamp64Milli({startDate:UInt64}) AND ts.OccurredAt <= fromUnixTimestamp64Milli({endDate:UInt64})";
  const updatedWindow =
    " AND ts.UpdatedAt >= fromUnixTimestamp64Milli({startDate:UInt64}) AND ts.UpdatedAt <= fromUnixTimestamp64Milli({endDate:UInt64})";
  // Collapses ts to each trace's latest version so the updated-axis window/filters/cursor
  // evaluate on the latest row, bounded by scrollStart when a scroll is in play — otherwise
  // a trace bumped past the cursor mid-scroll would silently drop out of every remaining
  // page. Capped inside the dedup, not on the outer rows, since version resolution itself
  // must stay stable for the scroll's duration.
  const latestVersionOnly = buildLatestVersionOnly(scrollStart);

  const { occurredCursor, updatedCursor } = buildCursorSeeks({ cursor, cmp });

  const sharedParams = buildPageSharedParams({
    projectId,
    startDate,
    endDate,
    filterParams,
    traceIds,
    effectiveQuery,
    scrollStart,
  });

  const cursorParams = {
    lastTimestamp: cursor?.lastTimestamp ?? 0,
    lastTraceId: cursor?.lastTraceId ?? "",
  };

  // Step 1: Find page trace IDs + count in parallel.
  // The ID query is lightweight (no heavy columns). occurred counts with
  // HyperLogLog (~2% error, fine for display); updated counts traces whose
  // global max(UpdatedAt) falls in the window (exact, via the aggregate).
  const { countQuery, idQuery } = buildPageQueries({
    isUpdatedAxis,
    extraFilters,
    latestVersionOnly,
    occurredCursor,
    occurredWindow,
    orderDirection,
    searchFilter,
    traceIdFilter,
    updatedCursor,
    updatedWindow,
  });

  return { countQuery, idQuery, sharedParams, cursorParams, dateColumn, orderDirection };
}

function buildPageQueries({
  isUpdatedAxis,
  extraFilters,
  latestVersionOnly,
  occurredCursor,
  occurredWindow,
  orderDirection,
  searchFilter,
  traceIdFilter,
  updatedCursor,
  updatedWindow,
}: {
  isUpdatedAxis: boolean;
  extraFilters: string;
  latestVersionOnly: string;
  occurredCursor: string;
  occurredWindow: string;
  orderDirection: string;
  searchFilter: string;
  traceIdFilter: string;
  updatedCursor: string;
  updatedWindow: string;
}): { countQuery: string; idQuery: string } {
  const countQuery = isUpdatedAxis
    ? `
              SELECT count() AS total
              FROM (
                SELECT ts.TraceId
                FROM trace_summaries ts
                WHERE ts.TenantId = {tenantId:String}
                  ${latestVersionOnly}
                  ${updatedWindow}
                  ${extraFilters}
                  ${traceIdFilter}
                  ${searchFilter}
                GROUP BY ts.TraceId
              )
            `
    : `
              SELECT uniq(ts.TraceId) as total
              FROM trace_summaries ts
              WHERE ts.TenantId = {tenantId:String}
                ${occurredWindow}
                ${extraFilters}
                ${traceIdFilter}
                ${searchFilter}
            `;
  const idQuery = isUpdatedAxis
    ? `
              SELECT ts.TraceId
              FROM trace_summaries ts
              WHERE ts.TenantId = {tenantId:String}
                ${latestVersionOnly}
                ${updatedWindow}
                ${extraFilters}
                ${traceIdFilter}
                ${searchFilter}
                ${updatedCursor}
              GROUP BY ts.TraceId
              ORDER BY max(toUnixTimestamp64Milli(ts.UpdatedAt)) ${orderDirection}, ts.TraceId ${orderDirection}
              LIMIT {pageSize:UInt32}
            `
    : `
              SELECT s.TraceId
              FROM (
                SELECT ts.TraceId AS TraceId,
                       argMax(ts.OccurredAt, ts.UpdatedAt) AS _oa
                FROM trace_summaries ts
                WHERE ts.TenantId = {tenantId:String}
                  ${occurredWindow}
                  ${extraFilters}
                  ${traceIdFilter}
                  ${searchFilter}
                  ${occurredCursor}
                GROUP BY ts.TraceId
              ) s
              ORDER BY s._oa ${orderDirection}, s.TraceId ${orderDirection}
              LIMIT {pageSize:UInt32}
            `;
  return { countQuery, idQuery };
}

/**
 * Collapses ts to each trace's latest version, capped at the scroll's snapshot when one is in
 * play. Only the updated axis uses it, so versions before the window's start can never be the
 * latest of a trace the window keeps; bounding them lets the UpdatedAt index skip old granules.
 */
function buildLatestVersionOnly(scrollStart: number | undefined): string {
  const scrollSnapshotBound =
    scrollStart !== undefined
      ? " AND UpdatedAt <= fromUnixTimestamp64Milli({scrollStart:UInt64})"
      : "";
  return ` AND (ts.TenantId, ts.TraceId, ts.UpdatedAt) IN (SELECT TenantId, TraceId, max(UpdatedAt) FROM trace_summaries WHERE TenantId = {tenantId:String} AND UpdatedAt >= fromUnixTimestamp64Milli({startDate:UInt64})${scrollSnapshotBound} GROUP BY TenantId, TraceId)`;
}

/** Stored-span rows as the joined read selects them. */
const joinedSpanRowSchema = z.looseObject({
  SpanId: chString,
  TraceId: chString,
  TenantId: chString,
  ParentSpanId: chString.nullable(),
  ParentTraceId: chString.nullable(),
  ParentIsRemote: chBoolean.nullable(),
  Sampled: chBoolean,
  StartTime: chNumber,
  EndTime: chNumber,
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
});

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

const retentionFloorLogger = createLogger("langwatch:clickhouse:retention-floor");

export class TraceLegacyReadClickHouseRepository extends TraceLegacyReadRepository {
  private readonly logger = createLogger("langwatch:traces:clickhouse-service");
  private readonly tracer = getLangWatchTracer("langwatch.traces.clickhouse-service");

  private readonly store: ClickHouseTraceLegacyReadOptions;
  private readonly resolveClickHouseClient: ClickHouseTraceLegacyReadOptions["resolveClickHouseClient"];
  private readonly annotations: ClickHouseTraceLegacyReadOptions["annotations"];

  constructor(options: ClickHouseTraceLegacyReadOptions) {
    super();
    const { resolveClickHouseClient, clickhouse, annotations } = options;
    this.store = { resolveClickHouseClient, clickhouse, annotations };
    this.resolveClickHouseClient = resolveClickHouseClient;
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
    if (!this.store.clickhouse) throw new ClickHouseClientUnavailableError(projectId);
    return this.store.clickhouse.as(authorization, { reads: "traces" });
  }

  /** Translates the caller's filter selection into a ClickHouse predicate. */
  private translateFilters(
    filters: Record<string, unknown>,
    window: { startDate: number; endDate: number },
  ): { conditions: string[]; params: Record<string, unknown>; hasUnsupportedFilters: boolean } {
    if (Object.keys(filters).length === 0) {
      return { conditions: [], params: {}, hasUnsupportedFilters: false };
    }
    return translateLegacyFilters({ filters, window });
  }

  private async resolveClient(projectId: string): Promise<TraceClickHouseClient> {
    const resolve = this.resolveClickHouseClient;
    if (!resolve) {
      throw new ClickHouseClientUnavailableError(projectId);
    }
    return resolve(projectId);
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
        const reader = this.reader({ authorization, projectId });

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
            reader,
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
        const clickHouseClient = await this.resolveClient(projectId);

        try {
          const result = await clickHouseClient.query({
            query: `
              SELECT DISTINCT TraceId
              FROM trace_summaries
              WHERE TenantId = {tenantId:String}
                AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
                AND OccurredAt <= fromUnixTimestamp64Milli({toMs:Int64})
                AND startsWith(TraceId, {prefix:String})
              LIMIT {limit:UInt32}
            `,
            query_params: {
              tenantId: projectId,
              fromMs: occurredAt.from,
              toMs: occurredAt.to,
              prefix,
              limit,
            },
            format: "JSONEachRow",
          });

          const rows = traceIdRowsSchema.parse(await result.json());
          return rows.map((r) => r.TraceId);
        } catch (error) {
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
        const reader = this.reader({ authorization, projectId });

        this.logger.debug({ projectId, threadId }, "Fetching traces by thread ID from ClickHouse");

        try {
          // Query trace_summaries for traces with matching thread_id
          // Thread ID can be stored under different attribute keys
          const result = await reader.query({
            query: `
              SELECT DISTINCT TraceId
              FROM trace_summaries
              WHERE ${tenantScope("OccurredAt")}
                AND Attributes['gen_ai.conversation.id'] = {threadId:String}
              ORDER BY CreatedAt ASC
              LIMIT 1000
            `,
            query_params: {
              threadId,
            },
            format: "JSONEachRow",
          });

          const rows = traceIdRowsSchema.parse(await result.json());
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
        const reader = this.reader({ authorization, projectId });

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
          const result = await reader.query({
            query: `
              SELECT DISTINCT TraceId
              FROM trace_summaries
              WHERE ${tenantScope("OccurredAt")}
                AND Attributes['gen_ai.conversation.id'] IN ({threadIds:Array(String)})
              ORDER BY CreatedAt ASC
              LIMIT {maxTraces:UInt32}
            `,
            query_params: {
              threadIds,
              maxTraces: maxTraces ?? DEFAULT_THREAD_TRACES_LIMIT,
            },
            format: "JSONEachRow",
          });

          const rows = traceIdRowsSchema.parse(await result.json());
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
    reader,
    projectId,
    summaries,
    projection,
  }: {
    reader: TenantScopedReader;
    projectId: string;
    summaries: TraceSummaryData[];
    projection: GetAllTracesForProjectOptions["projection"];
  }): Promise<Pick<TraceLegacyPage, "evaluations" | "events" | "annotations">> {
    if (summaries.length === 0) return { evaluations: [] };
    const traceIds = summaries.map((summary) => summary.traceId);
    const evaluations = await this.fetchEvaluationRows({ reader, traceIds });
    // Scoped to this page, never table-wide.
    const events = projection?.needsEvents
      ? await this.findEventsForProjection({ reader, projectId, summaries })
      : undefined;
    const annotations = projection?.needsAnnotations
      ? await this.findAnnotationsForProjection({ projectId, traceIds })
      : undefined;
    return { evaluations, events, annotations };
  }

  /** The page's spans, read only where the caller wants spans or full IO. */
  private async readRequestedSpans({
    reader,
    summaries,
    projectId,
    wanted,
    retentionDays,
  }: {
    reader: TenantScopedReader;
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
      reader,
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
    options: GetAllTracesForProjectOptions;
    retentionDays: RetentionDaysProvider | undefined;
    ownRead: Authorization;
  }): Promise<TraceLegacyPage> {
    return this.tracer.withActiveSpan(
      "TraceLegacyReadClickHouseRepository.getAllTracesForProject",
      async (_span) => {
        const reader = this.reader({ authorization: ownRead, projectId: input.projectId });

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

          // Pass the dashboard time window so span/event filters bound their stored_spans
          // EXISTS subqueries to the same window, pruning partitions instead of cold-scanning.
          const {
            conditions: legacyFilterConditions,
            params: legacyFilterParams,
            hasUnsupportedFilters,
          } = this.translateFilters(input.filters ?? {}, {
            startDate: input.startDate,
            endDate: input.endDate,
          });

          if (hasUnsupportedFilters) {
            throw new Error("Filters contain unsupported fields for ClickHouse");
          }

          // The v1 REST search door's compiled query-language filter (already
          // parameterized by `TraceApi.compileExplorerTraceFilter`), ANDed
          // alongside the legacy filter map's own conditions.
          const { filterConditions, filterParams } = mergeFilterWhere({
            conditions: legacyFilterConditions,
            params: legacyFilterParams,
            filterWhere: fenceFilterWhere({
              filterWhere: options.filterWhere,
              authorization: options.authorization,
            }),
          });

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
            pageSize,
            sortDirection,
            cursor,
            protections,
            startDate: input.startDate,
            endDate: effectiveEndDate,
            filterConditions,
            filterParams,
            traceIds: input.traceIds,
            query: input.query,
            fetchInput,
            fetchOutput,
            dateField,
            scrollStart,
          });
          const spans = await this.readRequestedSpans({
            reader,
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
            reader,
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
    options: TraceSummaryListOptions = {},
  ): Promise<TraceSummaryPage> {
    return this.tracer.withActiveSpan(
      "TraceLegacyReadClickHouseRepository.findTraceSummaries",
      { attributes: { "tenant.id": input.projectId } },
      async () => {
        const clickHouseClient = await this.resolveClient(input.projectId);
        const pageSize = input.pageSize ?? 25;
        const sortDirection = "asc";
        const dateField: TraceDateField = options.dateField ?? "occurred";
        const cursor = this.decodeScrollCursor({
          scrollId: options.scrollId,
          sortDirection,
          pageSize,
          dateField,
        });
        const { filterConditions, filterParams } = mergeFilterWhere({
          conditions: [],
          params: {},
          filterWhere: options.filterWhere,
        });
        const { scrollStart, effectiveEndDate } = resolveScrollWindow({
          dateField,
          cursor,
          endDate: input.endDate,
        });
        const { extraFilters, traceIdFilter } = buildPageFilterClauses({
          filterConditions,
          traceIds: undefined,
        });
        const { idQuery, sharedParams, cursorParams, dateColumn, orderDirection } =
          buildPageStatements({
            projectId: input.projectId,
            startDate: input.startDate,
            endDate: effectiveEndDate,
            filterParams,
            traceIds: undefined,
            effectiveQuery: undefined,
            scrollStart,
            cursor,
            sortDirection,
            dateField,
            extraFilters,
            searchFilter: "",
            traceIdFilter,
          });
        const idRows = traceIdRowsSchema.parse(
          await (
            await clickHouseClient.query({
              query: idQuery,
              query_params: { ...sharedParams, ...cursorParams, pageSize },
              format: "JSONEachRow",
            })
          ).json(),
        );
        const traceIds = idRows.map((row) => row.TraceId);
        const rows =
          traceIds.length === 0
            ? []
            : await this.fetchTraceSummaryRows({
                clickHouseClient,
                projectId: input.projectId,
                startDate: input.startDate,
                endDate: effectiveEndDate ?? nowInstant().epochMilliseconds,
                traceIds,
                orderDirection,
                fetchInput: false,
                fetchOutput: false,
                dateColumn,
                scrollStart,
              });
        const summaries = rows.map((row) => this.rowToTraceSummaryData(row));
        const last = summaries.at(-1);
        const scrollId = this.buildNextScrollId({
          last: last
            ? {
                timestamp: dateField === "updated" ? last.updatedAt : last.occurredAt,
                traceId: last.traceId,
              }
            : null,
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
        const clickHouseClient = await this.resolveClient(input.projectId);

        try {
          // Build date filter conditions
          const conditions: string[] = ["TenantId = {tenantId:String}"];
          if (input.startDate) {
            conditions.push("CreatedAt >= fromUnixTimestamp64Milli({startDate:UInt64})");
          }
          if (input.endDate) {
            conditions.push("CreatedAt <= fromUnixTimestamp64Milli({endDate:UInt64})");
          }

          const whereClause = conditions.join(" AND ");

          const result = await clickHouseClient.query({
            query: `
              SELECT
                TopicId,
                SubTopicId,
                count() as count
              FROM trace_summaries
              WHERE ${whereClause}
                AND (TopicId IS NOT NULL OR SubTopicId IS NOT NULL)
              GROUP BY TopicId, SubTopicId
              LIMIT 10000
            `,
            query_params: {
              tenantId: input.projectId,
              startDate: input.startDate ?? 0,
              endDate: input.endDate ?? nowInstant().epochMilliseconds,
            },
            format: "JSONEachRow",
          });

          const rows = topicCountRowsSchema.parse(await result.json());

          return aggregateTopicCounts(rows);
        } catch (error) {
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
        const clickHouseClient = await this.resolveClient(input.projectId);

        try {
          // Build date filter conditions
          const conditions: string[] = ["TenantId = {tenantId:String}"];
          if (input.startDate) {
            conditions.push("CreatedAt >= fromUnixTimestamp64Milli({startDate:UInt64})");
          }
          if (input.endDate) {
            conditions.push("CreatedAt <= fromUnixTimestamp64Milli({endDate:UInt64})");
          }

          const whereClause = conditions.join(" AND ");

          // Query for unique customer IDs
          const customerResult = await clickHouseClient.query({
            query: `
              SELECT DISTINCT Attributes['langwatch.customer_id'] as customer_id
              FROM trace_summaries
              WHERE ${whereClause}
                AND Attributes['langwatch.customer_id'] != ''
              LIMIT 10000
            `,
            query_params: {
              tenantId: input.projectId,
              startDate: input.startDate ?? 0,
              endDate: input.endDate ?? nowInstant().epochMilliseconds,
            },
            format: "JSONEachRow",
          });

          const customerRows = customerRowsSchema.parse(await customerResult.json());

          // Query for unique labels
          // Labels are stored as JSON array in langwatch.labels attribute
          const labelsResult = await clickHouseClient.query({
            query: `
              SELECT DISTINCT Attributes['langwatch.labels'] as labels_json
              FROM trace_summaries
              WHERE ${whereClause}
                AND Attributes['langwatch.labels'] != ''
              LIMIT 10000
            `,
            query_params: {
              tenantId: input.projectId,
              startDate: input.startDate ?? 0,
              endDate: input.endDate ?? nowInstant().epochMilliseconds,
            },
            format: "JSONEachRow",
          });

          const labelsRows = labelsRowsSchema.parse(await labelsResult.json());

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
        const clickHouseClient = await this.resolveClient(projectId);

        try {
          // Fetch ALL spans in the trace in a single query so we can
          // both extract LLM data and walk ancestors for prompt reference.
          const queryResult = await clickHouseClient.query({
            query: `
              SELECT
                SpanId,
                TraceId,
                ParentSpanId,
                SpanName,
                SpanAttributes,
                toUnixTimestamp64Milli(StartTime) AS StartTime,
                toUnixTimestamp64Milli(EndTime) AS EndTime,
                DurationMs,
                StatusCode,
                StatusMessage
              FROM stored_spans
              WHERE TenantId = {tenantId:String}
                AND TraceId = (
                  SELECT TraceId FROM stored_spans
                  WHERE TenantId = {tenantId:String}
                    AND SpanId = {spanId:String}
                  LIMIT 1
                )
              LIMIT 1000
            `,
            query_params: {
              tenantId: projectId,
              spanId,
            },
            format: "JSONEachRow",
          });

          const rows = promptStudioSpanRowsSchema.parse(await queryResult.json());
          return derivePromptStudioSpan({ rows, spanId }) ?? null;
        } catch (error) {
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
        const clickHouseClient = await this.resolveClient(projectId);

        try {
          // Get distinct span names from stored_spans
          const spanResult = await clickHouseClient.query({
            query: `
              SELECT DISTINCT SpanName
              FROM stored_spans
              WHERE TenantId = {tenantId:String}
                AND StartTime >= fromUnixTimestamp64Milli({startDate:UInt64})
                AND StartTime <= fromUnixTimestamp64Milli({endDate:UInt64})
                AND SpanName != ''
              ORDER BY SpanName ASC
              LIMIT ${DISTINCT_FIELD_NAMES_LIMIT}
            `,
            query_params: {
              tenantId: projectId,
              startDate,
              endDate,
            },
            format: "JSONEachRow",
          });

          const spanRows = spanNameRowsSchema.parse(await spanResult.json());

          const spanNames = spanRows.map((row) => ({
            key: row.SpanName,
            label: row.SpanName,
          }));

          // Get distinct metadata keys from trace_summaries Attributes
          const metaResult = await clickHouseClient.query({
            query: `
              SELECT DISTINCT arrayJoin(mapKeys(Attributes)) AS key
              FROM trace_summaries
              WHERE TenantId = {tenantId:String}
                AND CreatedAt >= fromUnixTimestamp64Milli({startDate:UInt64})
                AND CreatedAt <= fromUnixTimestamp64Milli({endDate:UInt64})
              ORDER BY key ASC
              LIMIT ${DISTINCT_FIELD_NAMES_LIMIT}
            `,
            query_params: {
              tenantId: projectId,
              startDate,
              endDate,
            },
            format: "JSONEachRow",
          });

          const metaRows = metadataKeyRowsSchema.parse(await metaResult.json());

          const metadataKeys = metaRows.map((row) => ({
            key: row.key,
            label: row.key,
          }));

          // Get distinct evaluator names from evaluation_runs. Dedupe by
          // evaluator id (an evaluator can be renamed over time) and keep the
          // most recent name. The dropdown maps the id and shows the name.
          const evalResult = await clickHouseClient.query({
            query: `
              SELECT
                EvaluatorId AS id,
                argMax(EvaluatorName, ScheduledAt) AS name
              FROM evaluation_runs
              WHERE TenantId = {tenantId:String}
                AND ScheduledAt >= fromUnixTimestamp64Milli({startDate:UInt64})
                AND ScheduledAt <= fromUnixTimestamp64Milli({endDate:UInt64})
                AND EvaluatorId != ''
              GROUP BY EvaluatorId
              ORDER BY name ASC
              LIMIT ${DISTINCT_FIELD_NAMES_LIMIT}
            `,
            query_params: {
              tenantId: projectId,
              startDate,
              endDate,
            },
            format: "JSONEachRow",
          });

          const evalRows = evaluatorNameRowsSchema.parse(await evalResult.json());

          const evaluationNames = evalRows.map((row) => ({
            key: row.id,
            label: row.name ?? row.id,
          }));

          return { spanNames, metadataKeys, evaluationNames };
        } catch (error) {
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
  private async fetchTracesWithPagination({
    projectId,
    pageSize,
    sortDirection,
    cursor,
    protections,
    startDate,
    endDate,
    filterConditions,
    filterParams,
    traceIds,
    query,
    fetchInput = true,
    fetchOutput = true,
    dateField = "occurred",
    scrollStart,
  }: {
    projectId: string;
    pageSize: number;
    sortDirection: "asc" | "desc";
    cursor: ClickHouseScrollCursor | null;
    protections: Protections;
    startDate?: number;
    endDate?: number;
    filterConditions?: string[];
    filterParams?: Record<string, unknown>;
    traceIds?: string[];
    query?: string;
    /** Fetch the heavy ComputedInput column. False prunes it. */
    fetchInput?: boolean;
    /** Fetch the heavy ComputedOutput column. False prunes it. */
    fetchOutput?: boolean;
    /** Time axis for the date window + keyset cursor. Default "occurred". */
    dateField?: TraceDateField;
    /**
     * Updated-axis snapshot point (epoch ms). Caps version resolution so every
     * page of one scroll sees the same latest-versions. Undefined on the
     * occurred axis, and on updated-axis cursors minted before it existed.
     */
    scrollStart?: number;
  }): Promise<{ summaries: TraceSummaryData[]; totalHits: number }> {
    return this.tracer.withActiveSpan(
      "TraceLegacyReadClickHouseRepository.fetchTracesWithPagination",
      {
        attributes: { "tenant.id": projectId },
      },
      async (_span) => {
        const clickHouseClient = await this.resolveClient(projectId);

        // Additional filter conditions (already parameterized by the filter module)
        const { extraFilters, traceIdFilter } = buildPageFilterClauses({
          filterConditions,
          traceIds,
        });

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

        const searchFilter = buildSearchFilter({ effectiveQuery, protections });
        const { countQuery, idQuery, sharedParams, cursorParams, dateColumn, orderDirection } =
          buildPageStatements({
            projectId,
            startDate,
            endDate,
            filterParams,
            traceIds,
            effectiveQuery,
            scrollStart,
            cursor,
            sortDirection,
            dateField,
            extraFilters,
            searchFilter,
            traceIdFilter,
          });
        const [countResult, idsResult] = await Promise.all([
          clickHouseClient.query({
            query: countQuery,
            query_params: sharedParams,
            format: "JSONEachRow",
          }),
          clickHouseClient.query({
            query: idQuery,
            query_params: {
              ...sharedParams,
              ...cursorParams,
              pageSize,
            },
            format: "JSONEachRow",
          }),
        ]);

        const [countRows, idRows] = await Promise.all([
          countResult.json().then((rows) => totalRowsSchema.parse(rows)),
          idsResult.json().then((rows) => traceIdRowsSchema.parse(rows)),
        ]);

        const totalHits = parseInt(countRows[0]?.total ?? "0", 10);
        const pageTraceIds = idRows.map((r) => r.TraceId);

        if (pageTraceIds.length === 0) {
          return { summaries: [], totalHits };
        }

        // Step 2: Fetch full data for just the page's trace IDs.
        // The dedup subquery is scoped to pageTraceIds so it only reads
        // N traces instead of the entire table.
        const summaryRows = await this.fetchTraceSummaryRows({
          clickHouseClient,
          projectId,
          startDate: startDate ?? 0,
          endDate: endDate ?? nowInstant().epochMilliseconds,
          traceIds: pageTraceIds,
          orderDirection,
          fetchInput,
          fetchOutput,
          dateColumn,
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
  private async fetchTraceSummaryRows({
    clickHouseClient,
    projectId,
    startDate,
    endDate,
    traceIds,
    orderDirection,
    fetchInput = true,
    fetchOutput = true,
    dateColumn = "OccurredAt",
    scrollStart,
  }: {
    clickHouseClient: TraceClickHouseClient;
    projectId: string;
    startDate: number;
    endDate: number;
    traceIds: string[];
    orderDirection: string;
    /** Fetch the heavy Computed* columns independently. False reads '' instead —
     * the row shape is unchanged but ClickHouse never materializes that column. */
    fetchInput?: boolean;
    fetchOutput?: boolean;
    /** Column the date window + ORDER BY run on (must match the page-ID query). */
    dateColumn?: "OccurredAt" | "UpdatedAt";
    /**
     * Updated-axis snapshot point (epoch ms) — must match the id-query's. This query
     * re-resolves each trace's latest version, so an uncapped read could hand back a newer
     * version than the page was selected on.
     */
    scrollStart?: number;
  }): Promise<TraceSummaryRow[]> {
    // dateColumn is interpolated into SQL and reachable from paths that are only
    // TypeScript-narrowed — assert here so a non-enum value can never reach the query string.
    if (dateColumn !== "OccurredAt" && dateColumn !== "UpdatedAt") {
      throw new Error(`Invalid dateColumn: ${String(dateColumn)}`);
    }
    const computedInputExpr = fetchInput ? "ts.ComputedInput" : "''";
    const computedOutputExpr = fetchOutput ? "ts.ComputedOutput" : "''";
    const isUpdatedAxis = dateColumn === "UpdatedAt";
    const sortColumn = isUpdatedAxis ? "ts_UpdatedAt" : "ts_OccurredAt";
    // Updated axis dedups on the GLOBAL max(UpdatedAt) — the page IDs were
    // already filtered by the id-query's HAVING, so no date window is applied
    // here (windowing would re-introduce the in-window-max staleness). Occurred
    // axis windows the partition column in both the outer scan and the dedup.
    const outerWindow = isUpdatedAxis
      ? ""
      : `AND ts.${dateColumn} >= fromUnixTimestamp64Milli({startDate:UInt64})
            AND ts.${dateColumn} <= fromUnixTimestamp64Milli({endDate:UInt64})`;
    const dedupWindow = isUpdatedAxis
      ? ""
      : `AND ${dateColumn} >= fromUnixTimestamp64Milli({startDate:UInt64})
                AND ${dateColumn} <= fromUnixTimestamp64Milli({endDate:UInt64})`;
    // Same snapshot bound the id-query applied, so both stages resolve the same
    // version of every trace. Updated axis only; the occurred axis has no
    // scrollStart and its SQL is unchanged.
    const dedupScrollBound =
      isUpdatedAxis && scrollStart !== undefined
        ? " AND UpdatedAt <= fromUnixTimestamp64Milli({scrollStart:UInt64})"
        : "";
    const runQuery = async (ids: string[]) => {
      const result = await clickHouseClient.query({
        query: `
          SELECT
            ts.TraceId AS ts_TraceId,
            ts.SpanCount AS ts_SpanCount,
            ts.TotalDurationMs AS ts_TotalDurationMs,
            ts.ComputedIOSchemaVersion AS ts_ComputedIOSchemaVersion,
            ts.TimeToFirstTokenMs AS ts_TimeToFirstTokenMs,
            ts.TimeToLastTokenMs AS ts_TimeToLastTokenMs,
            ts.TokensPerSecond AS ts_TokensPerSecond,
            ts.ContainsErrorStatus AS ts_ContainsErrorStatus,
            ts.ContainsOKStatus AS ts_ContainsOKStatus,
            ts.ErrorMessage AS ts_ErrorMessage,
            ts.Models AS ts_Models,
            ts.TotalCost AS ts_TotalCost,
            ts.NonBilledCost AS ts_NonBilledCost,
            ts.TokensEstimated AS ts_TokensEstimated,
            ts.TotalPromptTokenCount AS ts_TotalPromptTokenCount,
            ts.TotalCompletionTokenCount AS ts_TotalCompletionTokenCount,
            ts.TopicId AS ts_TopicId,
            ts.SubTopicId AS ts_SubTopicId,
            ts.HasAnnotation AS ts_HasAnnotation,
            ts.AnnotationIds AS ts_AnnotationIds,
            ${computedInputExpr} AS ts_ComputedInput,
            ${computedOutputExpr} AS ts_ComputedOutput,
            ts.Attributes AS ts_Attributes,
            ts.TraceName AS ts_TraceName,
            ts.Version AS ts_Version,
            ts.EarliestSpanStartMs AS ts_EarliestSpanStartMs,
            toUnixTimestamp64Milli(ts.OccurredAt) AS ts_OccurredAt,
            toUnixTimestamp64Milli(ts.CreatedAt) AS ts_CreatedAt,
            toUnixTimestamp64Milli(ts.UpdatedAt) AS ts_UpdatedAt
          FROM trace_summaries ts
          WHERE ts.TenantId = {tenantId:String}
            ${outerWindow}
            AND ts.TraceId IN ({pageTraceIds:Array(String)})
            AND (ts.TenantId, ts.TraceId, ts.UpdatedAt) IN (
              SELECT TenantId, TraceId, max(UpdatedAt)
              FROM trace_summaries
              WHERE TenantId = {tenantId:String}
                ${dedupWindow}
                ${dedupScrollBound}
                AND TraceId IN ({pageTraceIds:Array(String)})
              GROUP BY TenantId, TraceId
            )
          ORDER BY ts.${dateColumn} ${orderDirection}, ts.TraceId ${orderDirection}
        `,
        query_params: {
          tenantId: projectId,
          startDate,
          endDate,
          pageTraceIds: ids,
          ...(dedupScrollBound !== "" ? { scrollStart } : {}),
        },
        format: "JSONEachRow",
      });
      return traceSummaryRowsSchema.parse(await result.json());
    };

    try {
      return await runQuery(traceIds);
    } catch (error) {
      if (!TraceLegacyReadClickHouseRepository.isClickHouseMemoryLimitError(error)) {
        throw error;
      }

      return this.fetchTraceSummaryRowsInBatches({
        traceIds,
        orderDirection,
        sortColumn,
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
    reader,
    projectId,
    summaries,
  }: {
    reader: TenantScopedReader;
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
    const {
      outer: spanTimeFilterOuter,
      inner: spanTimeFilterInner,
      params: spanTimeParams,
    } = buildEventOccurrenceWindows(occurredAts);

    const result = await reader.query({
      query: `
        SELECT
          t.TraceId AS TraceId,
          t.SpanId AS SpanId,
          toUnixTimestamp64Milli(t.StartTime) AS StartTimeMs,
          toUnixTimestamp64Milli(t.EndTime) AS EndTimeMs,
          mapFilter((k, v) -> startsWith(k, 'event.'), t.SpanAttributes) AS EventAttrs
        FROM stored_spans AS t
        WHERE ${tenantScope("StartTime")}
          AND t.TraceId IN ({traceIds:Array(String)})
          ${spanTimeFilterOuter}
          AND mapContains(t.SpanAttributes, 'event.type')
          AND (t.TenantId, t.TraceId, t.SpanId, t.UpdatedAt) IN (
            SELECT TenantId, TraceId, SpanId, max(UpdatedAt)
            FROM stored_spans
            WHERE ${tenantScope("StartTime")}
              AND TraceId IN ({traceIds:Array(String)})
              ${spanTimeFilterInner}
              AND mapContains(SpanAttributes, 'event.type')
            GROUP BY TenantId, TraceId, SpanId
          )
        ORDER BY t.TraceId, t.StartTime ASC
        LIMIT {maxEvents:UInt32} BY t.TraceId
      `,
      query_params: {
        traceIds,
        maxEvents: MAX_EVENTS_PER_TRACE,
        ...spanTimeParams,
      },
      format: "JSONEachRow",
    });

    const rows = eventSpanRowsSchema.parse(await result.json());
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
    reader,
    traceIds,
  }: {
    reader: TenantScopedReader;
    traceIds: string[];
  }): Promise<ClickHouseEvaluationRunRow[]> {
    const runQuery = async (ids: string[]) => {
      const result = await reader.query({
        query: `
          SELECT ${EVALUATION_RUN_COLUMNS_WITH_INPUTS}
          FROM evaluation_runs
          WHERE ${tenantScope("ScheduledAt")}
            AND TraceId IN ({traceIds:Array(String)})
            AND (TenantId, EvaluationId, UpdatedAt) IN (
              SELECT TenantId, EvaluationId, max(UpdatedAt)
              FROM evaluation_runs
              WHERE ${tenantScope("ScheduledAt")}
                AND TraceId IN ({traceIds:Array(String)})
              GROUP BY TenantId, EvaluationId
            )
        `,
        query_params: {
          traceIds: ids,
        },
        format: "JSONEachRow",
      });
      return evaluationRunRowsSchema.parse(await result.json());
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
    reader,
    traceIds,
  }: {
    reader: TenantScopedReader;
    traceIds: string[];
  }): Promise<OccurredAtRange | undefined> {
    if (traceIds.length === 0) {
      return undefined;
    }
    const result = await reader.query({
      query: `
        SELECT
          toUnixTimestamp64Milli(min(OccurredAt)) AS fromMs,
          toUnixTimestamp64Milli(max(OccurredAt)) AS toMs
        FROM trace_summaries
        WHERE ${tenantScope("OccurredAt")}
          AND TraceId IN ({traceIds:Array(String)})
          AND OccurredAt > fromUnixTimestamp64Milli(0)
      `,
      query_params: { traceIds },
      format: "JSONEachRow",
    });
    const rows = occurredAtRangeRowsSchema.parse(await result.json());
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
    reader,
    projectId,
    traceIds,
    occurredAt,
    retentionDays,
  }: {
    reader: TenantScopedReader;
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
        const effectiveOccurredAt =
          occurredAt ?? (await this.resolveOccurredAtOrNone({ reader, projectId, traceIds }));
        const batchRead = { reader, projectId, effectiveOccurredAt, retentionDays };

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
    reader,
    projectId,
    traceIds,
  }: {
    reader: TenantScopedReader;
    projectId: string;
    traceIds: string[];
  }): Promise<OccurredAtRange | undefined> {
    // Callers that already know the traces' time pass `occurredAt`; thread-view paths only
    // have trace ids. Without a window the summary read below filters on TraceId alone, which
    // cannot prune partitions, so resolve the OccurredAt span from a cheap sort-key seek first.
    return this.resolveOccurredAtRange({ reader, traceIds }).catch((error) => {
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
      return undefined;
    });
  }

  /**
   * On OOM, re-reads in fixed-size batches under a span budget; see
   * {@link MAX_SPANS_PER_JOINED_FALLBACK}.
   */
  private async readJoinedTracesInBatches({
    reader,
    projectId,
    effectiveOccurredAt,
    retentionDays,
    traceIds,
  }: {
    reader: TenantScopedReader;
    projectId: string;
    effectiveOccurredAt: OccurredAtRange | undefined;
    retentionDays: RetentionDaysProvider | undefined;
    traceIds: string[];
  }): Promise<Map<string, TraceLegacyRow>> {
    const batchRead = { reader, projectId, effectiveOccurredAt, retentionDays };

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
    reader,
    projectId,
    effectiveOccurredAt,
    retentionDays,
    batchTraceIds,
    maxSpanRows,
  }: {
    reader: TenantScopedReader;
    projectId: string;
    effectiveOccurredAt: OccurredAtRange | undefined;
    retentionDays: RetentionDaysProvider | undefined;
    batchTraceIds: string[];
    /** Rows the span read may return before ClickHouse refuses it. */
    maxSpanRows?: number;
  }): Promise<Map<string, TraceLegacyRow>> {
    const { summaryRows, hasSummaryWindow } = await this.readJoinedSummaryRows({
      reader,
      effectiveOccurredAt,
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
      reader,
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
    reader,
    effectiveOccurredAt,
    batchTraceIds,
  }: {
    reader: TenantScopedReader;
    effectiveOccurredAt: OccurredAtRange | undefined;
    batchTraceIds: string[];
  }): Promise<{ summaryRows: TraceSummaryRow[]; hasSummaryWindow: boolean }> {
    // When the caller knows the traces' approximate time, bound the summary read to those
    // weekly partitions with a ±2-day safety margin; without a hint keep the unbounded read.
    // resolveOccurredAtRange yields a range, not a point, so map it onto queryWindowed's
    // centre+half-width form. Fallback "none": an empty result is authoritative here, and
    // the caller below skips the span scan rather than widening it.
    const hasSummaryWindow =
      effectiveOccurredAt !== undefined &&
      effectiveOccurredAt.from > 0 &&
      effectiveOccurredAt.to > 0;
    const summaryHintMs = hasSummaryWindow
      ? (effectiveOccurredAt.from + effectiveOccurredAt.to) / 2
      : null;
    const summaryWindowMs = hasSummaryWindow
      ? (effectiveOccurredAt.to - effectiveOccurredAt.from) / 2 + DEFAULT_PARTITION_WINDOW_MS
      : DEFAULT_PARTITION_WINDOW_MS;

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
        const summaryTimeFilterOuter = window ? window.sqlFor("t.OccurredAt") : "";
        const summaryTimeFilterInner = window ? window.sqlFor("OccurredAt") : "";
        const summaryResult = await reader.query({
          query: `
        SELECT
          TraceId AS ts_TraceId,
          SpanCount AS ts_SpanCount,
          TotalDurationMs AS ts_TotalDurationMs,
          ComputedIOSchemaVersion AS ts_ComputedIOSchemaVersion,
          ComputedInput AS ts_ComputedInput,
          ComputedOutput AS ts_ComputedOutput,
          TimeToFirstTokenMs AS ts_TimeToFirstTokenMs,
          TimeToLastTokenMs AS ts_TimeToLastTokenMs,
          TokensPerSecond AS ts_TokensPerSecond,
          ContainsErrorStatus AS ts_ContainsErrorStatus,
          ContainsOKStatus AS ts_ContainsOKStatus,
          ErrorMessage AS ts_ErrorMessage,
          Models AS ts_Models,
          TotalCost AS ts_TotalCost,
          NonBilledCost AS ts_NonBilledCost,
          TokensEstimated AS ts_TokensEstimated,
          TotalPromptTokenCount AS ts_TotalPromptTokenCount,
          TotalCompletionTokenCount AS ts_TotalCompletionTokenCount,
          TopicId AS ts_TopicId,
          SubTopicId AS ts_SubTopicId,
          HasAnnotation AS ts_HasAnnotation,
          AnnotationIds AS ts_AnnotationIds,
          Attributes AS ts_Attributes,
          TraceName AS ts_TraceName,
          Version AS ts_Version,
          EarliestSpanStartMs AS ts_EarliestSpanStartMs,
          toUnixTimestamp64Milli(OccurredAt) AS ts_OccurredAt,
          toUnixTimestamp64Milli(CreatedAt) AS ts_CreatedAt,
          toUnixTimestamp64Milli(UpdatedAt) AS ts_UpdatedAt
        FROM trace_summaries AS t
        WHERE ${tenantScope("OccurredAt")}
          AND t.TraceId IN ({traceIds:Array(String)})
          ${summaryTimeFilterOuter}
          AND (t.TenantId, t.TraceId, t.UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM trace_summaries
            WHERE ${tenantScope("OccurredAt")}
              AND TraceId IN ({traceIds:Array(String)})
              ${summaryTimeFilterInner}
            GROUP BY TenantId, TraceId
          )
        ORDER BY t.TraceId
      `,
          query_params: {
            traceIds: batchTraceIds,
            ...window?.params,
          },
          format: "JSONEachRow",
        });
        return traceSummaryRowsSchema.parse(await summaryResult.json());
      },
    });
    return { summaryRows, hasSummaryWindow };
  }

  private async readJoinedSpanRows({
    reader,
    projectId,
    batchTraceIds,
    spanRange,
    maxSpanRows,
    retentionDays,
  }: {
    reader: TenantScopedReader;
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
        // Always present now: a hint yields the hinted fragment, and the
        // hint-less path yields the retention floor's fragment. The null
        // arm is kept only because the shared contract permits it.
        const spanTimeFilterOuter = window ? window.sqlFor("t.StartTime") : "";
        const spanTimeFilterInner = window ? window.sqlFor("StartTime") : "";
        const spansResult = await reader.query({
          query: `
        SELECT
          SpanId,
          TraceId,
          TenantId,
          ParentSpanId,
          ParentTraceId,
          ParentIsRemote,
          Sampled,
          toUnixTimestamp64Milli(StartTime) AS StartTime,
          toUnixTimestamp64Milli(EndTime) AS EndTime,
          DurationMs,
          SpanName,
          SpanKind,
          ResourceAttributes,
          SpanAttributes,
          StatusCode,
          StatusMessage,
          ScopeName,
          ScopeVersion,
          arrayMap(x -> toUnixTimestamp64Milli(x), \`Events.Timestamp\`) AS Events_Timestamp,
          \`Events.Name\` AS Events_Name,
          \`Events.Attributes\` AS Events_Attributes,
          \`Links.TraceId\` AS Links_TraceId,
          \`Links.SpanId\` AS Links_SpanId,
          \`Links.Attributes\` AS Links_Attributes
        FROM stored_spans AS t
        WHERE ${tenantScope("StartTime")}
          AND t.TraceId IN ({traceIds:Array(String)})
          ${spanTimeFilterOuter}
          AND (t.TenantId, t.TraceId, t.SpanId, t.StartTime) IN (
            SELECT TenantId, TraceId, SpanId, max(StartTime)
            FROM stored_spans
            WHERE ${tenantScope("StartTime")}
              AND TraceId IN ({traceIds:Array(String)})
              ${spanTimeFilterInner}
            GROUP BY TenantId, TraceId, SpanId
          )
        ORDER BY t.TraceId, t.StartTime ASC
        LIMIT ${MAX_SPANS_PER_TRACE} BY t.TraceId
      `,
          query_params: {
            traceIds: batchTraceIds,
            ...window?.params,
          },
          clickhouse_settings: spanReadSettings,
          format: "JSONEachRow",
        });
        return joinedSpanRowsSchema.parse(await spansResult.json());
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
      StartTime: number;
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
      startTimeUnixMs: row.StartTime,
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
