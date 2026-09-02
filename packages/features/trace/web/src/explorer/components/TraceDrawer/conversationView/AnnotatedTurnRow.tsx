import { Box, Grid, VStack } from "@chakra-ui/react";
import { memo } from "react";
import type { AnnotationByTrace } from "../../../../hooks/useAnnotationsByTraceIds";
import { ChatTurnRow } from "./ChatTurnRow";
import { FocusedTurnFrame } from "./FocusedTurn";
import { TurnAnnotationRail } from "./TurnAnnotationRail";
import type { ParsedTurn, TurnLayout } from "./types";
import { type RailLayout, THREAD_COLUMN_MAX_WIDTH_PX } from "./useRailLayout";

/**
 * Lines the stacked rail up with the message text: the card's own 12px
 * padding on top of this inset lands on the same left edge as a message
 * (12px row padding + 24px avatar + 10px gap).
 */
const STACKED_RAIL_INSET_PX = 34;

const EMPTY_ANNOTATIONS: AnnotationByTrace[] = [];

interface AnnotatedTurnRowProps {
  parsed: ParsedTurn;
  index: number;
  layout: TurnLayout;
  isCurrent: boolean;
  onSelectTurn: (traceId: string) => void;
  /** What was said about this turn as a whole, which is what its count reads. */
  annotations?: AnnotationByTrace[];
  /** What was said about the parts inside this turn. Read in the rail only. */
  anchoredAnnotations?: AnnotationByTrace[];
  /** Whether the conversation has a rail at all right now. */
  isRailActive: boolean;
  railLayout: RailLayout;
  /** Whether the separator offers to count this turn into the session. */
  showSessionCheckbox?: boolean;
  /** Whether this is the turn the reviewer was sent to. */
  isFocused?: boolean;
  /** Whether the turn under review is blinking, to land the reader's eye. */
  isBlinking?: boolean;
}

/**
 * One turn, with its annotations beside it when the conversation has a rail.
 *
 * The sole child of the virtualizer's measured wrapper, and the same component
 * on the un-virtualized path, so a turn measures the same height either way
 * however tall its annotations make it. With the rail closed this renders the
 * turn and nothing else.
 *
 * The tint marking the turn under review is drawn here rather than around the
 * whole row, because this is where the messages stop and the rail begins.
 */
export const AnnotatedTurnRow = memo(function AnnotatedTurnRow({
  parsed,
  index,
  layout,
  isCurrent,
  onSelectTurn,
  annotations = EMPTY_ANNOTATIONS,
  anchoredAnnotations = EMPTY_ANNOTATIONS,
  isRailActive,
  railLayout,
  showSessionCheckbox = false,
  isFocused = false,
  isBlinking = false,
}: AnnotatedTurnRowProps) {
  const turn = (
    <FocusedTurnFrame isFocused={isFocused} isBlinking={isBlinking}>
      <ChatTurnRow
        layout={layout}
        turn={parsed.turn}
        userText={parsed.userText}
        assistantText={parsed.assistantText}
        assistantReasoning={parsed.assistantReasoning}
        userMedia={parsed.userMedia}
        assistantMedia={parsed.assistantMedia}
        gapSecs={parsed.gapSecs}
        showGap={parsed.showGap}
        index={index}
        isCurrent={isCurrent}
        onSelect={onSelectTurn}
        annotationItems={annotations}
        anchoredAnnotationItems={anchoredAnnotations}
        showSessionCheckbox={showSessionCheckbox}
      />
    </FocusedTurnFrame>
  );

  if (!isRailActive) return turn;

  const rail = (
    <TurnAnnotationRail
      traceId={parsed.turn.traceId}
      input={parsed.turn.input}
      output={parsed.turn.output}
      annotations={annotations}
      anchoredAnnotations={anchoredAnnotations}
    />
  );

  if (railLayout.mode === "stacked") {
    return (
      <VStack align="stretch" gap={2}>
        {/* The turn keeps a box of its own here too: the tint pays for its
            room with negative margins, and those would come out of the stack's
            own spacing if the turn sat in it directly. */}
        <Box>{turn}</Box>
        <Box paddingLeft={`${STACKED_RAIL_INSET_PX}px`}>{rail}</Box>
      </VStack>
    );
  }

  return (
    <Grid
      templateColumns={`${messageColumnWidth(layout)} ${railLayout.railWidth}px`}
      gap={3}
      alignItems="start"
      width="full"
    >
      <Box minWidth={0}>{turn}</Box>
      {rail}
    </Grid>
  );
});

/**
 * How much of the row the messages take beside the rail.
 *
 * Thread caps itself at a reading width and the conversation reserves the rail
 * beside it, so the column is that width whether the rail is open or not.
 * Bubbles span whatever the pane gives them, so a fixed column would make the
 * whole conversation jump width the moment the rail opened.
 */
function messageColumnWidth(layout: TurnLayout): string {
  return layout === "thread"
    ? `minmax(0, ${THREAD_COLUMN_MAX_WIDTH_PX}px)`
    : "minmax(0, 1fr)";
}
