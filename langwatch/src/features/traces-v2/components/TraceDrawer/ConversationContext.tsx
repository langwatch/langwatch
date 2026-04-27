import { Box, Circle, Flex, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import {
  LuArrowLeft,
  LuArrowRight,
  LuBot,
  LuMessageCircle,
  LuUser,
} from "react-icons/lu";
import { useThreadContext, type ThreadTurn } from "../../hooks/useThreadContext";
import { useTraceDrawerNavigation } from "../../hooks/useTraceDrawerNavigation";
import { useDrawerStore } from "../../stores/drawerStore";
import { STATUS_COLORS } from "../../utils/formatters";

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
  return flat.length <= MAX_PREVIEW ? flat : `${flat.slice(0, MAX_PREVIEW - 1)}…`;
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
    const text = previous.input ?? previous.output ?? "";
    if (text) {
      rows.push({
        key: `prev-${previous.traceId}`,
        traceId: previous.traceId,
        role: previous.input ? "user" : "assistant",
        text: `"${truncate(text)}"`,
        position: "previous",
        status: previous.status,
      });
    }
  }
  if (current) {
    const text = current.output ?? current.input ?? "";
    if (text) {
      rows.push({
        key: `curr-${current.traceId}`,
        traceId: current.traceId,
        role: current.output ? "assistant" : "user",
        text: `"${truncate(text)}"`,
        position: "current",
        status: current.status,
      });
    }
  }
  if (next) {
    const text = next.input ?? next.output ?? "";
    if (text) {
      rows.push({
        key: `next-${next.traceId}`,
        traceId: next.traceId,
        role: next.input ? "user" : "assistant",
        text: `"${truncate(text)}"`,
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
    navigateToTrace({
      fromTraceId: traceId,
      fromViewMode: viewMode,
      toTraceId: id,
    });
  };

  return (
    <Box
      paddingX={4}
      paddingY={3}
      bg="bg.subtle"
      borderBottomWidth="1px"
      borderColor="border.muted"
    >
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
        <Box
          paddingY={3}
          paddingX={3}
          borderRadius="md"
          borderWidth="1px"
          borderColor="border.muted"
          bg="bg.panel"
        >
          <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
            Resolving thread…
          </Text>
        </Box>
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
  const RoleIcon = row.role === "user" ? LuUser : LuBot;
  const Affordance =
    row.position === "previous"
      ? LuArrowLeft
      : row.position === "next"
        ? LuArrowRight
        : null;
  const statusColor = STATUS_COLORS[row.status] as string;

  return (
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
      _hover={
        isCurrent
          ? undefined
          : { bg: "bg.muted" }
      }
      transition="background 0.12s ease"
      textAlign="left"
      width="full"
    >
      <Icon
        as={RoleIcon}
        boxSize={3.5}
        color={row.role === "assistant" ? "blue.fg" : "fg.muted"}
        flexShrink={0}
      />
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
        <Icon as={Affordance} boxSize={3.5} color="fg.subtle" flexShrink={0} />
      ) : null}
    </Flex>
  );
}
