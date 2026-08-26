import type { ScenarioMessageSnapshotEvent } from "@langwatch/scenario-contract";
import { visitContentPart } from "@langwatch/trace-contract";
import { coerceContentToArray } from "./coerce-content-to-array";
import type { MediaPartData } from "./media-parts";
import { safeJsonParseOrStringFallback } from "./safe-json-parse-or-string-fallback";

type RawMessage = ScenarioMessageSnapshotEvent["messages"][number];

export type DisplayItem =
  | {
      kind: "text";
      id: string;
      role: string;
      content: string;
      traceId?: string;
    }
  | { kind: "image"; id: string; src: string; role?: string; traceId?: string }
  | {
      kind: "media";
      id: string;
      part: MediaPartData;
      role?: string;
      transcript?: string;
      traceId?: string;
    }
  | {
      kind: "tool_call";
      id: string;
      name: string;
      arguments: unknown;
      traceId?: string;
    }
  | { kind: "tool_result"; id: string; result: unknown; traceId?: string };

export interface StreamingMessage {
  messageId: string;
  role: string;
  content: string;
  messageIndex?: number;
  status: "streaming" | "complete";
}

export function flattenMessages(
  messages: ScenarioMessageSnapshotEvent["messages"],
  streamingMessages?: StreamingMessage[],
): DisplayItem[] {
  const items: DisplayItem[] = [];

  for (const msg of messages) {
    if (msg.role === "user" || msg.role === "assistant") {
      // Support both snake_case (OpenAI/chatMessageSchema) and camelCase (AG-UI MessageSchema)
      const msgAny = msg as Record<string, unknown>;
      const toolCalls =
        (msgAny.tool_calls as
          | Array<{ function?: { name?: string; arguments?: string } }>
          | undefined) ??
        (msgAny.toolCalls as
          | Array<{ function?: { name?: string; arguments?: string } }>
          | undefined) ??
        null;
      if (toolCalls) {
        for (const tc of toolCalls) {
          items.push({
            kind: "tool_call",
            id: `${msg.id ?? ""}-tool-${tc.function?.name ?? "unknown"}`,
            name: tc.function?.name ?? "unknown",
            arguments: safeJsonParseOrStringFallback(tc.function?.arguments ?? "{}"),
            traceId: msg.trace_id,
          });
        }
      }
      items.push(...flattenContent(msg));
    } else if (msg.role === "tool") {
      items.push({
        kind: "tool_result",
        id: msg.id ?? crypto.randomUUID(),
        result: safeJsonParseOrStringFallback(
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content ?? {}),
        ),
        traceId: msg.trace_id,
      });
    }
  }

  if (streamingMessages?.length) {
    const serverIds = new Set(messages.map((m) => m.id).filter(Boolean));
    for (const sm of streamingMessages) {
      if (serverIds.has(sm.messageId)) continue;
      items.push({
        kind: "text",
        id: sm.messageId,
        role: sm.role,
        content: sm.content || "\u2026",
      });
    }
  }

  return items;
}

function flattenContent(msg: RawMessage): DisplayItem[] {
  const coerced = coerceContentToArray(msg.content);
  if (coerced) return flattenMixed(coerced, msg);

  const raw =
    typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? {});

  if (msg.content && msg.content !== "None") {
    return [
      {
        kind: "text",
        id: msg.id ?? crypto.randomUUID(),
        role: msg.role ?? "assistant",
        content: raw,
        traceId: msg.trace_id,
      },
    ];
  }
  return [];
}

function flattenMixed(content: unknown[], msg: RawMessage): DisplayItem[] {
  const items: DisplayItem[] = [];
  const role = msg.role ?? "assistant";
  content.forEach((item, i) => {
    const result = visitContentPart<DisplayItem | undefined>(item, {
      text: (text) =>
        text
          ? {
              kind: "text" as const,
              id: `${msg.id}-c${i}`,
              role,
              content: text,
              traceId: msg.trace_id,
            }
          : undefined,
      media: (part) => ({
        kind: "media" as const,
        id: `${msg.id}-media${i}`,
        // Cast: MediaPartData's discriminated union splits on source.type;
        // runtime shape is validated by the upstream source guard.
        part: { type: part.type, source: part.source } as MediaPartData,
        role,
        traceId: msg.trace_id,
      }),
      binary: (part) => ({
        kind: "media" as const,
        id: `${msg.id}-media${i}`,
        part: part as MediaPartData,
        role,
        traceId: msg.trace_id,
      }),
      toolCall: (part) => ({
        kind: "tool_call" as const,
        id: `${msg.id}-tu${i}`,
        name: part.name,
        arguments: part.arguments,
        traceId: msg.trace_id,
      }),
      toolResult: (part) => ({
        kind: "tool_result" as const,
        id: `${msg.id}-tr${i}`,
        result: part.result,
        traceId: msg.trace_id,
      }),
      imageUrl: (url) => ({
        kind: "image" as const,
        id: `${msg.id}-img${i}`,
        src: url,
        role,
        traceId: msg.trace_id,
      }),
      bareImage: (src) => ({
        kind: "image" as const,
        id: `${msg.id}-img${i}`,
        src,
        role,
        traceId: msg.trace_id,
      }),
      // OpenAI Realtime API audio shape. Two states:
      // - Pre-extraction: {data, format} (inline base64). Server-side
      //   extraction normally rewrites this away, but if the renderer
      //   sees one it builds a data: URI so the <audio> element can
      //   still play the bytes.
      // - Post-extraction: {url, format, mimeType} where url is
      //   /api/files/<storedObjectId>. Build a url-source MediaPart.
      inputAudio: (part) => {
        const mimeType =
          part.mimeType ??
          (part.format === "wav"
            ? "audio/wav"
            : part.format === "mp3"
              ? "audio/mpeg"
              : "audio/wav");
        if (part.url) {
          return {
            kind: "media" as const,
            id: `${msg.id}-audio${i}`,
            part: {
              type: "audio" as const,
              source: { type: "url" as const, value: part.url, mimeType },
            },
            role,
            traceId: msg.trace_id,
          };
        }
        if (part.data) {
          return {
            kind: "media" as const,
            id: `${msg.id}-audio${i}`,
            part: {
              type: "audio" as const,
              source: { type: "data" as const, value: part.data, mimeType },
            },
            role,
            traceId: msg.trace_id,
          };
        }
        return undefined;
      },
    });
    if (result) items.push(result);
  });

  // If a single message contains both audio AND text parts, the text is the
  // transcript of the audio (OpenAI Realtime API convention: same content
  // array, sibling parts). Collapse into one media item with `transcript`
  // so the renderer shows audio + italic caption as one unit, not two
  // separate bubbles.
  const mediaItems = items.filter((it) => it.kind === "media");
  const textItems = items.filter((it) => it.kind === "text");
  if (mediaItems.length === 1 && textItems.length > 0) {
    const media = mediaItems[0]!;
    if (media.kind === "media") {
      media.transcript = textItems
        .map((t) => (t.kind === "text" ? t.content : ""))
        .filter(Boolean)
        .join(" ");
    }
    return items.filter((it) => it.kind !== "text");
  }

  return items;
}

/**
 * Groups consecutive display items that share a trace id into turns.
 * Items without a trace id (e.g. still-streaming messages) form their own
 * unnumbered group so they render without a separator.
 */
type ConversationTurn = {
  key: string;
  traceId?: string;
  turnNumber?: number;
  items: DisplayItem[];
};

export function groupIntoTurns(items: DisplayItem[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let turnNumber = 0;
  for (const item of items) {
    const last = turns[turns.length - 1];
    if (last && (last.traceId ?? "") === (item.traceId ?? "")) {
      last.items.push(item);
      continue;
    }
    turns.push({
      key: item.id,
      traceId: item.traceId,
      turnNumber: item.traceId ? ++turnNumber : undefined,
      items: [item],
    });
  }
  return turns;
}
