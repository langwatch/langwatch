import {
  Badge,
  Box,
  Circle,
  Flex,
  HStack,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  Clock,
  GitBranch,
  Settings2,
  User,
  Zap,
} from "lucide-react";
import type React from "react";
import { useState } from "react";
import { useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import type { DensityTokens } from "../../../../../hooks/useDensityTokens";
import { useOpenTraceDrawer } from "../../../../../hooks/useOpenTraceDrawer";
import type { Density } from "../../../../../stores/uiStore";
import type { TraceListItem } from "../../../../../types/trace";
import {
  abbreviateModel,
  formatCost,
  formatDuration,
  formatTokens,
  formatWallClock,
} from "../../../../../utils/formatters";
import { TraceIdPeek } from "../../../../TraceIdPeek";
import { MonoCell } from "../../../MonoCell";
import { ROW_STYLES, type RowStyle, StatusDot } from "../../../StatusRow";
import { Td, Tr } from "../../../TablePrimitives";
import type { ConversationGroup } from "../../../conversationGroups";
import type { AddonDef } from "../../types";
import { Bubble } from "./Bubble";

const MAX_VISIBLE_TURNS = 7;

export const ConversationTurnsAddon: AddonDef<ConversationGroup> = {
  id: "conversation-turns",
  label: "Conversation turns",
  shouldRender: ({ isExpanded }) => isExpanded,
  render: ({ row, colSpan, style, density, densityMode }) =>
    densityMode === "comfortable" ? (
      <ChatTurns group={row} colSpan={colSpan} style={style} />
    ) : (
      <CompactTurns
        group={row}
        colSpan={colSpan}
        style={style}
        density={density}
      />
    ),
};

// ---------------------------------------------------------------------------
// Comfortable: chat-bubble dialogue
// ---------------------------------------------------------------------------

const ChatTurns: React.FC<{
  group: ConversationGroup;
  colSpan: number;
  style: RowStyle;
}> = ({ group, colSpan, style }) => {
  const visibleTurns = group.traces.slice(0, MAX_VISIBLE_TURNS);
  const overflow = group.traces.length - MAX_VISIBLE_TURNS;
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
  const isLong = text.length > 280;
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

const ChatTurn: React.FC<{
  trace: TraceListItem;
  turnIndex: number;
  prevTrace?: TraceListItem;
}> = ({ trace, turnIndex, prevTrace }) => {
  const { currentDrawer } = useDrawer();
  const params = useDrawerParams();
  const openTraceDrawer = useOpenTraceDrawer();
  const selectedTraceId =
    currentDrawer === "traceV2Details" ? (params.traceId ?? null) : null;
  const isSelected = selectedTraceId === trace.traceId;

  const gap = prevTrace
    ? (trace.timestamp - (prevTrace.timestamp + prevTrace.durationMs)) / 1000
    : 0;
  const showGap = gap > 2;
  const turnInput = parseLastUserText(trace.input);

  return (
    <VStack align="stretch" gap={2.5}>
      {showGap && (
        <Flex align="center" gap={2} paddingY={1}>
          <Box height="1px" flex={1} bg="border.muted" />
          <HStack gap={1}>
            <Icon boxSize="12px" color={gap > 30 ? "yellow.fg" : "fg.subtle"}>
              <Clock />
            </Icon>
            <Text
              textStyle="xs"
              fontFamily="mono"
              color={gap > 30 ? "yellow.fg" : "fg.subtle"}
            >
              {gap >= 60
                ? `${Math.floor(gap / 60)}m ${Math.floor(gap % 60)}s`
                : `${gap.toFixed(1)}s`}
              {gap > 30 ? " pause" : ""}
            </Text>
          </HStack>
          <Box height="1px" flex={1} bg="border.muted" />
        </Flex>
      )}

      <Flex
        align="center"
        gap={2}
        cursor="pointer"
        onClick={() => openTraceDrawer(trace)}
        _hover={{ "& > .turn-line": { bg: "border.emphasized" } }}
      >
        <Box
          className="turn-line"
          height="1px"
          flex={1}
          bg={isSelected ? "blue.solid" : "border.muted"}
          transition="background 0.12s ease"
        />
        <HStack gap={1.5} flexShrink={0}>
          <Text
            textStyle="2xs"
            color={isSelected ? "blue.fg" : "fg.subtle"}
            fontWeight="600"
            textTransform="uppercase"
            letterSpacing="0.06em"
          >
            Turn {turnIndex + 1}
          </Text>
          {trace.status === "error" && <StatusDot status="error" size="6px" />}
          <Text textStyle="2xs" color="fg.subtle">·</Text>
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
          bg={isSelected ? "blue.solid" : "border.muted"}
          transition="background 0.12s ease"
        />
      </Flex>

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

      {trace.output ? (
        <Bubble
          side="right"
          tone="assistant"
          label={
            trace.models[0] ? abbreviateModel(trace.models[0]) : "Assistant"
          }
          icon={<Bot />}
          text={trace.output}
          onClick={() => openTraceDrawer(trace)}
          isSelected={isSelected}
        />
      ) : trace.error ? (
        <Bubble
          side="right"
          tone="error"
          label="Error"
          icon={<AlertTriangle />}
          text={trace.error}
          onClick={() => openTraceDrawer(trace)}
          isSelected={isSelected}
        />
      ) : null}
    </VStack>
  );
};

function parseSystemPrompt(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const sys = parsed.find(
        (m) => m && typeof m === "object" && m.role === "system",
      );
      if (sys) return contentToString(sys.content);
    }
  } catch {
    // not JSON
  }
  return "";
}

function parseLastUserText(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const lastUser = [...parsed]
        .reverse()
        .find((m) => m && typeof m === "object" && m.role === "user");
      if (lastUser) return contentToString(lastUser.content);
    }
    if (typeof parsed === "object" && parsed !== null) {
      return JSON.stringify(parsed);
    }
  } catch {
    // not JSON
  }
  return raw;
}

function contentToString(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (
          part &&
          typeof part === "object" &&
          typeof (part as { text?: unknown }).text === "string"
        ) {
          return (part as { text: string }).text;
        }
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return JSON.stringify(content);
}


// ---------------------------------------------------------------------------
// Compact: original dense list (unchanged)
// ---------------------------------------------------------------------------

const CompactTurns: React.FC<{
  group: ConversationGroup;
  colSpan: number;
  style: RowStyle;
  density: DensityTokens;
}> = ({ group, colSpan, style, density }) => {
  const visibleTurns = group.traces.slice(0, MAX_VISIBLE_TURNS);
  const overflow = group.traces.length - MAX_VISIBLE_TURNS;

  return (
    <>
      <ConversationSummaryRow group={group} style={style} colSpan={colSpan} />
      {visibleTurns.map((trace, i) => (
        <ConversationTurnRow
          key={trace.traceId}
          trace={trace}
          prevTrace={i > 0 ? visibleTurns[i - 1] : undefined}
          turnIndex={i}
          colCount={colSpan}
          primaryModel={group.primaryModel}
          density={density}
        />
      ))}
      {overflow > 0 && (
        <Tr bg="fg/2" borderBottomWidth="1px" borderBottomColor="border.muted">
          <Td
            colSpan={colSpan}
            padding="6px 8px 6px 40px"
            borderLeftWidth="2px"
            borderLeftColor={style.borderColor}
          >
            <Text textStyle="xs" color="fg.subtle">
              ... {overflow} more turns
            </Text>
          </Td>
        </Tr>
      )}
    </>
  );
};

const ConversationSummaryLine: React.FC<{ group: ConversationGroup }> = ({
  group,
}) => {
  const lastTrace = group.traces[group.traces.length - 1]!;
  const endTime = group.latestTimestamp + lastTrace.durationMs;
  return (
    <HStack
      gap={3}
      flexWrap="wrap"
      textStyle="xs"
      color="fg.subtle"
      fontFamily="mono"
    >
      <Text>{group.traces.length} turns</Text>
      <Text>·</Text>
      <Text>{formatWallClock(group.earliestTimestamp, endTime)}</Text>
      {group.primaryModel && (
        <>
          <Text>·</Text>
          <Text>{abbreviateModel(group.primaryModel)}</Text>
        </>
      )}
      {group.totalCost > 0 && (
        <>
          <Text>·</Text>
          <Text>{formatCost(group.totalCost)}</Text>
        </>
      )}
      {group.totalTokens > 0 && (
        <>
          <Text>·</Text>
          <Text>{formatTokens(group.totalTokens)} tok</Text>
        </>
      )}
      {group.errorCount > 0 && (
        <>
          <Text>·</Text>
          <HStack gap={1}>
            <Icon boxSize="10px" color="red.fg">
              <AlertTriangle />
            </Icon>
            <Text color="red.fg">
              {group.errorCount} {group.errorCount === 1 ? "error" : "errors"}
            </Text>
          </HStack>
        </>
      )}
    </HStack>
  );
};

const ConversationSummaryRow: React.FC<{
  group: ConversationGroup;
  style: RowStyle;
  colSpan: number;
}> = ({ group, style, colSpan }) => {
  const lastTrace = group.traces[group.traces.length - 1]!;
  const endTime = group.latestTimestamp + lastTrace.durationMs;

  return (
    <Tr bg="fg/2" borderBottomWidth="1px" borderBottomColor="border.muted">
      <Td
        colSpan={colSpan}
        padding="4px 8px 4px 40px"
        borderLeftWidth="2px"
        borderLeftColor={style.borderColor}
      >
        <HStack gap={3} textStyle="xs" color="fg.subtle">
          <Text>{group.traces.length} turns</Text>
          <Text>·</Text>
          <Text>{formatWallClock(group.earliestTimestamp, endTime)}</Text>
          {group.primaryModel && (
            <>
              <Text>·</Text>
              <Text>{abbreviateModel(group.primaryModel)}</Text>
            </>
          )}
          {group.totalSpans > 0 && (
            <>
              <Text>·</Text>
              <HStack gap={1}>
                <Icon boxSize="10px">
                  <GitBranch />
                </Icon>
                <Text>{group.totalSpans} spans</Text>
              </HStack>
            </>
          )}
          {group.totalCost > 0 && (
            <>
              <Text>·</Text>
              <Text>{formatCost(group.totalCost)}</Text>
            </>
          )}
          {group.totalTokens > 0 && (
            <>
              <Text>·</Text>
              <Text>{formatTokens(group.totalTokens)} tok</Text>
            </>
          )}
          {group.errorCount > 0 && (
            <>
              <Text>·</Text>
              <HStack gap={1}>
                <Icon boxSize="10px" color="red.fg">
                  <AlertTriangle />
                </Icon>
                <Text color="red.fg">
                  {group.errorCount}{" "}
                  {group.errorCount === 1 ? "error" : "errors"}
                </Text>
              </HStack>
            </>
          )}
          {group.totalEvents > 0 && (
            <>
              <Text>·</Text>
              <HStack gap={1}>
                <Icon boxSize="10px" color="orange.fg">
                  <Zap />
                </Icon>
                <Text>
                  {group.totalEvents}{" "}
                  {group.totalEvents === 1 ? "event" : "events"}
                </Text>
              </HStack>
            </>
          )}
          {group.totalEvals > 0 && (
            <>
              <Text>·</Text>
              <HStack gap={1}>
                <Circle
                  size="6px"
                  bg={group.evalsFailedCount > 0 ? "red.solid" : "green.solid"}
                />
                <Text>
                  {group.evalsPassedCount}/{group.totalEvals} evals
                </Text>
              </HStack>
            </>
          )}
          {group.serviceName && (
            <>
              <Text>·</Text>
              <Text>{group.serviceName}</Text>
            </>
          )}
        </HStack>
      </Td>
    </Tr>
  );
};

const ConversationTurnRow: React.FC<{
  trace: TraceListItem;
  prevTrace?: TraceListItem;
  turnIndex: number;
  colCount: number;
  primaryModel: string;
  density: DensityTokens;
}> = ({ trace, prevTrace, turnIndex, colCount, primaryModel, density }) => {
  const { currentDrawer } = useDrawer();
  const params = useDrawerParams();
  const openTraceDrawer = useOpenTraceDrawer();
  const selectedTraceId =
    currentDrawer === "traceV2Details" ? (params.traceId ?? null) : null;
  const isSelected = selectedTraceId === trace.traceId;
  const turnVariant = isSelected
    ? "selected"
    : trace.status === "error"
      ? "error"
      : trace.status === "warning"
        ? "warning"
        : "default";
  const turnStyle = ROW_STYLES[turnVariant];
  const turnBg = isSelected ? turnStyle.bg : "fg/2";

  const gap = prevTrace
    ? (trace.timestamp - (prevTrace.timestamp + prevTrace.durationMs)) / 1000
    : 0;

  const turnModel = trace.models[0] ?? "";
  const showModel = turnModel && turnModel !== primaryModel;

  return (
    <>
      {gap > 2 && (
        <Tr bg="fg/2">
          <Td
            colSpan={colCount}
            padding="0 8px 0 40px"
            borderLeftWidth="2px"
            borderLeftColor={turnStyle.borderColor}
          >
            <HStack gap={1} justifyContent="center" paddingY={0.5}>
              <Box height="1px" flex={1} bg="border.muted" />
              <HStack gap={1}>
                <Icon
                  boxSize="10px"
                  color={gap > 30 ? "yellow.fg" : "fg.subtle"}
                >
                  <Clock />
                </Icon>
                <Text
                  color={gap > 30 ? "yellow.fg" : "fg.subtle"}
                  textStyle="2xs"
                  fontFamily="mono"
                >
                  {gap >= 60
                    ? `${Math.floor(gap / 60)}m ${Math.floor(gap % 60)}s`
                    : `${gap.toFixed(1)}s`}
                  {gap > 30 ? " pause" : ""}
                </Text>
              </HStack>
              <Box height="1px" flex={1} bg="border.muted" />
            </HStack>
          </Td>
        </Tr>
      )}
      <Tr
        bg={turnBg}
        borderBottomWidth="1px"
        borderBottomColor="border.muted"
        transition="none"
        _hover={{ bg: turnStyle.hoverBg }}
        cursor="pointer"
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          openTraceDrawer(trace);
        }}
      >
        <Td
          colSpan={colCount - 1}
          padding={`${density.rowPaddingY} 8px ${density.rowPaddingY} 40px`}
          borderLeftWidth="2px"
          borderLeftColor={turnStyle.borderColor}
        >
          <HStack gap={2} textStyle="sm">
            <TraceIdPeek traceId={trace.traceId} />
            <Badge size="xs" variant="outline" fontFamily="mono" flexShrink={0}>
              T{turnIndex + 1}
            </Badge>
            {trace.status === "error" && <StatusDot status="error" size="6px" />}
            {trace.input && (
              <HStack gap={1} overflow="hidden" flexShrink={1} minWidth={0}>
                <Icon boxSize="12px" color="blue.fg" flexShrink={0}>
                  <User />
                </Icon>
                <Text color="fg.muted" truncate>
                  {trace.input.slice(0, 80)}
                  {trace.input.length > 80 ? "…" : ""}
                </Text>
              </HStack>
            )}
            {trace.output ? (
              <HStack gap={1} overflow="hidden" flexShrink={1} minWidth={0}>
                <Icon boxSize="12px" color="green.fg" flexShrink={0}>
                  <Bot />
                </Icon>
                <Text color="fg.subtle" truncate>
                  {trace.output.slice(0, 80)}
                  {trace.output.length > 80 ? "…" : ""}
                </Text>
              </HStack>
            ) : trace.error ? (
              <HStack gap={1} overflow="hidden" flexShrink={1} minWidth={0}>
                <Icon boxSize="12px" color="red.fg" flexShrink={0}>
                  <AlertTriangle />
                </Icon>
                <Text color="red.fg" truncate textStyle="xs">
                  {trace.error.slice(0, 60)}
                  {trace.error.length > 60 ? "…" : ""}
                </Text>
              </HStack>
            ) : null}
            {showModel && (
              <Text
                textStyle="2xs"
                color="fg.subtle"
                fontFamily="mono"
                flexShrink={0}
              >
                {abbreviateModel(turnModel)}
              </Text>
            )}
            {trace.spanCount > 1 && (
              <HStack gap={0.5} flexShrink={0}>
                <Icon boxSize="10px" color="fg.subtle">
                  <GitBranch />
                </Icon>
                <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
                  {trace.spanCount}
                </Text>
              </HStack>
            )}
            {trace.events.length > 0 && (
              <HStack gap={0.5} flexShrink={0}>
                <Icon boxSize="10px" color="orange.fg">
                  <Zap />
                </Icon>
                <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
                  {trace.events.length}
                </Text>
              </HStack>
            )}
            {trace.evaluations.length > 0 && (
              <HStack gap={0.5} flexShrink={0}>
                <Circle
                  size="6px"
                  bg={
                    trace.evaluations.some((e) => e.passed === false)
                      ? "red.solid"
                      : "green.solid"
                  }
                />
                <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
                  {trace.evaluations.filter((e) => e.passed === true).length}/
                  {trace.evaluations.length}
                </Text>
              </HStack>
            )}
          </HStack>
        </Td>
        <Td padding={`${density.rowPaddingY} 8px`} textAlign="right">
          <MonoCell>{formatDuration(trace.durationMs)}</MonoCell>
        </Td>
      </Tr>
    </>
  );
};
