import type {
  NormalizedSpan,
  Protections,
  CustomersAndLabelsResult,
  DistinctFieldNamesResult,
  PromptStudioSpanResult,
  TopicCountsResult,
  Trace,
  TracesForProjectResult,
  AggregationFiltersInput,
  GetAllTracesForProjectInput,
  GetAllTracesForProjectOptions,
  TraceSummaryListOptions,
  TraceSummaryListQuery,
  TraceSummaryPage,
} from "@langwatch/trace-contract";

import type { ResolvedTraceSpans } from "../services/trace-offload-resolution.service.ts";

/**
 * Resolves offloaded blob refs for a single trace's normalized spans (ADR-021 decision B:
 * read-time recompute). When present, called after fetching spans but before mapping them to
 * legacy Span.
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
 * Partition-key bound for multi-trace reads: earliest and latest occurrence
 * time (epoch ms) in the requested set. A one-trace caller passes an exact
 * point range (from===to); the store widens it by its own safety margin.
 */
interface TraceOccurredAtRange {
  from: number;
  to: number;
}

/**
 * Every read the legacy trace surface makes against the stored trace summaries
 * and spans. The store behind it is chosen at the composition root, so the
 * service that orchestrates a read never names one.
 */
export abstract class TraceLegacyReadRepository {
  abstract listAllTracesForProject(
    input: GetAllTracesForProjectInput,
    protections: Protections,
    options?: GetAllTracesForProjectOptions,
  ): Promise<TracesForProjectResult>;

  abstract findTraceSummaries(
    query: TraceSummaryListQuery,
    options?: TraceSummaryListOptions,
  ): Promise<TraceSummaryPage>;

  abstract findCustomersAndLabels(
    input: AggregationFiltersInput,
  ): Promise<CustomersAndLabelsResult>;

  abstract findDistinctFieldNames(
    projectId: string,
    startDate: number,
    endDate: number,
  ): Promise<DistinctFieldNamesResult>;

  abstract findTopicCounts(input: AggregationFiltersInput): Promise<TopicCountsResult>;

  abstract findTracesByThreadId({
    projectId,
    threadId,
    protections,
    opts,
  }: {
    projectId: string;
    threadId: string;
    protections: Protections;
    opts?: { resolveBlobs?: boolean };
  }): Promise<Trace[]>;

  abstract findTracesWithSpans({
    projectId,
    traceIds,
    protections,
    occurredAt,
    opts,
  }: {
    projectId: string;
    traceIds: string[];
    protections: Protections;
    occurredAt?: TraceOccurredAtRange;
    opts?: { resolveBlobs?: boolean };
  }): Promise<Trace[]>;

  abstract findTracesWithSpansByThreadIds({
    projectId,
    threadIds,
    protections,
    opts,
  }: {
    projectId: string;
    threadIds: string[];
    protections: Protections;
    opts?: { resolveBlobs?: boolean };
  }): Promise<Trace[]>;

  abstract resolveTraceIdByPrefix(params: {
    projectId: string;
    prefix: string;
    occurredAt: TraceOccurredAtRange;
    limit?: number;
  }): Promise<string[]>;

  abstract findSpanForPromptStudio(params: {
    projectId: string;
    spanId: string;
    protections: Protections;
  }): Promise<PromptStudioSpanResult | null>;
}
