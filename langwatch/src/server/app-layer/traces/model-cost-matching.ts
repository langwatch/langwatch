import { ATTR_KEYS } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
import {
  estimateCost,
  matchModelCostWithFallbacks,
} from "~/server/background/workers/collector/cost";
import type { NormalizedAttributes } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import { getStaticModelCosts } from "~/server/modelProviders/llmModelCost";
import { coerceToNumber } from "~/utils/coerceToNumber";

/** Per-tier custom rates read off the `langwatch.model.*` enrichment attributes. */
export interface CustomTierRates {
  inputCostPerToken: number;
  outputCostPerToken: number;
  cacheReadCostPerToken: number;
  cacheCreationCostPerToken: number;
}

/**
 * Resolve the custom per-token rate override (`computeSpanCost` Priority 1) from
 * a rate accessor, or `null` when the span carries no custom rate.
 *
 * A custom override is often ONE-SIDED — a customer prices, say, only their
 * input rate and leaves output unset. Zeroing the unset tiers would silently
 * make those tokens free (under-billing on display AND in the block-cost split),
 * so an unset tier falls back per-tier: to the registry rate for the model when
 * one is known (`registryFallback`), else to the input rate for the cache tiers
 * (counted, not discounted), else 0. The registry fallback is computed lazily
 * and only when a tier is actually missing.
 *
 * Single source of the P1 cascade so the two consumers — `computeSpanCost`
 * (which multiplies these by usage to get the span cost) and the block-cost
 * allocator's per-tier pricing (which reconciles Σ per-category cost to that
 * same span cost) — cannot drift. BOTH must pass the SAME `registryFallback`, or
 * the display and the allocation would price the unset tiers differently and
 * break conservation. The accessor abstracts over the caller's attribute shape
 * (`NormalizedAttributes` map vs an OTLP span lookup).
 */
export function resolveCustomTierRates(
  getRate: (key: string) => number | null,
  registryFallback?: () => Partial<CustomTierRates> | null,
): CustomTierRates | null {
  const customInput = getRate(ATTR_KEYS.LANGWATCH_MODEL_INPUT_COST_PER_TOKEN);
  const customOutput = getRate(ATTR_KEYS.LANGWATCH_MODEL_OUTPUT_COST_PER_TOKEN);
  if (customInput === null && customOutput === null) return null;

  const customCacheRead = getRate(
    ATTR_KEYS.LANGWATCH_MODEL_CACHE_READ_COST_PER_TOKEN,
  );
  const customCacheCreation = getRate(
    ATTR_KEYS.LANGWATCH_MODEL_CACHE_CREATION_COST_PER_TOKEN,
  );

  // Compute the registry rates once, and only if some tier is actually unset.
  const needsFallback =
    customInput === null ||
    customOutput === null ||
    customCacheRead === null ||
    customCacheCreation === null;
  const fb = needsFallback ? (registryFallback?.() ?? null) : null;

  const inputRate = customInput ?? fb?.inputCostPerToken ?? 0;
  return {
    inputCostPerToken: inputRate,
    outputCostPerToken: customOutput ?? fb?.outputCostPerToken ?? 0,
    cacheReadCostPerToken:
      customCacheRead ?? fb?.cacheReadCostPerToken ?? inputRate,
    cacheCreationCostPerToken:
      customCacheCreation ?? fb?.cacheCreationCostPerToken ?? inputRate,
  };
}

/**
 * Registry-backed per-tier rates for a model (`computeSpanCost` Priority 3),
 * or `null` when the model is unknown. A missing cache rate falls back to the
 * input rate (counted, not discounted). Co-located with `computeSpanCost` so the
 * app-layer block classifier can source registry rates from here instead of
 * reaching into `background/workers/collector` directly (ADR-018 hygiene).
 */
export function resolveRegistryTierRates(
  model: string,
): CustomTierRates | null {
  const matched = matchModelCostWithFallbacks(model, getStaticModelCosts());
  if (!matched) return null;
  const inputRate = matched.inputCostPerToken ?? 0;
  return {
    inputCostPerToken: inputRate,
    outputCostPerToken: matched.outputCostPerToken ?? 0,
    cacheReadCostPerToken: matched.cacheReadCostPerToken ?? inputRate,
    cacheCreationCostPerToken: matched.cacheCreationCostPerToken ?? inputRate,
  };
}

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

  const resolvedModel =
    model ??
    (typeof attrs[ATTR_KEYS.GEN_AI_RESPONSE_MODEL] === "string"
      ? (attrs[ATTR_KEYS.GEN_AI_RESPONSE_MODEL] as string)
      : undefined) ??
    (typeof attrs[ATTR_KEYS.GEN_AI_REQUEST_MODEL] === "string"
      ? (attrs[ATTR_KEYS.GEN_AI_REQUEST_MODEL] as string)
      : undefined);

  // Priority 1: Custom cost rates from enrichment. A one-sided override fills
  // its unset tiers from the registry rate for this model (see
  // resolveCustomTierRates) rather than zeroing them — the SAME fallback the
  // block-cost allocator passes, so display and per-category cost stay conserved.
  const customRates = resolveCustomTierRates(
    (key) => coerceToNumber(attrs[key]),
    resolvedModel ? () => resolveRegistryTierRates(resolvedModel) : undefined,
  );
  if (customRates) {
    return (
      inputTokens * customRates.inputCostPerToken +
      outputTokens * customRates.outputCostPerToken +
      cacheReadTokens * customRates.cacheReadCostPerToken +
      cacheCreationTokens * customRates.cacheCreationCostPerToken
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
