import type { CliResultDigest, CliToolResult } from "@langwatch/cli-cards";
import {
  langyMessagePartSchema,
  type LangyMessagePart,
} from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/shared";
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
  return [...toolParts, { type: "text", text, role: "assistant" }];
}
