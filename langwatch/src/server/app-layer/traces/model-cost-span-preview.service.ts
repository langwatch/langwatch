import {
  estimateCost,
  matchModelCostWithFallbacks,
} from "~/server/background/workers/collector/cost";
import {
  getLLMModelCosts,
  type MaybeStoredLLMModelCost,
} from "~/server/modelProviders/llmModelCost";
import { compileSafeRegex } from "~/utils/safeRegex";
import { ValidationError } from "../domain-error";
import type { SpanStorageService } from "./span-storage.service";

/**
 * How far back the preview looks for spans. Wide enough to catch models that
 * only run a few times a week, narrow enough to stay on warm partitions.
 */
export const PREVIEW_WINDOW_DAYS = 7;

/** Project-wide distinct-model inventory cap for one preview round. */
const MAX_DISTINCT_MODELS = 500;

/** Sample-span list shown under the regex field. */
const MAX_SAMPLE_SPANS = 10;
const PER_MODEL_SAMPLE_LIMIT = 3;

/** Non-matching models surfaced in the zero/partial-match hint. */
const MAX_UNMATCHED_MODELS = 8;

export interface CostRulePreviewInput {
  projectId: string;
  regex: string;
  model?: string;
  inputCostPerToken?: number;
  outputCostPerToken?: number;
  cacheReadCostPerToken?: number;
  cacheCreationCostPerToken?: number;
}

export interface CostRulePreviewSampleSpan {
  traceId: string;
  spanId: string;
  spanName: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  startTimeMs: number;
  /**
   * What this span would cost under the rates being edited, or null when no
   * rates were entered yet (or the span carries no token usage).
   */
  exampleCost: number | null;
}

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

/**
 * Previews which of the project's recently-seen models (and sample spans) a
 * model cost rule's regex would match.
 *
 * Matching deliberately runs through `matchModelCostWithFallbacks`, the
 * exact function the ingestion pipeline uses, so the preview can never
 * disagree with what the rule will actually do (vendor-prefix stripping,
 * Bedrock id normalization, lowercase fallback and all).
 */
export async function previewCostRuleMatchingSpans(
  spans: SpanStorageService,
  input: CostRulePreviewInput,
): Promise<CostRuleMatchingSpansPreview> {
  if (!compileSafeRegex(input.regex)) {
    throw new ValidationError("Invalid or unsafe regular expression");
  }

  const candidate: MaybeStoredLLMModelCost = {
    projectId: input.projectId,
    model: input.model ?? input.regex,
    regex: input.regex,
    inputCostPerToken: input.inputCostPerToken,
    outputCostPerToken: input.outputCostPerToken,
    cacheReadCostPerToken: input.cacheReadCostPerToken,
    cacheCreationCostPerToken: input.cacheCreationCostPerToken,
  };

  const fromMs = Date.now() - PREVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const stats = await spans.getModelUsageStats({
    tenantId: input.projectId,
    fromMs,
    limit: MAX_DISTINCT_MODELS,
  });

  const matchedModels: CostRuleMatchingSpansPreview["matchedModels"] = [];
  const unmatchedModels: CostRuleMatchingSpansPreview["unmatchedModels"] = [];
  for (const stat of stats) {
    if (matchModelCostWithFallbacks(stat.model, [candidate])) {
      matchedModels.push(stat);
    } else if (unmatchedModels.length < MAX_UNMATCHED_MODELS) {
      unmatchedModels.push({ model: stat.model, spanCount: stat.spanCount });
    }
  }

  let sampleSpans: CostRulePreviewSampleSpan[] = [];
  if (matchedModels.length > 0) {
    const rows = await spans.getRecentSpansByModels({
      tenantId: input.projectId,
      models: matchedModels.map((m) => m.model),
      fromMs,
      perModelLimit: PER_MODEL_SAMPLE_LIMIT,
      limit: MAX_SAMPLE_SPANS,
    });
    sampleSpans = rows.map((row) => ({
      ...row,
      exampleCost:
        estimateCost({
          llmModelCost: candidate,
          inputTokens: row.inputTokens ?? 0,
          outputTokens: row.outputTokens ?? 0,
          cacheReadTokens: row.cacheReadTokens ?? 0,
          cacheCreationTokens: row.cacheCreationTokens ?? 0,
        }) ?? null,
    }));
  }

  return {
    windowDays: PREVIEW_WINDOW_DAYS,
    totalMatchedSpans: matchedModels.reduce((sum, m) => sum + m.spanCount, 0),
    matchedModels,
    sampleSpans,
    unmatchedModels,
  };
}

/**
 * Decides whether a span's detail view should suggest creating a model cost
 * mapping: the span names a model and carries token usage, yet no cost was
 * computed for it AND no cost entry (custom rule or static registry) matches
 * the model. The last check keeps the suggestion from showing on spans that
 * pre-date a rule the user already created.
 */
export async function deriveUnmappedCostSuggestion({
  projectId,
  model,
  cost,
  promptTokens,
  completionTokens,
}: {
  projectId: string;
  model: string | null;
  cost: number | null | undefined;
  promptTokens: number | null | undefined;
  completionTokens: number | null | undefined;
}): Promise<{ model: string } | null> {
  if (!model) return null;
  if (cost != null) return null;
  const hasTokens = (promptTokens ?? 0) > 0 || (completionTokens ?? 0) > 0;
  if (!hasTokens) return null;

  const costs = await getLLMModelCosts({ projectId });
  if (matchModelCostWithFallbacks(model, costs)) return null;

  return { model };
}
