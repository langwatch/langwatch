import type { Authorization } from "@langwatch/authorization";
import type { RetentionDaysProvider } from "@langwatch/clickhouse-client";
import type {
  Event,
  NormalizedSpan,
  ProjectedAnnotation,
  Protections,
  CustomersAndLabelsResult,
  DistinctFieldNamesResult,
  PromptStudioSpanResult,
  TopicCountsResult,
  TraceSummaryData,
  AggregationFiltersInput,
  GetAllTracesForProjectInput,
  GetAllTracesForProjectOptions,
  TraceSummaryListOptions,
  TraceSummaryListQuery,
  TraceSummaryPage,
} from "@langwatch/trace-contract";

import type { ClickHouseEvaluationRunRow } from "../../../rules/trace-evaluation-mapping.rules.ts";
import type { ResolvedTraceSpans } from "../../../services/trace-offload-resolution.service.ts";

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

/** One stored trace as the store holds it: its summary row and its spans, unmapped. */
export type TraceLegacyRow = { summary: TraceSummaryData; spans: NormalizedSpan[] };

/** One list page as the store holds it; the mapping service turns it into the page's traces. */
export type TraceLegacyPage = {
  summaries: TraceSummaryData[];
  totalHits: number;
  scrollId?: string | undefined;
  /** Updated axis only: the upper bound this scroll covered, in epoch ms. */
  updatedThrough?: number | undefined;
  /** The page's spans by trace id, read only where spans or full IO were asked for. */
  spans: Map<string, TraceLegacyRow>;
  evaluations: ClickHouseEvaluationRunRow[];
  events?: Map<string, Event[]> | undefined;
  annotations?: Map<string, ProjectedAnnotation[]> | undefined;
};

/** The tenant's retention policy, which widens the span read's floor past the platform default. */
type TraceLegacySpanFloor = { retentionDays: RetentionDaysProvider | undefined };

/**
 * Every read the legacy trace surface makes against the stored trace summaries
 * and spans. The store behind it is chosen at the composition root, so the
 * service that orchestrates a read never names one.
 */
export abstract class TraceLegacyReadRepository {
  abstract listAllTracesForProject(
    params: TraceLegacySpanFloor & {
      input: GetAllTracesForProjectInput;
      protections: Protections;
      options: GetAllTracesForProjectOptions;
      /** The own-only proof the span, evaluation and event reads go through. */
      ownRead: Authorization;
    },
  ): Promise<TraceLegacyPage>;

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

  abstract findTracesByThreadId(
    params: TraceLegacySpanFloor & {
      authorization: Authorization;
      projectId: string;
      threadId: string;
    },
  ): Promise<TraceLegacyRow[]>;

  abstract findTracesWithSpans(
    params: TraceLegacySpanFloor & {
      authorization: Authorization;
      projectId: string;
      traceIds: string[];
      occurredAt?: TraceOccurredAtRange | undefined;
    },
  ): Promise<TraceLegacyRow[]>;

  abstract findTracesWithSpansByThreadIds(
    params: TraceLegacySpanFloor & {
      authorization: Authorization;
      projectId: string;
      threadIds: string[];
      maxTraces?: number | undefined;
    },
  ): Promise<TraceLegacyRow[]>;

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
