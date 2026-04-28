import {
  Box,
  Circle,
  Flex,
  HStack,
  Icon,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { LuArrowLeft, LuArrowRight, LuMessageCircle } from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";
import {
  type ThreadTurn,
  useThreadContext,
} from "../../hooks/useThreadContext";
import { useTraceDrawerNavigation } from "../../hooks/useTraceDrawerNavigation";
import { useDrawerStore } from "../../stores/drawerStore";
import { STATUS_COLORS } from "../../utils/formatters";
import { TraceIdPeek } from "../TraceIdPeek";
import { useDisplayRoleVisuals } from "./scenarioRoles";

interface ConversationContextProps {
  conversationId: string | null;
  traceId: string;
}

/** Display row built from a turn — user or assistant side. */
interface ConversationRow {
  key: string;
  traceId: string;
  role: "user" | "assistant";
  text: string;
  /** "previous" / "current" / "next" relative to the visible trace */
  position: "previous" | "current" | "next";
  status: ThreadTurn["status"];
}

const MAX_PREVIEW = 140;

function truncate(s: string): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length <= MAX_PREVIEW
    ? flat
    : `${flat.slice(0, MAX_PREVIEW - 1)}…`;
}

/**
 * Pull a readable snippet out of an input/output payload. If the payload is
 * a JSON chat array, walk the messages and extract the text from the side
 * we actually care about (last user prose for "input", last assistant text
 * for "output"). Strips Anthropic-style typed-block JSON and tool_use
 * wrappers so the context strip doesn't look like a stringified blob.
 */
function extractReadableSnippet(
  raw: string | null | undefined,
  prefer: "user" | "assistant",
): string {
  if (!raw) return "";
  // Try to parse as JSON. If chat-shaped, walk it.
  let parsed: unknown = null;
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("{") && trimmed.endsWith("}"))
  ) {
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // not JSON, fall through to raw
    }
  }

  const extractMessageText = (msg: unknown): string => {
    if (!msg || typeof msg !== "object") return "";
    const obj = msg as Record<string, unknown>;
    const content = obj.content;
    if (typeof content === "string") {
      // Could itself be JSON of a typed block — strip that down.
      const t = content.trim();
      if (t.startsWith('{"type":"text"')) {
        try {
          const inner = JSON.parse(t) as { text?: string };
          if (typeof inner.text === "string") return inner.text;
        } catch {
          /* ignore */
        }
      }
      // Skip pure JSON typed-blocks that aren't text
      if (t.startsWith('{"type":"') && !t.startsWith('{"type":"text"'))
        return "";
      return content;
    }
    if (Array.isArray(content)) {
      const texts: string[] = [];
      for (const part of content) {
        if (typeof part === "string") {
          texts.push(part);
        } else if (
          part &&
          typeof part === "object" &&
          (part as { type?: unknown }).type === "text" &&
          typeof (part as { text?: unknown }).text === "string"
        ) {
          texts.push((part as { text: string }).text);
        }
      }
      return texts.join(" ");
    }
    return "";
  };

  if (Array.isArray(parsed)) {
    const targetRole = prefer;
    // Walk backwards for the latest matching role.
    for (let i = parsed.length - 1; i >= 0; i--) {
      const msg = parsed[i] as Record<string, unknown> | null;
      if (msg && msg.role === targetRole) {
        const text = extractMessageText(msg);
        if (text.trim()) return truncate(text);
      }
    }
    // Fallback: any message with text content.
    for (let i = parsed.length - 1; i >= 0; i--) {
      const text = extractMessageText(parsed[i]);
      if (text.trim()) return truncate(text);
    }
  }

  return truncate(raw);
}

/**
 * Build the rows shown in the panel from the available turns.
 *
 * Reading flow we want is: previous user message → current assistant
 * response (highlighted) → next user message. Falls back to whatever side
 * is available when the other is missing.
 */
function buildRows({
  previous,
  current,
  next,
}: {
  previous: ThreadTurn | null;
  current: ThreadTurn | null;
  next: ThreadTurn | null;
}): ConversationRow[] {
  const rows: ConversationRow[] = [];
  if (previous) {
    // For a sibling turn we prefer the user side (what was asked); fall
    // back to the assistant reply if that side is empty.
    const text =
      extractReadableSnippet(previous.input, "user") ||
      extractReadableSnippet(previous.output, "assistant");
    if (text) {
      rows.push({
        key: `prev-${previous.traceId}`,
        traceId: previous.traceId,
        role: previous.input ? "user" : "assistant",
        text,
        position: "previous",
        status: previous.status,
      });
    }
  }
  if (current) {
    // For the current turn we surface the assistant reply (what was said
    // back) — the user prompt is rendered elsewhere in the drawer.
    const text =
      extractReadableSnippet(current.output, "assistant") ||
      extractReadableSnippet(current.input, "user");
    if (text) {
      rows.push({
        key: `curr-${current.traceId}`,
        traceId: current.traceId,
        role: current.output ? "assistant" : "user",
        text,
        position: "current",
        status: current.status,
      });
    }
  }
  if (next) {
    const text =
      extractReadableSnippet(next.input, "user") ||
      extractReadableSnippet(next.output, "assistant");
    if (text) {
      rows.push({
        key: `next-${next.traceId}`,
        traceId: next.traceId,
        role: next.input ? "user" : "assistant",
        text,
        position: "next",
        status: next.status,
      });
    }
  }
  return rows;
}

export function ConversationContext({
  conversationId,
  traceId,
}: ConversationContextProps) {
  const { navigateToTrace } = useTraceDrawerNavigation();
  const viewMode = useDrawerStore((s) => s.viewMode);
  const ctx = useThreadContext(conversationId, traceId);

  if (!conversationId) return null;

  const current = ctx.turns.find((t) => t.traceId === traceId) ?? null;
  const rows = buildRows({
    previous: ctx.previous,
    current,
    next: ctx.next,
  });

  const navigate = (id: string) => {
    if (id === traceId) return;
    const turn = ctx.turns.find((t) => t.traceId === id);
    navigateToTrace({
      fromTraceId: traceId,
      fromViewMode: viewMode,
      toTraceId: id,
      toTimestamp: turn?.timestamp,
    });
  };

  return (
    <Box paddingX={4}>
      <HStack gap={2} marginBottom={2}>
        <Icon as={LuMessageCircle} boxSize={3} color="fg.muted" />
        <Text
          textStyle="2xs"
          color="fg.muted"
          textTransform="uppercase"
          letterSpacing="0.06em"
          fontWeight="semibold"
        >
          Conversation Context
        </Text>
        {ctx.isLoading ? (
          <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
            loading…
          </Text>
        ) : ctx.total > 0 ? (
          <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
            turn {ctx.position} of {ctx.total}
          </Text>
        ) : null}
      </HStack>

      {ctx.isLoading && rows.length === 0 ? (
        // Skeleton mirrors the eventual row layout (icon + line) so the
        // section doesn't jump in height once the thread resolves.
        <VStack
          align="stretch"
          gap={0}
          borderRadius="md"
          borderWidth="1px"
          borderColor="border.muted"
          bg="bg.panel"
          overflow="hidden"
        >
          {[0, 1, 2].map((i) => (
            <HStack
              key={i}
              paddingX={3}
              paddingY={2}
              gap={2.5}
              borderBottomWidth={i === 2 ? 0 : "1px"}
              borderColor="border.muted"
            >
              <Skeleton height="14px" width="56px" borderRadius="sm" />
              <Skeleton height="14px" width="14px" borderRadius="full" />
              <Skeleton
                height="12px"
                flex={1}
                borderRadius="sm"
                opacity={i === 1 ? 1 : 0.55}
              />
            </HStack>
          ))}
        </VStack>
      ) : rows.length === 0 ? (
        <Box
          paddingY={3}
          paddingX={3}
          borderRadius="md"
          borderWidth="1px"
          borderColor="border.muted"
          bg="bg.panel"
        >
          <Text textStyle="2xs" color="fg.subtle">
            This is the only turn in the conversation.
          </Text>
        </Box>
      ) : (
        <VStack
          align="stretch"
          gap={0}
          borderRadius="md"
          borderWidth="1px"
          borderColor="border.muted"
          bg="bg.panel"
          overflow="hidden"
        >
          {rows.map((row, i) => (
            <ConversationRow
              key={row.key}
              row={row}
              isLast={i === rows.length - 1}
              onClick={() => navigate(row.traceId)}
            />
          ))}
        </VStack>
      )}
    </Box>
  );
}

function ConversationRow({
  row,
  isLast,
  onClick,
}: {
  row: ConversationRow;
  isLast: boolean;
  onClick: () => void;
}) {
  const isCurrent = row.position === "current";
  // Scenario mode swaps icon + accent so the prev/curr/next chips line up
  // with the bubble headers in the body of the drawer.
  const visuals = useDisplayRoleVisuals(row.role);
  const RoleIcon = visuals.Icon;
  const iconColor =
    visuals.displayRole === "assistant" ? "blue.fg" : "fg.muted";
  const Affordance =
    row.position === "previous"
      ? LuArrowLeft
      : row.position === "next"
        ? LuArrowRight
        : null;
  const statusColor = STATUS_COLORS[row.status] as string;

  return (
    <Tooltip
      content={`View the trace of the ${row.position} message in the conversation`}
      disabled={row.position === "current"}
    >
      <Flex
        as={isCurrent ? "div" : "button"}
        align="center"
        gap={2.5}
        paddingX={3}
        paddingY={2}
        bg={isCurrent ? "bg.emphasized" : "transparent"}
        borderBottomWidth={isLast ? 0 : "1px"}
        borderColor="border.muted"
        cursor={isCurrent ? "default" : "pointer"}
        onClick={isCurrent ? undefined : onClick}
        _hover={isCurrent ? undefined : { bg: "bg.muted" }}
        transition="background 0.12s ease"
        textAlign="left"
        width="full"
        // One-shot pulse on the current row whenever it (re)mounts — the
        // row's key includes the trace id, so navigating to a sibling
        // remounts this element and the animation re-fires.
        css={
          isCurrent
            ? {
                animation: "tracesV2CurrentRowPulse 0.6s ease-out",
                "@keyframes tracesV2CurrentRowPulse": {
                  "0%": {
                    backgroundColor:
                      "color-mix(in srgb, var(--chakra-colors-blue-500) 28%, transparent)",
                    boxShadow:
                      "inset 0 0 0 1px color-mix(in srgb, var(--chakra-colors-blue-500) 35%, transparent)",
                  },
                  "100%": {
                    backgroundColor: "var(--chakra-colors-bg-emphasized)",
                    boxShadow: "inset 0 0 0 1px transparent",
                  },
                },
                "@media (prefers-reduced-motion: reduce)": {
                  animation: "none",
                },
              }
            : undefined
        }
      >
        <TraceIdPeek traceId={row.traceId} />
        <Icon as={RoleIcon} boxSize={3.5} color={iconColor} flexShrink={0} />
        <Text
          textStyle="xs"
          color={isCurrent ? "fg" : "fg.muted"}
          fontWeight={isCurrent ? "medium" : "normal"}
          truncate
          flex={1}
          minWidth={0}
        >
          {row.text}
        </Text>
        {isCurrent ? (
          <Circle size="8px" bg={statusColor} flexShrink={0} />
        ) : Affordance ? (
          <Icon
            as={Affordance}
            boxSize={3.5}
            color="fg.subtle"
            flexShrink={0}
          />
        ) : null}
      </Flex>
    </Tooltip>
  );
}
