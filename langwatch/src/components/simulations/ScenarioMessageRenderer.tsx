import { Box, HStack, Image, Text, VStack } from "@chakra-ui/react";
import { useMemo, useRef, useEffect } from "react";
import { useSequentialAudioPlayback } from "./useSequentialAudioPlayback";
import { Settings } from "react-feather";
import type { StreamingMessage } from "~/hooks/useSimulationStreamingState";
import type { ScenarioMessageSnapshotEvent } from "~/server/scenarios/scenario-event.types";
import { coerceContentToArray } from "~/server/stored-objects/coerce-content-to-array";
import { visitContentPart } from "~/server/stored-objects/visit-content-part";
import { TraceMessage } from "../copilot-kit/TraceMessage";
import { Markdown } from "../Markdown";
import { RenderInputOutput } from "../traces/RenderInputOutput";
import { safeJsonParseOrStringFallback } from "./utils/safe-json-parse-or-string-fallback";
import { MediaPart } from "./MediaPart";
import type { MediaPartData } from "./MediaPart";

type RawMessage = ScenarioMessageSnapshotEvent["messages"][number];

type DisplayItem =
  | { kind: "text"; id: string; role: string; content: string; traceId?: string }
  | { kind: "image"; id: string; src: string; role?: string; traceId?: string }
  | { kind: "media"; id: string; part: MediaPartData; role?: string; transcript?: string; traceId?: string }
  | { kind: "tool_call"; id: string; name: string; arguments: unknown; traceId?: string }
  | { kind: "tool_result"; id: string; result: unknown; traceId?: string };

interface ScenarioMessageRendererProps {
  messages: ScenarioMessageSnapshotEvent["messages"];
  streamingMessages?: StreamingMessage[];
  variant: "grid" | "drawer";
  /** Project that owns the stored objects in this message thread. Forwarded to MediaPart for server-side probes. */
  projectId: string;
}

export function ScenarioMessageRenderer({
  messages,
  streamingMessages,
  variant,
  projectId,
}: ScenarioMessageRendererProps) {
  const smallerView = variant === "grid";
  const endRef = useRef<HTMLDivElement>(null);

  const items = useMemo(
    () => flattenMessages(messages, streamingMessages),
    [messages, streamingMessages],
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items]);

  // Ordered list of audio-only item ids — the single source of ordering truth
  // for the sequential playback hook. Filters to audio media only (not video /
  // binary) so the hook's "next" index is never off by a non-audio item.
  const orderedAudioIds = useMemo(
    () =>
      items
        .filter(
          (item): item is Extract<DisplayItem, { kind: "media" }> =>
            item.kind === "media" && item.part.type === "audio",
        )
        .map((item) => item.id),
    [items],
  );

  // Per-renderer-instance sequential audio playback coordinator.
  // Each instance of ScenarioMessageRenderer owns its own hook invocation,
  // so grid cells are fully isolated from one another.
  const { getAudioProps } = useSequentialAudioPlayback({
    orderedIds: orderedAudioIds,
  });

  return (
    <VStack
      align="stretch"
      gap={smallerView ? 2 : 4}
      padding={smallerView ? 2 : 4}
      fontSize={smallerView ? "xs" : "sm"}
      width="100%"
      height="100%"
      overflowY="auto"
    >
      {items.map((item) => {
        switch (item.kind) {
          case "text":
            return (
              <VStack
                key={item.id}
                align={item.role === "assistant" ? "flex-start" : "flex-end"}
                gap={1}
              >
                {item.role === "assistant" ? (
                  <Box
                    bg="bg.panel"
                    border="1px solid"
                    borderColor="border"
                    borderRadius="lg"
                    paddingX={4}
                    paddingY={3}
                    maxW="95%"
                    fontSize="sm"
                    css={{
                      "& h1": { fontSize: "lg", fontWeight: "bold" },
                      "& h2": { fontSize: "md", fontWeight: "bold" },
                      "& h3": { fontSize: "sm", fontWeight: "semibold" },
                      "& > .markdown > *:last-child": { marginBottom: 0 },
                    }}
                  >
                    <Markdown>{item.content}</Markdown>
                  </Box>
                ) : (
                  <Box
                    bg="bg.subtle"
                    border="1px solid"
                    borderColor="border"
                    borderRadius="lg"
                    paddingX={3}
                    paddingY={2}
                    maxW="85%"
                    maxH={smallerView ? undefined : "150px"}
                    overflowY="auto"
                    fontSize="sm"
                    color="fg.muted"
                    whiteSpace="pre-wrap"
                  >
                    {item.content}
                  </Box>
                )}
                {!smallerView && item.traceId && item.role === "assistant" && (
                  <TraceMessage traceId={item.traceId} />
                )}
              </VStack>
            );

          case "image":
            return (
              <VStack
                key={item.id}
                align={item.role === "assistant" ? "flex-start" : "flex-end"}
              >
                <Image src={item.src} maxH="200px" borderRadius="md" />
              </VStack>
            );

          case "media": {
            return (
              <VStack
                key={item.id}
                align={item.role === "assistant" ? "flex-start" : "flex-end"}
                width="100%"
              >
                <VStack
                  align="stretch"
                  gap={1}
                  width={{ base: "100%", md: "min(420px, 95%)" }}
                >
                  <MediaPart
                    part={item.part}
                    projectId={projectId}
                    audioPlayback={
                      item.part.type === "audio"
                        ? getAudioProps(item.id)
                        : undefined
                    }
                  />
                  {item.transcript && (
                    <Text
                      fontSize="xs"
                      color="fg.muted"
                      fontStyle="italic"
                      paddingX={2}
                      textAlign={
                        item.role === "assistant" ? "left" : "right"
                      }
                    >
                      {item.transcript}
                    </Text>
                  )}
                </VStack>
                {!smallerView && item.traceId && item.role === "assistant" && (
                  <TraceMessage traceId={item.traceId} />
                )}
              </VStack>
            );
          }

          case "tool_call":
            return (
              <VStack key={item.id} align="flex-start" gap={2}>
                <HStack gap={2}>
                  <Box color="orange.fg">
                    <Settings size={12} />
                  </Box>
                  <Text fontSize="xs" color="orange.fg" fontWeight="medium">
                    {item.name}
                  </Text>
                </HStack>
                <Box
                  w="full"
                  maxW="80%"
                  bg="bg.subtle"
                  border="1px solid"
                  borderColor="border"
                  borderRadius="lg"
                  p={3}
                >
                  <Text fontSize="xs" fontWeight="semibold" color="fg.muted" mb={2}>
                    Tool arguments
                  </Text>
                  <Box bg="bg.panel" border="1px solid" borderColor="border" borderRadius="md" p={2}>
                    <RenderInputOutput value={item.arguments as string} />
                  </Box>
                </Box>
                {!smallerView && item.traceId && <TraceMessage traceId={item.traceId} />}
              </VStack>
            );

          case "tool_result":
            return (
              <VStack key={item.id} align="flex-start" gap={2}>
                <Box
                  w="full"
                  maxW="80%"
                  bg="bg.subtle"
                  border="1px solid"
                  borderColor="border"
                  borderRadius="lg"
                  p={3}
                >
                  <Text fontSize="xs" fontWeight="semibold" color="fg.muted" mb={2}>
                    Tool result
                  </Text>
                  <Box bg="bg.panel" border="1px solid" borderColor="border" borderRadius="md" p={2}>
                    <RenderInputOutput value={item.result as string} />
                  </Box>
                </Box>
                {!smallerView && item.traceId && <TraceMessage traceId={item.traceId} />}
              </VStack>
            );

          default:
            return null;
        }
      })}
      <div ref={endRef} />
    </VStack>
  );
}

// ---------------------------------------------------------------------------
// Flatten raw scenario messages + streaming into DisplayItems
// ---------------------------------------------------------------------------

function flattenMessages(
  messages: ScenarioMessageSnapshotEvent["messages"],
  streamingMessages?: StreamingMessage[],
): DisplayItem[] {
  const items: DisplayItem[] = [];

  for (const msg of messages) {
    if (msg.role === "user" || msg.role === "assistant") {
      // Support both snake_case (OpenAI/chatMessageSchema) and camelCase (AG-UI MessageSchema)
      const msgAny = msg as Record<string, unknown>;
      const toolCalls = (msgAny.tool_calls as Array<{ function?: { name?: string; arguments?: string } }> | undefined)
        ?? (msgAny.toolCalls as Array<{ function?: { name?: string; arguments?: string } }> | undefined)
        ?? null;
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
          typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? {}),
        ),
        traceId: msg.trace_id,
      });
    }
  }

  if (streamingMessages?.length) {
    const serverIds = new Set(messages.map((m) => m.id).filter(Boolean));
    for (const sm of streamingMessages) {
      if (serverIds.has(sm.messageId)) continue;
      items.push({ kind: "text", id: sm.messageId, role: sm.role, content: sm.content || "\u2026" });
    }
  }

  deduplicateTraceIds(items);
  return items;
}

function flattenContent(msg: RawMessage): DisplayItem[] {
  const coerced = coerceContentToArray(msg.content);
  if (coerced) return flattenMixed(coerced, msg);

  const raw = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? {});

  if (msg.content && msg.content !== "None") {
    return [{ kind: "text", id: msg.id ?? crypto.randomUUID(), role: msg.role ?? "assistant", content: raw, traceId: msg.trace_id }];
  }
  return [];
}

function flattenMixed(content: unknown[], msg: RawMessage): DisplayItem[] {
  const items: DisplayItem[] = [];
  const role = msg.role ?? "assistant";
  content.forEach((item, i) => {
    const result = visitContentPart<DisplayItem | undefined>(item, {
      text: (text) => text
        ? { kind: "text" as const, id: `${msg.id}-c${i}`, role, content: text, traceId: msg.trace_id }
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
      toolCall: (part) => ({ kind: "tool_call" as const, id: `${msg.id}-tu${i}`, name: part.name, arguments: part.arguments, traceId: msg.trace_id }),
      toolResult: (part) => ({ kind: "tool_result" as const, id: `${msg.id}-tr${i}`, result: part.result, traceId: msg.trace_id }),
      imageUrl: (url) => ({ kind: "image" as const, id: `${msg.id}-img${i}`, src: url, role, traceId: msg.trace_id }),
      bareImage: (src) => ({ kind: "image" as const, id: `${msg.id}-img${i}`, src, role, traceId: msg.trace_id }),
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

function deduplicateTraceIds(items: DisplayItem[]): void {
  const seen = new Set<string>();
  for (let i = items.length - 1; i >= 0; i--) {
    const t = items[i]!.traceId;
    if (!t) continue;
    if (seen.has(t)) items[i]!.traceId = undefined;
    seen.add(t);
  }
}
