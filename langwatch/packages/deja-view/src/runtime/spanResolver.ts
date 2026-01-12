import type { ProjectionTimelineTypes } from "../runner/projectionTimeline.types";

/**
 * SpanData extracted from span projection.
 * Mirrors the SpanProjectionData structure from spanProjection.ts.
 */
export interface SpanProjectionData {
  spanData: {
    id: string;
    aggregateId: string;
    tenantId: string;
    traceId: string;
    spanId: string;
    parentSpanId: string | null;
    name: string;
    kind: number;
    startTimeUnixMs: number;
    endTimeUnixMs: number;
    durationMs: number;
    attributes: Record<string, unknown>;
    events: unknown[];
    links: unknown[];
    status: { code: number; message: string | null };
    [key: string]: unknown;
  };
  collectedAtUnixMs: number;
}

/**
 * Checks if a projection is a span projection based on its name.
 *
 * @example
 * const isSpan = isSpanProjection(timeline.projection);
 */
function isSpanProjection(projection: { projectionName: string }): boolean {
  const name = projection.projectionName.toLowerCase();
  return name.includes("span") && !name.includes("trace");
}

/**
 * Extracts span data from projection snapshots at a given step.
 *
 * @example
 * const spans = extractSpansFromStep(step);
 */
function extractSpansFromStep(
  step: ProjectionTimelineTypes["Step"] | undefined,
): SpanProjectionData[] {
  if (!step) return [];

  const spans: SpanProjectionData[] = [];
  for (const snapshot of step.projectionStateByAggregate) {
    const data = snapshot.data as SpanProjectionData | undefined;
    if (data?.spanData?.spanId) {
      spans.push(data);
    }
  }
  return spans;
}

/**
 * Creates a span resolver from projection timelines.
 * Resolves span data by replaying the span projection over loaded events.
 *
 * @example
 * const resolver = createSpanResolverFromTimelines(timelines, eventIndex);
 * const span = resolver.getSpanById("span123");
 */
export function createSpanResolverFromTimelines(
  timelines: ProjectionTimelineTypes["Timeline"][],
  eventIndex: number,
): {
  getSpanById: (spanId: string) => SpanProjectionData | null;
  getSpanByAggregateId: (aggregateId: string) => SpanProjectionData | null;
  getAllSpans: () => SpanProjectionData[];
  hasSpanProjection: boolean;
} {
  // Find span projection timeline
  const spanTimeline = timelines.find((t) => isSpanProjection(t.projection));

  if (!spanTimeline) {
    return {
      getSpanById: () => null,
      getSpanByAggregateId: () => null,
      getAllSpans: () => [],
      hasSpanProjection: false,
    };
  }

  // Get the step at the current event index (or latest available)
  const step =
    spanTimeline.steps[eventIndex] ??
    spanTimeline.steps[spanTimeline.steps.length - 1];

  const spans = extractSpansFromStep(step);

  // Build lookup maps
  const bySpanId = new Map<string, SpanProjectionData>();
  const byAggregateId = new Map<string, SpanProjectionData>();

  for (const span of spans) {
    if (span.spanData.spanId) {
      bySpanId.set(span.spanData.spanId, span);
    }
    if (span.spanData.aggregateId) {
      byAggregateId.set(span.spanData.aggregateId, span);
    }
  }

  return {
    getSpanById: (spanId: string) => bySpanId.get(spanId) ?? null,
    getSpanByAggregateId: (aggregateId: string) =>
      byAggregateId.get(aggregateId) ?? null,
    getAllSpans: () => spans,
    hasSpanProjection: true,
  };
}

/**
 * Legacy stub span resolver for backwards compatibility.
 * Use createSpanResolverFromTimelines for projection-based resolution.
 *
 * @example
 * const span = await spanResolver.getSpan("tenant", "trace", "span");
 */
export const spanResolver = {
  async getSpan(): Promise<null> {
    return null;
  },
  async getSpansForTrace(): Promise<never[]> {
    return [];
  },
  isAvailable: false as const,
};
