import type { Protections } from "@langwatch/trace-contract";
import { TraceEditOverlayRedactionService } from "./trace-edit-overlay-redaction.service";
import { ClaudeCodeLogEnrichmentService } from "./claude-code-log-enrichment.service";
import { TraceEvaluationMappingService } from "./trace-evaluation-mapping.service";
import type { EvaluationService } from "@langwatch/evaluation-contract";
import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
import { createLogger } from "@langwatch/observability";
import { getLangWatchTracer } from "langwatch";
import type { TraceBlobStoreService } from "./trace-blob-store.service";
import {
  CODING_AGENT_ORIGIN,
  type TraceLogRecordReader,
} from "./claude-code-log-enrichment.service";
import type { TraceIOExtractionService } from "#services/trace-io-extraction.service";
import type { Evaluation, Trace } from "@langwatch/trace-contract";

import type { TraceLegacyReadRepository } from "../repositories/trace-legacy-read.repository";
import { applyOverlayToTrace } from "@langwatch/trace-contract";
import { TraceEditOverlayService } from "./trace-edit-overlay.service";

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
  private readonly injectedLogRecordStorage?: TraceLogRecordReader;
  private constructor(
    private readonly traceCanonicalisation: TraceCanonicalisationService,
    private readonly clickHouseService: TraceLegacyReadRepository,
    private readonly editOverlay: TraceEditOverlayService,
    // Required, so it comes before the optional tail: every single-trace read
    // resolves the evaluations behind it.
    private readonly evaluationService: EvaluationService,
    logRecordStorage?: TraceLogRecordReader,
  ) {
    // Injected store for the read-time Claude Code content enrichment; the
    // default comes LAZILY from the App on first use (see
    // logRecordStorageService), so construction here stays free of ClickHouse
    // wiring. Non-enriching callers and unit tests that never hit the
    // coding-agent path pay nothing.
    this.injectedLogRecordStorage = logRecordStorage;
  }

  /**
   * The log-record store for read-time Claude Code content enrichment.
   */
  private logRecordStorageService(): TraceLogRecordReader {
    const injected = this.injectedLogRecordStorage;
    if (!injected) {
      throw new Error(
        "This trace read was composed with no log-record reader, so a coding-agent trace cannot be enriched with the content its spans left in the trace's log records.",
      );
    }

    return injected;
  }

  /**
   * The single-trace tail shared by every branch of {@link tryGetById}: coding-agent
   * enrichment first, then the reviewer correction if the caller asked for one.
   */
  private async enrichAndCorrect({
    projectId,
    trace,
    protections,
    withEditOverlay,
  }: {
    projectId: string;
    trace: Trace;
    protections: Protections;
    withEditOverlay?: boolean;
  }): Promise<Trace> {
    const enriched = await this.enrichCodingAgentTrace(projectId, trace);
    if (!withEditOverlay) {
      return enriched;
    }

    const [corrected] = await this.applyEditOverlays(projectId, [enriched], protections);

    return corrected ?? enriched;
  }

  /**
   * Overlays reviewer corrections onto a page of traces, in one read for the whole page. Runs LAST on every
   * opted-in path, after blob resolution and coding-agent enrichment, so a correction wins over whatever the
   * resolvers put in the field.
   */
  private async applyEditOverlays(
    projectId: string,
    traces: Trace[],
    protections: Protections,
  ): Promise<Trace[]> {
    if (traces.length === 0) {
      return traces;
    }

    const patches = await this.editOverlay.getPatchesByTraceIds({
      projectId,
      traceIds: traces.map((trace) => trace.trace_id),
    });
    if (patches.size === 0) {
      return traces;
    }

    let changed = false;
    const corrected = traces.map((trace) => {
      const patch = patches.get(trace.trace_id);
      if (!patch) {
        return trace;
      }

      const next = applyOverlayToTrace({
        trace,
        patch: TraceEditOverlayRedactionService.redactPatchForViewer({
          patch,
          protections,
          isWindowRedacted: trace.redacted_by_visibility_window === true,
        }),
      });
      if (next !== trace) {
        changed = true;
      }

      return next;
    });

    return changed ? corrected : traces;
  }

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
      traceCanonicalisation,
      traceRead,
      editOverlay,
      evaluationService,
      logRecordStorage,
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
          this.enrichAndCorrect({
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
   * Batch sibling of {@link enrichCodingAgentTrace} for the multi-trace read paths (evals, export, legacy thread reads). Enriches each coding-agent trace in the array with its own lazy, time-capped log read
   * (reads run in parallel, a bounded few at a time); every non-coding-agent trace short-circuits inside `enrichCodingAgentTrace` and pays nothing. The upfront origin check skips even the fan-out allocation on
   * the common all-non-coding-agent page, so a project that never uses a coding assistant never touches the log store. Best-effort per trace.
   */
  private async enrichCodingAgentTraces(projectId: string, traces: Trace[]): Promise<Trace[]> {
    const hasCodingAgentTrace = traces.some(
      (trace) => trace.metadata?.["langwatch.origin"] === CODING_AGENT_ORIGIN,
    );
    if (!hasCodingAgentTrace) {
      return traces;
    }

    // Bounded fan-out: each coding-agent trace's enrichment holds a capped but heavy log read (raw bodies run to
    // 60 KB a row) in memory, so an unbounded Promise.all over a big export/eval page multiplies that by the page
    // size. Five in flight keeps the multi-trace paths at a bounded memory ceiling; non-coding-agent traces
    // short-circuit inside `enrichCodingAgentTrace` and cost nothing.
    const enrichConcurrency = 5;
    const enriched: Trace[] = [...traces];
    for (let start = 0; start < traces.length; start += enrichConcurrency) {
      const chunk = traces.slice(start, start + enrichConcurrency);
      const results = await Promise.all(
        chunk.map((trace) => this.enrichCodingAgentTrace(projectId, trace)),
      );
      for (let offset = 0; offset < results.length; offset++) {
        enriched[start + offset] = results[offset]!;
      }
    }

    return enriched;
  }

  /**
   * Read-time Claude Code content enrichment for coding-agent-origin traces. The real `llm_request` spans carry tokens / `request_id` but no message content and no cost — both live in the trace's OTLP log records. When the trace is coding-agent origin we do one lazy, time-capped log
   * read and join capped `input` / `output` + the authoritative `cost` onto the spans so the legacy trace/span API (REST, export, legacy tRPC, evals) returns whole spans. Origin-gated so a non-Claude trace pays nothing; idempotent and a no-op when the trace has no Claude content
   * logs; best-effort (a log-read failure returns the un-enriched trace rather than failing the read).
   */
  private async enrichCodingAgentTrace(projectId: string, trace: Trace): Promise<Trace> {
    if (trace.metadata?.["langwatch.origin"] !== CODING_AGENT_ORIGIN) {
      return trace;
    }

    const spans = await ClaudeCodeLogEnrichmentService.enrichCodingAgentSpansFromLogs({
      logRecords: this.logRecordStorageService(),
      tenantId: projectId,
      traceId: trace.trace_id,
      spans: trace.spans,
      occurredAtMs: trace.timestamps.started_at,
      logger: this.logger,
      traceCanonicalisation: this.traceCanonicalisation,
    });

    return spans === trace.spans ? trace : { ...trace, spans };
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
        const enriched = await this.enrichCodingAgentTraces(projectId, traces);
        if (!opts?.withEditOverlay) {
          return enriched;
        }

        return this.applyEditOverlays(projectId, enriched, protections);
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

        return this.enrichCodingAgentTraces(projectId, traces);
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
        const enriched = await this.enrichCodingAgentTraces(input.projectId, flat);
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
        const enriched = await this.enrichCodingAgentTraces(projectId, traces);
        if (!opts?.withEditOverlay) {
          return enriched;
        }

        return this.applyEditOverlays(projectId, enriched, protections);
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
