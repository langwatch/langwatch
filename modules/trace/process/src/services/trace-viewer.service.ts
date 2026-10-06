import {
  type Trace,
  TraceViewerService,
  type TraceViewerReadInput,
  type TraceLegacyListInput,
  type TracesForProjectResult,
  type TraceSummaryListQuery,
  type TraceSummaryListOptions,
  type TraceSummaryPage,
  type Evaluation,
  type TraceLegacyFilterInput,
  type TopicCountsResult,
  type CustomersAndLabelsResult,
  type DistinctFieldNamesResult,
  type PromptStudioSpanResult,
} from "@langwatch/trace-contract";

import type { TraceViewerProtectionService } from "./trace-viewer-protection.service.ts";

/** The legacy trace read, as tRPC transports use it. Declared here to let
 * surfaces be package-owned before the implementation. `protections` is
 * deliberately unknown; transports never inspect them. */
export interface TraceLegacyRead {
  /** One trace with its spans, or undefined when the project holds no such trace. */
  findById(params: {
    projectId: string;
    traceId: string;
    protections: unknown;
    opts?: { full?: boolean; withEditOverlay?: boolean };
  }): Promise<Trace | undefined>;

  /** The project's list/search read, keyset-paged by `scrollId`. */
  getAllTracesForProject(
    input: TraceLegacyListInput,
    protections: unknown,
    options?: {
      downloadMode?: boolean;
      includeSpans?: boolean;
      resolveBlobs?: boolean;
      scrollId?: string | null;
      /** The v1 REST search's compiled query-language filter, ANDed into the read. */
      filterWhere?: { sql: string; params: Record<string, unknown> };
    },
  ): Promise<TracesForProjectResult>;

  /** The list read's keyset page as bare summaries, for a system reader. */
  listTraceSummaries(
    query: TraceSummaryListQuery,
    options?: TraceSummaryListOptions,
  ): Promise<TraceSummaryPage>;

  /**
   * Named traces with their spans. `occurredAt` is the partition-pruning hint:
   * dropping it turns a bounded read into a scan of every partition, cold
   * storage included.
   */
  getTracesWithSpans(params: {
    projectId: string;
    traceIds: string[];
    protections: unknown;
    occurredAt?: { from: number; to: number };
    opts?: { full?: boolean; withEditOverlay?: boolean };
  }): Promise<Trace[]>;

  /** Every trace in one conversation. */
  getTracesByThreadId(params: {
    projectId: string;
    threadId: string;
    protections: unknown;
    opts?: { full?: boolean };
  }): Promise<Trace[]>;

  /** Every trace in each of several conversations. */
  getTracesWithSpansByThreadIds(params: {
    projectId: string;
    threadIds: string[];
    protections: unknown;
    opts?: { full?: boolean; withEditOverlay?: boolean; maxTraces?: number };
  }): Promise<Trace[]>;

  /** The evaluator verdicts on a page of traces, keyed by trace id. */
  getEvaluationsMultiple(
    projectId: string,
    traceIds: string[],
    protections: unknown,
  ): Promise<Record<string, Evaluation[]>>;

  /** One evaluation's inputs, resolved lazily when its card is expanded. */
  findEvaluationInputs(input: {
    projectId: string;
    evaluationId: string;
  }): Promise<Record<string, unknown> | null>;

  /** Topic and subtopic counts for the filtered window. */
  getTopicCounts(input: TraceLegacyFilterInput): Promise<TopicCountsResult>;

  /** The distinct customer ids and labels in the filtered window. */
  getCustomersAndLabels(input: TraceLegacyFilterInput): Promise<CustomersAndLabelsResult>;

  /** Span names, metadata keys and evaluator names the project has produced. */
  getDistinctFieldNames(
    projectId: string,
    startDate: number,
    endDate: number,
  ): Promise<DistinctFieldNamesResult>;

  /** One LLM span reshaped for the prompt studio, or null when it is not one. */
  findSpanForPromptStudio(input: {
    projectId: string;
    spanId: string;
    protections: unknown;
  }): Promise<PromptStudioSpanResult | null>;
}

type TraceViewerServiceOptions = Readonly<{
  read: TraceLegacyRead;
  protections: Pick<TraceViewerProtectionService, "resolve">;
}>;

/**
 * The complete named viewer read. It owns the viewer identity-to-protections
 * boundary and delegates hydration to the existing trace read pipeline, so
 * blobs, spans, coding-agent enrichment and ordering retain one implementation.
 */
export class TraceViewerReadService extends TraceViewerService {
  static create(options: TraceViewerServiceOptions): TraceViewerReadService {
    return new TraceViewerReadService(options);
  }

  private constructor(private readonly options: TraceViewerServiceOptions) {
    super();
  }

  async readForViewer(input: TraceViewerReadInput): Promise<Trace[]> {
    const protections = await this.options.protections.resolve({
      projectId: input.projectId,
      userId: input.userId,
      publiclyShared: false,
    });

    return this.options.read.getTracesWithSpans({
      projectId: input.projectId,
      traceIds: [...input.traceIds],
      protections,
      opts: { full: true },
    });
  }
}
