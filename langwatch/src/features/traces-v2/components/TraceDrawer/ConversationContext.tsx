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
import { AnimatePresence, motion, type Variants } from "motion/react";
import { memo, useCallback, useMemo } from "react";
import {
  LuArrowLeft,
  LuArrowRight,
  LuCircleDashed,
  LuFlag,
  LuMessageCircle,
} from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";
import {
  type ConversationTurn,
  useConversationContext,
} from "../../hooks/useConversationContext";
import { useTraceDrawerNavigation } from "../../hooks/useTraceDrawerNavigation";
import { useDrawerStore } from "../../stores/drawerStore";
import { STATUS_COLORS } from "../../utils/formatters";
import { TraceIdPeek } from "../TraceIdPeek";
import { useDisplayRoleVisuals } from "./scenarioRoles";

interface ConversationContextProps {
  conversationId: string | null;
  traceId: string;
}

/**
 * Display row built from a turn — represents BOTH halves (user + assistant)
 * because a "turn" in chat is an exchange, not a single message. Earlier
 * versions rendered one row per side and missed the user-prompt half on
 * the current turn, which made the context strip read as half a
 * conversation. Now each slot shows both halves stacked: user on top,
 * assistant below.
 */
interface ConversationRow {
  key: string;
  traceId: string;
  /** Pre-extracted user prompt text, or null when there isn't one. */
  userText: string | null;
  /** Pre-extracted assistant response text, or null when there isn't one. */
  assistantText: string | null;
  /** "previous" / "current" / "next" relative to the visible trace */
  position: "previous" | "current" | "next";
  status: ConversationTurn["status"];
  /** True when the slot has no real turn — render as a "boundary" hint. */
  isPlaceholder?: boolean;
  /** Boundary kind for placeholders: "start" or "end" of conversation. */
  boundary?: "start" | "end";
}

const MAX_PREVIEW = 140;

// Hoisted so each render of ConversationContext doesn't re-allocate the
// variants object (and so `motion` doesn't see fresh references and
// re-evaluate variants resolution unnecessarily).
const SLIDE_VARIANTS: Variants = {
  enter: { opacity: 0 },
  center: { opacity: 1 },
  exit: { opacity: 0 },
};

// Quick tween instead of a spring — tested settle was 250-350ms with the
// spring config; a 160ms ease-out reads as much snappier without losing
// the bookshelf direction cue.
const SLIDE_TRANSITION = { duration: 0.16, ease: "easeOut" as const };

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
  previous: ConversationTurn | null;
  current: ConversationTurn | null;
  next: ConversationTurn | null;
}): ConversationRow[] {
  // Always returns exactly 3 rows so the section's height is stable. Missing
  // prev/next slots become "Start of conversation" / "End of conversation"
  // placeholders.
  const placeholder = (
    pos: "previous" | "next",
    boundary: "start" | "end",
  ): ConversationRow => ({
    key: `${pos}-placeholder`,
    traceId: "",
    userText: null,
    assistantText:
      boundary === "start" ? "Start of conversation" : "End of conversation",
    position: pos,
    status: "ok",
    isPlaceholder: true,
    boundary,
  });

  const buildSlot = (
    turn: ConversationTurn,
    position: "previous" | "current" | "next",
    keyPrefix: string,
  ): ConversationRow => ({
    key: `${keyPrefix}-${turn.traceId}`,
    traceId: turn.traceId,
    userText: extractReadableSnippet(turn.input, "user") || null,
    assistantText: extractReadableSnippet(turn.output, "assistant") || null,
    position,
    status: turn.status,
  });

  const prevRow = previous
    ? buildSlot(previous, "previous", "prev")
    : placeholder("previous", "start");
  const currRow = current ? buildSlot(current, "current", "curr") : null;
  const nextRow = next
    ? buildSlot(next, "next", "next")
    : placeholder("next", "end");

  return currRow ? [prevRow, currRow, nextRow] : [];
}

export const ConversationContext = memo(function ConversationContext({
  conversationId,
  traceId,
}: ConversationContextProps) {
  const { navigateToTrace } = useTraceDrawerNavigation();
  const viewMode = useDrawerStore((s) => s.viewMode);
  const ctx = useConversationContext(conversationId, traceId);

  // Memo before the early `null` return so the hook order stays stable
  // when this component goes from "no conversation" → "conversation".
  const current = useMemo(
    () => ctx.turns.find((t) => t.traceId === traceId) ?? null,
    [ctx.turns, traceId],
  );
  // `buildRows` runs `extractReadableSnippet` up to 6 times — each one a
  // potential JSON parse on the input/output payload. Cache the result so
  // re-renders during the transition don't re-parse.
  const rows = useMemo(
    () => buildRows({ previous: ctx.previous, current, next: ctx.next }),
    [ctx.previous, current, ctx.next],
  );

  const navigate = useCallback(
    (id: string) => {
      if (id === traceId) return;
      const turn = ctx.turns.find((t) => t.traceId === id);
      navigateToTrace({
        fromTraceId: traceId,
        fromViewMode: viewMode,
        toTraceId: id,
        toTimestamp: turn?.timestamp,
      });
    },
    [traceId, ctx.turns, navigateToTrace, viewMode],
  );

  if (!conversationId) return null;

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
        // Bookshelf slide on navigation: the whole 3-row strip slides up
        // (J / forward) or down (K / backward), exiting one strip while the
        // new one slides in from the opposite side. Same snappy spring as
        // the body bookshelf.
        <Box
          position="relative"
          borderRadius="md"
          borderWidth="1px"
          borderColor="border.muted"
          bg="bg.panel"
          overflow="hidden"
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={traceId}
              variants={SLIDE_VARIANTS}
              initial="enter"
              animate="center"
              exit="exit"
              transition={SLIDE_TRANSITION}
            >
              <VStack align="stretch" gap={0}>
                {rows.map((row, i) => (
                  <ConversationRow
                    key={row.key}
                    row={row}
                    isLast={i === rows.length - 1}
                    onSelect={navigate}
                  />
                ))}
              </VStack>
            </motion.div>
          </AnimatePresence>
        </Box>
      )}
    </Box>
  );
});

const ConversationRow = memo(function ConversationRow({
  row,
  isLast,
  onSelect,
}: {
  row: ConversationRow;
  isLast: boolean;
  /** Stable callback from the parent — the row decides if it fires. */
  onSelect: (traceId: string) => void;
}) {
  const isCurrent = row.position === "current";
  const isPlaceholder = !!row.isPlaceholder;
  const handleClick = useCallback(() => {
    if (isPlaceholder || isCurrent) return;
    onSelect(row.traceId);
  }, [isPlaceholder, isCurrent, onSelect, row.traceId]);
  // Visuals for both halves of a turn — user on top, assistant below.
  const userVisuals = useDisplayRoleVisuals("user");
  const assistantVisuals = useDisplayRoleVisuals("assistant");
  const Affordance =
    !isPlaceholder && row.position === "previous"
      ? LuArrowLeft
      : !isPlaceholder && row.position === "next"
        ? LuArrowRight
        : null;
  const statusColor = STATUS_COLORS[row.status] as string;

  if (isPlaceholder) {
    const PlaceholderIcon = row.boundary === "start" ? LuFlag : LuCircleDashed;
    return (
      <Flex
        align="center"
        gap={2.5}
        paddingX={3}
        paddingY={2}
        borderBottomWidth={isLast ? 0 : "1px"}
        borderColor="border.muted"
        opacity={0.55}
        cursor="default"
      >
        <Box width="18px" flexShrink={0} />
        <Icon
          as={PlaceholderIcon}
          boxSize={3.5}
          color="fg.subtle"
          flexShrink={0}
        />
        <Text
          textStyle="xs"
          color="fg.subtle"
          fontStyle="italic"
          truncate
          flex={1}
          minWidth={0}
        >
          {row.assistantText ?? row.userText ?? ""}
        </Text>
      </Flex>
    );
  }

  return (
    <Tooltip
      content={`View the trace of the ${row.position} turn in the conversation`}
      disabled={row.position === "current"}
    >
      <Flex
        as={isCurrent ? "div" : "button"}
        align="stretch"
        gap={2.5}
        paddingX={3}
        paddingY={2}
        bg={isCurrent ? "blue.subtle" : "transparent"}
        borderBottomWidth={isLast ? 0 : "1px"}
        borderColor="border.muted"
        cursor={isCurrent ? "default" : "pointer"}
        onClick={isCurrent ? undefined : handleClick}
        _hover={isCurrent ? undefined : { bg: "bg.muted" }}
        transition="background 0.12s ease"
        textAlign="left"
        width="full"
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
                    backgroundColor: "var(--chakra-colors-blue-subtle)",
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
        <Flex direction="column" align="center" gap={1} paddingTop={0.5}>
          <TraceIdPeek traceId={row.traceId} />
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
        <VStack align="stretch" gap={1.5} flex={1} minWidth={0}>
          <TurnLine
            icon={userVisuals.Icon}
            iconColor="fg"
            text={row.userText}
            emphasised={isCurrent}
            placeholder="(no user message)"
            kind="user"
          />
          <TurnLine
            icon={assistantVisuals.Icon}
            iconColor="blue.fg"
            text={row.assistantText}
            emphasised={isCurrent}
            placeholder="(no assistant response)"
            kind="assistant"
          />
        </VStack>
      </Flex>
    </Tooltip>
  );
});

/**
 * Single line in a turn slot — either user or assistant half. The two
 * lines are visually distinct in three ways so the eye can parse a turn
 * at a glance:
 *
 *   1. The user line keeps the slot's background; the assistant line gets
 *      a subtle `bg.muted` tint that marks it as the reply card within
 *      the turn. One bar, two backgrounds — same idea you'd find in
 *      message threads (quoted reply on a tinted strip).
 *   2. The assistant line is indented and prefixed with a `↳` reply
 *      glyph so the hierarchy reads "this is the response to that".
 *   3. Icon colours differ per role: user = `fg` (full neutral), assistant
 *      = `blue.fg`. The reply text itself stays muted regardless of
 *      whether the slot is current, so the user prompt always reads as
 *      the louder of the two — which matches how people scan a chat
 *      ("what was asked, then what was answered").
 *
 * The `↳` glyph is `aria-hidden` because the user/bot icon already names
 * the role for assistive tech.
 */
const TurnLine: React.FC<{
  icon: React.ElementType;
  iconColor: string;
  text: string | null;
  emphasised: boolean;
  placeholder: string;
  kind: "user" | "assistant";
}> = ({ icon, iconColor, text, emphasised, placeholder, kind }) => {
  const isAssistant = kind === "assistant";
  return (
    <HStack
      gap={1.5}
      align="center"
      paddingY={1}
      paddingX={isAssistant ? 2 : 1}
      paddingLeft={isAssistant ? 5 : 1}
      borderRadius="sm"
      bg={isAssistant ? "bg.muted" : undefined}
      position="relative"
    >
      {isAssistant && (
        <Text
          as="span"
          aria-hidden
          color="fg.subtle"
          textStyle="xs"
          position="absolute"
          left={1.5}
          top="50%"
          transform="translateY(-50%)"
        >
          ↳
        </Text>
      )}
      <Icon as={icon} boxSize={3.5} color={iconColor} flexShrink={0} />
      <Text
        textStyle="xs"
        color={
          text
            ? isAssistant
              ? "fg.muted"
              : emphasised
                ? "fg"
                : "fg.muted"
            : "fg.subtle"
        }
        fontStyle={text ? "normal" : "italic"}
        fontWeight={emphasised && text && !isAssistant ? "medium" : "normal"}
        truncate
        flex={1}
        minWidth={0}
      >
        {text ?? placeholder}
      </Text>
    </HStack>
  );
};
