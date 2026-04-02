/**
 * Shared span metrics extraction used by BOTH traceSummary and analyticsTraceFacts
 * fold projections. This ensures consistency between the two projections.
 *
 * Both projections call `extractSpanMetrics()` to get the same intermediate result,
 * then map it into their respective state shapes.
 */

import { ATTR_KEYS } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
import type { NormalizedSpan } from "../../schemas/spans";
import { SpanCostService } from "./span-cost.service";
import { SpanStatusService } from "./span-status.service";
import { SpanTimingService } from "./span-timing.service";

// Singleton service instances — shared across both projections
const spanTimingService = new SpanTimingService();
const spanStatusService = new SpanStatusService();
const spanCostService = new SpanCostService();

export { spanTimingService, spanStatusService, spanCostService };

/**
 * Minimal state interface accepted by the timing accumulation.
 * Both TraceSummaryData and AnalyticsTraceFactData satisfy this.
 */
export interface TimingState {
  occurredAt: number;
  totalDurationMs: number;
}

/**
 * Intermediate result from span metric extraction.
 * State-shape independent — both projections consume this.
 */
export interface SpanMetricsResult {
  timing: { occurredAt: number; totalDurationMs: number };
  status: { hasError: boolean; hasOK: boolean; errorMessage: string | null };
  tokens: {
    promptTokens: number;
    completionTokens: number;
    cost: number;
    estimated: boolean;
  };
  tokenTiming: {
    timeToFirstToken: number | null;
    timeToLastToken: number | null;
  };
  models: string[];
}

/**
 * Extract all standard span metrics in one call.
 * Both traceSummary and analyticsTraceFacts projections call this
 * to ensure identical computation.
 */
export function extractSpanMetrics({
  timingState,
  span,
}: {
  timingState: TimingState;
  span: NormalizedSpan;
}): SpanMetricsResult {
  // SpanTimingService.accumulateTiming expects TraceSummaryData, but only
  // reads occurredAt and totalDurationMs. Cast through the minimal interface.
  const timing = spanTimingService.accumulateTiming({
    state: timingState as Parameters<
      typeof spanTimingService.accumulateTiming
    >[0]["state"],
    span,
  });

  const status = spanStatusService.extractStatus(span);
  const tokens = spanCostService.extractTokenMetrics(span);
  const tokenTiming = spanCostService.extractTokenTiming(span);
  const models = spanCostService.extractModelsFromSpan(span);

  return { timing, status, tokens, tokenTiming, models };
}

/**
 * Extract known identity attributes from a span.
 * Used by analyticsTraceFacts to populate top-level userId/threadId/customerId.
 * traceSummary stores these in an Attributes map instead.
 */
export function extractIdentityAttributes(span: NormalizedSpan): {
  userId: string;
  threadId: string;
  customerId: string;
} {
  const attrs = span.spanAttributes;
  const str = (key: string): string => {
    const v = attrs[key];
    return typeof v === "string" ? v : "";
  };

  return {
    userId:
      str(ATTR_KEYS.LANGWATCH_USER_ID) ||
      str(ATTR_KEYS.LANGWATCH_USER_ID_LEGACY) ||
      str(ATTR_KEYS.LANGWATCH_USER_ID_LEGACY_ROOT),
    threadId:
      str(ATTR_KEYS.GEN_AI_CONVERSATION_ID) ||
      str(ATTR_KEYS.LANGWATCH_THREAD_ID) ||
      str(ATTR_KEYS.LANGWATCH_THREAD_ID_LEGACY) ||
      str(ATTR_KEYS.LANGWATCH_THREAD_ID_LEGACY_ROOT),
    customerId:
      str(ATTR_KEYS.LANGWATCH_CUSTOMER_ID) ||
      str(ATTR_KEYS.LANGWATCH_CUSTOMER_ID_LEGACY) ||
      str(ATTR_KEYS.LANGWATCH_CUSTOMER_ID_LEGACY_ROOT),
  };
}
