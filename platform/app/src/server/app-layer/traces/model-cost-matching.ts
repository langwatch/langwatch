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
interface SpanCostUsage {
  cacheReadTokens: number;
  cacheCreationTokens: number;
  inputCharacters: number;
  audioSeconds: number;
}

// Prompt-cache token counts (OTEL semconv dotted form). These are emitted
// SEPARATELY from input_tokens — the gateway sends the non-cached input
// count, so cache buckets add on top rather than overlap. Read tokens bill
// ~0.1x the input rate, write tokens above it, so a cached follow-up must
// not be costed at the full input price.
// Audio usage: TTS spans carry the characters synthesized, STT spans the
// seconds transcribed. These are the billable units for audio models that
// report no token usage at all.
function spanCostUsageFromAttrs(attrs: NormalizedAttributes): SpanCostUsage {
  return {
    cacheReadTokens: Math.max(
      0,
      coerceToNumber(attrs[ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS]) ??
        0,
    ),
    cacheCreationTokens: Math.max(
      0,
      coerceToNumber(
        attrs[ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS],
      ) ?? 0,
    ),
    inputCharacters: Math.max(
      0,
      coerceToNumber(attrs[ATTR_KEYS.GEN_AI_USAGE_INPUT_CHARS]) ?? 0,
    ),
    audioSeconds: Math.max(
      0,
      coerceToNumber(attrs[ATTR_KEYS.GEN_AI_USAGE_AUDIO_SECONDS]) ?? 0,
    ),
  };
}

// Priority 1: Custom cost rates from enrichment. A custom cost may carry
// its own cache rates (customer override); when it does not, cache tokens
// fall back to the input rate (counted, just not discounted).
function customRateSpanCost({
  attrs,
  inputTokens,
  outputTokens,
  cacheReadTokens,
  cacheCreationTokens,
}: {
  attrs: NormalizedAttributes;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}): number | null {
  const numInputRate = coerceToNumber(
    attrs[ATTR_KEYS.LANGWATCH_MODEL_INPUT_COST_PER_TOKEN],
  );
  const numOutputRate = coerceToNumber(
    attrs[ATTR_KEYS.LANGWATCH_MODEL_OUTPUT_COST_PER_TOKEN],
  );
  if (numInputRate === null && numOutputRate === null) return null;

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
function explicitSpanCost(attrs: NormalizedAttributes): number | null {
  const numSpanCost = coerceToNumber(attrs[ATTR_KEYS.LANGWATCH_SPAN_COST]);
  return numSpanCost !== null && numSpanCost > 0 ? numSpanCost : null;
}

function resolveModelForCost({
  attrs,
  model,
}: {
  attrs: NormalizedAttributes;
  model?: string;
}): string | undefined {
  return (
    model ??
    (typeof attrs[ATTR_KEYS.GEN_AI_RESPONSE_MODEL] === "string"
      ? (attrs[ATTR_KEYS.GEN_AI_RESPONSE_MODEL] as string)
      : undefined) ??
    (typeof attrs[ATTR_KEYS.GEN_AI_REQUEST_MODEL] === "string"
      ? (attrs[ATTR_KEYS.GEN_AI_REQUEST_MODEL] as string)
      : undefined)
  );
}

// Priority 3: Static model registry with fallbacks
function registryModelCost({
  attrs,
  model,
  inputTokens,
  outputTokens,
  usage,
}: {
  attrs: NormalizedAttributes;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  usage: SpanCostUsage;
}): number | null {
  const resolvedModel = resolveModelForCost({ attrs, model });
  const {
    cacheReadTokens,
    cacheCreationTokens,
    inputCharacters,
    audioSeconds,
  } = usage;

  if (
    !resolvedModel ||
    !(
      inputTokens > 0 ||
      outputTokens > 0 ||
      cacheReadTokens > 0 ||
      cacheCreationTokens > 0 ||
      inputCharacters > 0 ||
      audioSeconds > 0
    )
  ) {
    return null;
  }

  const matched = matchModelCostWithFallbacks(
    resolvedModel,
    getStaticModelCosts(),
  );
  if (!matched) return null;

  const computed = estimateCost({
    llmModelCost: matched,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    inputCharacters,
    audioSeconds,
  });
  return computed !== undefined && computed > 0 ? computed : null;
}

// Priority 4: Guardrail cost
function guardrailSpanCost(attrs: NormalizedAttributes): number | null {
  if (attrs[ATTR_KEYS.SPAN_TYPE] !== "guardrail") return null;

  const rawOutput = attrs[ATTR_KEYS.LANGWATCH_OUTPUT];
  if (!rawOutput || typeof rawOutput !== "object" || Array.isArray(rawOutput)) {
    return null;
  }

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
  return null;
}

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
  const usage = spanCostUsageFromAttrs(attrs);

  const customRate = customRateSpanCost({
    attrs,
    inputTokens,
    outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
  });
  if (customRate !== null) return customRate;

  const explicit = explicitSpanCost(attrs);
  if (explicit !== null) return explicit;

  const registry = registryModelCost({
    attrs,
    model,
    inputTokens,
    outputTokens,
    usage,
  });
  if (registry !== null) return registry;

  const guardrail = guardrailSpanCost(attrs);
  if (guardrail !== null) return guardrail;

  return 0;
}
