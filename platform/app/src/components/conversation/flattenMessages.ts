/**
 * flattenMessages — the one place raw chat messages become renderable parts.
 *
 * Three surfaces used to do this independently: the playground converted to
 * CopilotKit message classes, the simulations renderer walked content itself,
 * and the Traces V2 transcript had its own block parser. The first of those
 * silently dropped every tool call it built, which is what a third
 * implementation buys you.
 *
 * All the shape-sniffing is delegated to `visitContentPart`, the canonical
 * decoder shared with the server-side extraction walk (see `./contentParts`).
 * A new content shape is taught there once.
 */
import type { ScenarioMessageSnapshotEvent } from "~/server/scenarios/scenario-event.types";
import { coerceContentToArray } from "~/server/stored-objects/coerce-content-to-array";
import type { ParsedLLMError } from "~/utils/formatLLMError";
import {
  collapseAudioTranscript,
  decodeContentPart,
  type PartContext,
} from "./contentParts";
import { safeJsonParseOrStringFallback } from "./safeJsonParse";
import type { ConversationTurn, DisplayPart } from "./types";

/**
 * The message shape every caller already holds.
 *
 * `ScenarioMessageSnapshotEvent["messages"]` is a union of the AG-UI message
 * schema, langwatch's own `chatMessageSchema`, and the scenario audio shape —
 * intersected with optional `id` / `trace_id`. The playground persists
 * `chatMessageSchema` + `id`, so it is already a member and needs no
 * conversion step.
 */
export type FlattenableMessage =
  ScenarioMessageSnapshotEvent["messages"][number];

/** A reply still arriving, not yet part of the stored message list. */
export interface StreamingPart {
  messageId: string;
  role: string;
  content: string;
}

const NO_CONTENT_SENTINEL = "None";

/**
 * Reads the reasoning a message carried, under either vendor's field name.
 *
 * OpenAI's o-series puts chain-of-thought on `reasoning_content`; Anthropic
 * uses `thinking`. They mean the same thing to a reader, so they render the
 * same way.
 */
function readReasoning(msg: FlattenableMessage): string | undefined {
  const raw = msg as Record<string, unknown>;
  const reasoning = raw.reasoning_content ?? raw.thinking;
  return typeof reasoning === "string" && reasoning.trim()
    ? reasoning
    : undefined;
}

/**
 * Reads a message's tool calls, accepting both wire casings.
 *
 * `tool_calls` is OpenAI's and langwatch's own `chatMessageSchema`; `toolCalls`
 * is AG-UI's. Both reach this renderer, so both are read rather than one being
 * normalised at some earlier boundary that not every caller passes through.
 */
function readToolCalls(
  msg: FlattenableMessage,
): Array<{ id?: string; function?: { name?: string; arguments?: string } }> {
  const raw = msg as Record<string, unknown>;
  const calls = raw.tool_calls ?? raw.toolCalls;
  return Array.isArray(calls) ? calls : [];
}

/** Walks a typed content array into parts, preserving source order. */
function flattenTypedParts(
  content: unknown[],
  msg: FlattenableMessage,
  messageIndex: number,
): DisplayPart[] {
  const base: Omit<PartContext, "index"> = {
    // The message's position when it has no id of its own, for the same reason
    // the untyped branch below uses it: `""` made two id-less messages emit the
    // same part ids, and those ids are the React keys.
    id: msg.id ?? `message-${messageIndex}`,
    role: msg.role ?? "assistant",
    traceId: msg.trace_id,
  };

  const parts = content
    .map((item, index) => decodeContentPart(item, { ...base, index }))
    .filter((part): part is DisplayPart => part !== undefined);

  return collapseAudioTranscript(parts);
}

function flattenContent(
  msg: FlattenableMessage,
  messageIndex: number,
): DisplayPart[] {
  const coerced = coerceContentToArray(msg.content);
  if (coerced) return flattenTypedParts(coerced, msg, messageIndex);

  if (!msg.content || msg.content === NO_CONTENT_SENTINEL) return [];

  const text =
    typeof msg.content === "string"
      ? msg.content
      : JSON.stringify(msg.content ?? {});

  return [
    {
      kind: "text",
      // The message's position, not a fresh uuid. A uuid changed on every
      // render, so the React key changed with it and the bubble remounted —
      // losing selection and scroll — and `crypto.randomUUID` is not available
      // at all on an insecure origin.
      id: msg.id ?? `message-${messageIndex}`,
      role: msg.role ?? "assistant",
      content: text,
      reasoning: readReasoning(msg),
      traceId: msg.trace_id,
    },
  ];
}

/** A whole message that is one tool's answer (OpenAI's `role: "tool"`). */
function toolResultMessagePart(
  msg: FlattenableMessage,
  messageIndex: number,
): DisplayPart {
  const raw = msg as Record<string, unknown>;
  const body =
    typeof msg.content === "string"
      ? msg.content
      : JSON.stringify(msg.content ?? {});

  return {
    kind: "tool",
    id: msg.id ?? `message-${messageIndex}`,
    name: typeof raw.name === "string" ? raw.name : "Tool result",
    arguments: undefined,
    toolCallId:
      typeof raw.tool_call_id === "string" ? raw.tool_call_id : undefined,
    result: { content: safeJsonParseOrStringFallback(body) },
    traceId: msg.trace_id,
  };
}

/** The calls a message requested, in the order it requested them. */
function toolCallParts(
  msg: FlattenableMessage,
  messageIndex: number,
): DisplayPart[] {
  return readToolCalls(msg).map((call, index) => ({
    kind: "tool",
    // The index disambiguates, as it does in `contentParts`. Parallel calls to
    // one tool are ordinary — two `search` calls in a single message — and the
    // name alone gave them the same id. That id is the React key and the turn
    // key, so React could reuse the wrong node and a card show the other call's
    // arguments.
    id: `${msg.id ?? `message-${messageIndex}`}-tool-${index}-${call.function?.name ?? "unknown"}`,
    name: call.function?.name ?? "unknown",
    arguments: safeJsonParseOrStringFallback(call.function?.arguments ?? "{}"),
    toolCallId: call.id,
    traceId: msg.trace_id,
  }));
}

/** The parts a single message contributes, tool calls first. */
function partsForMessage(
  msg: FlattenableMessage,
  messageIndex: number,
): DisplayPart[] {
  if (msg.role === "user" || msg.role === "assistant") {
    return [
      ...toolCallParts(msg, messageIndex),
      ...flattenContent(msg, messageIndex),
    ];
  }
  if (msg.role === "tool") {
    return [toolResultMessagePart(msg, messageIndex)];
  }
  return [];
}

/**
 * Attaches each tool result to the call it answers, so the two render as one
 * card rather than as an orphaned request followed by an orphaned reply.
 *
 * A result whose call is not in the transcript keeps its own part — dropping
 * it would hide output the model actually received.
 */
function pairToolResults(parts: DisplayPart[]): DisplayPart[] {
  const callsById = new Map<string, DisplayPart & { kind: "tool" }>();
  for (const part of parts) {
    if (part.kind === "tool" && part.toolCallId && part.result === undefined) {
      callsById.set(part.toolCallId, part);
    }
  }

  return parts.filter((part) => {
    if (part.kind !== "tool" || part.result === undefined) return true;
    const call = part.toolCallId ? callsById.get(part.toolCallId) : undefined;
    if (!call) return true;
    call.result = part.result;
    return false;
  });
}

/** Replies still arriving that the stored message list has not caught up with. */
function streamingParts(
  messages: FlattenableMessage[],
  streaming: StreamingPart[],
): DisplayPart[] {
  const stored = new Set(messages.map((msg) => msg.id).filter(Boolean));
  return streaming
    .filter((message) => !stored.has(message.messageId))
    .map((message) => ({
      kind: "text",
      id: message.messageId,
      role: message.role,
      content: message.content || "…",
    }));
}

/**
 * Flattens a message list — plus anything still streaming — into display parts.
 */
export function flattenMessages({
  messages,
  streaming,
  errors,
}: {
  messages: FlattenableMessage[];
  streaming?: StreamingPart[];
  /**
   * Turns that failed, keyed by message id. A failure takes the place of the
   * reply that never came, so it lands at the point in the transcript where
   * the reader was waiting for one — not in a banner somewhere else.
   */
  errors?: Record<string, ParsedLLMError>;
}): DisplayPart[] {
  const parts = messages.flatMap<DisplayPart>((msg, messageIndex) => {
    const failure = msg.id ? errors?.[msg.id] : undefined;
    if (failure) {
      return [
        { kind: "error", id: msg.id!, error: failure, traceId: msg.trace_id },
      ];
    }
    return partsForMessage(msg, messageIndex);
  });

  return [
    ...pairToolResults(parts),
    ...(streaming?.length ? streamingParts(messages, streaming) : []),
  ];
}

/**
 * Groups consecutive parts that share a trace into numbered turns.
 *
 * A turn is an exchange, not a reply. Only the traced half carries the trace —
 * the playground writes a user message locally and the trace id arrives with
 * the answer — so grouping on the trace alone put the separator *between* the
 * question and its answer, splitting the exchange it was supposed to bound.
 * Untraced parts therefore lead into the traced turn that follows them.
 *
 * Untraced parts with no traced turn after them are the live case: a message
 * just sent, a reply still streaming. Whether that counts as a turn depends on
 * what the surface is showing. A live conversation numbers it — the exchange
 * starts when the reader sends, and waiting for the trace made the separator
 * appear a beat late, under content already on screen; the trace affordance is
 * what waits, not the number. A recorded transcript does not: an untraced
 * message there is one that was never traced, and numbering it would promise a
 * trace that is not coming.
 */
export function groupIntoTurns(
  parts: DisplayPart[],
  { live = false }: { live?: boolean } = {},
): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let turnNumber = 0;
  // Parts seen since the last traced turn closed, waiting to find out whether
  // a traced turn follows them or the conversation simply ends here.
  let leading: DisplayPart[] = [];

  const flushLeading = () => {
    if (leading.length === 0) return;
    turns.push({
      key: leading[0]!.id,
      turnNumber: live ? ++turnNumber : undefined,
      parts: leading,
    });
    leading = [];
  };

  for (const part of parts) {
    // An untraced part is always the start of something rather than the end of
    // it: either it leads the traced turn that answers it, or the conversation
    // ends here and it is live content.
    if (!part.traceId) {
      leading.push(part);
      continue;
    }

    const last = turns[turns.length - 1];
    if (leading.length === 0 && last?.traceId === part.traceId) {
      last.parts.push(part);
      continue;
    }

    turns.push({
      key: leading[0]?.id ?? part.id,
      traceId: part.traceId,
      turnNumber: ++turnNumber,
      parts: [...leading, part],
    });
    leading = [];
  }

  flushLeading();

  return turns;
}
