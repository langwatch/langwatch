import type { Authorization } from "@langwatch/authorization";
import { createLogger } from "@langwatch/observability";
import type {
  Protections,
  TraceCanonicalisationService,
  Evaluation,
  Trace,
  CustomersAndLabelsResult,
  DistinctFieldNamesResult,
  PromptStudioSpanResult,
  TopicCountsResult,
  TracesForProjectResult,
  AggregationFiltersInput,
  GetAllTracesForProjectInput,
  GetAllTracesForProjectOptions,
  TraceSummaryListOptions,
  TraceSummaryListQuery,
  TraceSummaryPage,
} from "@langwatch/trace-contract";
import { getLangWatchTracer } from "langwatch";

import type { TraceIOExtractionService } from "#features/derivation/services/trace-io-extraction.service";

import type { TraceEvaluationRunsReadRepository } from "../../../repositories/trace-evaluation-runs.repository.ts";
import { mapTraceEvaluationsToLegacyEvaluations } from "../../../rules/trace-evaluation-mapping.rules.ts";
import { type TraceLogRecordReader } from "../../claude-code/rules/claude-code-log-enrichment.rules.ts";
import type { TraceEditOverlayService } from "../../edit-overlay/services/trace-edit-overlay.service.ts";
import type { TraceBlobStoreService } from "../../media/services/trace-blob-store.service.ts";
import { TraceReadEnrichmentService } from "../../read/services/trace-read-enrichment.service.ts";
import type { TraceLegacyReadRepository } from "../repositories/trace-legacy-read.repository.ts";
import { normaliseTraceLookupId, type TraceByIdRead } from "../rules/trace-id-lookup.rules.ts";
import type { LegacyTraceMappingService } from "./legacy-trace-mapping.service.ts";
import { TraceAlternateIdService } from "./trace-alternate-id.service.ts";

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
export class TraceLegacyReadService {
  private readonly tracer = getLangWatchTracer("langwatch.traces.service");
  private readonly logger = createLogger("langwatch:traces:service");
  private readonly enrichment: TraceReadEnrichmentService;
  private readonly clickHouseService: TraceLegacyReadRepository;
  private readonly mapping: LegacyTraceMappingService;
  /** Every single-trace read resolves the evaluations behind it. */
  private readonly evaluationRuns: Pick<TraceEvaluationRunsReadRepository, "findTraceEvaluations">;

  private constructor(parts: {
    enrichment: TraceReadEnrichmentService;
    clickHouseService: TraceLegacyReadRepository;
    mapping: LegacyTraceMappingService;
    evaluationRuns: Pick<TraceEvaluationRunsReadRepository, "findTraceEvaluations">;
  }) {
    this.enrichment = parts.enrichment;
    this.clickHouseService = parts.clickHouseService;
    this.mapping = parts.mapping;
    this.evaluationRuns = parts.evaluationRuns;
  }

  static create({
    traceCanonicalisation,
    traceRead,
    mapping,
    editOverlay,
    logRecordStorage,
    evaluationRuns,
  }: {
    traceCanonicalisation: TraceCanonicalisationService;
    /** The composed trace store; the composition root picks the implementation. */
    traceRead: TraceLegacyReadRepository;
    /** The legacy read's rows as legacy traces: canonical IO, offloaded bodies, protections. */
    mapping: LegacyTraceMappingService;
    /** Reviewer corrections, applied only where a caller opts in. */
    editOverlay: TraceEditOverlayService;
    logRecordStorage?: TraceLogRecordReader;
    /** Evaluation's shared runs (R40); every single-trace read resolves its evaluations. */
    evaluationRuns: Pick<TraceEvaluationRunsReadRepository, "findTraceEvaluations">;
  }): TraceLegacyReadService {
    return new TraceLegacyReadService({
      enrichment: TraceReadEnrichmentService.create({
        traceCanonicalisation,
        editOverlay,
        logRecordStorage,
      }),
      clickHouseService: traceRead,
      mapping,
      evaluationRuns,
    });
  }

  /**
   * One trace by any id a caller may hold for it: the exact trace id (any case, padded), a
   * stored trace whose summary is not written yet, a unique prefix, a scenario run id or a
   * span id. Undefined only when none of those find it in this project.
   */
  async findById({
    authorization,
    projectId,
    traceId: requestedId,
    protections,
    opts,
  }: {
    authorization: Authorization;
    projectId: string;
    traceId: string;
    protections: Protections;
    opts?: { full?: boolean; withEditOverlay?: boolean };
  }): Promise<TraceByIdRead | undefined> {
    const traceId = normaliseTraceLookupId(requestedId);
    return this.tracer.withActiveSpan(
      "TraceService.findById",
      { attributes: { "tenant.id": projectId, "trace.id": traceId } },
      async (span) => {
        const finish = (trace: Trace) =>
          this.enrichment.enrichAndCorrect({
            projectId,
            trace,
            protections,
            withEditOverlay: opts?.withEditOverlay,
          });
        const read = (ids: string[]) =>
          this.mapping.findTracesWithSpans({
            authorization,
            projectId,
            traceIds: ids,
            protections,
            opts: { resolveBlobs: opts?.full },
          });
        const [exact] = await read([traceId]);
        if (exact) return finish(exact);

        const [fromSpans] = await this.mapping.findTraceFromStoredSpans({
          authorization,
          projectId,
          traceId,
          protections,
          opts: { resolveBlobs: opts?.full },
        });
        if (fromSpans) {
          span.setAttribute("trace.read.still_ingesting", true);
          return { ...(await finish(fromSpans)), stillIngesting: true as const };
        }

        const [alternate] = await TraceAlternateIdService.create({
          store: this.clickHouseService,
          mapping: this.mapping,
        }).find({
          authorization,
          projectId,
          traceId,
          onAmbiguousPrefix: () => span.setAttribute("trace.id.prefix.ambiguous", true),
        });
        if (!alternate) return undefined;
        span.setAttribute(`trace.id.${alternate.resolvedFrom}.resolved`, alternate.traceId);
        const [trace] = await read([alternate.traceId]);
        if (!trace) return undefined;
        return {
          ...(await finish(trace)),
          lookup: { requestedId, resolvedFrom: alternate.resolvedFrom },
        };
      },
    );
  }

  /** @param occurredAt bounds the partition scan. */
  async getTracesWithSpans({
    authorization,
    projectId,
    traceIds,
    protections,
    occurredAt,
    opts,
  }: {
    authorization: Authorization;
    projectId: string;
    traceIds: string[];
    protections: Protections;
    occurredAt?: { from: number; to: number };
    opts?: { full?: boolean; withEditOverlay?: boolean };
  }): Promise<Trace[]> {
    return this.tracer.withActiveSpan(
      "TraceService.getTracesWithSpans",
      {
        attributes: { "tenant.id": projectId, "trace.count": traceIds.length },
      },
      async () => {
        const traces = await this.mapping.findTracesWithSpans({
          authorization,
          projectId,
          traceIds,
          protections,
          occurredAt,
          opts: { resolveBlobs: opts?.full },
        });
        const enriched = await this.enrichment.enrichCodingAgentTraces(projectId, traces);
        if (!opts?.withEditOverlay) {
          return enriched;
        }

        return this.enrichment.applyEditOverlays(projectId, enriched, protections);
      },
    );
  }

  async getTracesByThreadId({
    authorization,
    projectId,
    threadId,
    protections,
    opts,
  }: {
    authorization: Authorization;
    projectId: string;
    threadId: string;
    protections: Protections;
    opts?: { full?: boolean };
  }): Promise<Trace[]> {
    return this.tracer.withActiveSpan(
      "TraceService.getTracesByThreadId",
      { attributes: { "tenant.id": projectId, "thread.id": threadId } },
      async () => {
        const traces = await this.mapping.findTracesByThreadId({
          authorization,
          projectId,
          threadId,
          protections,
          opts: { resolveBlobs: opts?.full },
        });

        return this.enrichment.enrichCodingAgentTraces(projectId, traces);
      },
    );
  }

  // An arrow instance property, not a prototype method: tests hold a
  // TraceLegacyReadService mock (a plain object cast `as unknown as
  // TraceLegacyReadService`) and assert on `.getAllTracesForProject`
  // directly, which is unsafe against a method-shorthand member. No
  // subclass extends this class and no code enumerates its own keys.
  getAllTracesForProject = async (
    input: GetAllTracesForProjectInput,
    protections: Protections,
    /** `ownRead` is the own-only proof the span, evaluation and event reads go through. */
    options: GetAllTracesForProjectOptions & { ownRead: Authorization },
  ): Promise<TracesForProjectResult> => {
    return this.tracer.withActiveSpan(
      "TraceService.getAllTracesForProject",
      { attributes: { "tenant.id": input.projectId } },
      async () => {
        const result = await this.mapping.listAllTracesForProject(input, protections, options);
        if (!options.includeSpans) {
          return result;
        }

        // Enrichment runs over the flattened page so the helper's bounded fan-out caps concurrent
        // log reads for the whole page; a page with no coding-agent trace pays nothing.
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
  };

  /** The list read's keyset page as bare summaries: the store's read, no enrichment. */
  listTraceSummaries(
    query: TraceSummaryListQuery,
    options?: TraceSummaryListOptions,
  ): Promise<TraceSummaryPage> {
    return this.clickHouseService.findTraceSummaries(query, options);
  }

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
        const result = await this.evaluationRuns.findTraceEvaluations({
          tenantId: projectId,
          traceIds,
        });

        return mapTraceEvaluationsToLegacyEvaluations(result);
      },
    );
  }

  async getTracesWithSpansByThreadIds({
    authorization,
    projectId,
    threadIds,
    protections,
    opts,
  }: {
    authorization: Authorization;
    projectId: string;
    threadIds: string[];
    protections: Protections;
    opts?: { full?: boolean; withEditOverlay?: boolean; maxTraces?: number };
  }): Promise<Trace[]> {
    return this.tracer.withActiveSpan(
      "TraceService.getTracesWithSpansByThreadIds",
      {
        attributes: {
          "tenant.id": projectId,
          "thread.count": threadIds.length,
        },
      },
      async () => {
        const traces = await this.mapping.findTracesWithSpansByThreadIds({
          authorization,
          projectId,
          threadIds,
          protections,
          opts: {
            resolveBlobs: opts?.full,
            ...(opts?.maxTraces === undefined ? {} : { maxTraces: opts.maxTraces }),
          },
        });
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
        return this.clickHouseService.findTopicCounts(input);
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
        return this.clickHouseService.findCustomersAndLabels(input);
      },
    );
  }

  async getDistinctFieldNames(
    projectId: string,
    startDate: number,
    endDate: number,
  ): Promise<DistinctFieldNamesResult> {
    return this.tracer.withActiveSpan(
      "TraceService.getDistinctFieldNames",
      { attributes: { "tenant.id": projectId } },
      async () => {
        return this.clickHouseService.findDistinctFieldNames(projectId, startDate, endDate);
      },
    );
  }

  async findSpanForPromptStudio({
    projectId,
    spanId,
    protections,
  }: {
    projectId: string;
    spanId: string;
    protections: Protections;
  }): Promise<PromptStudioSpanResult | null> {
    return this.tracer.withActiveSpan(
      "TraceService.findSpanForPromptStudio",
      { attributes: { "tenant.id": projectId, "span.id": spanId } },
      async () => {
        return this.clickHouseService.findSpanForPromptStudio({
          projectId,
          spanId,
          protections,
        });
      },
    );
  }
}
