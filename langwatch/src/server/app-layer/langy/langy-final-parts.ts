import type { LangyMessagePart } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/shared";

/**
 * A tool call the agent ran during a turn, in the compact form both the backend
 * relay (accumulated off the NDJSON stream) and the durable HTTP-final ingest
 * (posted by the agent) carry. `output` doubles as the error text when
 * `isError` — the wire keeps a single field.
 */
export interface LangyFinalToolCall {
  id: string;
  name: string;
  input?: unknown;
  output?: string;
  isError?: boolean;
}

/**
 * Assemble the durable assistant-message parts for a finalized turn: the tool
 * cards this turn ran are placed BEFORE the prose, so a refreshed client
 * replays the tool cards in order and then the text. The part shape matches the
 * AI-SDK tool part the live stream emits, so the SAME renderer draws them live
 * and on reload.
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
  const toolParts: LangyMessagePart[] = toolCalls.map((call) => ({
    type: `tool-${call.name}`,
    toolCallId: call.id,
    state: call.isError ? "output-error" : "output-available",
    ...(call.input !== undefined ? { input: call.input } : {}),
    ...(call.isError
      ? { errorText: call.output ?? "Tool call failed" }
      : { output: call.output ?? "" }),
  }));
  return [...toolParts, { type: "text", text, role: "assistant" }];
}
