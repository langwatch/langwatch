import { ATTR_KEYS } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
import type { NormalizedAttributes } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import {
  estimateCost,
  matchModelCostWithFallbacks,
} from "~/server/background/workers/collector/cost";
import { getStaticModelCosts } from "~/server/modelProviders/llmModelCost";
import { coerceToNumber } from "~/utils/coerceToNumber";

/**
 * Computes per-span cost using a priority cascade:
 * 1. Custom cost rates from enrichment attributes
 * 2. Static model registry lookup (with provider subtype + date fallbacks)
 * 3. SDK-provided cost fallback
 * 4. Guardrail cost extraction
 */
export function computeSpanCost({
  attrs,
  model,
  promptTokens,
  completionTokens,
}: {
  attrs: NormalizedAttributes;
  model?: string;
  promptTokens: number | null;
  completionTokens: number | null;
}): number {
  const inputTokens = promptTokens ?? 0;
  const outputTokens = completionTokens ?? 0;

  // Priority 1: Custom cost rates from enrichment
  const numInputRate = coerceToNumber(
    attrs[ATTR_KEYS.LANGWATCH_MODEL_INPUT_COST_PER_TOKEN],
  );
  const numOutputRate = coerceToNumber(
    attrs[ATTR_KEYS.LANGWATCH_MODEL_OUTPUT_COST_PER_TOKEN],
  );
  if (numInputRate !== null || numOutputRate !== null) {
    return inputTokens * (numInputRate ?? 0) + outputTokens * (numOutputRate ?? 0);
  }

  // Priority 2: Static model registry with fallbacks
  const resolvedModel =
    model ??
    (typeof attrs[ATTR_KEYS.GEN_AI_RESPONSE_MODEL] === "string"
      ? (attrs[ATTR_KEYS.GEN_AI_RESPONSE_MODEL] as string)
      : undefined) ??
    (typeof attrs[ATTR_KEYS.GEN_AI_REQUEST_MODEL] === "string"
      ? (attrs[ATTR_KEYS.GEN_AI_REQUEST_MODEL] as string)
      : undefined);

  if (resolvedModel && (inputTokens > 0 || outputTokens > 0)) {
    const matched = matchModelCostWithFallbacks(resolvedModel, getStaticModelCosts());
    if (matched) {
      const computed = estimateCost({
        llmModelCost: matched,
        inputTokens,
        outputTokens,
      });
      if (computed !== undefined && computed > 0) return computed;
    }
  }

  // Priority 3: SDK-provided cost
  const numSpanCost = coerceToNumber(attrs[ATTR_KEYS.LANGWATCH_SPAN_COST]);
  if (numSpanCost !== null && numSpanCost > 0) return numSpanCost;

  // Priority 4: Guardrail cost
  if (attrs[ATTR_KEYS.SPAN_TYPE] === "guardrail") {
    const rawOutput = attrs[ATTR_KEYS.LANGWATCH_OUTPUT];
    if (rawOutput && typeof rawOutput === "object" && !Array.isArray(rawOutput)) {
      const costObj = (rawOutput as Record<string, unknown>).cost as
        | { amount?: number; currency?: string }
        | undefined;
      if (
        costObj?.currency === "USD" &&
        typeof costObj.amount === "number" &&
        costObj.amount > 0
      ) {
        return costObj.amount;
      }
    }
  }

  return 0;
}
