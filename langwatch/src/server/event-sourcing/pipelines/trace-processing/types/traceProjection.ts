import type { Projection } from "../../../library/core/types";

/**
 * Projection containing computed metrics for a trace.
 * This is built from all spans in a trace and contains aggregated data.
 */
export type TraceProjection = Projection<string, TraceProjectionData>;

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
