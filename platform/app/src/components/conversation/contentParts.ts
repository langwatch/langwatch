/**
 * Decoding one message's `content` into display parts.
 *
 * Split from the message-level walk so each file answers one question: this
 * one is "what is inside a message", `flattenMessages` is "what is in the
 * conversation".
 */
import type { ContentPartVisitor } from "~/shared/content-parts/visit-content-part";
import { visitContentPart } from "~/shared/content-parts/visit-content-part";
import type { MediaPartData } from "~/shared/traces/mediaParts";
import type { DisplayPart } from "./types";

/** Identity a decoded part inherits from the message it came from. */
export interface PartContext {
  id: string;
  role: string;
  traceId?: string;
  index: number;
}

const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/**
 * Reads a `tool_use` / `tool_call` / `tool_result` content block.
 *
 * Read here rather than through `visitContentPart` because these carry the ids
 * the result-pairing pass needs, and the visitor's `toolCall` / `toolResult`
 * branches do not surface them.
 */
export function readToolBlock(
  item: unknown,
  { id, traceId, index }: PartContext,
): DisplayPart | undefined {
  if (!item || typeof item !== "object") return undefined;
  const block = item as Record<string, unknown>;

  if (block.type === "tool_use" || block.type === "tool_call") {
    return {
      kind: "tool",
      id: `${id}-tu${index}`,
      name: asString(block.name) ?? "unknown",
      arguments: block.input ?? block.arguments,
      toolCallId: asString(block.id),
      traceId,
    };
  }

  if (block.type === "tool_result") {
    return {
      kind: "tool",
      id: `${id}-tr${index}`,
      name: asString(block.name) ?? "Tool result",
      arguments: undefined,
      toolCallId: asString(block.tool_use_id),
      result: { content: block.content, isError: block.is_error === true },
      traceId,
    };
  }

  return undefined;
}

/**
 * OpenAI Realtime audio, in either state: inline base64 before server-side
 * extraction, or a `/api/files/<id>` reference after it.
 *
 * Each branch builds its whole part because `MediaPartData` splits its union
 * on `source.type` — a shared object literal over a union of sources matches
 * neither arm.
 */
function audioPart(
  audio: { data?: string; url?: string; format?: string; mimeType?: string },
  { id, role, traceId, index }: PartContext,
): DisplayPart | undefined {
  const mimeType =
    audio.mimeType ?? (audio.format === "mp3" ? "audio/mpeg" : "audio/wav");
  const partId = `${id}-audio${index}`;

  if (audio.url) {
    return {
      kind: "media",
      id: partId,
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
      kind: "media",
      id: partId,
      part: {
        type: "audio",
        source: { type: "data", value: audio.data, mimeType },
      },
      role,
      traceId,
    };
  }

  return undefined;
}

/** The visitor branches for everything `readToolBlock` did not claim. */
function partVisitor(
  context: PartContext,
): ContentPartVisitor<DisplayPart | undefined> {
  const { id, role, traceId, index } = context;

  return {
    text: (text) =>
      text
        ? { kind: "text", id: `${id}-c${index}`, role, content: text, traceId }
        : undefined,
    media: (media) => ({
      kind: "media",
      id: `${id}-media${index}`,
      // Cast: MediaPartData's union splits on source.type, which the upstream
      // source guard has already validated.
      part: { type: media.type, source: media.source } as MediaPartData,
      role,
      traceId,
    }),
    binary: (binary) => ({
      kind: "media",
      id: `${id}-media${index}`,
      part: binary as MediaPartData,
      role,
      traceId,
    }),
    toolCall: (call) => ({
      kind: "tool",
      id: `${id}-tu${index}`,
      name: call.name,
      arguments: call.arguments,
      traceId,
    }),
    toolResult: (result) => ({
      kind: "tool",
      id: `${id}-tr${index}`,
      name: "Tool result",
      arguments: undefined,
      result: { content: result.result },
      traceId,
    }),
    imageUrl: (url) => ({
      kind: "image",
      id: `${id}-img${index}`,
      src: url,
      role,
      traceId,
    }),
    bareImage: (src) => ({
      kind: "image",
      id: `${id}-img${index}`,
      src,
      role,
      traceId,
    }),
    inputAudio: (audio) => audioPart(audio, context),
  };
}

/** Decodes one content-array entry. */
export function decodeContentPart(
  item: unknown,
  context: PartContext,
): DisplayPart | undefined {
  return (
    readToolBlock(item, context) ??
    visitContentPart<DisplayPart | undefined>(item, partVisitor(context))
  );
}

/**
 * Folds a lone audio part and its sibling text into one part.
 *
 * The OpenAI Realtime API puts spoken audio and its transcript in the same
 * content array as siblings. Rendering them as two units reads as the model
 * having said everything twice.
 */
export function collapseAudioTranscript(parts: DisplayPart[]): DisplayPart[] {
  const media = parts.filter((part) => part.kind === "media");
  const texts = parts.filter((part) => part.kind === "text");
  if (media.length !== 1 || texts.length === 0) return parts;

  const only = media[0];
  if (only?.kind !== "media") return parts;
  // Only audio carries a transcript. A message pairing text with an image, a
  // video or a document is two things the reader wants both of, and folding
  // the text into the media part drops its bubble at the filter below.
  if (only.part.type !== "audio") return parts;

  only.transcript = texts
    .map((part) => (part.kind === "text" ? part.content : ""))
    .filter(Boolean)
    .join(" ");

  return parts.filter((part) => part.kind !== "text");
}
