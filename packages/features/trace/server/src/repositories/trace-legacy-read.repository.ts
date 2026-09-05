import type { Protections } from "@langwatch/trace-contract";
import type {
  CustomersAndLabelsResult,
  DistinctFieldNamesResult,
  PromptStudioSpanResult,
  TopicCountsResult,
  Trace,
  TracesForProjectResult,
} from "@langwatch/trace-contract";

import type {
  AggregationFiltersInput,
  GetAllTracesForProjectInput,
  GetAllTracesForProjectOptions,
} from "@langwatch/trace-contract";

/**
 * Partition-key bound a multi-trace read prunes on: earliest and latest occurrence time (epoch ms) in the requested set. A one-trace caller passes an exact point range (from===to); the store widens it by its own safety margin.
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
  abstract getAllTracesForProject(
    input: GetAllTracesForProjectInput,
    protections: Protections,
    options?: GetAllTracesForProjectOptions,
  ): Promise<TracesForProjectResult>;

  abstract getCustomersAndLabels(input: AggregationFiltersInput): Promise<CustomersAndLabelsResult>;

  abstract getDistinctFieldNames(
    projectId: string,
    startDate: number,
    endDate: number,
  ): Promise<DistinctFieldNamesResult>;

  abstract getTopicCounts(input: AggregationFiltersInput): Promise<TopicCountsResult>;

  abstract getTracesByThreadId(
    projectId: string,
    threadId: string,
    protections: Protections,
    opts?: { resolveBlobs?: boolean },
  ): Promise<Trace[]>;

  abstract getTracesWithSpans(
    projectId: string,
    traceIds: string[],
    protections: Protections,
    occurredAt?: TraceOccurredAtRange,
    opts?: { resolveBlobs?: boolean },
  ): Promise<Trace[]>;

  abstract getTracesWithSpansByThreadIds(
    projectId: string,
    threadIds: string[],
    protections: Protections,
    opts?: { resolveBlobs?: boolean },
  ): Promise<Trace[]>;

  abstract resolveTraceIdByPrefix(params: {
    projectId: string;
    prefix: string;
    occurredAt: TraceOccurredAtRange;
    limit?: number;
  }): Promise<string[]>;

  abstract tryGetSpanForPromptStudio(params: {
    projectId: string;
    spanId: string;
    protections: Protections;
  }): Promise<PromptStudioSpanResult | null>;
}
