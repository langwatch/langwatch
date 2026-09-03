/**
 * What the cost-rule drawer's live preview answers, and the model ceilings
 * the model pickers read.
 *
 * Both lived in `platform/app`, so `LlmModelCostTrpcPorts` could only declare
 * `Promise<unknown>` and `unknown` for the two operations that publish them —
 * and `unknown` reaches the browser as `{}`. The drawer reads
 * `totalMatchedSpans`, `matchedModels`, `sampleSpans` and `unmatchedModels`
 * off the preview; every one of those reads was unchecked.
 */

/** The rule being typed, as the preview evaluates it. */
export interface CostRulePreviewInput {
  projectId: string;
  regex: string;
  model?: string;
  inputCostPerToken?: number;
  outputCostPerToken?: number;
  cacheReadCostPerToken?: number;
  cacheCreationCostPerToken?: number;
  cacheCreation1hCostPerToken?: number;
}

/** One span the rule would match, priced under the rates being edited. */
export interface CostRulePreviewSampleSpan {
  traceId: string;
  spanId: string;
  spanName: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  cacheCreation1hTokens: number | null;
  startTimeMs: number;
  /**
   * What this span would cost under the rates being edited, or null when no
   * rates were entered yet (or the span carries no token usage).
   */
  exampleCost: number | null;
}

/** The whole preview: what matched, what did not, and a sample of each. */
export interface CostRuleMatchingSpansPreview {
  windowDays: number;
  totalMatchedSpans: number;
  matchedModels: Array<{
    model: string;
    spanCount: number;
    lastSeenMs: number;
  }>;
  sampleSpans: CostRulePreviewSampleSpan[];
  unmatchedModels: Array<{ model: string; spanCount: number }>;
}

/** The registry's context-window and output ceilings for one model id. */
export interface ModelLimits {
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxTokens?: number;
}
