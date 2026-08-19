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
 * decoder shared with the server-side extraction walk. A new content shape is
 * taught there once.
 */

import type { ScenarioMessageSnapshotEvent } from "~/server/scenarios/scenario-event.types";
import { coerceContentToArray } from "~/server/stored-objects/coerce-content-to-array";
import { visitContentPart } from "~/shared/content-parts/visit-content-part";
import type { MediaPartData } from "~/shared/traces/mediaParts";
import type { ParsedLLMError } from "~/utils/formatLLMError";
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

function flattenContent(msg: FlattenableMessage): DisplayPart[] {
  const coerced = coerceContentToArray(msg.content);
  if (coerced) return flattenTypedParts(coerced, msg);

  if (!msg.content || msg.content === NO_CONTENT_SENTINEL) return [];

  const text =
    typeof msg.content === "string"
      ? msg.content
      : JSON.stringify(msg.content ?? {});

  return [
    {
      kind: "text",
      id: msg.id ?? crypto.randomUUID(),
      role: msg.role ?? "assistant",
      content: text,
      reasoning: readReasoning(msg),
      traceId: msg.trace_id,
    },
  ];
}

/**
 * Walks a typed content array (Anthropic blocks, AG-UI parts, OpenAI mixed
 * content) into parts, preserving source order.
 */
function flattenTypedParts(
  content: unknown[],
  msg: FlattenableMessage,
): DisplayPart[] {
  const parts: DisplayPart[] = [];
  const role = msg.role ?? "assistant";
  const traceId = msg.trace_id;

  content.forEach((item, i) => {
    // Tool blocks carry ids that the pairing pass needs and the visitor's
    // `toolCall` / `toolResult` branches do not surface, so those two shapes
    // are read here before delegating the rest.
    const block = item as Record<string, unknown> | null;
    if (block && typeof block === "object") {
      if (block.type === "tool_use" || block.type === "tool_call") {
        parts.push({
          kind: "tool",
          id: `${msg.id ?? ""}-tu${i}`,
          name: typeof block.name === "string" ? block.name : "unknown",
          arguments: block.input ?? block.arguments,
          toolCallId: typeof block.id === "string" ? block.id : undefined,
          traceId,
        });
        return;
      }
      if (block.type === "tool_result") {
        parts.push({
          kind: "tool",
          id: `${msg.id ?? ""}-tr${i}`,
          name: typeof block.name === "string" ? block.name : "Tool result",
          arguments: undefined,
          toolCallId:
            typeof block.tool_use_id === "string"
              ? block.tool_use_id
              : undefined,
          result: {
            content: block.content,
            isError: block.is_error === true,
          },
          traceId,
        });
        return;
      }
    }

    const part = visitContentPart<DisplayPart | undefined>(item, {
      text: (text) =>
        text
          ? {
              kind: "text" as const,
              id: `${msg.id}-c${i}`,
              role,
              content: text,
              traceId,
            }
          : undefined,
      media: (media) => ({
        kind: "media" as const,
        id: `${msg.id}-media${i}`,
        // Cast: MediaPartData's union splits on source.type, which the
        // upstream source guard has already validated.
        part: { type: media.type, source: media.source } as MediaPartData,
        role,
        traceId,
      }),
      binary: (binary) => ({
        kind: "media" as const,
        id: `${msg.id}-media${i}`,
        part: binary as MediaPartData,
        role,
        traceId,
      }),
      toolCall: (call) => ({
        kind: "tool" as const,
        id: `${msg.id}-tu${i}`,
        name: call.name,
        arguments: call.arguments,
        traceId,
      }),
      toolResult: (toolResult) => ({
        kind: "tool" as const,
        id: `${msg.id}-tr${i}`,
        name: "Tool result",
        arguments: undefined,
        result: { content: toolResult.result },
        traceId,
      }),
      imageUrl: (url) => ({
        kind: "image" as const,
        id: `${msg.id}-img${i}`,
        src: url,
        role,
        traceId,
      }),
      bareImage: (src) => ({
        kind: "image" as const,
        id: `${msg.id}-img${i}`,
        src,
        role,
        traceId,
      }),
      // OpenAI Realtime audio, in either state: inline base64 before
      // server-side extraction, or a /api/files/<id> reference after it.
      // Each branch builds its whole part: MediaPartData splits its union on
      // `source.type`, so a shared object literal over a union of sources
      // matches neither arm.
      inputAudio: (audio) => {
        const mimeType =
          audio.mimeType ??
          (audio.format === "mp3" ? "audio/mpeg" : "audio/wav");
        const id = `${msg.id}-audio${i}`;
        if (audio.url) {
          return {
            kind: "media" as const,
            id,
            part: {
              type: "audio",
              source: { type: "url", value: audio.url, mimeType },
            },
            role,
            traceId,
          };
        }
        if (audio.data) {
          return {
            kind: "media" as const,
            id,
            part: {
              type: "audio",
              source: { type: "data", value: audio.data, mimeType },
            },
            role,
            traceId,
          };
        }
        return undefined;
      },
    });

    if (part) parts.push(part);
  });

  return collapseAudioTranscript(parts);
}

/**
 * Folds a lone audio part and its sibling text into one part.
 *
 * The OpenAI Realtime API puts spoken audio and its transcript in the same
 * content array as siblings. Rendering them as two units reads as the model
 * having said everything twice.
 */
function collapseAudioTranscript(parts: DisplayPart[]): DisplayPart[] {
  const media = parts.filter((part) => part.kind === "media");
  const texts = parts.filter((part) => part.kind === "text");
  if (media.length !== 1 || texts.length === 0) return parts;

  const only = media[0];
  if (only?.kind !== "media") return parts;

  only.transcript = texts
    .map((part) => (part.kind === "text" ? part.content : ""))
    .filter(Boolean)
    .join(" ");

  return parts.filter((part) => part.kind !== "text");
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

  const paired: DisplayPart[] = [];
  for (const part of parts) {
    if (
      part.kind === "tool" &&
      part.result !== undefined &&
      part.toolCallId &&
      callsById.has(part.toolCallId)
    ) {
      const call = callsById.get(part.toolCallId)!;
      call.result = part.result;
      continue;
    }
    paired.push(part);
  }

  return paired;
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
  const parts: DisplayPart[] = [];

  for (const msg of messages) {
    const failure = msg.id ? errors?.[msg.id] : undefined;
    if (failure) {
      parts.push({
        kind: "error",
        id: msg.id!,
        error: failure,
        traceId: msg.trace_id,
      });
      continue;
    }

    if (msg.role === "user" || msg.role === "assistant") {
      for (const call of readToolCalls(msg)) {
        parts.push({
          kind: "tool",
          id: `${msg.id ?? ""}-tool-${call.function?.name ?? "unknown"}`,
          name: call.function?.name ?? "unknown",
          arguments: safeJsonParseOrStringFallback(
            call.function?.arguments ?? "{}",
          ),
          toolCallId: call.id,
          traceId: msg.trace_id,
        });
      }
      parts.push(...flattenContent(msg));
      continue;
    }

    if (msg.role === "tool") {
      const raw = msg as Record<string, unknown>;
      parts.push({
        kind: "tool",
        id: msg.id ?? crypto.randomUUID(),
        name: typeof raw.name === "string" ? raw.name : "Tool result",
        arguments: undefined,
        toolCallId:
          typeof raw.tool_call_id === "string" ? raw.tool_call_id : undefined,
        result: {
          content: safeJsonParseOrStringFallback(
            typeof msg.content === "string"
              ? msg.content
              : JSON.stringify(msg.content ?? {}),
          ),
        },
        traceId: msg.trace_id,
      });
    }
  }

  const paired = pairToolResults(parts);

  if (streaming?.length) {
    const stored = new Set(messages.map((msg) => msg.id).filter(Boolean));
    for (const message of streaming) {
      if (stored.has(message.messageId)) continue;
      paired.push({
        kind: "text",
        id: message.messageId,
        role: message.role,
        content: message.content || "…",
      });
    }
  }

  return paired;
}

/**
 * Groups consecutive parts that share a trace into numbered turns.
 */
export function groupIntoTurns(parts: DisplayPart[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let turnNumber = 0;

  for (const part of parts) {
    const last = turns[turns.length - 1];
    if (last && (last.traceId ?? "") === (part.traceId ?? "")) {
      last.parts.push(part);
      continue;
    }
    turns.push({
      key: part.id,
      traceId: part.traceId,
      turnNumber: part.traceId ? ++turnNumber : undefined,
      parts: [part],
    });
  }

  return turns;
}
