/** The span a settled voice session writes into its trace: a stable id and the cost attributes. */
import { createHash } from "node:crypto";

import type { GatewayRealtimeSessionRecord, SpendUsage } from "@langwatch/gateway-contract";
import { ATTR_KEYS as ATTR } from "@langwatch/trace-contract";

type SettlementSpanAttribute =
  | { key: string; value: { doubleValue: number } }
  | { key: string; value: { stringValue: string } };

/**
 * A span id derived from the session id rather than random. Settlement can be delivered more than
 * once — a resent webhook, a retried usage report, a cost-unknown settlement later confirmed — and
 * a stable id means each of those writes the same span, so a replay cannot inflate the cost.
 */
export function settlementSpanId(sessionId: string): string {
  return createHash("sha256").update(`realtime-settlement:${sessionId}`).digest("hex").slice(0, 16);
}

function attr(key: string, value: string | number): SettlementSpanAttribute {
  return typeof value === "number"
    ? { key, value: { doubleValue: value } }
    : { key, value: { stringValue: value } };
}

/** The span's attributes under the canonical names the trace fold reads. */
export function settlementSpanAttributes({
  session,
  usage,
  costNanoUsd,
}: {
  session: GatewayRealtimeSessionRecord;
  usage: SpendUsage;
  costNanoUsd: number;
}): SettlementSpanAttribute[] {
  // The canonical attribute names, the same ones the gateway's mint span
  // writes. The trace fold reads cost from `langwatch.span.cost` and tokens
  // from the `gen_ai.usage.*` keys; a name of our own would store fine and
  // then be ignored, leaving the span visible at no cost, which is the
  // failure this whole change exists to remove.
  return [
    attr(ATTR.SPAN_TYPE, "llm"),
    // The model the mint's span recorded, so one call is one model on the
    // trace surface. Falling back to the billing id keeps a session minted
    // before this was carried from losing its model entirely.
    attr(ATTR.GEN_AI_REQUEST_MODEL, session.requestedModel || session.model),
    attr(ATTR.GEN_AI_PROVIDER_NAME, session.vendor),
    // Priority 2 in the cost cascade: a cost the emitter worked out itself
    // wins over the registry estimate. This is the figure the spend record
    // carries, so the two surfaces state one number.
    attr(ATTR.LANGWATCH_SPAN_COST, costNanoUsd / 1_000_000_000),
    attr(ATTR.GEN_AI_USAGE_INPUT_TOKENS, usage.input_tokens ?? 0),
    attr(ATTR.GEN_AI_USAGE_OUTPUT_TOKENS, usage.output_tokens ?? 0),
    attr(ATTR.GEN_AI_USAGE_INPUT_AUDIO_TOKENS, usage.input_audio_tokens ?? 0),
    attr(ATTR.GEN_AI_USAGE_OUTPUT_AUDIO_TOKENS, usage.output_audio_tokens ?? 0),
    attr(ATTR.GEN_AI_USAGE_AUDIO_SECONDS, (usage.audio_ms ?? 0) / 1000),
    attr("langwatch.virtual_key_id", session.virtualKeyId),
    attr("langwatch.gateway_request_id", session.id),
  ];
}
