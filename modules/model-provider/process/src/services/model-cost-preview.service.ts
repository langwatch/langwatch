import { ValidationError } from "@langwatch/handled-error";
/**
 * The cost-rule drawer's live preview, and the span detail's "you have no rate
 * for this model" hint.
 */
import {
  estimateCost,
  matchModelCost,
  type CostRuleMatchingSpansPreview,
  type CostRulePreviewInput,
  type CostRulePreviewSampleSpan,
  type ModelCostRate,
} from "@langwatch/model-provider-contract";
import { nowInstant } from "@langwatch/time";

import type { ModelCostRegexSafetyService } from "./model-cost-regex-safety.service.ts";

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

/**
 * The two span reads the preview issues, declared structurally.
 */
export type ModelCostPreviewSpanReader = Readonly<{
  getModelUsageStats(input: {
    tenantId: string;
    fromMs: number;
    limit: number;
  }): Promise<{ model: string; spanCount: number; lastSeenMs: number }[]>;
  getRecentSpansByModels(input: {
    tenantId: string;
    models: string[];
    fromMs: number;
    perModelLimit: number;
    limit: number;
  }): Promise<
    {
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
    }[]
  >;
}>;

/** The rule being typed, as one catalogue rate. */
function candidateRate(input: CostRulePreviewInput): ModelCostRate {
  return {
    model: input.model ?? input.regex,
    regex: input.regex,
    ...(input.inputCostPerToken !== undefined
      ? { inputCostPerToken: input.inputCostPerToken }
      : {}),
    ...(input.outputCostPerToken !== undefined
      ? { outputCostPerToken: input.outputCostPerToken }
      : {}),
    ...(input.cacheReadCostPerToken !== undefined
      ? { cacheReadCostPerToken: input.cacheReadCostPerToken }
      : {}),
    ...(input.cacheCreationCostPerToken !== undefined
      ? { cacheCreationCostPerToken: input.cacheCreationCostPerToken }
      : {}),
    ...(input.cacheCreation1hCostPerToken !== undefined
      ? { cacheCreation1hCostPerToken: input.cacheCreation1hCostPerToken }
      : {}),
  };
}

export class ModelCostPreviewService {
  static create({
    regexSafety,
  }: {
    regexSafety: ModelCostRegexSafetyService;
  }): ModelCostPreviewService {
    return new ModelCostPreviewService(regexSafety);
  }

  private constructor(private readonly regexSafety: ModelCostRegexSafetyService) {}

  /**
   * Previews which of the project's recently-seen models (and sample spans) a
   * cost rule's regex would match.
   */
  async previewCostRuleMatchingSpans({
    spans,
    input,
  }: {
    spans: ModelCostPreviewSpanReader;
    input: CostRulePreviewInput;
  }): Promise<CostRuleMatchingSpansPreview> {
    if (!this.regexSafety.isSafeRegex(input.regex)) {
      throw new ValidationError("Invalid or unsafe regular expression");
    }

    const candidate = candidateRate(input);
    const fromMs = nowInstant().epochMilliseconds - PREVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const stats = await spans.getModelUsageStats({
      tenantId: input.projectId,
      fromMs,
      limit: MAX_DISTINCT_MODELS,
    });

    const matchedModels: CostRuleMatchingSpansPreview["matchedModels"] = [];
    const unmatchedModels: CostRuleMatchingSpansPreview["unmatchedModels"] = [];
    for (const stat of stats) {
      if (matchModelCost(stat.model, [candidate])) {
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
      sampleSpans = rows.map((row) => {
        const hasTokenUsage =
          row.inputTokens !== null ||
          row.outputTokens !== null ||
          row.cacheReadTokens !== null ||
          row.cacheCreationTokens !== null;

        return {
          ...row,
          exampleCost: !hasTokenUsage
            ? null
            : (estimateCost({
                rate: candidate,
                inputTokens: row.inputTokens ?? 0,
                outputTokens: row.outputTokens ?? 0,
                cacheReadTokens: row.cacheReadTokens ?? 0,
                cacheCreationTokens: row.cacheCreationTokens ?? 0,
                cacheCreation1hTokens: row.cacheCreation1hTokens ?? 0,
                inputAudioTokens: 0,
                outputAudioTokens: 0,
              }) ?? null),
        };
      });
    }

    return {
      windowDays: PREVIEW_WINDOW_DAYS,
      totalMatchedSpans: matchedModels.reduce((sum, m) => sum + m.spanCount, 0),
      matchedModels,
      sampleSpans,
      unmatchedModels,
    };
  }
}
