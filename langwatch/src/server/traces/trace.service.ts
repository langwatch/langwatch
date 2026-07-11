import type { PrismaClient } from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import { LogRecordStorageService } from "~/server/app-layer/traces/log-record-storage.service";
import { LogRecordStorageClickHouseRepository } from "~/server/app-layer/traces/repositories/log-record-storage.clickhouse.repository";
import { NullLogRecordStorageRepository } from "~/server/app-layer/traces/repositories/log-record-storage.repository";
import type { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import {
  type ClickHouseClientResolver,
  getClickHouseClientForProject,
  isClickHouseEnabled,
} from "~/server/clickhouse/clickhouseClient";
import { prisma as defaultPrisma } from "~/server/db";
import { EvaluationService } from "~/server/evaluations/evaluation.service";
import { mapTraceEvaluationsToLegacyEvaluations } from "~/server/evaluations/evaluation-run.mappers";
import type { NormalizedSpan } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import type { Evaluation, Trace } from "~/server/tracer/types";
import type { Protections } from "~/server/traces/protections";
import { createLogger } from "~/utils/logger/server";
import {
  CODING_AGENT_ORIGIN,
  enrichSpansWithClaudeLogContent,
} from "./claude-code-log-enrichment";
import { ClickHouseTraceService } from "./clickhouse-trace.service";
import { resolveOffloadedTraces } from "./resolve-offloaded-traces";

/**
 * Minimum prefix length we will attempt to resolve. Shorter strings fall
 * through to "not found" — this keeps us from scanning the entire
 * trace_summaries table on a single-character typo and narrows the search
 * space enough to meaningfully detect ambiguity.
 */
export const MIN_TRACE_ID_PREFIX_LENGTH = 8;

/**
 * Full length of a trace ID. Inputs shorter than this are treated as
 * potential prefixes; equal-or-longer inputs are treated as literal IDs.
 */
export const FULL_TRACE_ID_LENGTH = 32;

/**
 * How many candidates the resolver asks ClickHouse for when disambiguating
 * a prefix. Matches the cap the error message previews, so API clients see
 * every candidate the resolver considered.
 */
export const TRACE_ID_PREFIX_CANDIDATE_LIMIT = 5;

/**
 * Time window (in days) that prefix resolution scans. Without a partition
 * bound, ClickHouse would scan every partition (including cold storage on
 * S3) on a miss. 90 days covers the CLI's "copy a truncated ID from a
 * recent search" use case while keeping the query on hot partitions.
 * Full 32-char IDs still resolve unbounded via the normal exact-match path.
 */
export const TRACE_ID_PREFIX_LOOKUP_WINDOW_DAYS = 90;

/**
 * Thrown when a trace ID prefix matches more than one trace in the project.
 * Callers (route handlers) map this to a 409 response listing the full
 * candidate IDs so the user can disambiguate.
 */
export class AmbiguousTraceIdPrefixError extends Error {
  constructor(
    public readonly prefix: string,
    public readonly candidateTraceIds: string[],
  ) {
    const preview = candidateTraceIds
      .slice(0, TRACE_ID_PREFIX_CANDIDATE_LIMIT)
      .join(", ");
    const suffix =
      candidateTraceIds.length > TRACE_ID_PREFIX_CANDIDATE_LIMIT
        ? `, …${candidateTraceIds.length - TRACE_ID_PREFIX_CANDIDATE_LIMIT} more`
        : "";
    super(
      `Trace ID prefix "${prefix}" is ambiguous — matches: ${preview}${suffix}. Use a longer prefix.`,
    );
    this.name = "AmbiguousTraceIdPrefixError";
  }
}

/**
 * Trace IDs per the OpenTelemetry spec are 32 hex characters. We only
 * attempt prefix resolution for hex-only inputs — non-hex typos ("my-id ")
 * short-circuit to 404 without scanning.
 */
const HEX_ONLY = /^[0-9a-f]+$/i;

import type {
  AggregationFiltersInput,
  CustomersAndLabelsResult,
  DistinctFieldNamesResult,
  GetAllTracesForProjectInput,
  GetAllTracesForProjectOptions,
  PromptStudioSpanResult,
  TopicCountsResult,
  TracesForProjectResult,
} from "./types";

/**
 * Optional blob-offload resolution dependencies injected into TraceService
 * (ADR-022: read-time recompute via event_log).
 *
 * When provided, every read path that returns `Trace[]` with spans passes
 * each trace's normalized spans through `resolveOffloadedTraces` to
 * restore full field values that were offloaded by `leanForProjection`,
 * then re-runs `TraceIOExtractionService` to recompute trace.input /
 * trace.output from the resolved spans.
 *
 * When omitted (e.g. in tests or when S3 is not configured) the service
 * falls back to the preview values from trace_summaries — identical to
 * pre-ADR-022 behavior.
 */
export interface BlobResolutionDeps {
  blobStore: BlobStore;
  ioExtractionService: TraceIOExtractionService;
}

/**
 * Builds the per-trace resolver callback from BlobResolutionDeps.
 *
 * Encapsulates the ADR-022 read-path wiring: given a projectId and the
 * NormalizedSpan array for a single trace, calls `resolveOffloadedTraces`
 * and returns the resolved spans + recomputed IO.
 *
 * Returned as `undefined` when `deps` is absent so that ClickHouseTraceService
 * falls back to the preview values from trace_summaries (pre-ADR-022 behavior).
 */
class OffloadedSpanResolver {
  constructor(
    private readonly deps: BlobResolutionDeps,
    private readonly logger: ReturnType<typeof createLogger>,
  ) {}

  /**
   * Returns an async callback compatible with ClickHouseTraceService's
   * `resolveTraceSpansFn` parameter.
   */
  toResolverFn(): (
    projectId: string,
    normalizedSpans: NormalizedSpan[],
  ) => ReturnType<typeof resolveOffloadedTraces> {
    return (projectId, normalizedSpans) =>
      resolveOffloadedTraces({
        projectId,
        normalizedSpans,
        blobStore: this.deps.blobStore,
        ioExtractionService: this.deps.ioExtractionService,
        logger: this.logger,
      });
  }
}

/**
 * Unified service for fetching traces from ClickHouse.
 *
 * This service acts as a facade that routes all requests to the ClickHouse backend.
 *
 * @example
 * ```ts
 * const service = TraceService.create(prisma);
 * const traces = await service.getTracesWithSpans(projectId, traceIds, protections);
 * ```
 */
export class TraceService {
  private readonly tracer = getLangWatchTracer("langwatch.traces.service");
  private readonly logger = createLogger("langwatch:traces:service");
  private readonly clickHouseService: ClickHouseTraceService;
  private readonly evaluationService: EvaluationService;
  private readonly injectedLogRecordStorage?: LogRecordStorageService;
  private cachedLogRecordStorage?: LogRecordStorageService;
  constructor(
    readonly prisma: PrismaClient,
    blobResolutionDeps?: BlobResolutionDeps,
    logRecordStorage?: LogRecordStorageService,
  ) {
    // Build the per-trace resolver callback when deps are present.
    // The callback is passed to ClickHouseTraceService so resolution happens
    // at the NormalizedSpan level (before mapping to legacy Span), which is
    // the only level where spanAttributes carry the eventref keys.
    const resolveTraceSpansFn =
      blobResolutionDeps !== undefined
        ? new OffloadedSpanResolver(
            blobResolutionDeps,
            this.logger,
          ).toResolverFn()
        : undefined;

    this.clickHouseService = ClickHouseTraceService.create(
      prisma,
      resolveTraceSpansFn,
    );
    this.evaluationService = EvaluationService.create();
    // Injected store for the read-time Claude Code content enrichment; the
    // default is built LAZILY on first use (see logRecordStorageService) so
    // construction never touches ClickHouse config. Non-enriching callers and
    // unit tests that never hit the coding-agent path pay nothing — and don't
    // need to mock `isClickHouseEnabled`/`getClickHouseClientForProject`.
    this.injectedLogRecordStorage = logRecordStorage;
  }

  /**
   * The log-record store for read-time Claude Code content enrichment, built
   * lazily so a TraceService that never enriches (or a unit test that never
   * exercises the coding-agent-origin path) never constructs the
   * ClickHouse-backed default.
   */
  private logRecordStorageService(): LogRecordStorageService {
    if (this.injectedLogRecordStorage) return this.injectedLogRecordStorage;
    return (this.cachedLogRecordStorage ??=
      TraceService.buildDefaultLogRecordStorage());
  }

  private static buildDefaultLogRecordStorage(): LogRecordStorageService {
    const resolveClickHouseClient: ClickHouseClientResolver = async (
      tenantId,
    ) => {
      const client = await getClickHouseClientForProject(tenantId);
      if (!client) {
        throw new Error(`ClickHouse not available for tenant ${tenantId}`);
      }
      return client;
    };
    return new LogRecordStorageService(
      isClickHouseEnabled()
        ? new LogRecordStorageClickHouseRepository(resolveClickHouseClient)
        : new NullLogRecordStorageRepository(),
    );
  }

  /**
   * Static factory method for creating TraceService with default dependencies.
   *
   * @param prisma - PrismaClient instance
   * @param blobResolutionDeps - Optional blob-offload resolution deps (#4888)
   * @param logRecordStorage - Optional log-record store for read-time Claude
   *   Code content enrichment; default-built when omitted.
   * @returns TraceService instance
   */
  static create(
    prisma: PrismaClient = defaultPrisma,
    blobResolutionDeps?: BlobResolutionDeps,
    logRecordStorage?: LogRecordStorageService,
  ): TraceService {
    return new TraceService(prisma, blobResolutionDeps, logRecordStorage);
  }

  /**
   * Get a single trace by ID.
   *
   * @param projectId - The project ID
   * @param traceId - The trace ID to fetch
   * @param protections - Field redaction protections
   * @param opts.full - When true AND blob-resolution deps are present, resolves
   *   offloaded eventref pointers from event_log so over-threshold IO values
   *   read back full (#4888). Default (undefined/false) returns the ≤64 KB
   *   preview — identical to pre-#4888 behavior.
   * @returns The trace if found, undefined otherwise
   */
  async getById(
    projectId: string,
    traceId: string,
    protections: Protections,
    opts?: { full?: boolean },
  ): Promise<Trace | undefined> {
    return this.tracer.withActiveSpan(
      "TraceService.getById",
      { attributes: { "tenant.id": projectId, "trace.id": traceId } },
      async (span) => {
        const traces = await this.clickHouseService.getTracesWithSpans(
          projectId,
          [traceId],
          protections,
          undefined,
          { resolveBlobs: opts?.full },
        );
        if (traces[0]) {
          return this.enrichCodingAgentTrace(projectId, traces[0]);
        }

        // No exact match. If the input looks like a truncated hex prefix
        // (shorter than a full trace ID, but long enough to meaningfully
        // narrow the scan), try git-style prefix resolution scoped to this
        // project and the last TRACE_ID_PREFIX_LOOKUP_WINDOW_DAYS days.
        if (
          traceId.length < FULL_TRACE_ID_LENGTH &&
          traceId.length >= MIN_TRACE_ID_PREFIX_LENGTH &&
          HEX_ONLY.test(traceId)
        ) {
          const now = Date.now();
          const candidates =
            await this.clickHouseService.resolveTraceIdByPrefix({
              projectId,
              prefix: traceId,
              occurredAt: {
                from:
                  now -
                  TRACE_ID_PREFIX_LOOKUP_WINDOW_DAYS * 24 * 60 * 60 * 1000,
                to: now,
              },
              limit: TRACE_ID_PREFIX_CANDIDATE_LIMIT,
            });
          if (candidates.length === 0) {
            return undefined;
          }
          if (candidates.length > 1) {
            span.setAttribute("trace.id.prefix.ambiguous", true);
            throw new AmbiguousTraceIdPrefixError(traceId, candidates);
          }

          span.setAttribute("trace.id.prefix.resolved", candidates[0]!);
          const resolved = await this.clickHouseService.getTracesWithSpans(
            projectId,
            [candidates[0]!],
            protections,
            undefined,
            { resolveBlobs: opts?.full },
          );
          return resolved[0]
            ? this.enrichCodingAgentTrace(projectId, resolved[0])
            : undefined;
        }

        return undefined;
      },
    );
  }

  /**
   * Read-time Claude Code content enrichment for coding-agent-origin traces.
   * The real `llm_request` spans carry tokens / `request_id` but no message
   * content and no cost — both live in the trace's OTLP log records. When the
   * trace is coding-agent origin we do one lazy, time-capped log read and join
   * capped `input` / `output` + the authoritative `cost` onto the spans so the
   * legacy trace/span API (REST, export, legacy tRPC, evals) returns whole
   * spans. Origin-gated so a non-Claude trace pays nothing; idempotent and a
   * no-op when the trace has no Claude content logs; best-effort (a log-read
   * failure returns the un-enriched trace rather than failing the read).
   */
  private async enrichCodingAgentTrace(
    projectId: string,
    trace: Trace,
  ): Promise<Trace> {
    if (trace.metadata?.["langwatch.origin"] !== CODING_AGENT_ORIGIN) {
      return trace;
    }
    try {
      const logRows = await this.logRecordStorageService().getLogsByTraceId(
        projectId,
        trace.trace_id,
        trace.timestamps.started_at,
      );
      if (logRows.length === 0) return trace;
      const spans = enrichSpansWithClaudeLogContent({
        spans: trace.spans,
        logRows,
      });
      return spans === trace.spans ? trace : { ...trace, spans };
    } catch (error) {
      this.logger.warn(
        {
          projectId,
          traceId: trace.trace_id,
          error: error instanceof Error ? error.message : String(error),
        },
        "Claude Code log enrichment skipped: failed to read trace logs",
      );
      return trace;
    }
  }

  /**
   * Get traces with spans for the given trace IDs.
   *
   * @param projectId - The project ID
   * @param traceIds - Array of trace IDs to fetch
   * @param protections - Field redaction protections
   * @param occurredAt - Optional approximate trace time range (epoch ms). When
   *   supplied, the trace_summaries read prunes to the matching weekly
   *   partitions instead of scanning every partition (incl. cold S3).
   * @param opts.full - When true AND blob-resolution deps are present, resolves
   *   offloaded eventref pointers from event_log so over-threshold IO values
   *   read back full (#4888). Default (undefined/false) returns previews.
   * @returns Array of Trace objects with spans
   */
  async getTracesWithSpans(
    projectId: string,
    traceIds: string[],
    protections: Protections,
    occurredAt?: { from: number; to: number },
    opts?: { full?: boolean },
  ): Promise<Trace[]> {
    return this.tracer.withActiveSpan(
      "TraceService.getTracesWithSpans",
      {
        attributes: { "tenant.id": projectId, "trace.count": traceIds.length },
      },
      async () => {
        return this.clickHouseService.getTracesWithSpans(
          projectId,
          traceIds,
          protections,
          occurredAt,
          { resolveBlobs: opts?.full },
        );
      },
    );
  }

  /**
   * Get traces grouped by thread ID.
   *
   * @param projectId - The project ID
   * @param threadId - The thread ID to group by
   * @param protections - Field redaction protections
   * @returns Array of traces in the thread
   */
  async getTracesByThreadId(
    projectId: string,
    threadId: string,
    protections: Protections,
  ): Promise<Trace[]> {
    return this.tracer.withActiveSpan(
      "TraceService.getTracesByThreadId",
      { attributes: { "tenant.id": projectId, "thread.id": threadId } },
      async () => {
        return this.clickHouseService.getTracesByThreadId(
          projectId,
          threadId,
          protections,
        );
      },
    );
  }

  /**
   * Get all traces for a project with filtering and pagination.
   *
   * @param input - Query parameters including filters, pagination, and sorting
   * @param protections - Field redaction protections
   * @param options - Additional options for download mode
   * @returns TracesForProjectResult with groups, totalHits, and traceChecks
   */
  async getAllTracesForProject(
    input: GetAllTracesForProjectInput,
    protections: Protections,
    options: GetAllTracesForProjectOptions = {},
  ): Promise<TracesForProjectResult> {
    return this.tracer.withActiveSpan(
      "TraceService.getAllTracesForProject",
      { attributes: { "tenant.id": input.projectId } },
      async () => {
        return this.clickHouseService.getAllTracesForProject(
          input,
          protections,
          options,
        );
      },
    );
  }

  /**
   * Get evaluations for multiple traces.
   *
   * @param projectId - The project ID
   * @param traceIds - Array of trace IDs
   * @param protections - Field redaction protections
   * @returns Map of trace ID to evaluations
   */
  async getEvaluationsMultiple(
    projectId: string,
    traceIds: string[],
    protections: Protections,
  ): Promise<Record<string, Evaluation[]>> {
    return this.tracer.withActiveSpan(
      "TraceService.getEvaluationsMultiple",
      {
        attributes: { "tenant.id": projectId, "trace.count": traceIds.length },
      },
      async () => {
        const result = await this.evaluationService.getEvaluationsMultiple({
          projectId,
          traceIds,
          protections,
        });

        return mapTraceEvaluationsToLegacyEvaluations(result);
      },
    );
  }

  /**
   * Lazily fetch one evaluation's inputs, keyed by evaluation id so the read
   * prunes ClickHouse granules instead of scanning the whole trace. Used by
   * the v2 drawer when a single evaluation card is expanded.
   *
   * @param projectId - The project ID
   * @param evaluationId - The evaluation to fetch inputs for
   * @returns The parsed inputs, or null when none are available
   */
  async getEvaluationInputs(
    projectId: string,
    evaluationId: string,
  ): Promise<Record<string, unknown> | null> {
    return this.tracer.withActiveSpan(
      "TraceService.getEvaluationInputs",
      {
        attributes: {
          "tenant.id": projectId,
          "evaluation.id": evaluationId,
        },
      },
      async () => {
        return this.evaluationService.getEvaluationInputs({
          projectId,
          evaluationId,
        });
      },
    );
  }

  /**
   * Get traces with spans by thread IDs.
   *
   * @param projectId - The project ID
   * @param threadIds - Array of thread IDs
   * @param protections - Field redaction protections
   * @param opts.full - When true AND blob-resolution deps are present, resolves
   *   offloaded eventref pointers so thread IO reads back full. Used by the
   *   eval path (which needs full values for thread-mapped evaluators) — the
   *   eval-path TraceService carries deps. Customer thread views pass nothing
   *   and carry no deps, so they stay on the ≤64 KB preview (#4888 / ADR-022).
   * @returns Array of traces
   */
  async getTracesWithSpansByThreadIds(
    projectId: string,
    threadIds: string[],
    protections: Protections,
    opts?: { full?: boolean },
  ): Promise<Trace[]> {
    return this.tracer.withActiveSpan(
      "TraceService.getTracesWithSpansByThreadIds",
      {
        attributes: {
          "tenant.id": projectId,
          "thread.count": threadIds.length,
        },
      },
      async () => {
        return this.clickHouseService.getTracesWithSpansByThreadIds(
          projectId,
          threadIds,
          protections,
          { resolveBlobs: opts?.full },
        );
      },
    );
  }

  /**
   * Get topic and subtopic counts for a project with filters.
   *
   * @param input - Filter parameters including projectId and date range
   * @returns TopicCountsResult with topic and subtopic aggregations
   */
  async getTopicCounts(
    input: AggregationFiltersInput,
  ): Promise<TopicCountsResult> {
    return this.tracer.withActiveSpan(
      "TraceService.getTopicCounts",
      { attributes: { "tenant.id": input.projectId } },
      async () => {
        return this.clickHouseService.getTopicCounts(input);
      },
    );
  }

  /**
   * Get unique customers and labels for a project.
   *
   * @param input - Filter parameters including projectId and date range
   * @returns CustomersAndLabelsResult with unique customer IDs and labels
   */
  async getCustomersAndLabels(
    input: AggregationFiltersInput,
  ): Promise<CustomersAndLabelsResult> {
    return this.tracer.withActiveSpan(
      "TraceService.getCustomersAndLabels",
      { attributes: { "tenant.id": input.projectId } },
      async () => {
        return this.clickHouseService.getCustomersAndLabels(input);
      },
    );
  }

  /**
   * Get distinct span names and metadata keys for a project within a date range.
   *
   * @param projectId - The project ID
   * @param startDate - Start of date range (epoch millis)
   * @param endDate - End of date range (epoch millis)
   * @returns DistinctFieldNamesResult with span names and metadata keys
   */
  async getDistinctFieldNames(
    projectId: string,
    startDate: number,
    endDate: number,
  ): Promise<DistinctFieldNamesResult> {
    return this.tracer.withActiveSpan(
      "TraceService.getDistinctFieldNames",
      { attributes: { "tenant.id": projectId } },
      async () => {
        return this.clickHouseService.getDistinctFieldNames(
          projectId,
          startDate,
          endDate,
        );
      },
    );
  }

  /**
   * Get a span for prompt studio by span ID.
   *
   * @param projectId - The project ID
   * @param spanId - The span ID to find
   * @param protections - Field redaction protections
   * @returns PromptStudioSpanResult or null if not found
   */
  async getSpanForPromptStudio(
    projectId: string,
    spanId: string,
    protections: Protections,
  ): Promise<PromptStudioSpanResult | null> {
    return this.tracer.withActiveSpan(
      "TraceService.getSpanForPromptStudio",
      { attributes: { "tenant.id": projectId, "span.id": spanId } },
      async () => {
        return this.clickHouseService.getSpanForPromptStudio(
          projectId,
          spanId,
          protections,
        );
      },
    );
  }
}
