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
import { z } from "zod";

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
export const costRulePreviewSampleSpanSchema = z
  .object({
    traceId: z.string(),
    spanId: z.string(),
    spanName: z.string(),
    model: z.string(),
    inputTokens: z.number().nullable(),
    outputTokens: z.number().nullable(),
    cacheReadTokens: z.number().nullable(),
    cacheCreationTokens: z.number().nullable(),
    cacheCreation1hTokens: z.number().nullable(),
    startTimeMs: z.number(),
    /**
     * What this span would cost under the rates being edited, or null when no
     * rates were entered yet (or the span carries no token usage).
     */
    exampleCost: z.number().nullable(),
  })
  .strict();
export type CostRulePreviewSampleSpan = z.infer<typeof costRulePreviewSampleSpanSchema>;

/** The whole preview: what matched, what did not, and a sample of each. */
export const costRuleMatchingSpansPreviewSchema = z
  .object({
    windowDays: z.number(),
    totalMatchedSpans: z.number(),
    matchedModels: z
      .object({
        model: z.string(),
        spanCount: z.number(),
        lastSeenMs: z.number(),
      })
      .strict()
      .array(),
    sampleSpans: z.array(costRulePreviewSampleSpanSchema),
    unmatchedModels: z.object({ model: z.string(), spanCount: z.number() }).strict().array(),
  })
  .strict();
export type CostRuleMatchingSpansPreview = z.infer<typeof costRuleMatchingSpansPreviewSchema>;

/** The registry's context-window and output ceilings for one model id. */
export const modelLimitsSchema = z
  .object({
    maxInputTokens: z.number().optional(),
    maxOutputTokens: z.number().optional(),
    maxTokens: z.number().optional(),
  })
  .strict();
export type ModelLimits = z.infer<typeof modelLimitsSchema>;
