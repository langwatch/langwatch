import type { CliResultDigest, CliToolResult } from "@langwatch/cli-cards";
import {
  LANGY_CARD_FAILED_PART_TYPE,
  LANGY_CARD_PART_TYPE,
  langyMessagePartSchema,
  salvageLangyCardBlock,
  splitLangyCardFences,
  type LangyMessagePart,
} from "@langwatch/langy";
import { getLangyBlocksCounter } from "~/server/metrics";
import { LangyCliEnvelopeService } from "./execution/langy-cli-envelope.service";

/**
 * A tool call the agent ran during a turn, in the compact form both the backend
 * relay (accumulated off the NDJSON stream) and the durable HTTP-final ingest
 * (posted by the agent) carry. `output` doubles as the error text when
 * `isError` — the wire keeps a single field. `digest` is optional and usually
 * absent on the wire: it is computed here, by the CLI envelope, when the call
 * was a `langwatch <resource> <verb>`.
 */
export interface LangyFinalToolCall {
  id: string;
  name: string;
  input?: unknown;
  output?: string;
  isError?: boolean;
  digest?: CliResultDigest;
  result?: CliToolResult;
}

/** The one envelope both finalize paths re-type their tool calls through. */
const cliEnvelope = LangyCliEnvelopeService.create();

/**
 * Assemble the durable assistant-message parts for a finalized turn: the tool
 * cards this turn ran are placed BEFORE the prose, so a refreshed client
 * replays the tool cards in order and then the text. The part shape matches the
 * AI-SDK tool part the live stream emits, so the SAME renderer draws them live
 * and on reload.
 *
 * Every tool call passes through the CLI envelope first: a `bash` that ran the
 * LangWatch CLI is recorded as the capability it was (`langwatch.trace.search`),
 * its output reduced to the JSON document, and a `digest` attached — the
 * compact reference (resource, verb, query, ids, counts) the card hydrates
 * FRESH data from with the viewer's session. The reduced output stays on the
 * part as the fallback for old renderers and unhydratable results; a call that
 * was not a CLI invocation passes through untouched, so non-CLI tools and old
 * turns render exactly as before (the digest is additive and optional).
 *
 * The prose itself passes through the block stamp (`assistantTextParts`):
 * every ```langy-card fence the model emitted is salvaged, validated and
 * recorded as a typed part in place, with the surrounding prose kept as text
 * parts on either side (ADR-060 §1).
 *
 * This is the single source of truth for final-part shape, shared by the
 * backend relay (`LangyTurnRelay`) and the durable HTTP-final ingest
 * (`langy-internal` → `ingestAgentTurnResult`). Whichever path finalizes a turn
 * first therefore produces identical parts, so the turnId-idempotent dedupe at
 * the event store collapses the two without any content divergence.
 */
export function buildFinalAssistantParts({
  text,
  toolCalls = [],
}: {
  text: string;
  toolCalls?: LangyFinalToolCall[];
}): LangyMessagePart[] {
  const toolParts: LangyMessagePart[] = toolCalls.map((rawCall) => {
    const call = cliEnvelope.normalizeToolFrame({
      frame: { ...rawCall, phase: "end" },
    });
    return langyMessagePartSchema.parse({
      type: `tool-${call.name}`,
      toolCallId: call.id,
      state: call.isError ? "output-error" : "output-available",
      ...(call.input !== undefined ? { input: call.input } : {}),
      ...(call.digest !== undefined ? { digest: call.digest } : {}),
      ...(call.result !== undefined ? { result: call.result } : {}),
      ...(call.isError
        ? { errorText: call.output ?? "Tool call failed" }
        : { output: call.output ?? "" }),
    });
  });
  return [...toolParts, ...assistantTextParts(text)];
}

/**
 * The assistant's prose, with every ```langy-card fence stamped into a typed
 * part IN PLACE (ADR-060 §1). This is the relay stamp — the one decision
 * point for the model's block channel: salvage leniently, validate strictly,
 * and record the verdict as a part every consumer inherits. The browser
 * never parses fences out of recorded text; time travel replays the same
 * stamped part.
 *
 * Only assistant-GENERATED text is ever scanned. Tool results are distinct
 * typed parts built above from the call itself — a fence inside tool output
 * stays raw text inside that part, not because a filter says so but because
 * this function never sees it.
 *
 * A failed block (unsalvageable or invalid) is recorded, never dropped: the
 * `langy-card-failed` part carries the raw fence for the disclosure, and the
 * failure is counted — the drift alarm for prompt regressions (§8). Its
 * blockId is deterministic by position, because BOTH finalize paths (relay
 * final frame, durable HTTP ingest) build parts through here and the
 * turn-terminal dedupe relies on the two producing identical parts.
 */
function assistantTextParts(text: string): LangyMessagePart[] {
  const segments = splitLangyCardFences(text);
  if (!segments.some((segment) => segment.type === "fence")) {
    // Fence-less turns record byte-for-byte what they always did, including
    // the empty text part of an empty answer.
    return [{ type: "text", text, role: "assistant" }];
  }

  const parts: LangyMessagePart[] = [];
  let ordinal = 0;
  for (const segment of segments) {
    if (segment.type === "text") {
      parts.push({ type: "text", text: segment.text, role: "assistant" });
      continue;
    }
    ordinal += 1;
    const parsed = salvageLangyCardBlock(segment.raw);
    if (parsed.ok) {
      getLangyBlocksCounter("stamped").inc();
      parts.push(
        langyMessagePartSchema.parse({
          type: LANGY_CARD_PART_TYPE,
          blockId: parsed.block.blockId,
          kind: parsed.block.kind,
          provenance: "derived",
          card: parsed.block,
          ...(parsed.block.hints !== undefined
            ? { hints: parsed.block.hints }
            : {}),
        }),
      );
      continue;
    }
    getLangyBlocksCounter(parsed.reason).inc();
    parts.push({
      type: LANGY_CARD_FAILED_PART_TYPE,
      blockId: `failed-block-${ordinal}`,
      raw: segment.raw,
    });
  }
  return parts;
}
