import { Box, HStack, Image, Text, VStack } from "@chakra-ui/react";
import { useMemo, useRef, useEffect } from "react";
import { Settings } from "react-feather";
import type { StreamingMessage } from "~/hooks/useSimulationStreamingState";
import type { ScenarioMessageSnapshotEvent } from "~/server/scenarios/scenario-event.types";
import { TraceMessage } from "../copilot-kit/TraceMessage";
import { Markdown } from "../Markdown";
import { RenderInputOutput } from "../traces/RenderInputOutput";
import { safeJsonParseOrStringFallback } from "./utils/safe-json-parse-or-string-fallback";

type RawMessage = ScenarioMessageSnapshotEvent["messages"][number];

type DisplayItem =
  | { kind: "text"; id: string; role: string; content: string; traceId?: string }
  | { kind: "image"; id: string; src: string; traceId?: string }
  | { kind: "tool_call"; id: string; name: string; arguments: unknown; traceId?: string }
  | { kind: "tool_result"; id: string; result: unknown; traceId?: string };

interface ScenarioMessageRendererProps {
  messages: ScenarioMessageSnapshotEvent["messages"];
  streamingMessages?: StreamingMessage[];
  variant: "grid" | "drawer";
}

export function ScenarioMessageRenderer({
  messages,
  streamingMessages,
  variant,
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
                    <Markdown className="markdown">{item.content}</Markdown>
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
              <VStack key={item.id} align="flex-end">
                <Image src={item.src} maxH="200px" borderRadius="md" />
              </VStack>
            );

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
  // Content is already an array of rich content parts — use directly
  if (Array.isArray(msg.content)) return flattenMixed(msg.content, msg);

  const raw = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? {});

  // Try parsing string content as JSON array (e.g. serialized rich content)
  const parsed = safeJsonParseOrStringFallback(raw);
  if (Array.isArray(parsed)) return flattenMixed(parsed, msg);

  if (msg.content && msg.content !== "None") {
    return [{ kind: "text", id: msg.id ?? crypto.randomUUID(), role: msg.role ?? "assistant", content: raw, traceId: msg.trace_id }];
  }
  return [];
}

function flattenMixed(content: any[], msg: RawMessage): DisplayItem[] {
  const items: DisplayItem[] = [];
  content.forEach((item, i) => {
    if (typeof item === "string") {
      items.push({ kind: "text", id: `${msg.id}-c${i}`, role: msg.role ?? "assistant", content: item, traceId: msg.trace_id });
    } else if (typeof item === "object" && (item.type === "text" || (!item.type && item.text))) {
      // Handles: {type:"text", text:"..."}, {type:"text", content:"..."}, {text:"..."}
      const text = item.text ?? item.content ?? "";
      if (text) items.push({ kind: "text", id: `${msg.id}-c${i}`, role: msg.role ?? "assistant", content: text, traceId: msg.trace_id });
    } else if (typeof item === "object" && item.type === "image_url" && item.image_url?.url) {
      items.push({ kind: "image", id: `${msg.id}-img${i}`, src: item.image_url.url, traceId: msg.trace_id });
    } else if (typeof item === "object" && item.image) {
      items.push({ kind: "image", id: `${msg.id}-img${i}`, src: item.image, traceId: msg.trace_id });
    } else if (item.type === "tool_use" || item.type === "tool_call") {
      items.push({ kind: "tool_call", id: `${msg.id}-tu${i}`, name: item.name ?? item.toolName ?? "tool", arguments: item.arguments ?? item.input ?? item.args, traceId: msg.trace_id });
    } else if (item.type === "tool_result") {
      items.push({ kind: "tool_result", id: `${msg.id}-tr${i}`, result: item.content ?? item.result, traceId: msg.trace_id });
    }
  });
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
