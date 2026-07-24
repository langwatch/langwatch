import {
  Badge,
  Box,
  Button,
  Circle,
  HStack,
  Icon,
  Text,
} from "@chakra-ui/react";
import type { Cell } from "@tanstack/react-table";
import { AlertTriangle, Bot, Clock, GitBranch, User, Zap } from "lucide-react";
import type React from "react";
import type { ReactNode } from "react";
import { useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import type { DensityTokens } from "../../../../../hooks/useDensityTokens";
import { useOpenTraceDrawer } from "../../../../../hooks/useOpenTraceDrawer";
import { useTimeFormatStore } from "../../../../../stores/timeFormatStore";
import type { TraceListItem } from "../../../../../types/trace";
import {
  abbreviateModel,
  formatCost,
  formatDuration,
  formatISOTimestamp,
  formatTokens,
} from "../../../../../utils/formatters";
import { useRelativeTime } from "../../../../../utils/useRelativeTime";
import { TraceIdPeek } from "../../../../TraceIdPeek";
import { truncateText } from "../../../chatContent";
import type { ConversationGroup } from "../../../conversationGroups";
import { MonoCell } from "../../../MonoCell";
import {
  ROW_STYLES,
  type RowStyle,
  rowVariantFor,
  StatusDot,
  StatusIndicator,
} from "../../../StatusRow";
import { Td, Tr } from "../../../TablePrimitives";
import { cellPropsFor } from "../../../TraceTableShell";
import { dash } from "../../cells/dashPlaceholder";
import { SELECT_COLUMN_ID } from "../../cells/SelectCells";
import { ConversationSummaryDetail } from "./ConversationSummary";
import { EXPANDED_BG, EXPANDED_BG_CSS } from "./expandedTurnStyles";
import {
  formatGapSeconds,
  TURN_GAP_PAUSE_SECONDS,
  TURN_GAP_VISIBLE_SECONDS,
  turnGapSeconds,
} from "./turnGap";
import { SHOW_MORE_STEP, useTurnsWindow } from "./turnsWindow";

const TEXT_TRUNCATE_LENGTH = 80;
const ERROR_TRUNCATE_LENGTH = 60;

interface CompactTurnsProps {
  group: ConversationGroup;
  colSpan: number;
  style: RowStyle;
  density: DensityTokens;
  /** Visible cells of the conversation row, used to align turn cells under
   *  the same columns the group header shows. */
  cells: Array<Cell<ConversationGroup, unknown>>;
}

export const CompactTurns: React.FC<CompactTurnsProps> = ({
  group,
  colSpan,
  style,
  density,
  cells,
}) => {
  const { head, tail, hiddenCount, showMore, showAll, canShowMore } =
    useTurnsWindow(group.traces);

  return (
    <>
      <SummaryRow group={group} style={style} colSpan={colSpan} />
      {head.map((trace, i) => (
        <ConversationTurnRow
          key={trace.traceId}
          trace={trace}
          prevTrace={i > 0 ? head[i - 1] : undefined}
          turnIndex={i}
          cells={cells}
          railColor={style.borderColor}
          density={density}
        />
      ))}
      {canShowMore && (
        <ShowMoreRow
          hiddenCount={hiddenCount}
          colSpan={colSpan}
          borderColor={style.borderColor}
          onShowMore={showMore}
          onShowAll={showAll}
        />
      )}
      {tail && (
        <ConversationTurnRow
          // No prevTrace — turns were skipped, so a gap line would lie.
          trace={tail}
          turnIndex={group.traces.length - 1}
          cells={cells}
          railColor={style.borderColor}
          density={density}
        />
      )}
    </>
  );
};

const SummaryRow: React.FC<{
  group: ConversationGroup;
  style: RowStyle;
  colSpan: number;
}> = ({ group, style, colSpan }) => (
  <Tr borderBottomWidth="1px" borderBottomColor="border.muted">
    <Td
      colSpan={colSpan}
      style={{ backgroundColor: EXPANDED_BG_CSS }}
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
  cells: Array<Cell<ConversationGroup, unknown>>;
  railColor: RowStyle["borderColor"];
  density: DensityTokens;
}

const ConversationTurnRow: React.FC<ConversationTurnRowProps> = ({
  trace,
  prevTrace,
  turnIndex,
  cells,
  railColor,
  density,
}) => {
  const { currentDrawer } = useDrawer();
  const params = useDrawerParams();
  const openTraceDrawer = useOpenTraceDrawer();
  const selectedTraceId =
    currentDrawer === "traceV2Details" ? (params.traceId ?? null) : null;
  const isSelected = selectedTraceId === trace.traceId;
  const variant = rowVariantFor({ isSelected, status: trace.status });
  const rowStyle = ROW_STYLES[variant];
  // Selected turn lifts to the blue surface; every other turn shares the
  // block's recessed surface. The sticky first cell gets the raw CSS var so
  // it matches the rest of the row instead of seaming to the shell-forced
  // bg.surface.
  const rowBg = isSelected ? "blue.subtle" : EXPANDED_BG;
  const firstCellBg = isSelected
    ? "var(--chakra-colors-blue-subtle)"
    : EXPANDED_BG_CSS;

  const gapSeconds = turnGapSeconds({ trace, prevTrace });
  // The selected/error turn paints its own rail segment so selection and
  // error state read on the turn; otherwise it inherits the group's rail.
  const borderColor = variant === "default" ? railColor : rowStyle.borderColor;

  return (
    <>
      {gapSeconds > TURN_GAP_VISIBLE_SECONDS && (
        <GapRow
          seconds={gapSeconds}
          colCount={cells.length}
          borderColor={borderColor}
        />
      )}
      <Tr
        bg={rowBg}
        borderBottomWidth="1px"
        borderBottomColor="border.muted"
        transition="none"
        _hover={{ bg: rowStyle.hoverBg }}
        cursor="pointer"
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          openTraceDrawer(trace);
        }}
      >
        {cells.map((cell, i) => (
          <Td
            key={cell.column.id}
            style={i === 0 ? { backgroundColor: firstCellBg } : undefined}
            padding={`${density.rowPaddingY} 8px`}
            overflow="hidden"
            {...cellPropsFor(cell, borderColor, i)}
          >
            {turnCellContent({ columnId: cell.column.id, trace, turnIndex })}
          </Td>
        ))}
      </Tr>
    </>
  );
};

/**
 * Per-column content for a single turn, keyed by the conversation column
 * id so each value lands under the matching group-row header. Columns that
 * have no per-turn meaning (the running last-turn time) render a dash.
 */
function turnCellContent({
  columnId,
  trace,
  turnIndex,
}: {
  columnId: string;
  trace: TraceListItem;
  turnIndex: number;
}): ReactNode {
  switch (columnId) {
    case SELECT_COLUMN_ID:
      return null;
    case "conversation":
      return <TurnPreviewCell trace={trace} turnIndex={turnIndex} />;
    case "started":
      return <StartedCell timestamp={trace.timestamp} />;
    case "lastTurn":
      return dash;
    case "turns":
      return <MonoCell>T{turnIndex + 1}</MonoCell>;
    case "duration":
      return <MonoCell>{formatDuration(trace.durationMs)}</MonoCell>;
    case "cost":
      return <MonoCell>{formatCost(trace.totalCost)}</MonoCell>;
    case "tokens":
      return <MonoCell>{formatTokens(trace.totalTokens)}</MonoCell>;
    case "model":
      return (
        <MonoCell truncate whiteSpace={undefined}>
          {trace.models[0] ? abbreviateModel(trace.models[0]) : dash}
        </MonoCell>
      );
    case "service":
      return trace.serviceName ? (
        <Text textStyle="xs" color="fg.subtle" truncate>
          {trace.serviceName}
        </Text>
      ) : (
        dash
      );
    case "status":
      return <StatusIndicator status={trace.status} />;
    default:
      return null;
  }
}

/**
 * The turn's `started` time under the Time column, honoring the user's
 * `timeFormatStore` choice so it tracks the pinned TimeCell: ISO renders the
 * absolute timestamp, relative renders a self-updating compact label.
 */
const StartedCell: React.FC<{ timestamp: number }> = ({ timestamp }) => {
  const format = useTimeFormatStore((s) => s.format);
  return (
    <MonoCell color="fg.subtle">
      {format === "iso" ? (
        formatISOTimestamp(timestamp)
      ) : (
        <RelativeTime timestamp={timestamp} />
      )}
    </MonoCell>
  );
};

const RelativeTime: React.FC<{ timestamp: number }> = ({ timestamp }) => {
  const relative = useRelativeTime(timestamp);
  return <>{relative}</>;
};

/** The wide "conversation" column for a turn: turn marker, id peek, the
 *  message preview, and any chips for data without a dedicated column. */
const TurnPreviewCell: React.FC<{
  trace: TraceListItem;
  turnIndex: number;
}> = ({ trace, turnIndex }) => (
  <HStack gap={2} textStyle="xs" minWidth={0} paddingLeft={1}>
    <Badge size="xs" variant="outline" flexShrink={0}>
      T{turnIndex + 1}
    </Badge>
    <TraceIdPeek traceId={trace.traceId} occurredAtMs={trace.timestamp} />
    {trace.status === "error" && <StatusDot status="error" size="6px" />}
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
);

const ShowMoreRow: React.FC<{
  hiddenCount: number;
  colSpan: number;
  borderColor: RowStyle["borderColor"];
  onShowMore: () => void;
  onShowAll: () => void;
}> = ({ hiddenCount, colSpan, borderColor, onShowMore, onShowAll }) => {
  const nextStep = Math.min(SHOW_MORE_STEP, hiddenCount);
  return (
    <Tr borderBottomWidth="1px" borderBottomColor="border.muted">
      <Td
        colSpan={colSpan}
        style={{ backgroundColor: EXPANDED_BG_CSS }}
        padding="4px 8px 4px 40px"
        borderLeftWidth="2px"
        borderLeftColor={borderColor}
      >
        <HStack gap={2}>
          <Text textStyle="xs" color="fg.subtle">
            … {hiddenCount} more {hiddenCount === 1 ? "turn" : "turns"} hidden
          </Text>
          <Button
            size="xs"
            variant="ghost"
            height="auto"
            minHeight="0"
            paddingX={1}
            paddingY={0.5}
            color="blue.fg"
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              onShowMore();
            }}
          >
            Show {nextStep} more
          </Button>
          <Button
            size="xs"
            variant="ghost"
            height="auto"
            minHeight="0"
            paddingX={1}
            paddingY={0.5}
            color="fg.muted"
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              onShowAll();
            }}
          >
            Show all
          </Button>
        </HStack>
      </Td>
    </Tr>
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
    <Tr>
      <Td
        colSpan={colCount}
        style={{ backgroundColor: EXPANDED_BG_CSS }}
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
            <Text color={color} textStyle="2xs">
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
    <Text textStyle="2xs" color="fg.subtle">
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
      <Text textStyle="2xs" color="fg.subtle">
        {passed}/{evaluations.length}
      </Text>
    </HStack>
  );
};
