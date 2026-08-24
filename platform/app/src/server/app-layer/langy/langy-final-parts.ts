import type { CliResultDigest, CliToolResult } from "@langwatch/langy";
import {
  LANGY_CARD_FAILED_PART_TYPE,
  LANGY_CARD_PART_TYPE,
  type LangyMessagePart,
  langyMessagePartSchema,
  salvageLangyDerivedCard,
  splitLangyCardFences,
} from "@langwatch/langy";
import { getLangyBlocksCounter } from "~/server/metrics";
import { LangyCliEnvelopeService } from "./execution/langy-cli-envelope.service";
import type { LangyTurnSegment } from "./streaming/langyTurnOrder";

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
 * Assemble the durable assistant-message parts for a finalized turn.
 *
 * With an `order` — the turn's own account of what happened when
 * (`streaming/langyTurnOrder`) — the parts are the paragraphs and the calls
 * interleaved the way the reader watched them arrive, so a refreshed page reads
 * the same as the turn did. Without one, the calls are recorded first and the
 * reply after them, which is what this always did and what a turn whose live
 * account has lapsed can still say honestly.
 *
 * `text` stays authoritative for the REPLY the agent asked to keep, and the
 * order supplies the paragraphs written between the calls, which exist nowhere
 * else. What `text` holds depends on how the turn ended, so `orderedParts`
 * tells the two cases apart; nothing is written twice either way.
 *
 * The account is read by `ingestAgentTurnResult`, not by its callers, so both
 * finalize paths assemble the same parts and the shape never depends on which
 * of them landed first.
 *
 * The part shape matches the AI-SDK tool part the live stream emits, so the SAME
 * renderer draws them live and on reload.
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
  order,
}: {
  text: string;
  toolCalls?: LangyFinalToolCall[];
  /** What happened when, when the turn's live account was still on hand. */
  order?: readonly LangyTurnSegment[];
}): LangyMessagePart[] {
  const toolPartOf = (rawCall: LangyFinalToolCall): LangyMessagePart => {
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
  };

  if (!order?.length) {
    return [...toolCalls.map(toolPartOf), ...assistantTextParts(text)];
  }
  return orderedParts({ text, toolCalls, order, toolPartOf });
}

/**
 * The parts of a turn whose order is known: its paragraphs and its calls, as
 * they happened.
 *
 * The account names calls by id, so a call it never mentions — one the harness
 * reported only at the end, one that arrived after the buffer lapsed — is not
 * dropped. It keeps the place it always had, before the reply.
 *
 * What `text` holds depends on how the turn ended, and the two cases must be
 * told apart or the account's paragraphs are written a second time:
 *
 *   - The turn ended on a paragraph. That paragraph IS `text`, in its
 *     authoritative form, so the account's copy is replaced by it.
 *   - The turn ended on a call and said nothing after it. Then `text` is the
 *     whole narration the account already holds, in order, so appending it
 *     would repeat every paragraph. The account is recorded as it stands, and
 *     `text` is used only when the account carries no prose of its own.
 */
function orderedParts({
  text,
  toolCalls,
  order,
  toolPartOf,
}: {
  text: string;
  toolCalls: LangyFinalToolCall[];
  order: readonly LangyTurnSegment[];
  toolPartOf: (call: LangyFinalToolCall) => LangyMessagePart;
}): LangyMessagePart[] {
  const last = order.at(-1);
  const endedOnAParagraph = last?.kind === "text" && last.text.trim() !== "";
  const account = accountParts({
    order,
    toolCalls,
    toolPartOf,
    // The closing paragraph is appended once, below, from `text`.
    skipIndex: endedOnAParagraph ? order.length - 1 : -1,
  });

  const unrecorded = toolCalls.filter((call) => !account.recorded.has(call.id));
  const reply =
    endedOnAParagraph || !account.wroteProse ? assistantTextParts(text) : [];
  return [...account.parts, ...unrecorded.map(toolPartOf), ...reply];
}

/** The account walked in order: its parts, which calls it named, and whether
 * it carried prose of its own. */
function accountParts({
  order,
  toolCalls,
  toolPartOf,
  skipIndex,
}: {
  order: readonly LangyTurnSegment[];
  toolCalls: LangyFinalToolCall[];
  toolPartOf: (call: LangyFinalToolCall) => LangyMessagePart;
  skipIndex: number;
}): {
  parts: LangyMessagePart[];
  recorded: Set<string>;
  wroteProse: boolean;
} {
  const byId = new Map(toolCalls.map((call) => [call.id, call]));
  const parts: LangyMessagePart[] = [];
  const recorded = new Set<string>();
  let wroteProse = false;

  for (const [index, segment] of order.entries()) {
    if (segment.kind === "tool") {
      const call = byId.get(segment.id);
      if (!call) continue;
      recorded.add(call.id);
      parts.push(toolPartOf(call));
      continue;
    }
    if (index === skipIndex || segment.text.trim() === "") continue;
    wroteProse = true;
    parts.push(...assistantTextParts(segment.text));
  }

  return { parts, recorded, wroteProse };
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
    const parsed = salvageLangyDerivedCard(segment.raw);
    if (parsed.ok) {
      getLangyBlocksCounter("stamped").inc();
      parts.push(
        langyMessagePartSchema.parse({
          type: LANGY_CARD_PART_TYPE,
          blockId: parsed.card.blockId,
          kind: parsed.card.kind,
          provenance: "derived",
          card: parsed.card,
          ...(parsed.card.hints !== undefined
            ? { hints: parsed.card.hints }
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
