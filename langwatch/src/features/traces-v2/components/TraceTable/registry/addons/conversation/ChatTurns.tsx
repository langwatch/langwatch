import { Box, Flex, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  Clock,
  Settings2,
  User,
} from "lucide-react";
import type React from "react";
import { useState } from "react";
import { useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import { useOpenTraceDrawer } from "../../../../../hooks/useOpenTraceDrawer";
import type { TraceListItem } from "../../../../../types/trace";
import {
  abbreviateModel,
  formatDuration,
} from "../../../../../utils/formatters";
import { TraceIdPeek } from "../../../../TraceIdPeek";
import { findMessageContent, parseSystemPrompt } from "../../../chatContent";
import type { ConversationGroup } from "../../../conversationGroups";
import { type RowStyle, StatusDot } from "../../../StatusRow";
import { Td, Tr } from "../../../TablePrimitives";
import { Bubble } from "./Bubble";
import { ConversationSummaryLine } from "./ConversationSummary";
import {
  formatGapSeconds,
  TURN_GAP_PAUSE_SECONDS,
  TURN_GAP_VISIBLE_SECONDS,
  turnGapSeconds,
} from "./turnGap";

const SYSTEM_PROMPT_LONG_THRESHOLD = 280;

interface ChatTurnsProps {
  group: ConversationGroup;
  colSpan: number;
  style: RowStyle;
  visibleTurns: TraceListItem[];
  overflow: number;
}

export const ChatTurns: React.FC<ChatTurnsProps> = ({
  group,
  colSpan,
  style,
  visibleTurns,
  overflow,
}) => {
  const systemPrompt = parseSystemPrompt(visibleTurns[0]?.input);

  return (
    <Tr bg="fg/2" borderBottomWidth="1px" borderBottomColor="border.muted">
      <Td
        colSpan={colSpan}
        padding="20px 32px 28px 56px"
        borderLeftWidth="2px"
        borderLeftColor={style.borderColor}
      >
        <VStack align="stretch" gap={4}>
          <ConversationSummaryLine group={group} />
          {systemPrompt && <SystemPromptBanner text={systemPrompt} />}
          <VStack align="stretch" gap={5}>
            {visibleTurns.map((trace, i) => (
              <ChatTurn
                key={trace.traceId}
                trace={trace}
                turnIndex={i}
                prevTrace={i > 0 ? visibleTurns[i - 1] : undefined}
              />
            ))}
          </VStack>
          {overflow > 0 && (
            <Text textStyle="sm" color="fg.subtle" textAlign="center">
              … {overflow} more {overflow === 1 ? "turn" : "turns"}
            </Text>
          )}
        </VStack>
      </Td>
    </Tr>
  );
};

const SystemPromptBanner: React.FC<{ text: string }> = ({ text }) => {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > SYSTEM_PROMPT_LONG_THRESHOLD;
  return (
    <Box
      borderRadius="lg"
      borderWidth="1px"
      borderColor="border.muted"
      bg="bg.subtle"
      overflow="hidden"
    >
      <HStack
        gap={2}
        paddingX={3}
        paddingY={2}
        cursor={isLong ? "pointer" : "default"}
        onClick={isLong ? () => setExpanded((v) => !v) : undefined}
        _hover={isLong ? { bg: "bg.muted" } : undefined}
      >
        <Icon as={Settings2} boxSize="13px" color="fg.muted" />
        <Text
          textStyle="2xs"
          fontWeight="600"
          color="fg.muted"
          textTransform="uppercase"
          letterSpacing="0.06em"
        >
          System
        </Text>
        <Box flex={1} />
        {isLong && (
          <Icon
            as={expanded ? ChevronDown : ChevronRight}
            boxSize="13px"
            color="fg.subtle"
          />
        )}
      </HStack>
      <Box
        paddingX={3}
        paddingBottom={2.5}
        paddingTop={0.5}
        borderTopWidth="1px"
        borderTopColor="border.muted"
      >
        <Text
          textStyle="xs"
          fontFamily="mono"
          color="fg.muted"
          whiteSpace="pre-wrap"
          lineHeight="1.6"
          lineClamp={isLong && !expanded ? 3 : undefined}
        >
          {text}
        </Text>
      </Box>
    </Box>
  );
};

interface ChatTurnProps {
  trace: TraceListItem;
  turnIndex: number;
  prevTrace?: TraceListItem;
}

const ChatTurn: React.FC<ChatTurnProps> = ({ trace, turnIndex, prevTrace }) => {
  const { currentDrawer } = useDrawer();
  const params = useDrawerParams();
  const openTraceDrawer = useOpenTraceDrawer();
  const selectedTraceId =
    currentDrawer === "traceV2Details" ? (params.traceId ?? null) : null;
  const isSelected = selectedTraceId === trace.traceId;

  const gapSeconds = turnGapSeconds({ trace, prevTrace });
  const turnInput = findMessageContent({
    raw: trace.input,
    role: "user",
    pick: "last",
  });

  return (
    <VStack align="stretch" gap={2.5}>
      {gapSeconds > TURN_GAP_VISIBLE_SECONDS && (
        <TurnGap seconds={gapSeconds} />
      )}
      <TurnDivider
        turnIndex={turnIndex}
        trace={trace}
        isSelected={isSelected}
        onOpen={() => openTraceDrawer(trace)}
      />
      {turnInput && (
        <Bubble
          side="left"
          tone="user"
          label="User"
          icon={<User />}
          text={turnInput}
          onClick={() => openTraceDrawer(trace)}
          isSelected={isSelected}
        />
      )}
      <AssistantBubble
        trace={trace}
        isSelected={isSelected}
        onOpen={() => openTraceDrawer(trace)}
      />
    </VStack>
  );
};

const TurnGap: React.FC<{ seconds: number }> = ({ seconds }) => {
  const isPause = seconds > TURN_GAP_PAUSE_SECONDS;
  const color = isPause ? "yellow.fg" : "fg.subtle";
  return (
    <Flex align="center" gap={2} paddingY={1}>
      <Box height="1px" flex={1} bg="border.muted" />
      <HStack gap={1}>
        <Icon boxSize="12px" color={color}>
          <Clock />
        </Icon>
        <Text textStyle="xs" fontFamily="mono" color={color}>
          {formatGapSeconds(seconds)}
          {isPause ? " pause" : ""}
        </Text>
      </HStack>
      <Box height="1px" flex={1} bg="border.muted" />
    </Flex>
  );
};

const TurnDivider: React.FC<{
  turnIndex: number;
  trace: TraceListItem;
  isSelected: boolean;
  onOpen: () => void;
}> = ({ turnIndex, trace, isSelected, onOpen }) => {
  const lineBg = isSelected ? "blue.solid" : "border.muted";
  const labelColor = isSelected ? "blue.fg" : "fg.subtle";
  return (
    <Flex
      align="center"
      gap={2}
      cursor="pointer"
      onClick={onOpen}
      _hover={{ "& > .turn-line": { bg: "border.emphasized" } }}
    >
      <Box
        className="turn-line"
        height="1px"
        flex={1}
        bg={lineBg}
        transition="background 0.12s ease"
      />
      <HStack gap={1.5} flexShrink={0}>
        <Text
          textStyle="2xs"
          color={labelColor}
          fontWeight="600"
          textTransform="uppercase"
          letterSpacing="0.06em"
        >
          Turn {turnIndex + 1}
        </Text>
        {trace.status === "error" && <StatusDot status="error" size="6px" />}
        <Text textStyle="2xs" color="fg.subtle">
          ·
        </Text>
        <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
          {formatDuration(trace.durationMs)}
        </Text>
        <Box marginLeft={1}>
          <TraceIdPeek traceId={trace.traceId} />
        </Box>
      </HStack>
      <Box
        className="turn-line"
        height="1px"
        flex={1}
        bg={lineBg}
        transition="background 0.12s ease"
      />
    </Flex>
  );
};

const AssistantBubble: React.FC<{
  trace: TraceListItem;
  isSelected: boolean;
  onOpen: () => void;
}> = ({ trace, isSelected, onOpen }) => {
  if (trace.output) {
    const label = trace.models[0]
      ? abbreviateModel(trace.models[0])
      : "Assistant";
    return (
      <Bubble
        side="right"
        tone="assistant"
        label={label}
        icon={<Bot />}
        text={trace.output}
        onClick={onOpen}
        isSelected={isSelected}
      />
    );
  }
  if (trace.error) {
    return (
      <Bubble
        side="right"
        tone="error"
        label="Error"
        icon={<AlertTriangle />}
        text={trace.error}
        onClick={onOpen}
        isSelected={isSelected}
      />
    );
  }
  return null;
};
