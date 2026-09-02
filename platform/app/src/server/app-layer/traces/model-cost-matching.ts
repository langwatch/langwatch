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
 * 2. Explicit total cost reported on the span (langwatch.span.cost)
 * 3. Static model registry lookup (with provider subtype + date fallbacks)
 * 4. Guardrail cost extraction
 *
 * An explicit cost is a figure the instrumented application worked out
 * itself and handed us through the SDK's metrics.cost, so it wins over our
 * token x registry ESTIMATE. The registry is the fallback for when nobody
 * told us the cost, not an override of a known-good one. (Per-token
 * enrichment rates still rank first: they are a deliberate "price
 * everything my way" policy, more specific than a single span's total.)
 *
 * Priorities 2 and 4 pass through a total someone else already worked out.
 * The two that price from rates, 1 and 3, both run the same `estimateCost`
 * arithmetic, so a new billable unit costs the same whether the rates came
 * from a customer override or the registry.
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
  // The portion of the writes above that bought an hour-long cache entry, which
  // bills higher than a short-lived one. Only emitters that know the split
  // report it; without it every write prices short-lived, as before.
  const cacheCreation1hTokens = Math.max(
    0,
    coerceToNumber(
      attrs[ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_1H_INPUT_TOKENS],
    ) ?? 0,
  );

  // Audio usage: TTS spans carry the characters synthesized, STT spans the
  // seconds transcribed. These are the billable units for audio models that
  // report no token usage at all.
  const inputCharacters = Math.max(
    0,
    coerceToNumber(attrs[ATTR_KEYS.GEN_AI_USAGE_INPUT_CHARS]) ?? 0,
  );
  const audioSeconds = Math.max(
    0,
    coerceToNumber(attrs[ATTR_KEYS.GEN_AI_USAGE_AUDIO_SECONDS]) ?? 0,
  );

  // Audio token counts, emitted SEPARATELY from input_tokens / output_tokens
  // the same way the cache buckets are. An audio token costs eight times a
  // text one on the realtime models, so pricing them off the flat totals is
  // what made a trace state a different cost from the budget it charged.
  const inputAudioTokens = Math.max(
    0,
    coerceToNumber(attrs[ATTR_KEYS.GEN_AI_USAGE_INPUT_AUDIO_TOKENS]) ?? 0,
  );
  const outputAudioTokens = Math.max(
    0,
    coerceToNumber(attrs[ATTR_KEYS.GEN_AI_USAGE_OUTPUT_AUDIO_TOKENS]) ?? 0,
  );

  // Image token counts, the same disjoint split as the audio buckets. A
  // generated 1024x1024 image is about 1600 output image tokens at $30 to
  // $40 per million, which is most of what an image call costs.
  const inputImageTokens = Math.max(
    0,
    coerceToNumber(attrs[ATTR_KEYS.GEN_AI_USAGE_INPUT_IMAGE_TOKENS]) ?? 0,
  );
  const outputImageTokens = Math.max(
    0,
    coerceToNumber(attrs[ATTR_KEYS.GEN_AI_USAGE_OUTPUT_IMAGE_TOKENS]) ?? 0,
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
    // Same arithmetic as every other priority, so a cache TTL split (or any
    // future billable unit) is priced identically whether the rates came from
    // a customer override or the registry.
    //
    // The `?? 0` is load-bearing, not defensive filler. This branch is gated on
    // a rate being PRESENT, while `estimateCost` gates on one being NON-ZERO,
    // so a deliberate all-zero override reaches it and comes back undefined.
    // Coercing that to 0 is what makes such an override price at zero and stop
    // here, instead of falling through to the registry it meant to replace.
    return (
      estimateCost({
        llmModelCost: {
          projectId: "",
          model: "",
          regex: "",
          inputCostPerToken: numInputRate ?? 0,
          outputCostPerToken: numOutputRate ?? 0,
          cacheReadCostPerToken:
            coerceToNumber(
              attrs[ATTR_KEYS.LANGWATCH_MODEL_CACHE_READ_COST_PER_TOKEN],
            ) ?? undefined,
          cacheCreationCostPerToken:
            coerceToNumber(
              attrs[ATTR_KEYS.LANGWATCH_MODEL_CACHE_CREATION_COST_PER_TOKEN],
            ) ?? undefined,
          cacheCreation1hCostPerToken:
            coerceToNumber(
              attrs[ATTR_KEYS.LANGWATCH_MODEL_CACHE_CREATION_1H_COST_PER_TOKEN],
            ) ?? undefined,
        },
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        cacheCreation1hTokens,
        // No audio rates on an enrichment override, so these price at the
        // override's text rate. Dropping them would charge nothing at all for
        // the audio half of the turn.
        inputAudioTokens,
        outputAudioTokens,
        // An enrichment override carries no image rates, so image tokens
        // price at zero here rather than at the override's text rate.
        inputImageTokens,
        outputImageTokens,
      }) ?? 0
    );
  }

  // Priority 2: Explicit total cost the application reported for itself,
  // through the SDK's metrics.cost. It is trusted over the token x registry
  // estimate below: when a caller states the cost, don't re-derive an
  // approximation of it. A zero or absent value falls through to the
  // registry, so this never suppresses costing for spans that didn't
  // report a cost.
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
      cacheCreationTokens > 0 ||
      cacheCreation1hTokens > 0 ||
      inputCharacters > 0 ||
      audioSeconds > 0 ||
      inputAudioTokens > 0 ||
      outputAudioTokens > 0 ||
      inputImageTokens > 0 ||
      outputImageTokens > 0)
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
        cacheCreation1hTokens,
        inputAudioTokens,
        outputAudioTokens,
        inputImageTokens,
        outputImageTokens,
        inputCharacters,
        audioSeconds,
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
