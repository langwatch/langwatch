import { Box, Grid, VStack } from "@chakra-ui/react";
import { memo } from "react";
import type { AnnotationByTrace } from "~/hooks/useAnnotationsByTraceIds";
import { ChatTurnRow } from "./ChatTurnRow";
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
  annotations?: AnnotationByTrace[];
  /** Whether the conversation has a rail at all right now. */
  isRailActive: boolean;
  railLayout: RailLayout;
}

/**
 * One turn, with its annotations beside it when the conversation has a rail.
 *
 * The sole child of the virtualizer's measured wrapper, and the same component
 * on the un-virtualized path, so a turn measures the same height either way
 * however tall its annotations make it. With the rail closed this renders the
 * turn and nothing else.
 */
export const AnnotatedTurnRow = memo(function AnnotatedTurnRow({
  parsed,
  index,
  layout,
  isCurrent,
  onSelectTurn,
  annotations = EMPTY_ANNOTATIONS,
  isRailActive,
  railLayout,
}: AnnotatedTurnRowProps) {
  const turn = (
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
      // Thread layout writes annotations in the rail, so its actions open the
      // composer there instead of a popover over the conversation.
      shouldUseRailComposer={layout === "thread"}
    />
  );

  if (!isRailActive) return turn;

  const rail = (
    <TurnAnnotationRail
      traceId={parsed.turn.traceId}
      output={parsed.turn.output}
      annotations={annotations}
    />
  );

  if (railLayout.mode === "stacked") {
    return (
      <VStack align="stretch" gap={2}>
        {turn}
        <Box paddingLeft={`${STACKED_RAIL_INSET_PX}px`}>{rail}</Box>
      </VStack>
    );
  }

  return (
    <Grid
      templateColumns={`minmax(0, ${THREAD_COLUMN_MAX_WIDTH_PX}px) ${railLayout.railWidth}px`}
      gap={3}
      alignItems="start"
      width="full"
    >
      <Box minWidth={0}>{turn}</Box>
      {rail}
    </Grid>
  );
});
