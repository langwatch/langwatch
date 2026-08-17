import type { ClickHouseClient } from "@clickhouse/client";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { getLangWatchTracer } from "langwatch";
import type { PrismaClient } from "~/generated/prisma/client";
import { LLM_PARAMETER_MAP } from "~/prompts/prompt-playground/llmParameterMap";
import { AnnotationService } from "~/server/annotations/annotation.service";
import { annotationSuggestedOutput } from "~/server/annotations/annotationSuggestedOutput";
import { createRetentionFloorService } from "~/server/app-layer/clients/clickhouse/retention-floor";
import {
  DEFAULT_PARTITION_WINDOW_MS,
  queryWindowed,
} from "~/server/app-layer/clients/clickhouse/windowed-read";
import {
  deserializeAttributes,
  ensureStringRecord,
} from "~/server/app-layer/traces/repositories/span-storage.clickhouse.repository";
import type { ExtractedIO } from "~/server/app-layer/traces/trace-io-extraction.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import type { RetentionPolicyResolver } from "~/server/data-retention/retentionPolicyResolver";
import { prisma as defaultPrisma } from "~/server/db";
import {
  type ClickHouseEvaluationRunRow,
  EVALUATION_RUN_COLUMNS_WITH_INPUTS,
  mapClickHouseEvaluationToTraceEvaluation,
  mapTraceEvaluationsToLegacyEvaluations,
} from "~/server/evaluations/evaluation-run.mappers";
import { isStorageAnchoredVersion } from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants";
import type {
  NormalizedSpan,
  NormalizedSpanKind,
  NormalizedStatusCode,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import { generateClickHouseFilterConditions } from "~/server/filters/clickhouse";
import type { Event, Span, Trace } from "~/server/tracer/types";
import type { Protections } from "~/server/traces/protections";
import { findPromptReferenceInAncestors } from "./findPromptReferenceInAncestors";
import {
  applyEventProtections,
  applyTraceProtections,
  extractRedactionsForObject,
  mapNormalizedSpansToSpans,
  mapTraceSummaryToTrace,
} from "./mappers";
import { parseLLMSpanMessages } from "./parseLLMSpanMessages";
import { parsePromptReference } from "./parsePromptReference";
import {
  type EventSpanRow,
  mapEventAttrsToEvent,
} from "./projection/event-attrs.mapper";
import type { ProjectableTrace, ProjectedAnnotation } from "./projection/types";
import type { ResolvedTraceSpans } from "./resolve-offloaded-traces";
import type {
  AggregationFiltersInput,
  CustomersAndLabelsResult,
  DistinctFieldNamesResult,
  GetAllTracesForProjectInput,
  GetAllTracesForProjectOptions,
  PromptStudioSpanResult,
  TopicCountsResult,
  TraceDateField,
  TracesForProjectResult,
  TraceWithGuardrail,
} from "./types";

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
 * Callback injected from TraceService that resolves offloaded blob refs for a
 * WHOLE result set of traces in one bounded pass (#4991 bulk read paths). When
 * present, the bulk read methods (getTracesWithSpans, enrichTracesWithSpans on
 * the download path) use it so a large export/thread streams its event_log
 * reads instead of fanning out an unbounded N×M burst. Falls back to the
 * per-trace {@link ResolveTraceSpansFn} when absent.
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
   *
   * UpdatedAt is a mutable sort key, so without this the dedup re-resolves each
   * trace to its CURRENT latest version on every page while the cursor still
   * points at a position computed from an earlier one. A trace bumped above the
   * cursor mid-scroll then matches no page — later thresholds only move further
   * away — and is dropped from the scroll entirely. Capping the dedup at this
   * timestamp makes every page resolve the same versions the first page saw, so
   * the trace keeps its original position and is still delivered; the newer
   * version belongs to the next incremental window.
   *
   * Absent on cursors minted before this field existed — those keep the old
   * uncapped behaviour rather than breaking mid-scroll on deploy.
   */
  scrollStart?: number;
}

/**
 * Approximate occurrence-time bounds (epoch ms) for a set of traces, used as a
 * partition-pruning hint on `trace_summaries`. `trace_summaries` is partitioned
 * on `OccurredAt`, so a read filtered only by `TraceId` cannot prune partitions
 * and scans every weekly part (incl. cold S3) to locate the rows. Supplying the
 * traces' time range lets the read prune to the relevant weeks. The window is
 * widened by a safety margin before use, so callers can pass an exact point
 * range (`from === to`) for a single trace.
 */
interface OccurredAtRange {
  /** Earliest trace occurrence time in the set (epoch ms). */
  from: number;
  /** Latest trace occurrence time in the set (epoch ms). */
  to: number;
}

/**
 * Upper bound on distinct field names (span names, metadata keys) returned for
 * the dataset / evaluator mapping dropdowns. Distinct names are low-cardinality
 * in healthy projects (hundreds), so this only guards against pathological
 * cardinality (e.g. dynamic IDs baked into span names) flooding the response.
 * Set well above any real project so every name is offered for mapping rather
 * than alphabetically truncated.
 */
const DISTINCT_FIELD_NAMES_LIMIT = 10_000;

/**
 * Upper bound on spans returned per trace by the spans-join read path. The REST
 * collector no longer caps spans per trace (#4629), so this read cap must be
 * high enough not to truncate real agentic traces while still protecting the
 * read path from a pathologically large trace's full span payload. A trace that
 * actually reaches this many spans is logged as a potential truncation.
 */
const MAX_SPANS_PER_TRACE = 10_000;

/**
 * Caps the joined span read's own memory instead of letting it draw on the
 * server's total budget.
 *
 * This read selects every heavy column (`SpanAttributes`, `ResourceAttributes`,
 * `Events.Attributes`, `Links.*`). Uncapped, the pathological tail was stopped
 * by the server's OvercommitTracker, which picks a victim across the whole
 * cluster - so one bad trace read degraded unrelated queries.
 *
 * With an explicit cap the offending read fails on its own and surfaces as a
 * query error on that request. Mirrors the single-trace read path in
 * `app-layer/traces/repositories/span-storage.clickhouse.repository.ts`.
 *
 * The upstream fix has since landed (ADR-087, migration 00072): `OccurredAt` on
 * trace_summaries is a frozen storage anchor, and this read's window falls back
 * through the caller's paging range to a retention floor, so the time filter is
 * never empty and the scan is never the whole table. The cap stays as the belt
 * to that braces - a page of ten thousand wide traces inside one window is still
 * a lot of bytes.
 */
const JOINED_SPAN_READ_SETTINGS = {
  // ClickHouse settings are string-typed over the wire.
  max_memory_usage: String(2 * 1024 * 1024 * 1024), // 2 GiB
} as const;

/**
 * The floor the joined span read bounds itself to when nothing else can supply a
 * window: no caller paging range, and not one matched summary carrying a usable
 * `OccurredAt`. The read then runs `now - this … now + 2d` instead of no time
 * predicate at all.
 *
 * A bound of last resort has to be justified on what it could exclude, so:
 * after ADR-087 the only rows that reach here are pre-anchor sentinel rows, and
 * a sentinel row is one whose fold never saw a usable span start. Overwhelmingly
 * that is a log-only trace, which has no spans for this read to find. The
 * residue is a trace whose every span carried an unusable start time - those
 * spans are themselves filed in `stored_spans`' epoch partition, so no bounded
 * read was ever going to return them, and reading them is precisely the
 * full-partition scan (cold S3 tiers included) that this constant exists to
 * stop.
 *
 * 90 days rather than the 49-day platform retention default: it covers the
 * default with room for a longer tenant policy, and matches the floor the log
 * read already uses (`log-record-storage.clickhouse.repository.ts`).
 */
const SPAN_READ_FLOOR_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;
/** Per-trace cap on projected events (events are a small subset of spans). */
const MAX_EVENTS_PER_TRACE = 1_000;

/**
 * How many spans the traces-with-spans OOM fallback will hold in memory before
 * it gives up on the read.
 *
 * The fallback re-runs a memory-capped ClickHouse query in batches of 25 and
 * merges every batch into one map. That bounds ClickHouse's peak memory and
 * not ours: the same full result set is materialised, just on this side of the
 * socket. On 2026-08-12..16 that turned a single MEMORY_LIMIT_EXCEEDED on a
 * 980-trace read into 50 V8 heap deaths — the whole worker fleet, 16:48 UTC,
 * every day, because every pod ran the same sweep at the same time.
 *
 * The read that triggers the fallback has ALREADY failed once in ClickHouse, so
 * refusing it here costs that caller nothing it had: it fails either way. What
 * it buys is that the failure stays inside one job instead of taking the
 * process — a failed job is retried and visible, a dead pod is neither.
 *
 * Sized well above any legitimate trace-detail read (10k spans is one very
 * large trace) and far below a heap-filling sweep.
 */
const MAX_SPANS_PER_JOINED_FALLBACK = 50_000;
/** Bounds the bounded events stored_spans scan to the page's occurrence weeks. */
const EVENT_PARTITION_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

/** Object keys that would corrupt the prototype chain if assigned. */
const FORBIDDEN_SCORE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Annotation `scoreOptions` is keyed by AnnotationScore id; the public contract
 * exposes `annotations.scores.<name>`, so remap id -> name. Score names are not
 * unique per project — on a collision the last definition wins. An id with no
 * matching score (e.g. a deleted definition) keeps its id as the key so data is
 * never silently dropped. Prototype-polluting keys are skipped.
 */
export function remapScoreOptionsToNames(
  scoreOptions: unknown,
  scoreNameById: Map<string, string>,
): Record<string, unknown> {
  if (!scoreOptions || typeof scoreOptions !== "object") return {};
  const remapped: Record<string, unknown> = {};
  for (const [scoreId, value] of Object.entries(
    scoreOptions as Record<string, unknown>,
  )) {
    const name = scoreNameById.get(scoreId) ?? scoreId;
    if (FORBIDDEN_SCORE_KEYS.has(name)) continue;
    // AnnotationScore names are not unique. On a collision the first entry
    // keeps the plain name and later ones get an id-suffixed key — deterministic
    // (object iteration is insertion-ordered) and lossless, instead of the
    // engine-defined last-write-wins this used to be.
    const key = name in remapped ? `${name} (${scoreId})` : name;
    if (FORBIDDEN_SCORE_KEYS.has(key)) continue;
    remapped[key] = value;
  }
  return remapped;
}

/**
 * Bound the events stored_spans scan to the partitions the page's traces
 * actually occurred in. Occurrence times are clustered (a new cluster starts on
 * a gap larger than the merge window), and each cluster contributes one tight
 * [min - window, max + window] range OR'd into the filter — so a page mixing old
 * and recent traces (common on the updated axis) scans a few small ranges rather
 * than one range spanning every weekly partition between them.
 */
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
 * Thrown when no ClickHouse client can be resolved for a project — the only
 * cause is a configuration problem (e.g. CLICKHOUSE_URL unset), never missing
 * data. ClickHouse is the sole trace backend, so callers cannot fall back;
 * they surface this as a configuration error.
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
 * Thrown when an injected {@link ResolveTraceSpansBatchFn} breaks its contract by
 * not returning exactly one resolution per input trace, in input order.
 * `ResolvedTraceSpans` carries no trace identity of its own, so the pairing is
 * purely positional and the type cannot enforce it — it is enforced at the call
 * boundary instead. Never caused by data; always a resolver (or test-double) bug.
 *
 * The read paths flatten failures into a generic "Failed to fetch traces…"; both
 * of them allowlist this class by `instanceof` and re-throw it unwrapped, so a
 * contract violation reaches the caller with the mismatch intact rather than
 * masquerading as a ClickHouse fetch failure.
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
 *
 * Fetches trace summaries and, when needed, span rows via separate ClickHouse
 * queries, combines them in application code, and maps to legacy Trace/Span types.
 */
export class ClickHouseTraceService {
  private readonly logger = createLogger("langwatch:traces:clickhouse-service");
  private readonly tracer = getLangWatchTracer(
    "langwatch.traces.clickhouse-service",
  );

  /**
   * Optional callback that resolves offloaded blob refs for a single trace's
   * normalized spans before they are mapped to legacy Span objects. Injected
   * from TraceService so blob-resolution deps are owned at a single composition
   * point. When absent, spans are mapped as-is (preview values remain).
   */
  private readonly resolveTraceSpans: ResolveTraceSpansFn | undefined;

  /**
   * Optional bulk resolver for whole result sets (#4991). Preferred over
   * {@link resolveTraceSpans} on the bulk read paths so a large export/thread
   * resolves its blobs in one bounded-concurrency pass. When absent, the bulk
   * paths fall back to the per-trace resolver.
   */
  private readonly resolveTraceSpansBatch: ResolveTraceSpansBatchFn | undefined;

  private readonly prisma: PrismaClient;

  constructor({
    prisma,
    resolveTraceSpans,
    resolveTraceSpansBatch,
    retentionResolver,
  }: {
    prisma: PrismaClient;
    resolveTraceSpans?: ResolveTraceSpansFn;
    resolveTraceSpansBatch?: ResolveTraceSpansBatchFn;
    /**
     * Widens the span read's retention floor to this tenant's own policy.
     * Optional: without it the floor stays at {@link SPAN_READ_FLOOR_LOOKBACK_MS}.
     */
    retentionResolver?: RetentionPolicyResolver;
  }) {
    this.prisma = prisma;
    this.resolveTraceSpans = resolveTraceSpans;
    this.resolveTraceSpansBatch = resolveTraceSpansBatch;
    this.retentionFloor = createRetentionFloorService(retentionResolver);
  }

  private readonly retentionFloor: ReturnType<
    typeof createRetentionFloorService
  >;

  /**
   * Resolve the ClickHouse client for a given project.
   *
   * The returned client is already wrapped with wrapWithDefaultSettings
   * by getClickHouseClientForProject, so every query automatically receives
   * memory-safety limits (max_memory_usage, max_bytes_before_external_group_by).
   *
   * @throws ClickHouseClientUnavailableError when no client resolves —
   *   ClickHouse is the sole backend, so an unresolvable client is always a
   *   configuration error, never a signal to fall back.
   */
  private async resolveClient(projectId: string): Promise<ClickHouseClient> {
    const client = await getClickHouseClientForProject(projectId);
    if (!client) {
      throw new ClickHouseClientUnavailableError(projectId);
    }
    return client;
  }

  /**
   * Static factory method for creating ClickHouseTraceService with default dependencies.
   */
  static create({
    prisma = defaultPrisma,
    resolveTraceSpans,
    resolveTraceSpansBatch,
    retentionResolver,
  }: {
    prisma?: PrismaClient;
    resolveTraceSpans?: ResolveTraceSpansFn;
    resolveTraceSpansBatch?: ResolveTraceSpansBatchFn;
    retentionResolver?: RetentionPolicyResolver;
  } = {}): ClickHouseTraceService {
    return new ClickHouseTraceService({
      prisma,
      resolveTraceSpans,
      resolveTraceSpansBatch,
      retentionResolver,
    });
  }

  /**
   * Get traces with spans for the given trace IDs.
   *
   * @param projectId - The project ID
   * @param traceIds - Array of trace IDs to fetch
   * @param protections - Field redaction protections
   * @param occurredAt - Optional approximate trace time range (epoch ms) used to
   *   bound the trace_summaries read to its weekly partitions. Without it the
   *   summary read scans every partition (incl. cold S3) to locate the traceIds.
   * @param opts.resolveBlobs - When true AND a blob resolver is wired on this
   *   instance, resolves offloaded eventref pointers from event_log so
   *   over-threshold IO values read back full (#4888). Default
   *   (undefined/false) maps the ≤64 KB preview as-is and issues zero
   *   event_log SELECTs.
   * @returns Array of Trace objects with spans
   * @throws ClickHouseClientUnavailableError when no ClickHouse client resolves
   */
  async getTracesWithSpans(
    projectId: string,
    traceIds: string[],
    protections: Protections,
    occurredAt?: OccurredAtRange,
    opts?: { resolveBlobs?: boolean },
  ): Promise<Trace[]> {
    return await this.tracer.withActiveSpan(
      "ClickHouseTraceService.getTracesWithSpans",
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
          if (error instanceof TraceSpansBatchResolverContractError)
            throw error;
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
   *
   * Used for git-style shortcut lookups where a user provides a prefix of the
   * full trace ID (for example, the 20-char truncated ID shown by `langwatch
   * trace search`). Returns up to `limit` distinct trace IDs so the caller can
   * detect ambiguity.
   *
   * Callers MUST pass an `occurredAt` range to keep the scan bounded. Per
   * repository conventions, filtering on the partition key (OccurredAt) is
   * required — without it ClickHouse scans every partition (including cold
   * S3 storage) for every lookup miss.
   *
   * @throws ClickHouseClientUnavailableError when no ClickHouse client resolves
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
      "ClickHouseTraceService.resolveTraceIdByPrefix",
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

  /**
   * Narrow a set of candidate trace IDs down to the ones this project actually
   * holds a trace for. Reads IDs only, so it stays cheap enough to sit in front
   * of a write path that would otherwise store references to nothing.
   *
   * Deliberately unbounded on the partition key, unlike every other read here,
   * so the cold-scan detector flags it and that is correct rather than an
   * oversight: callers hold a bare list of IDs of unknown age (a queue hand-off,
   * an automation firing on a trace someone picked weeks ago) and have no time
   * range to bound it with. Guessing one would report an old-but-live trace as
   * missing, which is the failure this guard exists to prevent. What keeps the
   * cost down is the sort key: `TraceId` follows `TenantId`, so each partition's
   * primary index narrows to the candidate IDs without reading their rows.
   *
   * No dedup: several unmerged versions of a row all prove the same thing, and
   * the answer is set membership, not a value.
   *
   * @throws ClickHouseClientUnavailableError when no ClickHouse client resolves
   */
  async findExistingTraceIds({
    projectId,
    traceIds,
  }: {
    /** The project ID (scoped via TenantId) */
    projectId: string;
    /** Candidate trace IDs to check */
    traceIds: string[];
  }): Promise<string[]> {
    if (traceIds.length === 0) return [];

    return await this.tracer.withActiveSpan(
      "ClickHouseTraceService.findExistingTraceIds",
      {
        attributes: {
          "tenant.id": projectId,
          "trace.id.candidate_count": traceIds.length,
        },
      },
      async () => {
        const clickHouseClient = await this.resolveClient(projectId);

        try {
          const result = await clickHouseClient.query({
            query: `
              SELECT DISTINCT TraceId
              FROM trace_summaries
              WHERE TenantId = {tenantId:String}
                AND TraceId IN ({traceIds:Array(String)})
            `,
            query_params: { tenantId: projectId, traceIds },
            format: "JSONEachRow",
          });

          const rows = (await result.json()) as Array<{ TraceId: string }>;
          return rows.map((row) => row.TraceId);
        } catch (error) {
          this.logger.warn(
            {
              projectId,
              traceIdCount: traceIds.length,
              error: error instanceof Error ? error.message : error,
            },
            "Failed to check trace existence in ClickHouse",
          );
          throw new Error("Failed to check which traces exist");
        }
      },
    );
  }

  /**
   * Get traces by thread ID.
   *
   * Queries trace_summaries using the Attributes map to find traces
   * with matching thread_id (stored under various attribute keys).
   *
   * @param projectId - The project ID
   * @param threadId - The thread ID to search for
   * @param protections - Field redaction protections
   * @param opts.resolveBlobs - Forwarded to the per-trace fetch so the
   *   thread-detail read resolves full IO (#4991). Customer thread views that
   *   construct without a blob resolver get a no-op. Defaults to false.
   * @returns Array of Trace objects, **sorted chronologically by
   *   `timestamps.started_at` ascending** (empty array if no matching traces).
   *   The ordering is part of this method's contract, not an incidental detail:
   *   the underlying bulk read returns trace-id order, and callers rely on the
   *   chronological order this restores. The public-share branch of the
   *   `getTracesByThreadId` tRPC route re-projects its authorized subset onto
   *   this order rather than re-deriving one, so dropping the sort here would
   *   silently mis-order that (anonymous, least-exercised) path. Pinned by
   *   "returns traces sorted chronologically" in
   *   clickhouse-trace.service-4991-bulk.unit.test.ts.
   * @throws ClickHouseClientUnavailableError when no ClickHouse client resolves
   */
  async getTracesByThreadId(
    projectId: string,
    threadId: string,
    protections: Protections,
    opts?: { resolveBlobs?: boolean },
  ): Promise<Trace[]> {
    return await this.tracer.withActiveSpan(
      "ClickHouseTraceService.getTracesByThreadId",
      {
        attributes: { "tenant.id": projectId, "thread.id": threadId },
      },
      async () => {
        const clickHouseClient = await this.resolveClient(projectId);

        this.logger.debug(
          { projectId, threadId },
          "Fetching traces by thread ID from ClickHouse",
        );

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
          traces.sort(
            (a, b) =>
              (a.timestamps.started_at ?? 0) - (b.timestamps.started_at ?? 0),
          );
          return traces;
        } catch (error) {
          // See getTracesWithSpans: a resolver-contract violation is a code bug,
          // not a fetch failure — surface it verbatim.
          if (error instanceof TraceSpansBatchResolverContractError)
            throw error;
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
   * Get traces with spans by multiple thread IDs.
   *
   * Queries trace_summaries using the Attributes map to find traces
   * with matching thread_ids (stored under various attribute keys).
   *
   * @param projectId - The project ID
   * @param threadIds - Array of thread IDs to search for
   * @param protections - Field redaction protections
   * @param opts.resolveBlobs - Forwarded to the per-trace fetch so the eval
   *   path can read full thread IO (#4888). Customer thread views construct
   *   without a blob resolver, so this is a no-op for them.
   * @returns Array of Trace objects with spans
   * @throws ClickHouseClientUnavailableError when no ClickHouse client resolves
   */
  async getTracesWithSpansByThreadIds(
    projectId: string,
    threadIds: string[],
    protections: Protections,
    opts?: { resolveBlobs?: boolean },
  ): Promise<Trace[]> {
    return await this.tracer.withActiveSpan(
      "ClickHouseTraceService.getTracesWithSpansByThreadIds",
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

          // Fetch full traces with spans. Forward resolveBlobs so the eval
          // path reads full thread IO (#4888); customer thread views pass
          // nothing and have no resolver, so they stay on the preview.
          const traces = await this.getTracesWithSpans(
            projectId,
            traceIds,
            protections,
            undefined,
            { resolveBlobs: opts?.resolveBlobs },
          );

          // Re-sort by timestamp — getTracesWithSpans returns in TraceId
          // order which doesn't match the chronological order we need.
          traces.sort(
            (a, b) =>
              (a.timestamps.started_at ?? 0) - (b.timestamps.started_at ?? 0),
          );
          return traces;
        } catch (error) {
          // Third flattening catch on this class, and it sits ABOVE
          // getTracesWithSpans — so a contract violation re-thrown unwrapped by
          // that method lands here and would be flattened again. Allowlist it,
          // same as the other two. (Live path: called with resolveBlobs from the
          // thread router and the evaluation-execution service.)
          if (error instanceof TraceSpansBatchResolverContractError)
            throw error;
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

  /**
   * Get all traces for a project with filtering and pagination.
   *
   * Uses keyset pagination for efficient cursor-based scrolling.
   * The scrollId encodes the last-seen (timestamp, traceId) pair.
   *
   * @param input - Query parameters including filters, pagination, and sorting
   * @param protections - Field redaction protections
   * @returns TracesForProjectResult
   * @throws ClickHouseClientUnavailableError when no ClickHouse client resolves
   */
  async getAllTracesForProject(
    input: GetAllTracesForProjectInput,
    protections: Protections,
    options: GetAllTracesForProjectOptions = {},
  ): Promise<TracesForProjectResult> {
    return await this.tracer.withActiveSpan(
      "ClickHouseTraceService.getAllTracesForProject",
      async (_span) => {
        const clickHouseClient = await this.resolveClient(input.projectId);

        try {
          const pageSize = input.pageSize ?? 25;
          const sortDirection =
            (input.sortDirection as "asc" | "desc") ?? "desc";

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
            this.logger.debug(
              { scrollId: options.scrollId },
              "Parsing scrollId from request",
            );
            try {
              cursor = JSON.parse(
                Buffer.from(options.scrollId, "base64").toString("utf-8"),
              );

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
                // scrollId is client-supplied base64 JSON parsed without a shape
                // check, and scrollStart binds as {scrollStart:UInt64}. A string,
                // a null or a negative would fail the query outright instead of
                // degrading, so a malformed one drops the cursor like every other
                // mismatch here and the scroll restarts uncapped.
                //
                // Safe INTEGER, not merely finite: an epoch is whole, and both
                // 1.5 and 2**53 are finite positives that UInt64 will not take.
                this.logger.warn(
                  { cursorScrollStart: cursor.scrollStart },
                  "Invalid scrollStart in cursor, ignoring cursor",
                );
                cursor = null;
              } else if (
                cursor &&
                (cursor.dateField ?? "occurred") !== dateField
              ) {
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

          // Generate filter conditions from input.filters. Pass the dashboard
          // time window so span/event filters bound their stored_spans EXISTS
          // subqueries to the same window the outer trace_summaries query uses,
          // pruning partitions instead of cold-scanning the S3-tiered tail.
          const {
            conditions: filterConditions,
            params: filterParams,
            hasUnsupportedFilters,
          } = generateClickHouseFilterConditions(input.filters ?? {}, {
            startDate: input.startDate,
            endDate: input.endDate,
          });

          if (hasUnsupportedFilters) {
            throw new Error(
              "Filters contain unsupported fields for ClickHouse",
            );
          }

          // The scroll's snapshot point. Pinned once, on the page that starts
          // the scroll, then carried by the cursor so every later page resolves
          // the same versions. Only the updated axis needs it — OccurredAt is
          // immutable, so the occurred cursor is stable on its own.
          const scrollStart =
            dateField === "updated"
              ? // A cursor minted before this field existed carries no snapshot.
                // Leave that scroll uncapped rather than pinning it to a point
                // after its earlier pages were already served — a bound taken
                // now would describe a moment that scroll never read from.
                cursor
                ? cursor.scrollStart
                : Date.now()
              : undefined;

          // The window this scroll can honestly claim. Version resolution is
          // pinned at scrollStart, so nothing written after it is in the scroll
          // — and a request may legitimately ask for an endDate beyond that
          // point. Reporting the requested window while delivering a shorter
          // one is how a client loses rows: it resumes from the end it asked
          // for and steps straight over the difference. Clamp instead, and
          // return the bound as `updatedThrough` so the next pull can start
          // exactly where this one stopped.
          const effectiveEndDate =
            scrollStart !== undefined
              ? Math.min(input.endDate ?? scrollStart, scrollStart)
              : input.endDate;

          // Build the query with keyset pagination
          let { traces, totalHits, lastTrace } =
            await this.fetchTracesWithPagination({
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

          // Spans are fetched when the caller wants them OR when it wants full
          // IO — because those are not the same thing.
          //
          // Blob resolution lives inside the span read: the full (>64 KB) value
          // is recoverable ONLY by de-offloading the spans' eventref pointers
          // and recomputing trace IO from them. trace_summaries holds nothing
          // but the 64 KB preview. So a content-consuming SUMMARY read — a
          // summary-mode export, a spans-less download — must still fetch and
          // resolve spans, then throw them away.
          //
          // Gating the fetch on includeSpans alone (as this did) made
          // resolveBlobs INERT for exactly those callers: the flag was set, no
          // event_log read was ever issued, and the truncated preview shipped
          // silently. That is #4991 AC1's bug, surviving on the paths the fix
          // was supposed to cover.
          //
          // resolveBlobs stays opt-in, so the list/search grid and the
          // aggregations still issue ZERO event_log reads (#4888 AC2 /
          // ADR-022 — AC5): they never ask for full IO, so nothing resolves,
          // whether or not they ask for spans.
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
            traces = wantsSpans
              ? enriched
              : enriched.map((trace) => ({ ...trace, spans: [] }));
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
            newScrollId = Buffer.from(JSON.stringify(newCursor)).toString(
              "base64",
            );

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
          const groups = rawGroups.map((group) =>
            transformTracesWithGuardrails(group),
          );

          this.logger.debug(
            {
              tracesReturned: traces.length,
              totalHits,
              hasScrollId: !!newScrollId,
              firstTraceId: traces[0]?.trace_id,
              firstTraceTimestamp: traces[0]?.timestamps.started_at,
              lastTraceId: traces[traces.length - 1]?.trace_id,
              lastTraceTimestamp:
                traces[traces.length - 1]?.timestamps.started_at,
            },
            "Returning traces result",
          );

          // Enrich with evaluations — direct ClickHouse query, no extra isClickHouseEnabled roundtrip
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
              ReturnType<typeof mapClickHouseEvaluationToTraceEvaluation>[]
            > = {};
            for (const id of traceIds) {
              grouped[id] = [];
            }
            for (const row of evalRows) {
              if (row.TraceId && grouped[row.TraceId]) {
                grouped[row.TraceId]!.push(
                  mapClickHouseEvaluationToTraceEvaluation(row),
                );
              }
            }

            traceChecks = mapTraceEvaluationsToLegacyEvaluations(grouped);
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
   *
   * @param input - Filter parameters including projectId and date range
   * @returns TopicCountsResult
   * @throws ClickHouseClientUnavailableError when no ClickHouse client resolves
   */
  async getTopicCounts(
    input: AggregationFiltersInput,
  ): Promise<TopicCountsResult> {
    return await this.tracer.withActiveSpan(
      "ClickHouseTraceService.getTopicCounts",
      { attributes: { "tenant.id": input.projectId } },
      async () => {
        const clickHouseClient = await this.resolveClient(input.projectId);

        try {
          // Build date filter conditions
          const conditions: string[] = ["TenantId = {tenantId:String}"];
          if (input.startDate) {
            conditions.push(
              "CreatedAt >= fromUnixTimestamp64Milli({startDate:UInt64})",
            );
          }
          if (input.endDate) {
            conditions.push(
              "CreatedAt <= fromUnixTimestamp64Milli({endDate:UInt64})",
            );
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
              topicCountsMap.set(
                row.TopicId,
                current + parseInt(row.count, 10),
              );
            }
            if (row.SubTopicId) {
              const current = subtopicCountsMap.get(row.SubTopicId) ?? 0;
              subtopicCountsMap.set(
                row.SubTopicId,
                current + parseInt(row.count, 10),
              );
            }
          }

          return {
            topicCounts: Array.from(topicCountsMap.entries()).map(
              ([key, count]) => ({ key, count }),
            ),
            subtopicCounts: Array.from(subtopicCountsMap.entries()).map(
              ([key, count]) => ({ key, count }),
            ),
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
   *
   * @param input - Filter parameters including projectId and date range
   * @returns CustomersAndLabelsResult
   * @throws ClickHouseClientUnavailableError when no ClickHouse client resolves
   */
  async getCustomersAndLabels(
    input: AggregationFiltersInput,
  ): Promise<CustomersAndLabelsResult> {
    return await this.tracer.withActiveSpan(
      "ClickHouseTraceService.getCustomersAndLabels",
      { attributes: { "tenant.id": input.projectId } },
      async () => {
        const clickHouseClient = await this.resolveClient(input.projectId);

        try {
          // Build date filter conditions
          const conditions: string[] = ["TenantId = {tenantId:String}"];
          if (input.startDate) {
            conditions.push(
              "CreatedAt >= fromUnixTimestamp64Milli({startDate:UInt64})",
            );
          }
          if (input.endDate) {
            conditions.push(
              "CreatedAt <= fromUnixTimestamp64Milli({endDate:UInt64})",
            );
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
            try {
              const labels = JSON.parse(row.labels_json);
              if (Array.isArray(labels)) {
                for (const label of labels) {
                  if (typeof label === "string") {
                    labelsSet.add(label);
                  }
                }
              }
            } catch {
              // If not valid JSON, treat as single label
              labelsSet.add(row.labels_json);
            }
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

  /**
   * Get a span for prompt studio by span ID.
   *
   * Returns null if:
   * - The span is not found
   * - The span is not an LLM span
   *
   * @param projectId - The project ID
   * @param spanId - The span ID to find
   * @param protections - Field redaction protections
   * @returns PromptStudioSpanResult or null
   */
  async getSpanForPromptStudio(
    projectId: string,
    spanId: string,
    protections: Protections,
  ): Promise<PromptStudioSpanResult | null> {
    return await this.tracer.withActiveSpan(
      "ClickHouseTraceService.getSpanForPromptStudio",
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

          // If the caller pointed us at a non-llm span (e.g. the user
          // clicked "Open in Playground" from the Prompt.compile or
          // PromptApiService.get span, or from the Prompts tab usage
          // card), resolve to the nearest llm in the trace that the
          // operator most likely meant: a descendant first, then a
          // sibling that started at or after the requested span. The
          // playground form needs an llm span's messages + llm config —
          // anything else lands as "No prompts open".
          const requestedType = requestedRow.SpanAttributes[
            "langwatch.span.type"
          ] as string | undefined;
          const row =
            requestedType === "llm"
              ? requestedRow
              : (findNearestLlm(allRows, requestedRow) ?? null);
          if (!row) {
            return null;
          }

          // Extract span data from attributes
          const result = this.extractPromptStudioDataFromClickHouse(
            row,
            protections,
          );

          // If the LLM span itself doesn't have a prompt reference,
          // search ancestors and their siblings to find it (SDK sets it on
          // sibling spans like Prompt.compile or PromptApiService.get)
          if (!result.promptHandle) {
            const ancestorSpans = allRows.map((r) => {
              const attributes: Record<string, unknown> = {};
              const promptId = r.SpanAttributes["langwatch.prompt.id"];
              if (promptId) attributes["langwatch.prompt.id"] = promptId;
              const promptVars = r.SpanAttributes["langwatch.prompt.variables"];
              if (promptVars)
                attributes["langwatch.prompt.variables"] = promptVars;
              const promptHandle = r.SpanAttributes["langwatch.prompt.handle"];
              if (promptHandle)
                attributes["langwatch.prompt.handle"] = promptHandle;
              const promptVersion =
                r.SpanAttributes["langwatch.prompt.version.number"];
              if (promptVersion)
                attributes["langwatch.prompt.version.number"] = promptVersion;
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
    // attributes. Lives in parseLLMSpanMessages.ts so the wire-shape
    // contract — including the single-message-object form nlpgo emits
    // for langwatch.output — is unit-testable without standing up the
    // full service. See that file's docstring for the shape catalog.
    const messages: PromptStudioSpanResult["messages"] =
      parseLLMSpanMessages(attrs);

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
    const promptTokens = attrs["gen_ai.usage.prompt_tokens"] as
      | number
      | undefined;
    const completionTokens = attrs["gen_ai.usage.completion_tokens"] as
      | number
      | undefined;

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
    const promptRef = parsePromptReference(attrs);

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
      "ClickHouseTraceService.getDistinctFieldNames",
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
      "ClickHouseTraceService.fetchTracesWithPagination",
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
          traceIds && traceIds.length > 0
            ? " AND ts.TraceId IN ({traceIds:Array(String)})"
            : "";

        // Text search on computed I/O — lower(ifNull(...)) matches the ngrambf_v1 indexed expression
        const effectiveQuery = query && query.length >= 3 ? query : undefined;

        // If the user can't see input/output, searching their content is not allowed
        if (
          effectiveQuery &&
          protections.canSeeCapturedInput === false &&
          protections.canSeeCapturedOutput === false
        ) {
          return { traces: [], totalHits: 0, lastTrace: null };
        }

        // Trace and span names are operation names rather than captured
        // content, and a tool or agent identifier is often only there, so free
        // text has to reach them too. They ride alongside the I/O columns
        // instead of replacing them, and `searchQuery` is already lowercased
        // and LIKE-escaped, so `lower(...)` on each side is the whole contract.
        // Whether captured I/O may be searched at all is still decided above.
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
              ...searchableColumns.map(
                (col) => `${col} LIKE {searchQuery:String}`,
              ),
              spanNameSearch,
            ].join(" OR ")})`
          : "";

        // Date axis.
        //  occurred (default): windows + seeks on the immutable OccurredAt in
        //    WHERE (prunes partitions). Keeps the pre-existing filter-then-dedup
        //    structure verbatim — changing it would alter results for every
        //    current client, so it stays byte-identical for backwards-compat.
        //  updated (CDC): restricts ts to each trace's LATEST version first
        //    (global max UpdatedAt, no window), THEN applies the window +
        //    filters + cursor to THAT row. So a stale version can never satisfy
        //    a filter the latest version doesn't, and "updated in [start,end]"
        //    means the trace's TRUE last modification (adjacent CDC windows stay
        //    mutually exclusive).
        const isUpdatedAxis = dateField === "updated";
        const dateColumn = isUpdatedAxis ? "UpdatedAt" : "OccurredAt";
        const cmp = sortDirection === "desc" ? "<" : ">";
        const orderDirection = sortDirection === "desc" ? "DESC" : "ASC";

        const occurredWindow =
          " AND ts.OccurredAt >= fromUnixTimestamp64Milli({startDate:UInt64}) AND ts.OccurredAt <= fromUnixTimestamp64Milli({endDate:UInt64})";
        const updatedWindow =
          " AND ts.UpdatedAt >= fromUnixTimestamp64Milli({startDate:UInt64}) AND ts.UpdatedAt <= fromUnixTimestamp64Milli({endDate:UInt64})";
        // Collapses ts to each trace's latest version (global max UpdatedAt) so
        // the updated-axis window/filters/cursor evaluate on the latest row.
        //
        // "Latest" is bounded by the scroll's start when one is in play. The
        // cursor pins a position derived from the versions visible when the
        // scroll began, and UpdatedAt keeps moving underneath it: re-resolving
        // to the current latest on every page lets a trace bumped above the
        // cursor mid-scroll fall outside every remaining page's range, which
        // drops it from the export with no error and no missing-row signal.
        // Capping here — inside the dedup rather than on the outer rows, since
        // it is version RESOLUTION that has to be stable, not just which rows
        // survive — holds each trace at the version the scroll started with.
        // The newer version is picked up by the next incremental window.
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
          const trace = mapTraceSummaryToTrace(summary, [], projectId);
          return applyTraceProtections(trace, protections);
        });

        const lastTrace =
          traces.length > 0 ? (traces[traces.length - 1] ?? null) : null;

        return { traces, totalHits, lastTrace };
      },
    );
  }

  private static readonly SUMMARY_BATCH_SIZE = 25;

  /**
   * Fetch full trace summary rows for a set of trace IDs.
   * On ClickHouse MEMORY_LIMIT_EXCEEDED, retries in smaller batches
   * so that heavy ComputedInput/ComputedOutput columns don't blow the
   * per-query memory cap. If a single batch still OOMs the error propagates.
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
     * Updated-axis snapshot point (epoch ms), and it must be the SAME one the
     * id-query used. This query re-resolves each trace's latest version, so an
     * uncapped read here would hand back a newer version than the one the page
     * was selected on — wrong sort position, and a cursor minted from a
     * timestamp that never appeared in the id-query's ordering.
     */
    scrollStart?: number;
  }): Promise<TraceSummaryRow[]> {
    // dateColumn is interpolated into SQL. The surface validates it via a zod
    // enum, but this method is also reachable from tRPC/internal paths whose
    // options are only TypeScript-narrowed — assert at the trust boundary so a
    // non-enum value can never reach the query string (defense-in-depth).
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
      if (!isClickHouseMemoryLimitError(error)) {
        throw error;
      }

      this.logger.warn(
        `Summary query OOM for ${traceIds.length} traces, retrying in batches of ${ClickHouseTraceService.SUMMARY_BATCH_SIZE}`,
      );

      const allRows: TraceSummaryRow[] = [];
      for (
        let i = 0;
        i < traceIds.length;
        i += ClickHouseTraceService.SUMMARY_BATCH_SIZE
      ) {
        const batch = traceIds.slice(
          i,
          i + ClickHouseTraceService.SUMMARY_BATCH_SIZE,
        );
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
   *
   * Events live inside stored_spans.SpanAttributes under `event.*` keys. This
   * extracts ONLY the event.* entries (via mapFilter) for the spans that carry
   * an event, scoped to the page's trace IDs and bounded to the weeks those
   * traces occurred in — so it never materializes the full SpanAttributes map
   * table-wide (the OOM vector). Mutates each trace's `events` in place.
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
    // RBAC parity with the legacy read path: events attach AFTER
    // applyTraceProtections ran, so they must get the same treatment —
    // event_details are blanked when captured input is not visible, and
    // otherwise scrubbed of any substring mirroring the trace's redacted io.
    for (const trace of traces) {
      const rawEvents = byTrace.get(trace.trace_id) ?? [];
      const redactions = new Set<string>([
        ...(!protections.canSeeCapturedInput
          ? extractRedactionsForObject(trace.input?.value)
          : []),
        ...(!protections.canSeeCapturedOutput
          ? extractRedactionsForObject(trace.output?.value)
          : []),
      ]);
      trace.events = rawEvents.map((event) =>
        applyEventProtections(event, protections, redactions),
      );
    }
  }

  /**
   * Projection JOIN: attach annotations to a page of traces.
   *
   * Annotations are Postgres-only (Prisma), never carried by the ClickHouse
   * read path. Fetched scoped to the page's trace IDs (multitenancy: projectId
   * is the first predicate). Mutates each trace's `annotations` in place.
   *
   * Every comment left on those traces, anchored ones included: this one read
   * feeds the trace table, the export and the dataset columns, and a comment on
   * one span of a trace is part of what reviewers said about it. A suggestion
   * only reads as the trace's expected output when that is what it suggested;
   * a correction proposed for a span or for the trace's input is not one.
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
    const annotations = AnnotationService.create({ prisma: this.prisma });
    const [rows, scoreDefs] = await Promise.all([
      annotations.getAllForProjection({ projectId, traceIds }),
      this.prisma.annotationScore.findMany({
        where: { projectId },
        select: { id: true, name: true },
      }),
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
        scores: remapScoreOptionsToNames(row.scoreOptions, scoreNameById),
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
      if (!isClickHouseMemoryLimitError(error)) {
        throw error;
      }

      this.logger.warn(
        `Evaluations query OOM for ${traceIds.length} traces, retrying in batches of ${ClickHouseTraceService.SUMMARY_BATCH_SIZE}`,
      );

      const allRows: ClickHouseEvaluationRunRow[] = [];
      for (
        let i = 0;
        i < traceIds.length;
        i += ClickHouseTraceService.SUMMARY_BATCH_SIZE
      ) {
        const batch = traceIds.slice(
          i,
          i + ClickHouseTraceService.SUMMARY_BATCH_SIZE,
        );
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

  /**
   * Resolve offloaded blob refs (if any), map normalized spans to legacy Span
   * objects, build the Trace via mapTraceSummaryToTrace, patch recomputed I/O,
   * and apply field-redaction protections.
   *
   * Extracted to remove the duplicated resolve+map+merge block that previously
   * appeared in both getTracesWithSpans and enrichTracesWithSpans. Both call
   * sites are now a single line.
   *
   * @internal
   */
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
     * Per-call gate (#4888/#4991): resolve offloaded eventref pointers from
     * event_log ONLY when true. The resolver is constructed on the instance,
     * but the read path opts in per call so list/search/collapsed reads keep
     * the preview and issue zero event_log SELECTs (ADR-022). Defaults to false.
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

  /**
   * Resolve offloaded blob refs for a set of traces' spans, in one pass.
   *
   * Prefers the bulk {@link resolveTraceSpansBatch} (single bounded-concurrency
   * sweep over event_log — #4991 AC6); falls back to the per-trace resolver
   * when only that is wired (e.g. a CH service constructed with just the
   * single-trace callback). When `resolveBlobs` is not true, returns
   * passthrough resolutions (preview preserved, zero event_log reads — AC5).
   *
   * @internal
   */
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
      const resolutions = await this.resolveTraceSpansBatch(
        projectId,
        spansPerTrace,
      );

      // ResolveTraceSpansBatchFn is INJECTED, so "one resolution per input
      // trace, in input order" is a convention its type cannot enforce. Today's
      // resolver honours it via .map, but a future resolver (or a test double)
      // that drops or reorders entries would silently pair the wrong resolved
      // spans with the wrong trace summary on this hot bulk-read path — shared
      // by export, thread, and the dataset/sample builders. Fail loudly at the
      // boundary, where the offending resolver is still nameable, instead of
      // letting a downstream non-null assertion crash with no context (or not
      // crash at all, and just scatter the wrong IO onto the wrong span).
      if (resolutions.length !== spansPerTrace.length) {
        throw TraceSpansBatchResolverContractError.cardinality({
          got: resolutions.length,
          expected: spansPerTrace.length,
        });
      }

      // Cardinality alone does NOT catch the silent-corruption case: a resolver
      // that returns the right COUNT in the wrong ORDER scatters each trace's IO
      // onto its neighbour. Both resolvers derive resolvedSpans by mapping over
      // the input spans, so a conforming resolution carries (a) the same span
      // count and (b) the trace identity the ResolvedTraceSpans type itself
      // lacks. Check both: a trace CAN legitimately have zero spans (the read
      // builds its map from summary rows), and such a trace has no identity to
      // compare — but the span count still catches it being swapped with a
      // spans-ful one, which is the case that would otherwise silently strip a
      // real trace's spans. Two span-less traces transposed stay invisible, and
      // are harmless: their resolutions are empty and interchangeable.
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
   *
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

    const mappedSpans = mapNormalizedSpansToSpans(resolution.resolvedSpans);
    let trace = mapTraceSummaryToTrace(summary, mappedSpans, projectId);

    // When blobs were resolved, patch trace.input / trace.output with
    // the recomputed full values (overwriting the preview from trace_summaries).
    if (recomputedInput !== null || recomputedOutput !== null) {
      trace = {
        ...trace,
        ...(recomputedInput !== null
          ? { input: { value: recomputedInput.text } }
          : {}),
        ...(recomputedOutput !== null
          ? { output: { value: recomputedOutput.text } }
          : {}),
      };
    }

    return applyTraceProtections(trace, protections);
  }

  /**
   * Enrich traces (which have empty spans) with actual span data from ClickHouse.
   *
   * Fetches spans via fetchTracesWithSpansJoined and replaces the empty span
   * arrays on each trace with the real spans. Traces whose spans are not found
   * are returned unchanged (with empty spans).
   *
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
    const tracesWithSpans = await this.fetchTracesWithSpansJoined(
      projectId,
      traceIds,
      occurredAt,
    );

    // Collect the traces that actually have spans, resolve+merge them as one
    // bounded batch (#4991 AC6), then splice the results back in order. Traces
    // whose spans are not found pass through unchanged.
    //
    // resolveBlobs is gated by the CALLER: the list/search grid leaves it false
    // so it keeps the ≤64 KB preview and issues zero event_log SELECTs (#4888
    // AC2 / ADR-022). Only the download/export path opts in (#4991 AC1).
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
   *
   * trace_summaries is ORDER BY (TenantId, TraceId), so filtering on those two
   * columns and reading only OccurredAt (a light column) lets ClickHouse answer
   * min/max from the sort-key index without decoding heavy payload columns. The
   * returned range then bounds the heavy summary read to the traces' weekly
   * partitions. Returns undefined when no rows match (min/max default to epoch),
   * so the caller keeps its previous unbounded behaviour rather than guessing.
   *
   * Pre-anchor sentinel rows (`OccurredAt = 0`, ADR-087) are excluded in SQL
   * rather than allowed to collapse the whole range: `min()` over a batch with
   * one sentinel in it returned the epoch, which failed the `> 0` check below and
   * discarded a range every other trace in the batch could have supplied.
   *
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
   * Fetch trace summaries with their spans using a JOIN query.
   * This is more efficient than two separate queries.
   *
   * The query joins trace_summaries with stored_spans on TenantId and TraceId,
   * returning all data needed to construct Trace objects.
   *
   * @internal
   */
  private async fetchTracesWithSpansJoined(
    projectId: string,
    traceIds: string[],
    occurredAt?: OccurredAtRange,
  ): Promise<
    Map<string, { summary: TraceSummaryData; spans: NormalizedSpan[] }>
  > {
    return await this.tracer.withActiveSpan(
      "ClickHouseTraceService.fetchTracesWithSpansJoined",
      {
        attributes: { "tenant.id": projectId },
      },
      async (_span) => {
        const clickHouseClient = await this.resolveClient(projectId);

        // Callers that already know the traces' time pass `occurredAt`; the
        // thread-view paths (getTracesByThreadId / getTracesWithSpansByThreadIds)
        // only have trace ids. Without a window the summary read below filters on
        // TraceId alone, which cannot prune partitions (trace_summaries is
        // partitioned on OccurredAt) and so opens every weekly part incl. cold
        // S3. Resolve the OccurredAt span from a cheap sort-key seek (light
        // column only) and reuse it to bound the heavy read. Same resolve-from-
        // sort-key shape as the single-trace read in the trace-summary repo.
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

        // The summary + span reads pull heavy columns (ComputedInput/Output,
        // Attributes, SpanAttributes/Events/Links) for the whole trace list, so a
        // large list can exceed the per-query memory cap and fail with
        // MEMORY_LIMIT_EXCEEDED. Run the list as one query on the happy path, and
        // on OOM retry in fixed-size batches (same fallback as fetchTraceSummaryRows
        // / fetchEvaluationRows).
        //
        // That bounds CLICKHOUSE's peak memory only. The batches merge back into
        // one map here, so this process still materialises the whole result set —
        // which is how a 980-trace read became 50 V8 heap deaths across the worker
        // fleet. The merge is therefore capped too; see
        // {@link MAX_SPANS_PER_JOINED_FALLBACK}.
        const runBatch = async ({
          batchTraceIds,
          maxSpanRows,
        }: {
          batchTraceIds: string[];
          /**
           * Rows the span read may return before ClickHouse refuses it.
           *
           * Set only by the OOM fallback below, which is the path with a heap
           * budget to spend. Checking the merged total AFTER a batch is decoded
           * is too late: one batch is `SUMMARY_BATCH_SIZE` traces at up to
           * {@link MAX_SPANS_PER_TRACE} spans each — 250,000 heavy rows, five
           * times the cap it is supposed to be enforcing — and materialising
           * that is the heap death the cap exists to prevent. Bounding the
           * query means the rows never cross the socket.
           */
          maxSpanRows?: number;
        }): Promise<
          Map<string, { summary: TraceSummaryData; spans: NormalizedSpan[] }>
        > => {
          // When the caller knows the traces' approximate time, bound the
          // summary read to those weekly partitions. trace_summaries is
          // partitioned on OccurredAt, so a TraceId-only filter cannot prune
          // partitions and scans every part (incl. cold S3) to locate the rows.
          // A ±2-day margin around the caller's range is safe headroom; without
          // a hint we keep the original unbounded read.
          //
          // resolveOccurredAtRange yields a RANGE (min/max OccurredAt), not a
          // point, so map it onto queryWindowed's centre+half-width form: centre
          // on the range midpoint and grow the half-width to cover half the range
          // PLUS the ±2-day margin. The emitted fragment's bounds then land on
          // exactly [from - 2d, to + 2d] — the same predicate the old local
          // constant produced. Fallback "none": a resolve failure already left
          // effectiveOccurredAt undefined (hint null -> unbounded read, warn
          // logged at the resolve site), and a hinted-but-empty summary read is
          // never widened here — an empty result is authoritative and the caller
          // below skips the span scan.
          const hasSummaryWindow =
            effectiveOccurredAt !== undefined &&
            effectiveOccurredAt.from > 0 &&
            effectiveOccurredAt.to > 0;
          const summaryHintMs = hasSummaryWindow
            ? (effectiveOccurredAt.from + effectiveOccurredAt.to) / 2
            : null;
          const summaryWindowMs = hasSummaryWindow
            ? (effectiveOccurredAt.to - effectiveOccurredAt.from) / 2 +
              DEFAULT_PARTITION_WINDOW_MS
            : DEFAULT_PARTITION_WINDOW_MS;

          // Summaries first (light, one row per trace): they carry OccurredAt,
          // which bounds the heavy stored_spans scan below to the traces' weekly
          // partitions instead of cold-scanning every partition on S3. A span's
          // StartTime always falls within its trace's lifetime, so a ±2-day window
          // around the summaries' OccurredAt range is safe headroom; when no
          // summary row is found we fall back to an unbounded span scan.
          const summaryRows = await queryWindowed<TraceSummaryRow[]>({
            table: "trace_summaries",
            hintMs: summaryHintMs,
            windowMs: summaryWindowMs,
            fallback: "none",
            isEmpty: (rows) => rows.length === 0,
            run: async (window) => {
              const summaryTimeFilterOuter = window
                ? window.sqlFor("t.OccurredAt")
                : "";
              const summaryTimeFilterInner = window
                ? window.sqlFor("OccurredAt")
                : "";
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
                  ...(window?.params ?? {}),
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

          // Bound the stored_spans scan to the weeks the matched traces occurred
          // in (the cold-scan cost driver). Same range->window mapping as the
          // summary read above: centre on the range midpoint, half-width = half
          // that range + the ±2-day margin, so the fragment lands on exactly
          // [min - 2d, max + 2d].
          //
          // Three sources, in order, and the last one cannot fail — which is the
          // point (ADR-087). This used to be one source: the matched summaries'
          // positive OccurredAts. When none survived, `hasWindow` was false, the
          // hint was null, `fallback: "none"` produced a null fragment and BOTH
          // filter strings rendered empty — so this read pulled every heavy span
          // column with no partition predicate at all, over every weekly part
          // including cold S3. That is the read prod died on with
          // MEMORY_LIMIT_EXCEEDED (code 241).
          //
          //   1. The matched summaries' own anchors. Post-ADR-087 every row has
          //      one; this stays the tightest window and the normal path.
          //   2. `effectiveOccurredAt` — the caller's own paging range, or the
          //      range resolved from trace_summaries for callers that only have
          //      trace ids. Preferred over a floor because it is derived from
          //      the traces actually being read.
          //   3. A retention floor ({@link SPAN_READ_FLOOR_LOOKBACK_MS}), via the
          //      `{ lookbackMs }` fallback, which renders `now - 90d … now + 2d`.
          //      Never null, so the filter string is never empty.
          //
          // `fallback: "none"` still applies whenever there IS a hint: a
          // hinted-but-empty span read is authoritative and must not be widened.
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
          const spanHintMs = spanRange
            ? (spanRange.from + spanRange.to) / 2
            : null;
          const spanWindowMs = spanRange
            ? (spanRange.to - spanRange.from) / 2 + DEFAULT_PARTITION_WINDOW_MS
            : DEFAULT_PARTITION_WINDOW_MS;

          // Resolved here rather than inside `run` below: the callback is
          // re-invoked per window attempt and the budget does not vary with the
          // window.
          //
          // `throw`, never `break`: `break` truncates the result and returns
          // it, which would silently hand back a partial span list as if it
          // were complete. One row of headroom so an exactly-at-budget batch
          // still succeeds and only a genuine overrun trips it.
          const spanReadSettings =
            maxSpanRows === undefined
              ? JOINED_SPAN_READ_SETTINGS
              : {
                  ...JOINED_SPAN_READ_SETTINGS,
                  max_result_rows: String(maxSpanRows + 1),
                  result_overflow_mode: "throw" as const,
                };

          const spanRows = await queryWindowed<SpanRow[]>({
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
              const spanTimeFilterOuter = window
                ? window.sqlFor("t.StartTime")
                : "";
              const spanTimeFilterInner = window
                ? window.sqlFor("StartTime")
                : "";
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
                  ...(window?.params ?? {}),
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
          if (!isClickHouseMemoryLimitError(error)) {
            throw error;
          }

          this.logger.warn(
            `Traces-with-spans join OOM for ${traceIds.length} traces, retrying in batches of ${ClickHouseTraceService.SUMMARY_BATCH_SIZE}`,
          );

          const merged = new Map<
            string,
            { summary: TraceSummaryData; spans: NormalizedSpan[] }
          >();
          let mergedSpanCount = 0;
          for (
            let i = 0;
            i < traceIds.length;
            i += ClickHouseTraceService.SUMMARY_BATCH_SIZE
          ) {
            const batch = traceIds.slice(
              i,
              i + ClickHouseTraceService.SUMMARY_BATCH_SIZE,
            );

            // Batching caps ClickHouse's peak memory, not ours — the merge
            // rebuilds the whole result set here. Stop before the heap does,
            // and stop at the QUERY rather than after decoding its rows: the
            // budget goes into the read so an over-budget batch is refused by
            // ClickHouse instead of arriving in this process first.
            // See {@link MAX_SPANS_PER_JOINED_FALLBACK}.
            const remainingSpanBudget =
              MAX_SPANS_PER_JOINED_FALLBACK - mergedSpanCount;
            let batchMap: Map<
              string,
              { summary: TraceSummaryData; spans: NormalizedSpan[] }
            >;
            try {
              batchMap = await runBatch({
                batchTraceIds: batch,
                maxSpanRows: remainingSpanBudget,
              });
            } catch (batchError) {
              if (!isClickHouseResultOverflowError(batchError))
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
  private extractTraceSummaryFromRow(
    row: JoinedTraceSpanRow,
  ): TraceSummaryData {
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
 * Split a summary row's two times back apart (ADR-087).
 *
 * `OccurredAt` is the frozen storage anchor - the partition and TTL address, and
 * the column the list read pages on. `occurredAt` on `TraceSummaryData` is the
 * span timing baseline, which is what the trace reports as its start. Before
 * migration 00072 one column carried both, so a row at the pre-anchor stamp
 * yields the same value for each; after it, the baseline has its own column and
 * reading it off the anchor would report an accept time as a span start.
 */
function traceSummaryTimesFromRow(row: TraceSummaryRow): {
  storageAnchorMs: number;
  occurredAt: number;
} {
  const isAnchored = isStorageAnchoredVersion(row.ts_Version);
  return {
    storageAnchorMs: row.ts_OccurredAt,
    occurredAt: isAnchored
      ? Number(row.ts_EarliestSpanStartMs ?? 0)
      : row.ts_OccurredAt,
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
 * ClickHouse refused a query because its result exceeded `max_result_rows`
 * under `result_overflow_mode = 'throw'` (TOO_MANY_ROWS_OR_BYTES, code 396).
 *
 * That is a deliberate refusal on our side, not a fault: the joined-span
 * fallback sets the limit from its own remaining heap budget so an over-budget
 * batch never reaches this process. Matched by code and by name because the
 * driver surfaces one or the other depending on how far the error has been
 * wrapped.
 */
export function isClickHouseResultOverflowError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (HandledError.isHandled(error)) {
    return (error.reasons ?? []).some(isClickHouseResultOverflowError);
  }
  return (
    error.message.includes("TOO_MANY_ROWS_OR_BYTES") ||
    (error as { type?: string }).type === "TOO_MANY_ROWS_OR_BYTES" ||
    (error as { code?: string | number }).code === 396 ||
    (error as { code?: string | number }).code === "396"
  );
}

export function isClickHouseMemoryLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // The resilient client translates the raw driver error into a handled
  // `query_memory_exceeded`, wrapping the original in `reasons`.
  if (HandledError.isHandled(error)) {
    return (
      error.code === "query_memory_exceeded" ||
      (error.reasons ?? []).some(isClickHouseMemoryLimitError)
    );
  }
  return (
    error.message.includes("MEMORY_LIMIT_EXCEEDED") ||
    error.message.toLowerCase().includes("memory limit exceeded") ||
    (error as { type?: string }).type === "MEMORY_LIMIT_EXCEEDED"
  );
}

/**
 * Given a non-llm span the operator clicked "Open in Playground" from
 * (typically `Prompt.compile` or `PromptApiService.get`), find the
 * nearest llm in the same trace to load instead. Preference order:
 *   1. Closest descendant llm under the requested span — usually a child
 *      llm call that consumed the just-compiled prompt.
 *   2. Sibling llm under the same parent that started after the
 *      requested span — the next llm call in the chain.
 *   3. First llm in the trace by start time as a last resort.
 * Returns null when the trace genuinely has no llm spans.
 */
function findNearestLlm<T extends PromptStudioCandidateRow>(
  rows: T[],
  requested: T,
): T | null {
  const isLlm = (r: T) =>
    (r.SpanAttributes["langwatch.span.type"] as string | undefined) === "llm";

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

  // 2. Sibling llm under the same parent (or root-level peer if the
  //    requested span has no parent) that started at/after the requested
  //    span. Earliest qualifying sibling wins, so we land on the *next*
  //    call rather than one further down the chain. Siblings that
  //    started *before* the requested span do NOT count — those belong
  //    to an earlier turn and would open an unrelated playground
  //    context — so the search falls through to step 3 instead.
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
