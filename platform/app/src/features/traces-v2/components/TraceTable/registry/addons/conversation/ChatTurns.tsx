import {
  Box,
  Button,
  Flex,
  HStack,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import { AlertTriangle, Bot, Clock, User } from "lucide-react";
import type React from "react";
import { useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import { useOpenTraceDrawer } from "../../../../../hooks/useOpenTraceDrawer";
import type { TraceListItem } from "../../../../../types/trace";
import {
  abbreviateModel,
  formatDuration,
} from "../../../../../utils/formatters";
import { SystemPromptBanner } from "../../../../TraceDrawer/conversationView/SystemPromptBanner";
import { TraceIdPeek } from "../../../../TraceIdPeek";
import { findMessageContent, parseSystemPrompt } from "../../../chatContent";
import type { ConversationGroup } from "../../../conversationGroups";
import { type RowStyle, StatusDot } from "../../../StatusRow";
import { Td, Tr } from "../../../TablePrimitives";
import { Bubble } from "./Bubble";
import { ConversationSummaryLine } from "./ConversationSummary";
import { EXPANDED_BG_CSS } from "./expandedTurnStyles";
import {
  formatGapSeconds,
  TURN_GAP_PAUSE_SECONDS,
  TURN_GAP_VISIBLE_SECONDS,
  turnGapSeconds,
} from "./turnGap";
import { SHOW_MORE_STEP, useTurnsWindow } from "./turnsWindow";

interface ChatTurnsProps {
  group: ConversationGroup;
  colSpan: number;
  style: RowStyle;
}

export const ChatTurns: React.FC<ChatTurnsProps> = ({
  group,
  colSpan,
  style,
}) => {
  const systemPrompt = parseSystemPrompt(group.traces[0]?.input);
  const { head, tail, hiddenCount, showMore, showAll, canShowMore } =
    useTurnsWindow(group.traces);
  const nextStep = Math.min(SHOW_MORE_STEP, hiddenCount);

  return (
    <Tr borderBottomWidth="1px" borderBottomColor="border.muted">
      <Td
        colSpan={colSpan}
        style={{ backgroundColor: EXPANDED_BG_CSS }}
        padding="20px 32px 28px 56px"
        borderLeftWidth="2px"
        borderLeftColor={style.borderColor}
      >
        <VStack align="stretch" gap={4}>
          <ConversationSummaryLine group={group} />
          {systemPrompt && <SystemPromptBanner text={systemPrompt} />}
          <VStack align="stretch" gap={5}>
            {head.map((trace, i) => (
              <ChatTurn
                key={trace.traceId}
                trace={trace}
                turnIndex={i}
                prevTrace={i > 0 ? head[i - 1] : undefined}
              />
            ))}
            {canShowMore && (
              <HStack justify="center" gap={2} paddingY={1}>
                <Box height="1px" flex={1} bg="border.muted" />
                <Text textStyle="sm" color="fg.subtle" flexShrink={0}>
                  … {hiddenCount} more {hiddenCount === 1 ? "turn" : "turns"}
                </Text>
                <Button
                  size="xs"
                  variant="ghost"
                  color="blue.fg"
                  onClick={showMore}
                >
                  Show {nextStep} more
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  color="fg.muted"
                  onClick={showAll}
                >
                  Show all
                </Button>
                <Box height="1px" flex={1} bg="border.muted" />
              </HStack>
            )}
            {tail && (
              <ChatTurn
                trace={tail}
                turnIndex={group.traces.length - 1}
                prevTrace={undefined}
              />
            )}
          </VStack>
        </VStack>
      </Td>
    </Tr>
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
        <Text textStyle="xs" color={color}>
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
        <Text textStyle="2xs" color="fg.subtle">
          {formatDuration(trace.durationMs)}
        </Text>
        <Box marginLeft={1}>
          <TraceIdPeek traceId={trace.traceId} occurredAtMs={trace.timestamp} />
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
