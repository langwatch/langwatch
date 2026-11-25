import { createHash } from "node:crypto";

import type { ModelCostEstimateInput } from "@langwatch/model-provider-contract";

/** A span-fed call's record id: 64 hex characters, the width the table's `RecordId` holds. */
export function spanModelCallRecordId({
  traceId,
  spanId,
}: {
  traceId: string;
  spanId: string;
}): string {
  return createHash("sha256").update(`span\0${traceId}\0${spanId}`).digest("hex");
}

/** The GenAI semconv keys a codex turn and a declared model call both carry, canonicalised. */
const GEN_AI_ATTR = {
  INPUT_TOKENS: "gen_ai.usage.input_tokens",
  OUTPUT_TOKENS: "gen_ai.usage.output_tokens",
  CACHE_READ_TOKENS: "gen_ai.usage.cache_read.input_tokens",
  CACHE_CREATION_TOKENS: "gen_ai.usage.cache_creation.input_tokens",
  REQUEST_MODEL: "gen_ai.request.model",
  RESPONSE_MODEL: "gen_ai.response.model",
} as const;

function count(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** A string attribute's text, empty when it is absent or not a string. */
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A model call's attributes plus the token counts and model the fold reads by these names. */
export type ModelCallFacts = Record<string, unknown> & {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  model: string | null;
};

/**
 * A model call's token facts off GenAI semconv keys, whose input the canonicaliser made disjoint,
 * in the names the session fold and the per-call fact table read.
 */
export function genAiModelCallFacts(attrs: Record<string, unknown>): ModelCallFacts {
  return {
    ...attrs,
    input_tokens: count(attrs[GEN_AI_ATTR.INPUT_TOKENS]),
    output_tokens: count(attrs[GEN_AI_ATTR.OUTPUT_TOKENS]),
    cache_read_tokens: count(attrs[GEN_AI_ATTR.CACHE_READ_TOKENS]),
    cache_creation_tokens: count(attrs[GEN_AI_ATTR.CACHE_CREATION_TOKENS]),
    model:
      text(attrs[GEN_AI_ATTR.REQUEST_MODEL]) || text(attrs[GEN_AI_ATTR.RESPONSE_MODEL]) || null,
  };
}

/** What the catalogue prices one model call from, so the fold and its per-call row agree. */
export function modelCallCostInput(facts: Record<string, unknown>): ModelCostEstimateInput {
  return {
    attrs: facts,
    model: text(facts.model) || undefined,
    promptTokens: count(facts.input_tokens),
    completionTokens: count(facts.output_tokens),
  };
}
