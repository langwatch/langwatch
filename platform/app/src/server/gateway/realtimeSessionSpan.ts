/**
 * The settlement span for a brokered voice session.
 *
 * A brokered call runs client to vendor, so the only span the gateway can emit
 * for it is the mint, and the mint happens before the call has cost anything.
 * Without this the trace surface shows the session at $0 while the spend
 * record shows what it really cost, and the customer reading the Usage page
 * sees nothing for a call we billed them for.
 *
 * This writes the settlement back into the mint's own trace, so one session is
 * one trace: the mint span says a call opened, this one says what it used.
 *
 * The cost here is the same figure `closeAndConfirmRealtimeSession` sends to
 * the spend pipeline, rated once from the same quantities, so the two surfaces
 * cannot drift by construction. Nothing sums the two: the Usage page reads
 * `trace_summaries`, budgets and the ledger read `gateway_spend`, and they are
 * meant to agree rather than add, exactly as they do for every other request.
 */

import { createLogger } from "@langwatch/observability";
import { createHash } from "crypto";
import type { GatewayRealtimeSession } from "~/generated/prisma/client";
import { getApp } from "~/server/app-layer/app";
import { ATTR_KEYS as ATTR } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
import type { SpendUsage } from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/commands";
import { DEFAULT_PII_REDACTION_LEVEL } from "~/server/event-sourcing/pipelines/trace-processing/schemas/commands";

const logger = createLogger("langwatch:gateway:realtime-session-span");

/** The span name a settled voice session appears under in the trace explorer. */
const SPAN_NAME = "realtime.session.settled";

/**
 * A span id derived from the session id rather than a random one.
 *
 * The settlement can be delivered more than once: a vendor may resend a
 * webhook, a client may retry its usage report, and a session that settled
 * cost-unknown is superseded when a late report confirms it. A stable id means
 * every one of those writes the same span rather than adding another, so a
 * replay cannot inflate the trace's cost.
 */
function settlementSpanId(sessionId: string): string {
  return createHash("sha256")
    .update(`realtime-settlement:${sessionId}`)
    .digest("hex")
    .slice(0, 16);
}

function attr(key: string, value: string | number) {
  return typeof value === "number"
    ? { key, value: { doubleValue: value } }
    : { key, value: { stringValue: value } };
}

/**
 * Records what a voice session used, in the trace the mint opened.
 *
 * Never throws. The money is already recorded on the spend record by the time
 * this runs, so a failure here costs a customer-visible number, not a charge,
 * and raising would roll back a settlement that has already been accepted.
 */
export async function recordRealtimeSessionSpan(params: {
  session: GatewayRealtimeSession;
  usage: SpendUsage;
  costNanoUsd: number;
  durationMs: number;
  occurredAt: Date;
}): Promise<void> {
  const { session } = params;
  // No trace means the mint predates the trace id being carried, or the
  // request arrived with no trace context. Inventing a trace here would put a
  // cost in the explorer under an id nothing else references.
  if (!session.traceId) return;

  const endMs = params.occurredAt.getTime();
  const startMs = Math.max(0, endMs - Math.max(0, params.durationMs));
  // The canonical attribute names, the same ones the gateway's mint span
  // writes. The trace fold reads cost from `langwatch.span.cost` and tokens
  // from the `gen_ai.usage.*` keys; a name of our own would store fine and
  // then be ignored, leaving the span visible at no cost, which is the
  // failure this whole change exists to remove.
  const attributes = [
    attr(ATTR.SPAN_TYPE, "llm"),
    // The model the mint's span recorded, so one call is one model on the
    // trace surface. Falling back to the billing id keeps a session minted
    // before this was carried from losing its model entirely.
    attr(ATTR.GEN_AI_REQUEST_MODEL, session.requestedModel || session.model),
    attr(ATTR.GEN_AI_PROVIDER_NAME, session.vendor),
    // Priority 2 in the cost cascade: a cost the emitter worked out itself
    // wins over the registry estimate. This is the figure the spend record
    // carries, so the two surfaces state one number.
    attr(ATTR.LANGWATCH_SPAN_COST, params.costNanoUsd / 1_000_000_000),
    attr(ATTR.GEN_AI_USAGE_INPUT_TOKENS, params.usage.input_tokens ?? 0),
    attr(ATTR.GEN_AI_USAGE_OUTPUT_TOKENS, params.usage.output_tokens ?? 0),
    attr(
      ATTR.GEN_AI_USAGE_INPUT_AUDIO_TOKENS,
      params.usage.input_audio_tokens ?? 0,
    ),
    attr(
      ATTR.GEN_AI_USAGE_OUTPUT_AUDIO_TOKENS,
      params.usage.output_audio_tokens ?? 0,
    ),
    attr(ATTR.GEN_AI_USAGE_AUDIO_SECONDS, (params.usage.audio_ms ?? 0) / 1000),
    attr("langwatch.virtual_key_id", session.virtualKeyId),
    attr("langwatch.gateway_request_id", session.id),
  ];

  try {
    // ingestNormalizedSpan, not the raw command: it is the seam the OTLP and
    // REST collectors both route through, and its (tenant, trace, span) dedup
    // gate is what makes a resent webhook or a retried usage report write this
    // span once rather than adding another cost to the trace.
    const collection = getApp().traces?.collection;
    if (!collection) return;
    await collection.ingestNormalizedSpan({
      tenantId: session.projectId,
      span: {
        traceId: session.traceId,
        spanId: settlementSpanId(session.id),
        name: SPAN_NAME,
        kind: 3,
        startTimeUnixNano: String(startMs * 1_000_000),
        endTimeUnixNano: String(endMs * 1_000_000),
        attributes,
        events: [],
        links: [],
        status: { message: null, code: null },
        droppedAttributesCount: 0,
        droppedEventsCount: 0,
        droppedLinksCount: 0,
      },
      resource: null,
      instrumentationScope: null,
      piiRedactionLevel: DEFAULT_PII_REDACTION_LEVEL,
    });
  } catch (error) {
    logger.warn(
      { error, sessionId: session.id },
      "a voice session settled but its cost was not written to the trace; the spend record is unaffected",
    );
  }
}
