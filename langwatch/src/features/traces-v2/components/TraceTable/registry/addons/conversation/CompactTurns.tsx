import { Badge, Box, Circle, HStack, Icon, Text } from "@chakra-ui/react";
import { AlertTriangle, Bot, Clock, GitBranch, User, Zap } from "lucide-react";
import type React from "react";
import { useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import type { DensityTokens } from "../../../../../hooks/useDensityTokens";
import { useOpenTraceDrawer } from "../../../../../hooks/useOpenTraceDrawer";
import type { TraceListItem } from "../../../../../types/trace";
import {
  abbreviateModel,
  formatDuration,
} from "../../../../../utils/formatters";
import { TraceIdPeek } from "../../../../TraceIdPeek";
import { truncateText } from "../../../chatContent";
import type { ConversationGroup } from "../../../conversationGroups";
import { MonoCell } from "../../../MonoCell";
import {
  ROW_STYLES,
  type RowStyle,
  rowVariantFor,
  StatusDot,
} from "../../../StatusRow";
import { Td, Tr } from "../../../TablePrimitives";
import { ConversationSummaryDetail } from "./ConversationSummary";
import {
  formatGapSeconds,
  TURN_GAP_PAUSE_SECONDS,
  TURN_GAP_VISIBLE_SECONDS,
  turnGapSeconds,
} from "./turnGap";

const TEXT_TRUNCATE_LENGTH = 80;
const ERROR_TRUNCATE_LENGTH = 60;

interface CompactTurnsProps {
  group: ConversationGroup;
  colSpan: number;
  style: RowStyle;
  density: DensityTokens;
  visibleTurns: TraceListItem[];
  overflow: number;
}

export const CompactTurns: React.FC<CompactTurnsProps> = ({
  group,
  colSpan,
  style,
  density,
  visibleTurns,
  overflow,
}) => (
  <>
    <SummaryRow group={group} style={style} colSpan={colSpan} />
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

const SummaryRow: React.FC<{
  group: ConversationGroup;
  style: RowStyle;
  colSpan: number;
}> = ({ group, style, colSpan }) => (
  <Tr bg="fg/2" borderBottomWidth="1px" borderBottomColor="border.muted">
    <Td
      colSpan={colSpan}
      padding="4px 8px 4px 40px"
      borderLeftWidth="2px"
      borderLeftColor={style.borderColor}
    >
      <ConversationSummaryDetail group={group} />
    </Td>
  </Tr>
);

interface ConversationTurnRowProps {
  trace: TraceListItem;
  prevTrace?: TraceListItem;
  turnIndex: number;
  colCount: number;
  primaryModel: string;
  density: DensityTokens;
}

const ConversationTurnRow: React.FC<ConversationTurnRowProps> = ({
  trace,
  prevTrace,
  turnIndex,
  colCount,
  primaryModel,
  density,
}) => {
  const { currentDrawer } = useDrawer();
  const params = useDrawerParams();
  const openTraceDrawer = useOpenTraceDrawer();
  const selectedTraceId =
    currentDrawer === "traceV2Details" ? (params.traceId ?? null) : null;
  const isSelected = selectedTraceId === trace.traceId;
  const variant = rowVariantFor({ isSelected, status: trace.status });
  const style = ROW_STYLES[variant];
  const turnBg = isSelected ? style.bg : "fg/2";

  const gapSeconds = turnGapSeconds({ trace, prevTrace });
  const turnModel = trace.models[0] ?? "";
  const showModel = turnModel && turnModel !== primaryModel;

  return (
    <>
      {gapSeconds > TURN_GAP_VISIBLE_SECONDS && (
        <GapRow
          seconds={gapSeconds}
          colCount={colCount}
          borderColor={style.borderColor}
        />
      )}
      <Tr
        bg={turnBg}
        borderBottomWidth="1px"
        borderBottomColor="border.muted"
        transition="none"
        _hover={{ bg: style.hoverBg }}
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
          borderLeftColor={style.borderColor}
        >
          <HStack gap={2} textStyle="xs">
            <TraceIdPeek traceId={trace.traceId} />
            <Badge size="xs" variant="outline" fontFamily="mono" flexShrink={0}>
              T{turnIndex + 1}
            </Badge>
            {trace.status === "error" && (
              <StatusDot status="error" size="6px" />
            )}
            {trace.input && (
              <InlineMessage
                icon={<User />}
                iconColor="blue.fg"
                textColor="fg.muted"
                text={trace.input}
                limit={TEXT_TRUNCATE_LENGTH}
              />
            )}
            {trace.output ? (
              <InlineMessage
                icon={<Bot />}
                iconColor="green.fg"
                textColor="fg.subtle"
                text={trace.output}
                limit={TEXT_TRUNCATE_LENGTH}
              />
            ) : trace.error ? (
              <InlineMessage
                icon={<AlertTriangle />}
                iconColor="red.fg"
                textColor="red.fg"
                text={trace.error}
                limit={ERROR_TRUNCATE_LENGTH}
                textStyleOverride="xs"
              />
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
              <CountChip
                icon={<GitBranch />}
                iconColor="fg.subtle"
                value={trace.spanCount}
              />
            )}
            {trace.events.length > 0 && (
              <CountChip
                icon={<Zap />}
                iconColor="orange.fg"
                value={trace.events.length}
              />
            )}
            {trace.evaluations.length > 0 && (
              <EvaluationChip evaluations={trace.evaluations} />
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

const GapRow: React.FC<{
  seconds: number;
  colCount: number;
  borderColor: RowStyle["borderColor"];
}> = ({ seconds, colCount, borderColor }) => {
  const isPause = seconds > TURN_GAP_PAUSE_SECONDS;
  const color = isPause ? "yellow.fg" : "fg.subtle";
  return (
    <Tr bg="fg/2">
      <Td
        colSpan={colCount}
        padding="0 8px 0 40px"
        borderLeftWidth="2px"
        borderLeftColor={borderColor}
      >
        <HStack gap={1} justifyContent="center" paddingY={0.5}>
          <Box height="1px" flex={1} bg="border.muted" />
          <HStack gap={1}>
            <Icon boxSize="10px" color={color}>
              <Clock />
            </Icon>
            <Text color={color} textStyle="2xs" fontFamily="mono">
              {formatGapSeconds(seconds)}
              {isPause ? " pause" : ""}
            </Text>
          </HStack>
          <Box height="1px" flex={1} bg="border.muted" />
        </HStack>
      </Td>
    </Tr>
  );
};

const InlineMessage: React.FC<{
  icon: React.ReactNode;
  iconColor: string;
  textColor: string;
  text: string;
  limit: number;
  textStyleOverride?: "xs";
}> = ({ icon, iconColor, textColor, text, limit, textStyleOverride }) => (
  <HStack gap={1} overflow="hidden" flexShrink={1} minWidth={0}>
    <Icon boxSize="12px" color={iconColor} flexShrink={0}>
      {icon}
    </Icon>
    <Text color={textColor} truncate textStyle={textStyleOverride}>
      {truncateText({ text, limit })}
    </Text>
  </HStack>
);

const CountChip: React.FC<{
  icon: React.ReactNode;
  iconColor: string;
  value: number;
}> = ({ icon, iconColor, value }) => (
  <HStack gap={0.5} flexShrink={0}>
    <Icon boxSize="10px" color={iconColor}>
      {icon}
    </Icon>
    <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
      {value}
    </Text>
  </HStack>
);

const EvaluationChip: React.FC<{
  evaluations: TraceListItem["evaluations"];
}> = ({ evaluations }) => {
  const passed = evaluations.filter((e) => e.passed === true).length;
  const failed = evaluations.some((e) => e.passed === false);
  return (
    <HStack gap={0.5} flexShrink={0}>
      <Circle size="6px" bg={failed ? "red.solid" : "green.solid"} />
      <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
        {passed}/{evaluations.length}
      </Text>
    </HStack>
  );
};
