import { Box } from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef } from "react";
import { ThreadedTurnView } from "./threaded-turn-view";
import { type ChatLayout, type ConversationTurn, LONG_THREAD_THRESHOLD } from "./types";

interface TurnRowProps {
  turn: ConversationTurn;
  index: number;
  total: number;
  layout: ChatLayout;
  collapseTools: boolean;
}

function TurnRow({ turn, index, total, layout, collapseTools }: TurnRowProps) {
  const isLast = index === total - 1;
  const defaultExpanded = shouldExpandTurn({ turn, index, total });

  return (
    <ThreadedTurnView
      turn={turn}
      index={index}
      isLast={isLast}
      defaultExpanded={defaultExpanded}
      collapseTools={collapseTools}
      layout={layout}
    />
  );
}

function shouldExpandTurn({
  turn,
  index,
  total,
}: Pick<TurnRowProps, "turn" | "index" | "total">): boolean {
  if (index === total - 1) {
    return true;
  }

  if (total > LONG_THREAD_THRESHOLD) {
    return false;
  }

  const isOneOfLastTwoTurns = index >= total - 2;
  return turn.kind !== "user" && isOneOfLastTwoTurns;
}

export function InlineTurnList({
  turns,
  totalTurns,
  indexOffset,
  layout,
  collapseTools,
}: {
  turns: ConversationTurn[];
  totalTurns: number;
  indexOffset: number;
  layout: ChatLayout;
  collapseTools: boolean;
}) {
  const tailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tailRef.current?.scrollIntoView({ block: "end" });
  }, [totalTurns]);

  return (
    <Box>
      {turns.map((turn, i) => (
        <TurnRow
          key={indexOffset + i}
          turn={turn}
          index={indexOffset + i}
          total={totalTurns}
          layout={layout}
          collapseTools={collapseTools}
        />
      ))}
      <Box ref={tailRef} aria-hidden />
    </Box>
  );
}

export function VirtualizedTurnList({
  turns,
  totalTurns,
  indexOffset,
  layout,
  collapseTools,
  maxHeightPx,
}: {
  turns: ConversationTurn[];
  totalTurns: number;
  indexOffset: number;
  layout: ChatLayout;
  collapseTools: boolean;
  maxHeightPx: number;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: turns.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200,
    overscan: 3,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  useEffect(() => {
    if (turns.length === 0) return;
    virtualizer.scrollToIndex(turns.length - 1, { align: "end" });
  }, [totalTurns, virtualizer]);

  return (
    <Box
      ref={parentRef}
      maxHeight={`${maxHeightPx}px`}
      overflow="auto"
      paddingX={3}
      paddingY={3}
      css={{
        "&::-webkit-scrollbar": { width: "4px" },
        "&::-webkit-scrollbar-thumb": {
          borderRadius: "4px",
          background: "var(--chakra-colors-border-muted)",
        },
        "&::-webkit-scrollbar-track": { background: "transparent" },
      }}
    >
      <Box height={`${virtualizer.getTotalSize()}px`} width="full" position="relative">
        {virtualizer.getVirtualItems().map((row) => {
          const turn = turns[row.index]!;
          return (
            <Box
              key={row.key}
              ref={virtualizer.measureElement}
              data-index={row.index}
              position="absolute"
              top={0}
              left={0}
              width="full"
              transform={`translateY(${row.start}px)`}
            >
              <TurnRow
                turn={turn}
                index={indexOffset + row.index}
                total={totalTurns}
                layout={layout}
                collapseTools={collapseTools}
              />
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
