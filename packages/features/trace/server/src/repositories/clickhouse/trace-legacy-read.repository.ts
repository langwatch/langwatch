import type { Protections } from "@langwatch/trace-contract";
import { TraceWindowedReadService } from "../../services/trace-windowed-read.service.ts";
import { TraceEvaluationMappingService } from "../../services/trace-evaluation-mapping.service.ts";
import { TraceEventAttributeMappingService } from "../../services/trace-event-attribute-mapping.service.ts";
import { TraceLlmSpanMessagesService } from "../../services/trace-llm-span-messages.service.ts";
import type { ClickHouseClient } from "@clickhouse/client";
import { type AnnotationService, annotationSuggestedOutput } from "@langwatch/annotation-contract";
import type { DataRetentionService } from "@langwatch/data-retention-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { LLM_PARAMETER_MAP, parsePromptTraceReference } from "@langwatch/prompt-contract";
import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
import { getLangWatchTracer } from "langwatch";
import { TraceRetentionFloorService } from "../../services/trace-retention-floor.service.ts";
import { TraceLegacyReadRepository } from "../trace-legacy-read.repository.ts";
import { DEFAULT_PARTITION_WINDOW_MS } from "../../services/trace-windowed-read.service.ts";
import { deserializeAttributes, ensureStringRecord } from "@langwatch/trace-server";
import type { ExtractedIO } from "#rules/trace-io-text.rules";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import {
  type ClickHouseEvaluationRunRow,
  EVALUATION_RUN_COLUMNS_WITH_INPUTS,
} from "../../services/trace-evaluation-mapping.service.ts";
import { isStorageAnchoredVersion } from "@langwatch/trace-contract";
import type {
  NormalizedSpan,
  NormalizedSpanKind,
  NormalizedStatusCode,
} from "@langwatch/trace-contract";
import type { Event, Span, Trace } from "@langwatch/trace-contract";

import { findPromptReferenceInAncestors } from "@langwatch/trace-contract";
import { TraceReadRedactionService } from "../../services/trace-read-redaction.service.ts";
import { TraceLegacySpanMappingService } from "../../services/trace-legacy-span-mapping.service.ts";
import { TraceLegacySummaryMappingService } from "../../services/trace-legacy-summary-mapping.service.ts";
import { type EventSpanRow } from "../../services/trace-event-attribute-mapping.service.ts";
import type { ProjectableTrace, ProjectedAnnotation } from "@langwatch/trace-contract";
import type { ResolvedTraceSpans } from "../../services/trace-offload-resolution.service.ts";
import type {
  CustomersAndLabelsResult,
  DistinctFieldNamesResult,
  PromptStudioSpanResult,
  TopicCountsResult,
  TracesForProjectResult,
  TraceWithGuardrail,
} from "@langwatch/trace-contract";
import type {
  AggregationFiltersInput,
  GetAllTracesForProjectInput,
  GetAllTracesForProjectOptions,
  TraceDateField,
} from "@langwatch/trace-contract";

/**
 * Callback injected from TraceService that resolves offloaded blob refs for
 * a single trace's normalized spans (ADR-021 decision B: read-time recompute).
 * When present, called after fetching spans but before mapping to legacy Span.
 */
export type ResolveTraceSpansFn = (
  projectId: string,
  normalizedSpans: NormalizedSpan[],
) => Promise<ResolvedTraceSpans>;

/**
 * Resolves offloaded blob refs for a whole result set in one bounded pass, so a bulk read
 * (getTracesWithSpans, enrichTracesWithSpans) streams event_log reads instead of fanning out
 * per trace. Falls back to {@link ResolveTraceSpansFn} when absent.
 */
export type ResolveTraceSpansBatchFn = (
  projectId: string,
  spansPerTrace: NormalizedSpan[][],
) => Promise<ResolvedTraceSpans[]>;

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

  const sorted = [...occurredAts].sort((a, b) => a - b);
  // Merge points whose ±window ranges would overlap; split when farther apart.
  const clusterGap = 2 * EVENT_PARTITION_WINDOW_MS;
  const clusters: Array<{ from: number; to: number }> = [];
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
export class ClickHouseClientUnavailableError extends Error {
  constructor(projectId: string) {
    super(
      `No ClickHouse client could be resolved for project "${projectId}" — check ClickHouse client configuration (CLICKHOUSE_URL)`,
    );
    this.name = "ClickHouseClientUnavailableError";
  }
}

/**
 * Thrown when an injected {@link ResolveTraceSpansBatchFn} doesn't return exactly one resolution
 * per input trace, in input order. `ResolvedTraceSpans` carries no trace identity of its own, so
 * this pairing is enforced here at the call boundary instead of by the type. Always a resolver bug.
 */
export class TraceSpansBatchResolverContractError extends Error {
  private constructor(message: string) {
    super(message);
    this.name = "TraceSpansBatchResolverContractError";
  }

  /** Wrong number of resolutions — entries were dropped or invented. */
  static cardinality({
    got,
    expected,
  }: {
    got: number;
    expected: number;
  }): TraceSpansBatchResolverContractError {
    return new TraceSpansBatchResolverContractError(
      `resolveTraceSpansBatch returned ${got} resolution(s) for ${expected} trace(s); it must return exactly one per input trace, in input order`,
    );
  }

  /** Right count, wrong pairing — the silent-corruption case. */
  static misaligned({
    index,
    expected,
    got,
  }: {
    index: number;
    expected: string;
    got: string;
  }): TraceSpansBatchResolverContractError {
    return new TraceSpansBatchResolverContractError(
      `resolveTraceSpansBatch returned ${got} at position ${index}, where ${expected} was supplied; resolutions must come back in input order`,
    );
  }
}

/**
 * Service for fetching traces from ClickHouse.
 */
/** The analytics filter vocabulary translated into a ClickHouse predicate. */
export type TraceLegacyFilterConditions = (
  filters: Record<string, unknown>,
  window: { startDate: number; endDate: number },
) => {
  conditions: string[];
  params: Record<string, unknown>;
  hasUnsupportedFilters: boolean;
};

export class TraceLegacyReadClickHouseRepository extends TraceLegacyReadRepository {
  private readonly logger = createLogger("langwatch:traces:clickhouse-service");
  private readonly tracer = getLangWatchTracer("langwatch.traces.clickhouse-service");

  /**
   * Optional callback that resolves offloaded blob refs for a single trace's normalized spans
   * before they map to legacy Span objects. Owns blob-resolution deps at a single composition
   * point. When absent, spans are mapped as-is (preview values remain).
   */
  private readonly resolveTraceSpans: ResolveTraceSpansFn | undefined;

  /**
   * Optional bulk resolver for whole result sets. Preferred over {@link resolveTraceSpans} on
   * bulk read paths so a large export/thread resolves its blobs in one bounded-concurrency pass.
   * Falls back to the per-trace resolver when absent.
   */
  private readonly resolveTraceSpansBatch: ResolveTraceSpansBatchFn | undefined;

  private readonly resolveClickHouseClient:
    | ((tenantId: string) => Promise<ClickHouseClient>)
    | undefined;
  private readonly filterConditions: TraceLegacyFilterConditions | undefined;
  private readonly annotations: AnnotationService | undefined;
  private readonly traceCanonicalisation: TraceCanonicalisationService;

  constructor({
    resolveClickHouseClient,
    filterConditions,
    resolveTraceSpans,
    resolveTraceSpansBatch,
    retentionResolver,
    annotations,
    traceCanonicalisation,
  }: {
    resolveClickHouseClient?: ((tenantId: string) => Promise<ClickHouseClient>) | undefined;
    filterConditions?: TraceLegacyFilterConditions | undefined;
    resolveTraceSpans?: ResolveTraceSpansFn;
    resolveTraceSpansBatch?: ResolveTraceSpansBatchFn;
    /**
     * Widens the span read's retention floor to this tenant's own policy.
     * Optional: without it the floor stays at {@link SPAN_READ_FLOOR_LOOKBACK_MS}.
     */
    retentionResolver?: DataRetentionService;
    annotations?: AnnotationService;
    traceCanonicalisation: TraceCanonicalisationService;
  }) {
    super();
    this.resolveClickHouseClient = resolveClickHouseClient;
    this.filterConditions = filterConditions;
    this.annotations = annotations;
    this.traceCanonicalisation = traceCanonicalisation;
    this.resolveTraceSpans = resolveTraceSpans;
    this.resolveTraceSpansBatch = resolveTraceSpansBatch;
    this.retentionFloor = TraceRetentionFloorService.create(retentionResolver);
  }

  private readonly retentionFloor: ReturnType<typeof TraceRetentionFloorService.create>;

  /**
   * Resolve the ClickHouse client for a given project.
   */
  /** Translates the caller's filter selection into a ClickHouse predicate. */
  private translateFilters(
    filters: Record<string, unknown>,
    window: { startDate: number; endDate: number },
  ): { conditions: string[]; params: Record<string, unknown>; hasUnsupportedFilters: boolean } {
    if (Object.keys(filters).length === 0) {
      return { conditions: [], params: {}, hasUnsupportedFilters: false };
    }
    const translate = this.filterConditions;
    if (!translate) {
      throw new Error(
        "This process composed no analytics filter translator, so a filtered trace list cannot be narrowed. Listing every trace instead would answer a narrowed question with the whole project.",
      );
    }
    return translate(filters, window);
  }

  private async resolveClient(projectId: string): Promise<ClickHouseClient> {
    const resolve = this.resolveClickHouseClient;
    if (!resolve) {
      throw new ClickHouseClientUnavailableError(projectId);
    }
    return resolve(projectId);
  }

  /**
   * Static factory method for creating TraceLegacyReadClickHouseRepository with explicit
   * canonicalisation and retention dependencies.
   */
  static create({
    resolveClickHouseClient,
    filterConditions,
    resolveTraceSpans,
    resolveTraceSpansBatch,
    retentionResolver,
    annotations,
    traceCanonicalisation,
  }: {
    /** The process's tenant-keyed connection, or none where it composed one. */
    resolveClickHouseClient?: ((tenantId: string) => Promise<ClickHouseClient>) | undefined;
    /** The analytics filter translator; absent, a filtered list refuses. */
    filterConditions?: TraceLegacyFilterConditions | undefined;
    resolveTraceSpans?: ResolveTraceSpansFn;
    resolveTraceSpansBatch?: ResolveTraceSpansBatchFn;
    retentionResolver?: DataRetentionService;
    annotations?: AnnotationService;
    traceCanonicalisation: TraceCanonicalisationService;
  }): TraceLegacyReadClickHouseRepository {
    return new TraceLegacyReadClickHouseRepository({
      resolveClickHouseClient,
      filterConditions,
      resolveTraceSpans,
      resolveTraceSpansBatch,
      retentionResolver,
      annotations,
      traceCanonicalisation,
    });
  }

  /**
   * @param occurredAt approximate time range bounding the partition scan.
   * @param opts.resolveBlobs resolves offloaded IO.
   */
  async getTracesWithSpans(
    projectId: string,
    traceIds: string[],
    protections: Protections,
    occurredAt?: OccurredAtRange,
    opts?: { resolveBlobs?: boolean },
  ): Promise<Trace[]> {
    return await this.tracer.withActiveSpan(
      "TraceLegacyReadClickHouseRepository.getTracesWithSpans",
      {
        attributes: { "tenant.id": projectId },
      },
      async () => {
        // Resolved up front (and discarded) so a configuration problem
        // surfaces as ClickHouseClientUnavailableError rather than the
        // generic fetch failure from the try/catch below.
        await this.resolveClient(projectId);

        if (traceIds.length === 0) {
          return [];
        }

        this.logger.debug(
          { projectId, traceIdCount: traceIds.length },
          "Fetching traces with spans from ClickHouse",
        );

        try {
          // Fetch trace summaries with spans using JOIN
          const tracesWithSpans = await this.fetchTracesWithSpansJoined(
            projectId,
            traceIds,
            occurredAt,
          );

          // Map to legacy Trace format and apply protections. Blob resolution
          // (when opted in) runs as a single bounded pass over the whole set so
          // a large multi-trace read streams its event_log reads (#4991 AC6).
          const traces = await this.resolveAndMergeMany({
            projectId,
            entries: [...tracesWithSpans.values()],
            protections,
            resolveBlobs: opts?.resolveBlobs,
          });

          this.logger.debug(
            { projectId, traceCount: traces.length },
            "Successfully fetched traces from ClickHouse",
          );

          return traces;
        } catch (error) {
          // A resolver-contract violation is a code bug, not a fetch failure —
          // surface it verbatim rather than flattening it into the generic
          // message and losing the mismatch.
          if (error instanceof TraceSpansBatchResolverContractError) throw error;
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
    return await this.tracer.withActiveSpan(
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

          const rows = (await result.json()) as Array<{ TraceId: string }>;
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

  async getTracesByThreadId(
    projectId: string,
    threadId: string,
    protections: Protections,
    opts?: { resolveBlobs?: boolean },
  ): Promise<Trace[]> {
    return await this.tracer.withActiveSpan(
      "TraceLegacyReadClickHouseRepository.getTracesByThreadId",
      {
        attributes: { "tenant.id": projectId, "thread.id": threadId },
      },
      async () => {
        const clickHouseClient = await this.resolveClient(projectId);

        this.logger.debug({ projectId, threadId }, "Fetching traces by thread ID from ClickHouse");

        try {
          // Query trace_summaries for traces with matching thread_id
          // Thread ID can be stored under different attribute keys
          const result = await clickHouseClient.query({
            query: `
              SELECT DISTINCT TraceId
              FROM trace_summaries
              WHERE TenantId = {tenantId:String}
                AND Attributes['gen_ai.conversation.id'] = {threadId:String}
              ORDER BY CreatedAt ASC
              LIMIT 1000
            `,
            query_params: {
              tenantId: projectId,
              threadId,
            },
            format: "JSONEachRow",
          });

          const rows = (await result.json()) as Array<{ TraceId: string }>;
          const traceIds = rows.map((r) => r.TraceId);

          if (traceIds.length === 0) {
            return [];
          }

          // Fetch full traces with spans. Forward resolveBlobs so the
          // thread-detail read can resolve full IO (#4991); customer thread
          // views with no resolver wired stay on the preview.
          const traces = await this.getTracesWithSpans(
            projectId,
            traceIds,
            protections,
            undefined,
            { resolveBlobs: opts?.resolveBlobs },
          );

          // Re-sort by timestamp — getTracesWithSpans returns in TraceId
          // order which doesn't match the chronological order we need.
          traces.sort((a, b) => (a.timestamps.started_at ?? 0) - (b.timestamps.started_at ?? 0));
          return traces;
        } catch (error) {
          // See getTracesWithSpans: a resolver-contract violation is a code bug,
          // not a fetch failure — surface it verbatim.
          if (error instanceof TraceSpansBatchResolverContractError) throw error;
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

  /** @param opts.resolveBlobs forwarded to the per-trace fetch. */
  async getTracesWithSpansByThreadIds(
    projectId: string,
    threadIds: string[],
    protections: Protections,
    opts?: { resolveBlobs?: boolean },
  ): Promise<Trace[]> {
    return await this.tracer.withActiveSpan(
      "TraceLegacyReadClickHouseRepository.getTracesWithSpansByThreadIds",
      {
        attributes: {
          "tenant.id": projectId,
          "thread.count": threadIds.length,
        },
      },
      async () => {
        const clickHouseClient = await this.resolveClient(projectId);

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
          const result = await clickHouseClient.query({
            query: `
              SELECT DISTINCT TraceId
              FROM trace_summaries
              WHERE TenantId = {tenantId:String}
                AND Attributes['gen_ai.conversation.id'] IN ({threadIds:Array(String)})
              ORDER BY CreatedAt ASC
              LIMIT 1000
            `,
            query_params: {
              tenantId: projectId,
              threadIds,
            },
            format: "JSONEachRow",
          });

          const rows = (await result.json()) as Array<{ TraceId: string }>;
          const traceIds = rows.map((r) => r.TraceId);

          if (traceIds.length === 0) {
            return [];
          }

          // Forward resolveBlobs so the eval path reads full thread IO; customer thread
          // views pass nothing and stay on the preview.
          const traces = await this.getTracesWithSpans(
            projectId,
            traceIds,
            protections,
            undefined,
            { resolveBlobs: opts?.resolveBlobs },
          );

          // Re-sort by timestamp — getTracesWithSpans returns in TraceId
          // order which doesn't match the chronological order we need.
          traces.sort((a, b) => (a.timestamps.started_at ?? 0) - (b.timestamps.started_at ?? 0));
          return traces;
        } catch (error) {
          // Never flatten a resolver contract violation re-thrown by getTracesWithSpans.
          if (error instanceof TraceSpansBatchResolverContractError) throw error;
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

  async getAllTracesForProject(
    input: GetAllTracesForProjectInput,
    protections: Protections,
    options: GetAllTracesForProjectOptions = {},
  ): Promise<TracesForProjectResult> {
    return await this.tracer.withActiveSpan(
      "TraceLegacyReadClickHouseRepository.getAllTracesForProject",
      async (_span) => {
        const clickHouseClient = await this.resolveClient(input.projectId);

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
          let cursor: ClickHouseScrollCursor | null = null;
          if (options.scrollId) {
            this.logger.debug({ scrollId: options.scrollId }, "Parsing scrollId from request");
            try {
              cursor = JSON.parse(Buffer.from(options.scrollId, "base64").toString("utf-8"));

              // Validate that cursor parameters match current request
              if (cursor && cursor.sortDirection !== sortDirection) {
                this.logger.warn(
                  {
                    cursorSortDirection: cursor.sortDirection,
                    requestSortDirection: sortDirection,
                  },
                  "Sort direction mismatch in cursor, ignoring cursor",
                );
                cursor = null;
              } else if (cursor && cursor.pageSize !== pageSize) {
                this.logger.warn(
                  {
                    cursorPageSize: cursor.pageSize,
                    requestPageSize: pageSize,
                  },
                  "Page size mismatch in cursor, ignoring cursor",
                );
                cursor = null;
              } else if (
                cursor &&
                cursor.scrollStart !== undefined &&
                (typeof cursor.scrollStart !== "number" ||
                  !Number.isSafeInteger(cursor.scrollStart) ||
                  cursor.scrollStart <= 0)
              ) {
                // scrollStart binds as {scrollStart:UInt64}; a bad value would fail the query
                // outright instead of degrading, so drop the cursor like every other mismatch.
                // Safe INTEGER, not merely finite — UInt64 rejects 1.5 and 2**53 alike.
                this.logger.warn(
                  { cursorScrollStart: cursor.scrollStart },
                  "Invalid scrollStart in cursor, ignoring cursor",
                );
                cursor = null;
              } else if (cursor && (cursor.dateField ?? "occurred") !== dateField) {
                this.logger.warn(
                  {
                    cursorDateField: cursor.dateField ?? "occurred",
                    requestDateField: dateField,
                  },
                  "Date axis mismatch in cursor, ignoring cursor",
                );
                cursor = null;
              }

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
                  scrollId: options.scrollId,
                  error: e instanceof Error ? e.message : e,
                },
                "Invalid scrollId, starting from beginning",
              );
            }
          } else {
            this.logger.debug("No scrollId provided in request");
          }

          // Pass the dashboard time window so span/event filters bound their stored_spans
          // EXISTS subqueries to the same window, pruning partitions instead of cold-scanning.
          const {
            conditions: filterConditions,
            params: filterParams,
            hasUnsupportedFilters,
          } = this.translateFilters(input.filters ?? {}, {
            startDate: input.startDate,
            endDate: input.endDate,
          });

          if (hasUnsupportedFilters) {
            throw new Error("Filters contain unsupported fields for ClickHouse");
          }

          // Pinned once on the first page and carried by the cursor so every later page
          // resolves the same versions. Only the updated axis needs it — OccurredAt is immutable.
          const scrollStart =
            dateField === "updated"
              ? // A cursor minted before this field existed carries no snapshot; leave that
                // scroll uncapped rather than pinning it to a point it never read from.
                cursor
                ? cursor.scrollStart
                : Date.now()
              : undefined;

          // Clamp the requested endDate to scrollStart: nothing written after it is in the
          // scroll, and reporting a wider window than delivered is how a client loses rows on
          // resume. Returned as `updatedThrough` so the next pull starts where this one stopped.
          const effectiveEndDate =
            scrollStart !== undefined
              ? Math.min(input.endDate ?? scrollStart, scrollStart)
              : input.endDate;

          // Build the query with keyset pagination
          const {
            traces: fetchedTraces,
            totalHits,
            lastTrace,
          } = await this.fetchTracesWithPagination({
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
          let traces = fetchedTraces;

          // Spans are fetched when the caller wants them OR wants full IO — not the same thing.
          // trace_summaries holds only the 64 KB preview, so recovering the full value means
          // de-offloading spans and recomputing trace IO even for a spans-less summary read.
          const wantsSpans = options.includeSpans === true;
          const wantsFullIo = options.resolveBlobs === true;

          if ((wantsSpans || wantsFullIo) && traces.length > 0) {
            const enriched = await this.enrichTracesWithSpans(
              traces,
              input.projectId,
              protections,
              wantsFullIo,
            );

            // A summary caller keeps the recomputed trace-level IO but not the
            // spans it never asked for — the payload shape stays exactly as it
            // was before this branch could run for them.
            traces = wantsSpans ? enriched : enriched.map((trace) => ({ ...trace, spans: [] }));
          }

          // Generate new scrollId from last trace. The cursor seeks on the
          // axis we paged by: OccurredAt (started_at) or, for the updated axis,
          // the latest-version UpdatedAt — and records the axis so the next
          // page rejects a cursor from a different axis.
          let newScrollId: string | undefined;
          if (lastTrace && traces.length === pageSize) {
            const lastSortTimestamp =
              dateField === "updated"
                ? lastTrace.timestamps.updated_at
                : lastTrace.timestamps.started_at;
            const newCursor: ClickHouseScrollCursor = {
              lastTimestamp: lastSortTimestamp,
              lastTraceId: lastTrace.trace_id,
              pageSize,
              sortDirection,
              dateField,
              // Carried forward unchanged: the snapshot must be the one the
              // scroll started from, not a fresh reading per page.
              ...(scrollStart !== undefined ? { scrollStart } : {}),
            };
            newScrollId = Buffer.from(JSON.stringify(newCursor)).toString("base64");

            this.logger.debug(
              {
                lastTraceTimestamp: lastTrace.timestamps.started_at,
                lastTraceId: lastTrace.trace_id,
                tracesCount: traces.length,
                pageSize,
                newScrollId,
              },
              "Generated new scrollId",
            );
          }

          // Group traces (for now, single-trace groups unless groupBy is specified)
          const rawGroups = this.groupTraces(traces, input.groupBy);

          // Transform traces to include guardrail information
          const groups = rawGroups.map((group) => transformTracesWithGuardrails(group));

          this.logger.debug(
            {
              tracesReturned: traces.length,
              totalHits,
              hasScrollId: !!newScrollId,
              firstTraceId: traces[0]?.trace_id,
              firstTraceTimestamp: traces[0]?.timestamps.started_at,
              lastTraceId: traces[traces.length - 1]?.trace_id,
              lastTraceTimestamp: traces[traces.length - 1]?.timestamps.started_at,
            },
            "Returning traces result",
          );

          // Direct ClickHouse query, no extra isClickHouseEnabled roundtrip.
          const traceIds = groups.flat().map((t) => t.trace_id);
          let traceChecks: TracesForProjectResult["traceChecks"] = {};
          if (traceIds.length > 0) {
            const evalRows = await this.fetchEvaluationRows({
              clickHouseClient,
              projectId: input.projectId,
              traceIds,
            });

            const grouped: Record<
              string,
              ReturnType<
                typeof TraceEvaluationMappingService.mapClickHouseEvaluationToTraceEvaluation
              >[]
            > = {};
            for (const id of traceIds) {
              grouped[id] = [];
            }
            for (const row of evalRows) {
              if (row.TraceId && grouped[row.TraceId]) {
                grouped[row.TraceId]!.push(
                  TraceEvaluationMappingService.mapClickHouseEvaluationToTraceEvaluation(row),
                );
              }
            }

            traceChecks =
              TraceEvaluationMappingService.mapTraceEvaluationsToLegacyEvaluations(grouped);
          }

          // Projection JOINs — attach child collections the legacy read path
          // does not carry, scoped to this page's traces (never table-wide).
          // Evaluations already flow through traceChecks; events and annotations
          // are fetched here on demand. The compiled projector reads
          // trace.events / trace.annotations off these same objects.
          if (projection?.needsEvents || projection?.needsAnnotations) {
            const pageTraces = groups.flat() as unknown as ProjectableTrace[];
            if (projection.needsEvents) {
              await this.enrichTracesWithEventsForProjection({
                clickHouseClient,
                projectId: input.projectId,
                traces: pageTraces,
                protections,
              });
            }
            if (projection.needsAnnotations) {
              await this.enrichTracesWithAnnotationsForProjection({
                projectId: input.projectId,
                traces: pageTraces,
              });
            }
          }

          return {
            groups,
            totalHits,
            traceChecks,
            scrollId: newScrollId,
            ...(effectiveEndDate !== undefined && scrollStart !== undefined
              ? { updatedThrough: effectiveEndDate }
              : {}),
          };
        } catch (error) {
          this.logger.warn(
            {
              projectId: input.projectId,
              error: error instanceof Error ? error.message : error,
              stack: error instanceof Error ? error.stack : undefined,
            },
            "Failed to fetch all traces from ClickHouse",
          );
          throw error;
        }
      },
    );
  }

  /**
   * Get topic and subtopic counts for a project.
   * @param input - Filter parameters including projectId and date range
   * @returns TopicCountsResult
   */
  async getTopicCounts(input: AggregationFiltersInput): Promise<TopicCountsResult> {
    return await this.tracer.withActiveSpan(
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
              endDate: input.endDate ?? Date.now(),
            },
            format: "JSONEachRow",
          });

          const rows = (await result.json()) as Array<{
            TopicId: string | null;
            SubTopicId: string | null;
            count: string;
          }>;

          // Aggregate counts by topic and subtopic
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
  async getCustomersAndLabels(input: AggregationFiltersInput): Promise<CustomersAndLabelsResult> {
    return await this.tracer.withActiveSpan(
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
              endDate: input.endDate ?? Date.now(),
            },
            format: "JSONEachRow",
          });

          const customerRows = (await customerResult.json()) as Array<{
            customer_id: string;
          }>;

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
              endDate: input.endDate ?? Date.now(),
            },
            format: "JSONEachRow",
          });

          const labelsRows = (await labelsResult.json()) as Array<{
            labels_json: string;
          }>;

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

  async tryGetSpanForPromptStudio({
    projectId,
    spanId,
    protections,
  }: {
    projectId: string;
    spanId: string;
    protections: Protections;
  }): Promise<PromptStudioSpanResult | null> {
    return await this.tracer.withActiveSpan(
      "TraceLegacyReadClickHouseRepository.tryGetSpanForPromptStudio",
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

          const allRows = (await queryResult.json()) as Array<{
            SpanId: string;
            TraceId: string;
            ParentSpanId: string | null;
            SpanName: string;
            SpanAttributes: Record<string, unknown>;
            StartTime: number;
            EndTime: number;
            DurationMs: number;
            StatusCode: number | null;
            StatusMessage: string | null;
          }>;

          const requestedRow = allRows.find((r) => r.SpanId === spanId);
          if (!requestedRow) {
            return null;
          }

          // If the caller pointed at a non-llm span, resolve to the nearest llm span the
          // operator most likely meant: a descendant first, then a later sibling. The
          // playground form needs an llm span's messages + config.
          const requestedType = requestedRow.SpanAttributes["langwatch.span.type"] as
            | string
            | undefined;
          const row =
            requestedType === "llm"
              ? requestedRow
              : (findNearestLlm(allRows, requestedRow) ?? null);
          if (!row) {
            return null;
          }

          // Extract span data from attributes
          const result = this.extractPromptStudioDataFromClickHouse(row, protections);

          // If the LLM span itself doesn't have a prompt reference,
          // search ancestors and their siblings to find it (SDK sets it on
          // sibling spans like Prompt.compile or PromptApiService.get)
          if (!result.promptHandle) {
            const ancestorSpans = allRows.map((r) => {
              const attributes: Record<string, unknown> = {};
              const promptId = r.SpanAttributes["langwatch.prompt.id"];
              if (promptId) attributes["langwatch.prompt.id"] = promptId;
              const promptVars = r.SpanAttributes["langwatch.prompt.variables"];
              if (promptVars) attributes["langwatch.prompt.variables"] = promptVars;
              const promptHandle = r.SpanAttributes["langwatch.prompt.handle"];
              if (promptHandle) attributes["langwatch.prompt.handle"] = promptHandle;
              const promptVersion = r.SpanAttributes["langwatch.prompt.version.number"];
              if (promptVersion) attributes["langwatch.prompt.version.number"] = promptVersion;
              return {
                spanId: r.SpanId,
                parentSpanId: r.ParentSpanId ?? null,
                startTime: r.StartTime,
                attributes,
              };
            });

            const ancestorRef = findPromptReferenceInAncestors({
              targetSpanId: row.SpanId,
              spans: ancestorSpans,
            });
            if (ancestorRef?.promptHandle) {
              result.promptHandle = ancestorRef.promptHandle;
              result.promptVersionNumber = ancestorRef.promptVersionNumber;
              result.promptTag = ancestorRef.promptTag;
              result.promptVariables = ancestorRef.promptVariables;
            }
          }

          return result;
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
   * Extract prompt studio data from ClickHouse span row.
   * @internal
   */
  private extractPromptStudioDataFromClickHouse(
    row: {
      SpanId: string;
      TraceId: string;
      SpanName: string;
      SpanAttributes: Record<string, unknown>;
      StartTime: number;
      EndTime: number;
      DurationMs: number;
      StatusCode: number | null;
      StatusMessage: string | null;
    },
    _protections: Protections,
  ): PromptStudioSpanResult {
    const attrs = row.SpanAttributes;
    // Pure extraction of input + output messages from the span's
    // attributes. Lives in TraceLlmSpanMessagesService.parseLLMSpanMessages.ts so the wire-shape
    // contract — including the single-message-object form nlpgo emits
    // for langwatch.output — is unit-testable without standing up the
    // full service. See that file's docstring for the shape catalog.
    const messages: PromptStudioSpanResult["messages"] =
      TraceLlmSpanMessagesService.parseLLMSpanMessages(attrs);

    // Extract LLM config
    const model =
      (attrs["gen_ai.response.model"] as string) ??
      (attrs["gen_ai.request.model"] as string) ??
      (attrs["llm.model"] as string) ??
      null;
    const vendor = (attrs["gen_ai.system"] as string) ?? null;

    // Build llmConfig dynamically from the parameter map
    const llmConfig: PromptStudioSpanResult["llmConfig"] = {
      model,
      systemPrompt: messages.find((m) => m.role === "system")?.content,
      temperature: null,
      maxTokens: null,
      topP: null,
      frequencyPenalty: null,
      presencePenalty: null,
      seed: null,
      topK: null,
      minP: null,
      repetitionPenalty: null,
      reasoning: null,
      verbosity: null,
      litellmParams: {},
    };

    for (const param of LLM_PARAMETER_MAP) {
      if (param.otelAttr === null) continue;
      const raw = attrs[param.otelAttr];
      if (raw != null) {
        (llmConfig as Record<string, unknown>)[param.formField] = raw;
      }
    }

    // Extract metrics
    const promptTokens = attrs["gen_ai.usage.prompt_tokens"] as number | undefined;
    const completionTokens = attrs["gen_ai.usage.completion_tokens"] as number | undefined;

    // Build error if present
    let error: Span["error"] | null = null;
    if (row.StatusCode === 2) {
      error = {
        has_error: true,
        message: row.StatusMessage ?? "Unknown error",
        stacktrace: [],
      };
    }

    // Extract prompt reference from attributes
    const promptRef = parsePromptTraceReference(attrs);

    return {
      spanId: row.SpanId,
      traceId: row.TraceId,
      spanName: row.SpanName ?? null,
      messages,
      llmConfig,
      vendor,
      error,
      timestamps: {
        started_at: row.StartTime,
        finished_at: row.EndTime,
      },
      metrics:
        promptTokens !== undefined || completionTokens !== undefined
          ? {
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
            }
          : null,
      promptHandle: promptRef.promptHandle,
      promptVersionNumber: promptRef.promptVersionNumber,
      promptTag: promptRef.promptTag,
      promptVariables: promptRef.promptVariables,
    };
  }

  /**
   * Get distinct span names and metadata keys for a project.
   *
   * @throws ClickHouseClientUnavailableError when no ClickHouse client resolves
   */
  async getDistinctFieldNames(
    projectId: string,
    startDate: number,
    endDate: number,
  ): Promise<DistinctFieldNamesResult> {
    return await this.tracer.withActiveSpan(
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

          const spanRows = (await spanResult.json()) as Array<{
            SpanName: string;
          }>;

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

          const metaRows = (await metaResult.json()) as Array<{
            key: string;
          }>;

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

          const evalRows = (await evalResult.json()) as Array<{
            id: string;
            name: string | null;
          }>;

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
  }): Promise<{ traces: Trace[]; totalHits: number; lastTrace: Trace | null }> {
    return await this.tracer.withActiveSpan(
      "TraceLegacyReadClickHouseRepository.fetchTracesWithPagination",
      {
        attributes: { "tenant.id": projectId },
      },
      async (_span) => {
        const clickHouseClient = await this.resolveClient(projectId);

        // Additional filter conditions (already parameterized by the filter module)
        const extraFilters =
          filterConditions && filterConditions.length > 0
            ? " AND " + filterConditions.join(" AND ")
            : "";

        // Explicit trace ID filter — when callers provide specific trace IDs
        const traceIdFilter =
          traceIds && traceIds.length > 0 ? " AND ts.TraceId IN ({traceIds:Array(String)})" : "";

        // lower(ifNull(...)) matches the ngrambf_v1 indexed expression.
        const effectiveQuery = query && query.length >= 3 ? query : undefined;

        // If the user can't see input/output, searching their content is not allowed
        if (
          effectiveQuery &&
          protections.canSeeCapturedInput === false &&
          protections.canSeeCapturedOutput === false
        ) {
          return { traces: [], totalHits: 0, lastTrace: null };
        }

        // Trace/span names are operation names, not captured content, so free text must reach
        // them too — alongside, not instead of, the I/O columns. `searchQuery` is already
        // lowercased and LIKE-escaped, so `lower(...)` on each side is the whole contract.
        const searchableColumns = [
          ...(protections.canSeeCapturedInput !== false
            ? ["lower(ifNull(ts.ComputedInput, ''))"]
            : []),
          ...(protections.canSeeCapturedOutput !== false
            ? ["lower(ifNull(ts.ComputedOutput, ''))"]
            : []),
          "lower(ifNull(ts.TraceName, ''))",
        ];

        // Non-root span names live in `stored_spans`, probed with the same
        // correlated EXISTS shape the span filters in `filter-conditions.ts`
        // use. The StartTime bound keeps it partition-pruned instead of
        // cold-scanning every weekly partition, matching `buildSpanTimeBound`.
        const spanNameSearch = `EXISTS (
                    SELECT 1 FROM stored_spans sp
                    WHERE sp.TenantId = ts.TenantId
                      AND sp.TraceId = ts.TraceId
                      AND sp.StartTime >= fromUnixTimestamp64Milli({startDate:UInt64})
                      AND sp.StartTime <= fromUnixTimestamp64Milli({endDate:UInt64})
                      AND lower(sp.SpanName) LIKE {searchQuery:String}
                  )`;

        const searchFilter = effectiveQuery
          ? ` AND (${[
              ...searchableColumns.map((col) => `${col} LIKE {searchQuery:String}`),
              spanNameSearch,
            ].join(" OR ")})`
          : "";

        // occurred (default): windows + seeks on the immutable OccurredAt (prunes partitions).
        // updated (CDC): restricts ts to each trace's latest version (global max UpdatedAt) first,
        // then applies window/filters/cursor to that row, so a stale version can never satisfy a
        // filter the latest version doesn't, and adjacent CDC windows stay mutually exclusive.
        const isUpdatedAxis = dateField === "updated";
        const dateColumn = isUpdatedAxis ? "UpdatedAt" : "OccurredAt";
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
        const scrollSnapshotBound =
          scrollStart !== undefined
            ? " AND UpdatedAt <= fromUnixTimestamp64Milli({scrollStart:UInt64})"
            : "";
        const latestVersionOnly = ` AND (ts.TenantId, ts.TraceId, ts.UpdatedAt) IN (SELECT TenantId, TraceId, max(UpdatedAt) FROM trace_summaries WHERE TenantId = {tenantId:String}${scrollSnapshotBound} GROUP BY TenantId, TraceId)`;

        let occurredCursor = "";
        let updatedCursor = "";
        if (cursor) {
          occurredCursor = ` AND (toUnixTimestamp64Milli(ts.OccurredAt), ts.TraceId) ${cmp} ({lastTimestamp:UInt64}, {lastTraceId:String})`;
          updatedCursor = ` AND (toUnixTimestamp64Milli(ts.UpdatedAt), ts.TraceId) ${cmp} ({lastTimestamp:UInt64}, {lastTraceId:String})`;
        }

        const sharedParams = {
          tenantId: projectId,
          startDate: startDate ?? 0,
          endDate: endDate ?? Date.now(),
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

        const cursorParams = {
          lastTimestamp: cursor?.lastTimestamp ?? 0,
          lastTraceId: cursor?.lastTraceId ?? "",
        };

        // Step 1: Find page trace IDs + count in parallel.
        // The ID query is lightweight (no heavy columns). occurred counts with
        // HyperLogLog (~2% error, fine for display); updated counts traces whose
        // global max(UpdatedAt) falls in the window (exact, via the aggregate).
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
          countResult.json() as Promise<Array<{ total: string }>>,
          idsResult.json() as Promise<Array<{ TraceId: string }>>,
        ]);

        const totalHits = parseInt(countRows[0]?.total ?? "0", 10);
        const pageTraceIds = idRows.map((r) => r.TraceId);

        if (pageTraceIds.length === 0) {
          return { traces: [], totalHits, lastTrace: null };
        }

        // Step 2: Fetch full data for just the page's trace IDs.
        // The dedup subquery is scoped to pageTraceIds so it only reads
        // N traces instead of the entire table.
        const summaryRows = await this.fetchTraceSummaryRows({
          clickHouseClient,
          projectId,
          startDate: startDate ?? 0,
          endDate: endDate ?? Date.now(),
          traceIds: pageTraceIds,
          orderDirection,
          fetchInput,
          fetchOutput,
          dateColumn,
          scrollStart,
        });

        const traces: Trace[] = summaryRows.map((row) => {
          const summary = this.rowToTraceSummaryData(row);
          const trace = TraceLegacySummaryMappingService.mapTraceSummaryToTrace(
            summary,
            [],
            projectId,
            this.traceCanonicalisation,
          );
          return TraceReadRedactionService.applyTraceProtections(trace, protections);
        });

        const lastTrace = traces.length > 0 ? (traces[traces.length - 1] ?? null) : null;

        return { traces, totalHits, lastTrace };
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
    clickHouseClient: ClickHouseClient;
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
      return result.json() as Promise<TraceSummaryRow[]>;
    };

    try {
      return await runQuery(traceIds);
    } catch (error) {
      if (!TraceLegacyReadClickHouseRepository.isClickHouseMemoryLimitError(error)) {
        throw error;
      }

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
  }

  /**
   * Projection JOIN: attach events to a page of traces.
   */
  private async enrichTracesWithEventsForProjection({
    clickHouseClient,
    projectId,
    traces,
    protections,
  }: {
    clickHouseClient: ClickHouseClient;
    projectId: string;
    traces: ProjectableTrace[];
    protections: Protections;
  }): Promise<void> {
    const traceIds = traces.map((t) => t.trace_id);
    if (traceIds.length === 0) return;

    // Occurrence anchor per trace: started_at, falling back to updated_at for
    // legacy/corrupt rows missing it — the scan must NEVER run time-unbounded
    // (that is the exact blowup the windowing prevents). Traces with no usable
    // timestamp at all get an empty events[] rather than an unbounded scan.
    const occurredAts = traces
      .map((t) => t.timestamps?.started_at || t.timestamps?.updated_at)
      .filter((t): t is number => typeof t === "number" && t > 0);
    if (occurredAts.length === 0) {
      this.logger.warn(
        { projectId, traceCount: traces.length },
        "No usable timestamps on page traces; skipping events projection rather than scanning unbounded",
      );
      for (const trace of traces) trace.events = [];
      return;
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

    const result = await clickHouseClient.query({
      query: `
        SELECT
          t.TraceId AS TraceId,
          t.SpanId AS SpanId,
          toUnixTimestamp64Milli(t.StartTime) AS StartTimeMs,
          toUnixTimestamp64Milli(t.EndTime) AS EndTimeMs,
          mapFilter((k, v) -> startsWith(k, 'event.'), t.SpanAttributes) AS EventAttrs
        FROM stored_spans AS t
        WHERE t.TenantId = {tenantId:String}
          AND t.TraceId IN ({traceIds:Array(String)})
          ${spanTimeFilterOuter}
          AND mapContains(t.SpanAttributes, 'event.type')
          AND (t.TenantId, t.TraceId, t.SpanId, t.UpdatedAt) IN (
            SELECT TenantId, TraceId, SpanId, max(UpdatedAt)
            FROM stored_spans
            WHERE TenantId = {tenantId:String}
              AND TraceId IN ({traceIds:Array(String)})
              ${spanTimeFilterInner}
              AND mapContains(SpanAttributes, 'event.type')
            GROUP BY TenantId, TraceId, SpanId
          )
        ORDER BY t.TraceId, t.StartTime ASC
        LIMIT {maxEvents:UInt32} BY t.TraceId
      `,
      query_params: {
        tenantId: projectId,
        traceIds,
        maxEvents: MAX_EVENTS_PER_TRACE,
        ...spanTimeParams,
      },
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as EventSpanRow[];
    const byTrace = new Map<string, Event[]>();
    for (const row of rows) {
      const event = TraceEventAttributeMappingService.tryMapEventAttrsToEvent({ row, projectId });
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
    // RBAC parity with the legacy read path: events attach AFTER
    // TraceReadRedactionService.applyTraceProtections ran, so they must get the same treatment —
    // event_details are blanked when captured input is not visible, and
    // otherwise scrubbed of any substring mirroring the trace's redacted io.
    for (const trace of traces) {
      const rawEvents = byTrace.get(trace.trace_id) ?? [];
      const redactions = new Set<string>([
        ...(!protections.canSeeCapturedInput
          ? TraceReadRedactionService.extractRedactionsForObject(trace.input?.value)
          : []),
        ...(!protections.canSeeCapturedOutput
          ? TraceReadRedactionService.extractRedactionsForObject(trace.output?.value)
          : []),
      ]);
      trace.events = rawEvents.map((event) =>
        TraceReadRedactionService.applyEventProtections(event, protections, redactions),
      );
    }
  }

  /**
   * Projection JOIN: attach annotations to a page of traces.
   */
  private async enrichTracesWithAnnotationsForProjection({
    projectId,
    traces,
  }: {
    projectId: string;
    traces: ProjectableTrace[];
  }): Promise<void> {
    const traceIds = traces.map((t) => t.trace_id);
    if (traceIds.length === 0) return;

    // scoreOptions is keyed by AnnotationScore id, but the public contract is
    // name-addressable (annotations.scores.<name>), so fetch the score
    // definitions to remap id -> name. Deleted definitions are included so
    // historical scoreOptions still resolve.
    if (!this.annotations) {
      throw new Error("AnnotationService is required for trace annotation projection");
    }
    const [rows, scoreDefs] = await Promise.all([
      this.annotations.listForProjection({ projectId, traceIds, anchor: "all" }),
      this.annotations.listScoreNames({ projectId }),
    ]);
    const scoreNameById = new Map(scoreDefs.map((s) => [s.id, s.name]));

    const byTrace = new Map<string, ProjectedAnnotation[]>();
    for (const row of rows) {
      const list = byTrace.get(row.traceId) ?? [];
      list.push({
        id: row.id,
        is_thumbs_up: row.isThumbsUp ?? null,
        comment: row.comment ?? null,
        expected_output:
          annotationSuggestedOutput({
            annotation: row,
            traceId: row.traceId,
          }) ?? null,
        scores: TraceLegacyReadClickHouseRepository.remapScoreOptionsToNames(
          row.scoreOptions,
          scoreNameById,
        ),
        created_at: row.createdAt.getTime(),
      });
      byTrace.set(row.traceId, list);
    }
    for (const trace of traces) {
      trace.annotations = byTrace.get(trace.trace_id) ?? [];
    }
  }

  /**
   * Fetch evaluation rows for a set of trace IDs.
   * Same OOM-resilient pattern as fetchTraceSummaryRows.
   */
  private async fetchEvaluationRows({
    clickHouseClient,
    projectId,
    traceIds,
  }: {
    clickHouseClient: ClickHouseClient;
    projectId: string;
    traceIds: string[];
  }): Promise<ClickHouseEvaluationRunRow[]> {
    const runQuery = async (ids: string[]) => {
      const result = await clickHouseClient.query({
        query: `
          SELECT ${EVALUATION_RUN_COLUMNS_WITH_INPUTS}
          FROM evaluation_runs
          WHERE TenantId = {tenantId:String}
            AND TraceId IN ({traceIds:Array(String)})
            AND (TenantId, EvaluationId, UpdatedAt) IN (
              SELECT TenantId, EvaluationId, max(UpdatedAt)
              FROM evaluation_runs
              WHERE TenantId = {tenantId:String}
                AND TraceId IN ({traceIds:Array(String)})
              GROUP BY TenantId, EvaluationId
            )
        `,
        query_params: {
          tenantId: projectId,
          traceIds: ids,
        },
        format: "JSONEachRow",
      });
      return result.json() as Promise<ClickHouseEvaluationRunRow[]>;
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
   * Group traces by the specified field.
   * @internal
   */
  private groupTraces(traces: Trace[], groupBy?: string): Trace[][] {
    if (!groupBy || groupBy === "none") {
      return traces.map((trace) => [trace]);
    }

    const groups: Map<string, Trace[]> = new Map();

    for (const trace of traces) {
      let key: string | null = null;

      if (groupBy === "user_id") {
        key = trace.metadata.user_id ?? null;
      } else if (groupBy === "thread_id") {
        key = trace.metadata.thread_id ?? null;
      }

      if (key) {
        const group = groups.get(key) ?? [];
        group.push(trace);
        groups.set(key, group);
      } else {
        // No grouping key - each trace is its own group
        groups.set(trace.trace_id, [trace]);
      }
    }

    return Array.from(groups.values());
  }

  /** Resolves offloaded blob refs, maps spans to legacy Trace objects, and applies protections. */
  private async resolveAndMergeMany({
    projectId,
    entries,
    protections,
    resolveBlobs,
  }: {
    projectId: string;
    entries: Array<{ summary: TraceSummaryData; spans: NormalizedSpan[] }>;
    protections: Protections;
    /**
     * Per-call gate: resolves offloaded eventref pointers from event_log only when true, so
     * list/search/collapsed reads keep the preview and issue zero event_log SELECTs. Defaults
     * to false.
     */
    resolveBlobs?: boolean;
  }): Promise<Trace[]> {
    const resolutions = await this.resolveSpansBatch({
      projectId,
      spansPerTrace: entries.map((e) => e.spans),
      resolveBlobs,
    });

    return entries.map((entry, i) =>
      this.mergeResolvedTrace({
        projectId,
        summary: entry.summary,
        resolution: resolutions[i]!,
        protections,
      }),
    );
  }

  /** Resolves offloaded blob refs for a set of traces' spans, in one pass. */
  private async resolveSpansBatch({
    projectId,
    spansPerTrace,
    resolveBlobs,
  }: {
    projectId: string;
    spansPerTrace: NormalizedSpan[][];
    resolveBlobs?: boolean;
  }): Promise<ResolvedTraceSpans[]> {
    if (resolveBlobs === true && this.resolveTraceSpansBatch) {
      const resolutions = await this.resolveTraceSpansBatch(projectId, spansPerTrace);

      // "One resolution per input trace, in input order" is a convention the injected fn's type
      // cannot enforce. Fail loudly at this boundary, where the offending resolver is still
      // nameable, rather than silently pairing the wrong spans with the wrong trace downstream.
      if (resolutions.length !== spansPerTrace.length) {
        throw TraceSpansBatchResolverContractError.cardinality({
          got: resolutions.length,
          expected: spansPerTrace.length,
        });
      }

      // Cardinality alone misses the wrong-order case: same count, swapped positions, IO scattered
      // onto the wrong trace. Check both span count and trace identity per entry — a span-less
      // trace has no identity to compare, but its zero count still catches a swap with a
      // spans-ful one. Two span-less traces transposed stay invisible, and are harmless.
      for (const [index, spans] of spansPerTrace.entries()) {
        const resolution = resolutions[index];

        if (resolution?.resolvedSpans.length !== spans.length) {
          throw TraceSpansBatchResolverContractError.misaligned({
            index,
            expected: `${spans.length} span(s)${spans[0] ? ` for trace "${spans[0].traceId}"` : ""}`,
            got: `${resolution?.resolvedSpans.length ?? 0} span(s)`,
          });
        }

        const expected = spans[0]?.traceId;
        const got = resolution.resolvedSpans[0]?.traceId;
        if (expected !== undefined && got !== undefined && expected !== got) {
          throw TraceSpansBatchResolverContractError.misaligned({
            index,
            expected: `trace "${expected}"`,
            got: `trace "${got}"`,
          });
        }
      }

      return resolutions;
    }

    if (resolveBlobs === true && this.resolveTraceSpans) {
      const resolutions: ResolvedTraceSpans[] = [];
      for (const spans of spansPerTrace) {
        resolutions.push(await this.resolveTraceSpans(projectId, spans));
      }
      return resolutions;
    }

    // No resolution opted in (or no resolver wired): keep the preview.
    return spansPerTrace.map((spans) => ({
      resolvedSpans: spans,
      recomputedInput: null,
      recomputedOutput: null,
      anyResolved: false,
    }));
  }

  /**
   * Map one trace's resolved spans to the legacy Trace, patch recomputed I/O
   * (when blobs were resolved), and apply field-redaction protections.
   * @internal
   */
  private mergeResolvedTrace({
    projectId,
    summary,
    resolution,
    protections,
  }: {
    projectId: string;
    summary: TraceSummaryData;
    resolution: ResolvedTraceSpans;
    protections: Protections;
  }): Trace {
    const recomputedInput: ExtractedIO | null = resolution.anyResolved
      ? resolution.recomputedInput
      : null;
    const recomputedOutput: ExtractedIO | null = resolution.anyResolved
      ? resolution.recomputedOutput
      : null;

    const mappedSpans = TraceLegacySpanMappingService.mapNormalizedSpansToSpans(
      resolution.resolvedSpans,
    );
    let trace = TraceLegacySummaryMappingService.mapTraceSummaryToTrace(
      summary,
      mappedSpans,
      projectId,
      this.traceCanonicalisation,
    );

    // When blobs were resolved, patch trace.input / trace.output with
    // the recomputed full values (overwriting the preview from trace_summaries).
    if (recomputedInput !== null || recomputedOutput !== null) {
      trace = {
        ...trace,
        ...(recomputedInput !== null ? { input: { value: recomputedInput.text } } : {}),
        ...(recomputedOutput !== null ? { output: { value: recomputedOutput.text } } : {}),
      };
    }

    return TraceReadRedactionService.applyTraceProtections(trace, protections);
  }

  /**
   * Enrich traces (which have empty spans) with actual span data from ClickHouse.
   * @internal
   */
  private async enrichTracesWithSpans(
    traces: Trace[],
    projectId: string,
    protections: Protections,
    resolveBlobs = false,
  ): Promise<Trace[]> {
    const traceIds = traces.map((t) => t.trace_id);
    // The traces already carry their own timestamps, so derive the partition
    // window for free: this bounds the trace_summaries summary read to the
    // weeks these traces occurred in instead of scanning every partition.
    const startedAts = traces
      .map((t) => t.timestamps.started_at)
      .filter((t): t is number => typeof t === "number" && t > 0);
    const occurredAt =
      startedAts.length > 0
        ? { from: Math.min(...startedAts), to: Math.max(...startedAts) }
        : undefined;
    const tracesWithSpans = await this.fetchTracesWithSpansJoined(projectId, traceIds, occurredAt);

    // Collect traces that have spans, resolve+merge them as one bounded batch, then splice the
    // results back in order; traces with no spans pass through unchanged. resolveBlobs is gated
    // by the caller — list/search leaves it false; only download/export opts in.
    const enrichable = traces
      .map((trace, index) => ({
        index,
        data: tracesWithSpans.get(trace.trace_id),
      }))
      .filter(
        (
          e,
        ): e is {
          index: number;
          data: { summary: TraceSummaryData; spans: NormalizedSpan[] };
        } => !!e.data && e.data.spans.length > 0,
      );

    const merged = await this.resolveAndMergeMany({
      projectId,
      entries: enrichable.map((e) => ({
        summary: e.data.summary,
        spans: e.data.spans,
      })),
      protections,
      resolveBlobs,
    });

    const result = [...traces];
    enrichable.forEach((e, i) => {
      result[e.index] = merged[i]!;
    });
    return result;
  }

  /**
   * Resolve the OccurredAt span of a set of traces from a cheap sort-key seek.
   * Pre-anchor sentinel rows (`OccurredAt = 0`, ADR-087) are excluded in SQL
   * @internal
   */
  private async resolveOccurredAtRange({
    client,
    projectId,
    traceIds,
  }: {
    client: ClickHouseClient;
    projectId: string;
    traceIds: string[];
  }): Promise<OccurredAtRange | undefined> {
    if (traceIds.length === 0) {
      return undefined;
    }
    const result = await client.query({
      query: `
        SELECT
          toUnixTimestamp64Milli(min(OccurredAt)) AS fromMs,
          toUnixTimestamp64Milli(max(OccurredAt)) AS toMs
        FROM trace_summaries
        WHERE TenantId = {tenantId:String}
          AND TraceId IN ({traceIds:Array(String)})
          AND OccurredAt > fromUnixTimestamp64Milli(0)
      `,
      query_params: { tenantId: projectId, traceIds },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Array<{
      fromMs: number | null;
      toMs: number | null;
    }>;
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
  private async fetchTracesWithSpansJoined(
    projectId: string,
    traceIds: string[],
    occurredAt?: OccurredAtRange,
  ): Promise<Map<string, { summary: TraceSummaryData; spans: NormalizedSpan[] }>> {
    return await this.tracer.withActiveSpan(
      "TraceLegacyReadClickHouseRepository.fetchTracesWithSpansJoined",
      {
        attributes: { "tenant.id": projectId },
      },
      async (_span) => {
        const clickHouseClient = await this.resolveClient(projectId);

        // Callers that already know the traces' time pass `occurredAt`; thread-view paths only
        // have trace ids. Without a window the summary read below filters on TraceId alone, which
        // cannot prune partitions, so resolve the OccurredAt span from a cheap sort-key seek first.
        const effectiveOccurredAt =
          occurredAt ??
          (await this.resolveOccurredAtRange({
            client: clickHouseClient,
            projectId,
            traceIds,
          }).catch((error) => {
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
          }));

        // The summary + span reads pull heavy columns for the whole trace list, so a large list
        // can exceed ClickHouse's per-query memory cap. Run as one query on the happy path, retry
        // in fixed-size batches on OOM. That bounds ClickHouse's memory only — this process still
        // materialises the whole merged result, so the merge is capped too; see
        // {@link MAX_SPANS_PER_JOINED_FALLBACK}.
        const runBatch = async ({
          batchTraceIds,
          maxSpanRows,
        }: {
          batchTraceIds: string[];
          /** Rows the span read may return before ClickHouse refuses it. */
          maxSpanRows?: number;
        }): Promise<Map<string, { summary: TraceSummaryData; spans: NormalizedSpan[] }>> => {
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
          const summaryRows = await TraceWindowedReadService.queryWindowed<TraceSummaryRow[]>({
            table: "trace_summaries",
            hintMs: summaryHintMs,
            windowMs: summaryWindowMs,
            fallback: "none",
            isEmpty: (rows) => rows.length === 0,
            run: async (window) => {
              const summaryTimeFilterOuter = window ? window.sqlFor("t.OccurredAt") : "";
              const summaryTimeFilterInner = window ? window.sqlFor("OccurredAt") : "";
              const summaryResult = await clickHouseClient.query({
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
        WHERE t.TenantId = {tenantId:String}
          AND t.TraceId IN ({traceIds:Array(String)})
          ${summaryTimeFilterOuter}
          AND (t.TenantId, t.TraceId, t.UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM trace_summaries
            WHERE TenantId = {tenantId:String}
              AND TraceId IN ({traceIds:Array(String)})
              ${summaryTimeFilterInner}
            GROUP BY TenantId, TraceId
          )
        ORDER BY t.TraceId
      `,
                query_params: {
                  tenantId: projectId,
                  traceIds: batchTraceIds,
                  ...window?.params,
                },
                format: "JSONEachRow",
              });
              return (await summaryResult.json()) as TraceSummaryRow[];
            },
          });

          // No matched summaries: the result map is built solely from summary
          // rows, so the spans would be discarded anyway. Return early to skip the
          // (otherwise unbounded) stored_spans scan — the very cold scan this path
          // is meant to avoid.
          if (summaryRows.length === 0) {
            return new Map();
          }

          // Parse spans
          type SpanRow = {
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
          };

          // Bounds the stored_spans scan to the weeks the matched traces occurred in. Same
          // range->window mapping as the summary read above: centre on the range midpoint,
          // half-width = half that range + the ±2-day margin.
          const occurredAts = summaryRows
            .map((r) => r.ts_OccurredAt)
            .filter((t): t is number => typeof t === "number" && t > 0);
          const spanRange =
            occurredAts.length > 0
              ? {
                  from: Math.min(...occurredAts),
                  to: Math.max(...occurredAts),
                }
              : hasSummaryWindow
                ? effectiveOccurredAt
                : undefined;
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

          const spanRows = await TraceWindowedReadService.queryWindowed<SpanRow[]>({
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
                  lookbackMs: await this.retentionFloor.getLookbackMs({
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
              const spansResult = await clickHouseClient.query({
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
        WHERE t.TenantId = {tenantId:String}
          AND t.TraceId IN ({traceIds:Array(String)})
          ${spanTimeFilterOuter}
          AND (t.TenantId, t.TraceId, t.SpanId, t.StartTime) IN (
            SELECT TenantId, TraceId, SpanId, max(StartTime)
            FROM stored_spans
            WHERE TenantId = {tenantId:String}
              AND TraceId IN ({traceIds:Array(String)})
              ${spanTimeFilterInner}
            GROUP BY TenantId, TraceId, SpanId
          )
        ORDER BY t.TraceId, t.StartTime ASC
        LIMIT ${MAX_SPANS_PER_TRACE} BY t.TraceId
      `,
                query_params: {
                  tenantId: projectId,
                  traceIds: batchTraceIds,
                  ...window?.params,
                },
                clickhouse_settings: spanReadSettings,
                format: "JSONEachRow",
              });
              return (await spansResult.json()) as SpanRow[];
            },
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
          const tracesMap = new Map<
            string,
            { summary: TraceSummaryData; spans: NormalizedSpan[] }
          >();

          for (const row of summaryRows) {
            const traceId = row.ts_TraceId;
            const summary = this.rowToTraceSummaryData(row);
            tracesMap.set(traceId, {
              summary,
              spans: spansByTrace.get(traceId) ?? [],
            });
          }

          return tracesMap;
        };

        try {
          return await runBatch({ batchTraceIds: traceIds });
        } catch (error) {
          if (!TraceLegacyReadClickHouseRepository.isClickHouseMemoryLimitError(error)) {
            throw error;
          }

          this.logger.warn(
            `Traces-with-spans join OOM for ${traceIds.length} traces, retrying in batches of ${TraceLegacyReadClickHouseRepository.SUMMARY_BATCH_SIZE}`,
          );

          const merged = new Map<string, { summary: TraceSummaryData; spans: NormalizedSpan[] }>();
          let mergedSpanCount = 0;
          for (
            let i = 0;
            i < traceIds.length;
            i += TraceLegacyReadClickHouseRepository.SUMMARY_BATCH_SIZE
          ) {
            const batch = traceIds.slice(
              i,
              i + TraceLegacyReadClickHouseRepository.SUMMARY_BATCH_SIZE,
            );

            // Batching caps ClickHouse's peak memory, not ours — the merge rebuilds the whole
            // result here. The budget goes into the read so an over-budget batch is refused by
            // ClickHouse instead of arriving in this process first. See
            // {@link MAX_SPANS_PER_JOINED_FALLBACK}.
            const remainingSpanBudget = MAX_SPANS_PER_JOINED_FALLBACK - mergedSpanCount;
            let batchMap: Map<string, { summary: TraceSummaryData; spans: NormalizedSpan[] }>;
            try {
              batchMap = await runBatch({
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
      },
    );
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
      return (error.reasons ?? []).some(
        TraceLegacyReadClickHouseRepository.isClickHouseResultOverflowError,
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
        (error.reasons ?? []).some(TraceLegacyReadClickHouseRepository.isClickHouseMemoryLimitError)
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
interface TraceSummaryRow {
  ts_TraceId: string;
  ts_SpanCount: number;
  ts_TotalDurationMs: number;
  ts_ComputedIOSchemaVersion: string;
  ts_ComputedInput?: string | null;
  ts_ComputedOutput?: string | null;
  ts_TimeToFirstTokenMs: number | null;
  ts_TimeToLastTokenMs: number | null;
  ts_TokensPerSecond: number | null;
  ts_ContainsErrorStatus: boolean;
  ts_ContainsOKStatus: boolean;
  ts_ErrorMessage: string | null;
  ts_Models: string[];
  ts_TotalCost: number | null;
  ts_NonBilledCost: number | null;
  ts_TokensEstimated: boolean;
  ts_TotalPromptTokenCount: number | null;
  ts_TotalCompletionTokenCount: number | null;
  ts_OutputFromRootSpan?: boolean;
  ts_OutputSpanEndTimeMs?: number;
  ts_TopicId: string | null;
  ts_SubTopicId: string | null;
  ts_HasAnnotation: boolean | null;
  ts_AnnotationIds: string[];
  ts_Attributes: Record<string, string>;
  ts_TraceName?: string | null;
  /**
   * The row's projection stamp. Read only to tell a pre-anchor row's `OccurredAt`
   * (which was `min(span start)`) from a post-anchor one's (which is the frozen
   * storage anchor). See {@link traceSummaryTimesFromRow}.
   */
  ts_Version?: string;
  /** The span timing baseline column added by migration 00072; absent on older rows. */
  ts_EarliestSpanStartMs?: number | string;
  ts_OccurredAt: number;
  ts_CreatedAt: number;
  ts_UpdatedAt: number;
}

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

interface PromptStudioCandidateRow {
  SpanId: string;
  ParentSpanId: string | null;
  SpanAttributes: Record<string, unknown>;
  StartTime: number;
}

/**
 * Given a non-llm span, finds the nearest llm span in the same trace to load into the
 * playground instead. Preference order: closest descendant, then next sibling by start time,
 * then the trace's first llm span. Returns null when the trace has no llm spans.
 */
function findNearestLlm<T extends PromptStudioCandidateRow>(rows: T[], requested: T): T | null {
  const isLlm = (r: T) => (r.SpanAttributes["langwatch.span.type"] as string | undefined) === "llm";

  const llmRows = rows.filter(isLlm);
  if (llmRows.length === 0) return null;

  // 1. Descendant llm closest to the requested span (smallest depth diff).
  const childrenByParent = new Map<string, T[]>();
  for (const r of rows) {
    if (!r.ParentSpanId) continue;
    const list = childrenByParent.get(r.ParentSpanId);
    if (list) list.push(r);
    else childrenByParent.set(r.ParentSpanId, [r]);
  }
  const visited = new Set<string>();
  const queue: T[] = [requested];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.SpanId)) continue;
    visited.add(current.SpanId);
    const children = childrenByParent.get(current.SpanId) ?? [];
    for (const child of children) {
      if (isLlm(child)) return child;
      queue.push(child);
    }
  }

  // 2. Sibling llm under the same parent that started at/after the requested span. Earliest
  // qualifying sibling wins, landing on the next call rather than one further down the chain.
  // Earlier siblings belong to a prior turn and fall through to step 3 instead.
  const siblingPool =
    requested.ParentSpanId == null
      ? rows.filter((r) => r.ParentSpanId == null)
      : (childrenByParent.get(requested.ParentSpanId) ?? []);
  const siblings = siblingPool
    .filter((s) => s.SpanId !== requested.SpanId && isLlm(s))
    .sort((a, b) => a.StartTime - b.StartTime);
  const nextOrSame = siblings.find((s) => s.StartTime >= requested.StartTime);
  if (nextOrSame) return nextOrSame;

  // 3. Earliest llm in the trace.
  return llmRows.sort((a, b) => a.StartTime - b.StartTime)[0] ?? null;
}

/**
 * Transform traces to include guardrail information
 */
function transformTracesWithGuardrails(traces: Trace[]): TraceWithGuardrail[] {
  return traces.map((trace) => {
    return {
      ...trace,
      lastGuardrail: void 0,
      annotations: void 0,
    };
  });
}
