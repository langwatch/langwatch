import type {
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
} from "@langwatch/trace-contract";

/**
 * Partition-key bound for multi-trace reads: earliest and latest occurrence
 * time (epoch ms) in the requested set. A one-trace caller passes an exact
 * point range (from===to); the store widens it by its own safety margin.
 */
export interface TraceOccurredAtRange {
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
