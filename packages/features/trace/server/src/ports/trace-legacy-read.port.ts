import type {
  CustomersAndLabelsResult,
  DistinctFieldNamesResult,
  Evaluation,
  PromptStudioSpanResult,
  TopicCountsResult,
  Trace,
  TraceLegacyFilterInput,
  TraceLegacyListInput,
  TracesForProjectResult,
} from "@langwatch/trace-contract";

/**
 * The legacy trace read, as the tRPC transports over it use it.
 *
 * The implementation is still the application's `TraceService`: it composes
 * ClickHouse reads, blob resolution, coding-agent enrichment and the reviewer
 * correction overlay, and none of that has left `platform/app` yet. This
 * declares only the eleven methods the `traces.*` and `spans.*` surfaces call,
 * so those surfaces can be package-owned before their service is.
 *
 * `protections` is deliberately `unknown`. Every method takes the viewer's
 * read-time redactions and the transports never look inside them — they ask
 * the process for them and hand them straight back — so naming their shape
 * here would only pin a second copy of a type the process owns. The one
 * surface that DOES read a field off them (the correction overlay's
 * visibility window) declares just that field, where it reads it.
 */
export abstract class TraceLegacyReadPort {
  /** One trace with its spans, or undefined when the project holds no such trace. */
  abstract getById(
    projectId: string,
    traceId: string,
    protections: unknown,
    opts?: { full?: boolean; withEditOverlay?: boolean },
  ): Promise<Trace | undefined>;

  /** The project's list/search read, keyset-paged by `scrollId`. */
  abstract getAllTracesForProject(
    input: TraceLegacyListInput,
    protections: unknown,
    options?: {
      downloadMode?: boolean;
      includeSpans?: boolean;
      resolveBlobs?: boolean;
      scrollId?: string | null;
    },
  ): Promise<TracesForProjectResult>;

  /**
   * Named traces with their spans. `occurredAt` is the partition-pruning hint:
   * dropping it turns a bounded read into a scan of every partition, cold
   * storage included.
   */
  abstract getTracesWithSpans(
    projectId: string,
    traceIds: string[],
    protections: unknown,
    occurredAt?: { from: number; to: number },
    opts?: { full?: boolean; withEditOverlay?: boolean },
  ): Promise<Trace[]>;

  /** Every trace in one conversation. */
  abstract getTracesByThreadId(
    projectId: string,
    threadId: string,
    protections: unknown,
    opts?: { full?: boolean },
  ): Promise<Trace[]>;

  /** Every trace in each of several conversations. */
  abstract getTracesWithSpansByThreadIds(
    projectId: string,
    threadIds: string[],
    protections: unknown,
    opts?: { full?: boolean; withEditOverlay?: boolean },
  ): Promise<Trace[]>;

  /** The evaluator verdicts on a page of traces, keyed by trace id. */
  abstract getEvaluationsMultiple(
    projectId: string,
    traceIds: string[],
    protections: unknown,
  ): Promise<Record<string, Evaluation[]>>;

  /** One evaluation's inputs, resolved lazily when its card is expanded. */
  abstract getEvaluationInputs(input: {
    projectId: string;
    evaluationId: string;
  }): Promise<Record<string, unknown> | null>;

  /** Topic and subtopic counts for the filtered window. */
  abstract getTopicCounts(input: TraceLegacyFilterInput): Promise<TopicCountsResult>;

  /** The distinct customer ids and labels in the filtered window. */
  abstract getCustomersAndLabels(input: TraceLegacyFilterInput): Promise<CustomersAndLabelsResult>;

  /** Span names, metadata keys and evaluator names the project has produced. */
  abstract getDistinctFieldNames(
    projectId: string,
    startDate: number,
    endDate: number,
  ): Promise<DistinctFieldNamesResult>;

  /** One LLM span reshaped for the prompt studio, or null when it is not one. */
  abstract getSpanForPromptStudio(input: {
    projectId: string;
    spanId: string;
    protections: unknown;
  }): Promise<PromptStudioSpanResult | null>;
}
