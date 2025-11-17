/**
 * Projection containing computed metrics for a trace.
 * This is built from all spans in a trace and contains aggregated data.
 */
export interface TraceProjection {
  /** Unique ID for this projection */
  id: string;
  /** The trace ID this projection represents */
  aggregateId: string;
  /** When this projection was last computed */
  version: number;
  /** Projection data */
  data: TraceProjectionData;
}

export interface TraceProjectionData {
  tenantId: string;
  traceId: string;

  // Computed metrics (stubs for now)
  computedInput?: string | null;
  computedOutput?: string | null;
  computedMetadata?: Record<string, string>;

  // Timing metrics
  timeToFirstTokenMs?: number | null;
  timeToLastTokenMs?: number | null;
  totalDurationMs: number;

  // Aggregate metrics
  tokensPerSecond?: number | null;
  spanCount: number;
  containsErrorStatus: boolean;
  containsOKStatus: boolean;

  // Event data
  models?: string | null;
  topicId?: string | null;
  subTopicId?: string | null;
  totalPromptTokenCount?: number | null;
  totalCompletionTokenCount?: number | null;
  hasAnnotation?: boolean | null;

  // Metadata
  createdAt: number;
  lastUpdatedAt: number;
}
