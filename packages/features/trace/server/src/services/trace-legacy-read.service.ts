import type { Protections } from "@langwatch/trace-contract";
import { TraceEvaluationMappingService } from "./trace-evaluation-mapping.service";
import type { EvaluationService } from "@langwatch/evaluation-contract";
import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
import { createLogger } from "@langwatch/observability";
import { getLangWatchTracer } from "langwatch";
import type { TraceBlobStoreService } from "./trace-blob-store.service";
import { type TraceLogRecordReader } from "./claude-code-log-enrichment.service";
import type { TraceIOExtractionService } from "#services/trace-io-extraction.service";
import type { Evaluation, Trace } from "@langwatch/trace-contract";

import type { TraceLegacyReadRepository } from "../repositories/trace-legacy-read.repository";
import { TraceEditOverlayService } from "./trace-edit-overlay.service";
import { TraceReadEnrichmentService } from "./trace-read-enrichment.service";

/**
 * Minimum prefix length we will attempt to resolve. Shorter strings fall through to "not found" — this keeps us
 * from scanning the entire trace_summaries table on a single-character typo and narrows the search space enough to
 * meaningfully detect ambiguity.
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
 * Time window (in days) that prefix resolution scans. Without a partition bound, ClickHouse would scan every partition (including cold storage on S3) on a
 * miss. 90 days covers the CLI's "copy a truncated ID from a recent search" use case while keeping the query on hot partitions. Full 32-char IDs still
 * resolve unbounded via the normal exact-match path.
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
    const preview = candidateTraceIds.slice(0, TRACE_ID_PREFIX_CANDIDATE_LIMIT).join(", ");
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
  CustomersAndLabelsResult,
  DistinctFieldNamesResult,
  PromptStudioSpanResult,
  TopicCountsResult,
  TracesForProjectResult,
} from "@langwatch/trace-contract";
import type {
  AggregationFiltersInput,
  GetAllTracesForProjectInput,
  GetAllTracesForProjectOptions,
} from "@langwatch/trace-contract";

/**
 * Optional blob-offload resolution dependencies injected into TraceService
 * (ADR-022: read-time recompute via event_log).
 * pre-ADR-022 behavior.
 */
export interface BlobResolutionDeps {
  blobStore: TraceBlobStoreService;
  ioExtractionService: TraceIOExtractionService;
}

/**
 * Unified service for fetching traces from ClickHouse.
 */
export class TraceService {
  private readonly tracer = getLangWatchTracer("langwatch.traces.service");
  private readonly logger = createLogger("langwatch:traces:service");
  private constructor(
    private readonly enrichment: TraceReadEnrichmentService,
    private readonly clickHouseService: TraceLegacyReadRepository,
    // Required, so it comes before the optional tail: every single-trace read
    // resolves the evaluations behind it.
    private readonly evaluationService: EvaluationService,
  ) {}

  /**
   * @param options composed service dependencies; @param blobResolutionDeps optional blob-offload deps (#4888);
   * @param logRecordStorage optional log-record store for read-time Claude Code enrichment.
   * @returns TraceService instance
   */
  static create({
    traceCanonicalisation,
    traceRead,
    editOverlay,
    logRecordStorage,
    evaluationService,
  }: {
    traceCanonicalisation: TraceCanonicalisationService;
    /** The composed trace store; the composition root picks the implementation. */
    traceRead: TraceLegacyReadRepository;
    /** Reviewer corrections, applied only where a caller opts in. */
    editOverlay: TraceEditOverlayService;
    logRecordStorage?: TraceLogRecordReader;
    /** Required: every single-trace read resolves the evaluations behind it. */
    evaluationService: EvaluationService;
  }): TraceService {
    return new TraceService(
      TraceReadEnrichmentService.create({ traceCanonicalisation, editOverlay, logRecordStorage }),
      traceRead,
      evaluationService,
    );
  }

  /**
   * @param projectId project ID; @param traceId trace ID to fetch; @param protections redaction protections.
   * @param opts.full resolves offloaded blob previews when deps are present; @param opts.withEditOverlay applies a reviewer's saved correction.
   * @returns The trace if found, undefined otherwise
   */
  async tryGetById(
    projectId: string,
    traceId: string,
    protections: Protections,
    opts?: { full?: boolean; withEditOverlay?: boolean },
  ): Promise<Trace | undefined> {
    return this.tracer.withActiveSpan(
      "TraceService.tryGetById",
      { attributes: { "tenant.id": projectId, "trace.id": traceId } },
      async (span) => {
        const finish = (trace: Trace) =>
          this.enrichment.enrichAndCorrect({
            projectId,
            trace,
            protections,
            withEditOverlay: opts?.withEditOverlay,
          });

        const traces = await this.clickHouseService.getTracesWithSpans(
          projectId,
          [traceId],
          protections,
          undefined,
          { resolveBlobs: opts?.full },
        );
        if (traces[0]) {
          return finish(traces[0]);
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
          const candidates = await this.clickHouseService.resolveTraceIdByPrefix({
            projectId,
            prefix: traceId,
            occurredAt: {
              from: now - TRACE_ID_PREFIX_LOOKUP_WINDOW_DAYS * 24 * 60 * 60 * 1000,
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

          return resolved[0] ? finish(resolved[0]) : undefined;
        }

        return undefined;
      },
    );
  }

  /**
   * @param projectId project ID; @param traceIds trace IDs; @param protections redaction protections;
   * @param occurredAt bounds the partition scan; @param opts.full resolves offloaded blob previews; @param opts.withEditOverlay applies reviewer corrections.
   * @returns Array of Trace objects with spans
   */
  async getTracesWithSpans(
    projectId: string,
    traceIds: string[],
    protections: Protections,
    occurredAt?: { from: number; to: number },
    opts?: { full?: boolean; withEditOverlay?: boolean },
  ): Promise<Trace[]> {
    return this.tracer.withActiveSpan(
      "TraceService.getTracesWithSpans",
      {
        attributes: { "tenant.id": projectId, "trace.count": traceIds.length },
      },
      async () => {
        const traces = await this.clickHouseService.getTracesWithSpans(
          projectId,
          traceIds,
          protections,
          occurredAt,
          { resolveBlobs: opts?.full },
        );
        const enriched = await this.enrichment.enrichCodingAgentTraces(projectId, traces);
        if (!opts?.withEditOverlay) {
          return enriched;
        }

        return this.enrichment.applyEditOverlays(projectId, enriched, protections);
      },
    );
  }

  /**
   * @param projectId project ID; @param threadId thread ID to group by; @param protections redaction protections.
   * @param opts.full resolves offloaded blob previews when deps are present.
   * @returns Array of traces in the thread
   */
  async getTracesByThreadId(
    projectId: string,
    threadId: string,
    protections: Protections,
    opts?: { full?: boolean },
  ): Promise<Trace[]> {
    return this.tracer.withActiveSpan(
      "TraceService.getTracesByThreadId",
      { attributes: { "tenant.id": projectId, "thread.id": threadId } },
      async () => {
        const traces = await this.clickHouseService.getTracesByThreadId(
          projectId,
          threadId,
          protections,
          { resolveBlobs: opts?.full },
        );

        return this.enrichment.enrichCodingAgentTraces(projectId, traces);
      },
    );
  }

  /**
   * @param input query parameters (filters, pagination, sorting); @param protections redaction protections;
   * @param options additional download-mode options.
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
        const result = await this.clickHouseService.getAllTracesForProject(
          input,
          protections,
          options,
        );
        if (!options.includeSpans) {
          return result;
        }

        // includeSpans callers (bulk export, search) read whole spans, so the Claude Code content + cost join
        // applies here exactly as on the single-trace and thread reads. Enrichment runs over the flattened page
        // so the helper's bounded fan-out caps concurrent log reads for the whole page; a page with no
        // coding-agent trace returns the same array reference and pays nothing.
        const flat = result.groups.flat();
        const enriched = await this.enrichment.enrichCodingAgentTraces(input.projectId, flat);
        if (enriched === flat) {
          return result;
        }

        // The helper is positional (same order, same length), so the groups
        // rebuild by position rather than by id.
        let cursor = 0;
        const groups = result.groups.map((group) =>
          group.map(() => enriched[cursor++] as (typeof group)[number]),
        );

        return { ...result, groups };
      },
    );
  }

  /**
   * @param projectId project ID; @param traceIds array of trace IDs; @param protections redaction protections.
   * @returns Map of trace ID to evaluations
   */
  async getEvaluationsMultiple(
    projectId: string,
    traceIds: string[],
    _protections: Protections,
  ): Promise<Record<string, Evaluation[]>> {
    return this.tracer.withActiveSpan(
      "TraceService.getEvaluationsMultiple",
      {
        attributes: { "tenant.id": projectId, "trace.count": traceIds.length },
      },
      async () => {
        const result = await this.evaluationService.findTraceEvaluations({
          tenantId: projectId,
          traceIds,
        });

        return TraceEvaluationMappingService.mapTraceEvaluationsToLegacyEvaluations(result);
      },
    );
  }

  /**
   * @param projectId - The project ID
   * @param evaluationId - The evaluation to fetch inputs for
   * @returns The parsed inputs, or null when none are available
   */
  async tryGetEvaluationInputs({
    projectId,
    evaluationId,
  }: {
    projectId: string;
    evaluationId: string;
  }): Promise<Record<string, unknown> | null> {
    return this.tracer.withActiveSpan(
      "TraceService.tryGetEvaluationInputs",
      {
        attributes: {
          "tenant.id": projectId,
          "evaluation.id": evaluationId,
        },
      },
      async () => {
        return this.evaluationService.tryGetInputs({
          tenantId: projectId,
          evaluationId,
        });
      },
    );
  }

  /**
   * @param projectId project ID; @param threadIds thread IDs; @param protections redaction protections;
   * @param opts.full resolves preview, zero event_log reads (#4888 / ADR-022); @param opts.withEditOverlay applies corrections.
   * @returns Array of traces
   */
  async getTracesWithSpansByThreadIds(
    projectId: string,
    threadIds: string[],
    protections: Protections,
    opts?: { full?: boolean; withEditOverlay?: boolean },
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
        const traces = await this.clickHouseService.getTracesWithSpansByThreadIds(
          projectId,
          threadIds,
          protections,
          { resolveBlobs: opts?.full },
        );
        const enriched = await this.enrichment.enrichCodingAgentTraces(projectId, traces);
        if (!opts?.withEditOverlay) {
          return enriched;
        }

        return this.enrichment.applyEditOverlays(projectId, enriched, protections);
      },
    );
  }

  /**
   * Get topic and subtopic counts for a project with filters.
   * @param input - Filter parameters including projectId and date range
   * @returns TopicCountsResult with topic and subtopic aggregations
   */
  async getTopicCounts(input: AggregationFiltersInput): Promise<TopicCountsResult> {
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
   * @param input - Filter parameters including projectId and date range
   * @returns CustomersAndLabelsResult with unique customer IDs and labels
   */
  async getCustomersAndLabels(input: AggregationFiltersInput): Promise<CustomersAndLabelsResult> {
    return this.tracer.withActiveSpan(
      "TraceService.getCustomersAndLabels",
      { attributes: { "tenant.id": input.projectId } },
      async () => {
        return this.clickHouseService.getCustomersAndLabels(input);
      },
    );
  }

  /**
   * @param projectId project ID; @param startDate start of date range (epoch millis); @param endDate end of range.
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
        return this.clickHouseService.getDistinctFieldNames(projectId, startDate, endDate);
      },
    );
  }

  /**
   * @param projectId project ID; @param spanId span ID to find; @param protections redaction protections.
   * @returns PromptStudioSpanResult or null if not found
   */
  async tryGetSpanForPromptStudio({
    projectId,
    spanId,
    protections,
  }: {
    projectId: string;
    spanId: string;
    protections: Protections;
  }): Promise<PromptStudioSpanResult | null> {
    return this.tracer.withActiveSpan(
      "TraceService.tryGetSpanForPromptStudio",
      { attributes: { "tenant.id": projectId, "span.id": spanId } },
      async () => {
        return this.clickHouseService.tryGetSpanForPromptStudio({
          projectId,
          spanId,
          protections,
        });
      },
    );
  }
}
