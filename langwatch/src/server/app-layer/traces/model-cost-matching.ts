import type { NormalizedAttributes } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import {
  estimateCost,
  matchingLLMModelCost,
} from "~/server/background/workers/collector/cost";
import { getStaticModelCosts } from "~/server/modelProviders/llmModelCost";
import type { MaybeStoredLLMModelCost } from "~/server/modelProviders/llmModelCost";
import { coerceToNumber } from "~/utils/coerceToNumber";

const DATE_SUFFIX_RE = /-\d{4}-\d{2}-\d{2}$/;

/**
 * Strips the provider subtype from a model string.
 * Example: "openai.responses/gpt-5-mini" → "openai/gpt-5-mini"
 */
export function stripProviderSubtype(model: string): string {
  const slashIdx = model.indexOf("/");
  if (slashIdx === -1) return model;
  const provider = model.slice(0, slashIdx);
  if (!provider.includes(".")) return model;
  return provider.split(".")[0] + model.slice(slashIdx);
}

/**
 * Strips a trailing date suffix (-YYYY-MM-DD) from a model string.
 * Example: "gpt-5-mini-2025-08-07" → "gpt-5-mini"
 */
export function stripDateSuffix(model: string): string {
  return model.replace(DATE_SUFFIX_RE, "");
}

/**
 * Tries to match a model against cost entries using cascading fallbacks:
 * 1. Exact model string (e.g. "openai.responses/gpt-5-mini-2025-08-07")
 * 2. Strip provider subtype (e.g. "openai/gpt-5-mini-2025-08-07")
 * 3. Strip date suffix (e.g. "openai.responses/gpt-5-mini")
 * 4. Strip both (e.g. "openai/gpt-5-mini")
 */
export function matchModelCostWithFallbacks(
  model: string,
  costs: MaybeStoredLLMModelCost[],
  matchFn: typeof matchingLLMModelCost = matchingLLMModelCost,
): MaybeStoredLLMModelCost | undefined {
  const strippedSubtype = stripProviderSubtype(model);
  const strippedDate = stripDateSuffix(model);
  const strippedBoth = stripProviderSubtype(strippedDate);

  const candidates = [model, strippedSubtype, strippedDate, strippedBoth];

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const match = matchFn(candidate, costs);
    if (match) return match;
  }

  return undefined;
}

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
  const numInputRate = coerceToNumber(attrs["langwatch.model.inputCostPerToken"]);
  const numOutputRate = coerceToNumber(attrs["langwatch.model.outputCostPerToken"]);
  if (numInputRate !== null || numOutputRate !== null) {
    return inputTokens * (numInputRate ?? 0) + outputTokens * (numOutputRate ?? 0);
  }

  // Priority 2: Static model registry with fallbacks
  const resolvedModel =
    model ??
    (typeof attrs["gen_ai.response.model"] === "string" ? attrs["gen_ai.response.model"] : undefined) ??
    (typeof attrs["gen_ai.request.model"] === "string" ? attrs["gen_ai.request.model"] : undefined);

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
  const numSpanCost = coerceToNumber(attrs["langwatch.span.cost"]);
  if (numSpanCost !== null && numSpanCost > 0) return numSpanCost;

  // Priority 4: Guardrail cost
  if (attrs["langwatch.span.type"] === "guardrail") {
    const rawOutput = attrs["langwatch.output"];
    if (rawOutput && typeof rawOutput === "object" && !Array.isArray(rawOutput)) {
      const costObj = (rawOutput as Record<string, unknown>).cost as
        | { amount?: number; currency?: string }
        | undefined;
      if (costObj?.currency === "USD" && typeof costObj.amount === "number") {
        return costObj.amount;
      }
    }
  }

  return 0;
}
