import { ATTR_KEYS } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
import type { NormalizedAttributes } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import { getStaticModelCosts } from "~/server/modelProviders/llmModelCost";
import {
  estimateCost,
  matchModelCostWithFallbacks,
} from "~/server/tracer/collector/cost";
import { coerceToNumber } from "~/utils/coerceToNumber";

/**
 * Computes per-span cost using a priority cascade:
 * 1. Custom cost rates from enrichment attributes (per-token override policy)
 * 2. Explicit / provider-reported total cost (langwatch.span.cost)
 * 3. Static model registry lookup (with provider subtype + date fallbacks)
 * 4. Guardrail cost extraction
 *
 * An explicit cost is an authoritative figure — the LangWatch SDK's
 * metrics.cost, or a provider's own billed number (e.g. Claude Code's
 * cost_usd) — so it wins over our token×registry ESTIMATE. The registry
 * is the fallback for when nobody told us the cost, not an override of a
 * known-good one. (Per-token enrichment rates still rank first: they are a
 * deliberate "price everything my way" policy, more specific than a single
 * span's total.)
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

  // Prompt-cache token counts (OTEL semconv dotted form). These are
  // emitted SEPARATELY from input_tokens — the gateway sends the
  // non-cached input count, so cache buckets add on top rather than
  // overlap. Read tokens bill ~0.1x the input rate, write tokens above
  // it, so a cached follow-up must not be costed at the full input price.
  const cacheReadTokens = Math.max(
    0,
    coerceToNumber(attrs[ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS]) ?? 0,
  );
  const cacheCreationTokens = Math.max(
    0,
    coerceToNumber(attrs[ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS]) ??
      0,
  );

  // Priority 1: Custom cost rates from enrichment. A custom cost may carry
  // its own cache rates (customer override); when it does not, cache tokens
  // fall back to the input rate (counted, just not discounted).
  const numInputRate = coerceToNumber(
    attrs[ATTR_KEYS.LANGWATCH_MODEL_INPUT_COST_PER_TOKEN],
  );
  const numOutputRate = coerceToNumber(
    attrs[ATTR_KEYS.LANGWATCH_MODEL_OUTPUT_COST_PER_TOKEN],
  );
  if (numInputRate !== null || numOutputRate !== null) {
    const inputRate = numInputRate ?? 0;
    const cacheReadRate =
      coerceToNumber(
        attrs[ATTR_KEYS.LANGWATCH_MODEL_CACHE_READ_COST_PER_TOKEN],
      ) ?? inputRate;
    const cacheCreationRate =
      coerceToNumber(
        attrs[ATTR_KEYS.LANGWATCH_MODEL_CACHE_CREATION_COST_PER_TOKEN],
      ) ?? inputRate;
    return (
      inputTokens * inputRate +
      outputTokens * (numOutputRate ?? 0) +
      cacheReadTokens * cacheReadRate +
      cacheCreationTokens * cacheCreationRate
    );
  }

  // Priority 2: Explicit / provider-reported total cost. An authoritative
  // figure (the SDK's metrics.cost or a provider's own billed number such as
  // Claude Code's cost_usd) is trusted over the token×registry estimate
  // below — when the cost is known exactly, don't re-derive an approximation
  // of it. A zero or absent value falls through to the registry, so this
  // never suppresses costing for spans that didn't report a cost.
  const numSpanCost = coerceToNumber(attrs[ATTR_KEYS.LANGWATCH_SPAN_COST]);
  if (numSpanCost !== null && numSpanCost > 0) return numSpanCost;

  // Priority 3: Static model registry with fallbacks
  const resolvedModel =
    model ??
    (typeof attrs[ATTR_KEYS.GEN_AI_RESPONSE_MODEL] === "string"
      ? (attrs[ATTR_KEYS.GEN_AI_RESPONSE_MODEL] as string)
      : undefined) ??
    (typeof attrs[ATTR_KEYS.GEN_AI_REQUEST_MODEL] === "string"
      ? (attrs[ATTR_KEYS.GEN_AI_REQUEST_MODEL] as string)
      : undefined);

  if (
    resolvedModel &&
    (inputTokens > 0 ||
      outputTokens > 0 ||
      cacheReadTokens > 0 ||
      cacheCreationTokens > 0)
  ) {
    const matched = matchModelCostWithFallbacks(
      resolvedModel,
      getStaticModelCosts(),
    );
    if (matched) {
      const computed = estimateCost({
        llmModelCost: matched,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
      });
      if (computed !== undefined && computed > 0) return computed;
    }
  }

  // Priority 4: Guardrail cost
  if (attrs[ATTR_KEYS.SPAN_TYPE] === "guardrail") {
    const rawOutput = attrs[ATTR_KEYS.LANGWATCH_OUTPUT];
    if (
      rawOutput &&
      typeof rawOutput === "object" &&
      !Array.isArray(rawOutput)
    ) {
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
