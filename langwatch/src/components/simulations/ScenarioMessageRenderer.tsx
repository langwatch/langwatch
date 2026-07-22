import { Box, HStack, Image, Text, VStack } from "@chakra-ui/react";
import { useEffect, useMemo, useRef } from "react";
import { Settings } from "react-feather";
import { getDisplayRoleVisuals } from "~/features/traces-v2/components/TraceDrawer/scenarioRoles";
import { Bubble } from "~/features/traces-v2/components/TraceTable/registry/addons/conversation/Bubble";
import type { StreamingMessage } from "~/hooks/useSimulationStreamingState";
import type { ScenarioMessageSnapshotEvent } from "@langwatch/contracts/scenarios/types";
import { coerceContentToArray } from "~/server/stored-objects/coerce-content-to-array";
import { visitContentPart } from "~/shared/content-parts/visit-content-part";
import type { MediaPartData } from "~/shared/traces/mediaParts";
import { RenderInputOutput } from "../traces/RenderInputOutput";
import { MediaPart } from "./MediaPart";
import { RunTurnSeparator } from "./RunTurnSeparator";
import { useSequentialAudioPlayback } from "./useSequentialAudioPlayback";
import { safeJsonParseOrStringFallback } from "./utils/safe-json-parse-or-string-fallback";

type RawMessage = ScenarioMessageSnapshotEvent["messages"][number];

// Role → alignment mapping. Extracted here so `align` and `data-align` always
// derive from the same value — the `data-align` attribute mirrors `align` for
// jsdom tests, which cannot read Chakra's atomic CSS classes via getComputedStyle.
const alignForRole = (role?: string): "flex-start" | "flex-end" =>
  role === "assistant" ? "flex-start" : "flex-end";

const textAlignForRole = (role?: string): "left" | "right" =>
  role === "assistant" ? "left" : "right";

type DisplayItem =
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

  // Drawer variant groups consecutive items that share a trace into turns,
  // each headed by a Traces V2-style separator line that opens the trace.
  const turns = useMemo(() => groupIntoTurns(items), [items]);

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

  const renderItem = (item: DisplayItem) => {
    switch (item.kind) {
      case "text": {
        // Scenario role mapping shared with the Traces V2 drawer: the
        // agent under test renders as the conversation's "user" side
        // (left/blue), the simulated user as the "assistant" side
        // (right/purple, flask icon).
        const visuals = getDisplayRoleVisuals(
          item.role === "assistant" ? "assistant" : "user",
          { isScenario: true },
        );
        const RoleIcon = visuals.Icon;
        return (
          <VStack
            key={item.id}
            align={alignForRole(item.role)}
            data-align={alignForRole(item.role)}
            gap={1}
            width="100%"
          >
            <Bubble
              side={visuals.displayRole === "user" ? "left" : "right"}
              tone={visuals.displayRole}
              label={visuals.bubbleLabel}
              icon={<RoleIcon />}
              text={item.content}
              size={smallerView ? "compact" : "regular"}
              maxChars={smallerView ? 320 : 800}
            />
          </VStack>
        );
      }

      case "image":
        return (
          <VStack
            key={item.id}
            align={alignForRole(item.role)}
            data-align={alignForRole(item.role)}
          >
            <Image src={item.src} maxH="200px" borderRadius="md" />
          </VStack>
        );

      case "media": {
        // Audio/video players stretch to the container width; attachment
        // chips hug the message side like a bubble would (user sent it →
        // right, agent → left). Mirrored into data-media-align because
        // jsdom cannot read the compiled flex styles.
        const innerAlign =
          item.part.type === "binary"
            ? alignForRole(item.role)
            : ("stretch" as const);
        return (
          <VStack
            key={item.id}
            align={alignForRole(item.role)}
            data-align={alignForRole(item.role)}
            width="100%"
          >
            <VStack
              align={innerAlign}
              data-media-align={innerAlign}
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
                  textAlign={textAlignForRole(item.role)}
                >
                  {item.transcript}
                </Text>
              )}
            </VStack>
          </VStack>
        );
      }

      case "tool_call":
        return (
          <VStack key={item.id} align="flex-start" gap={1.5} width="100%">
            <HStack gap={1.5} color="orange.fg">
              <Settings size={12} />
              <Text
                textStyle="2xs"
                fontWeight="600"
                textTransform="uppercase"
                letterSpacing="0.06em"
              >
                {item.name}
              </Text>
            </HStack>
            <Box
              w="full"
              maxW="85%"
              bg="bg.muted/60"
              borderWidth="1px"
              borderColor="border.muted"
              borderRadius="lg"
              padding={3}
            >
              <RenderInputOutput value={item.arguments as string} />
            </Box>
          </VStack>
        );

      case "tool_result":
        return (
          <VStack key={item.id} align="flex-start" gap={1.5} width="100%">
            <HStack gap={1.5} color="fg.muted">
              <Settings size={12} />
              <Text
                textStyle="2xs"
                fontWeight="600"
                textTransform="uppercase"
                letterSpacing="0.06em"
              >
                Tool result
              </Text>
            </HStack>
            <Box
              w="full"
              maxW="85%"
              bg="bg.muted/60"
              borderWidth="1px"
              borderColor="border.muted"
              borderRadius="lg"
              padding={3}
            >
              <RenderInputOutput value={item.result as string} />
            </Box>
          </VStack>
        );

      default:
        return null;
    }
  };

  return (
    <VStack
      align="stretch"
      gap={smallerView ? 2 : 4}
      // Drawer variant: the section content already pads — avoid doubling.
      padding={smallerView ? 2 : 0}
      fontSize={smallerView ? "xs" : "sm"}
      width="100%"
      height="100%"
      overflowY="auto"
    >
      {smallerView
        ? items.map(renderItem)
        : turns.map((turn) => (
            <VStack key={turn.key} align="stretch" gap={4} width="100%">
              {turn.traceId && turn.turnNumber != null && (
                <RunTurnSeparator
                  index={turn.turnNumber}
                  traceId={turn.traceId}
                />
              )}
              {turn.items.map(renderItem)}
            </VStack>
          ))}
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
            arguments: safeJsonParseOrStringFallback(
              tc.function?.arguments ?? "{}",
            ),
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
    typeof msg.content === "string"
      ? msg.content
      : JSON.stringify(msg.content ?? {});

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

function groupIntoTurns(items: DisplayItem[]): ConversationTurn[] {
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
