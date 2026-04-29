import { Box } from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import { ThreadedTurnView } from "./ThreadedTurnView";
import { TurnView } from "./TurnView";
import {
  type ChatLayout,
  type ConversationTurn,
  LONG_THREAD_THRESHOLD,
  VIRTUALIZE_AT,
} from "./types";

interface ConversationTurnsListProps {
  turns: ConversationTurn[];
  layout: ChatLayout;
  collapseTools?: boolean;
  /**
   * Maximum height of the internal scroll container — only honoured when
   * the list is virtualizing. The inline path is not bounded; the parent's
   * own scroll container constrains it.
   */
  maxHeightPx?: number;
}

/**
 * Single rendering surface for a list of conversation turns. Virtualizes
 * via `useVirtualizer` once the count crosses `VIRTUALIZE_AT`; below that
 * threshold the overhead of mounting a scroll container + measureElement
 * refs isn't justified, so it just maps the turns inline.
 *
 * Default-expansion logic lives here (not in `ThreadedTurnView`) so the
 * "user turns collapsed by default, last assistant turn expanded" rule
 * stays consistent across both code paths.
 */
export function ConversationTurnsList({
  turns,
  layout,
  collapseTools = false,
  maxHeightPx,
}: ConversationTurnsListProps) {
  return turns.length >= VIRTUALIZE_AT ? (
    <VirtualizedList
      turns={turns}
      layout={layout}
      collapseTools={collapseTools}
      maxHeightPx={maxHeightPx ?? 600}
    />
  ) : (
    <InlineList turns={turns} layout={layout} collapseTools={collapseTools} />
  );
}

function InlineList({
  turns,
  layout,
  collapseTools,
}: {
  turns: ConversationTurn[];
  layout: ChatLayout;
  collapseTools: boolean;
}) {
  return (
    <Box>
      {turns.map((turn, i) => (
        <TurnRow
          key={i}
          turn={turn}
          index={i}
          total={turns.length}
          layout={layout}
          collapseTools={collapseTools}
        />
      ))}
    </Box>
  );
}

function VirtualizedList({
  turns,
  layout,
  collapseTools,
  maxHeightPx,
}: {
  turns: ConversationTurn[];
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
      <Box
        height={`${virtualizer.getTotalSize()}px`}
        width="full"
        position="relative"
      >
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
                index={row.index}
                total={turns.length}
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

interface TurnRowProps {
  turn: ConversationTurn;
  index: number;
  total: number;
  layout: ChatLayout;
  collapseTools: boolean;
}

function TurnRow({ turn, index, total, layout, collapseTools }: TurnRowProps) {
  if (layout === "bubbles") {
    return <TurnView turn={turn} collapseTools={collapseTools} />;
  }
  // Thread layout: default-expand the last turn (always), plus the
  // immediately-prior assistant turn on short threads. User turns stay
  // collapsed unless they're the only thing showing — they're usually the
  // prompt the operator already knows they sent.
  const isLast = index === total - 1;
  const isLong = total > LONG_THREAD_THRESHOLD;
  const isLastTwo = index >= total - 2;
  const defaultExpanded = isLong
    ? isLast
    : turn.kind === "user"
      ? false
      : isLastTwo;
  return (
    <ThreadedTurnView
      turn={turn}
      index={index}
      isLast={isLast}
      defaultExpanded={defaultExpanded}
      collapseTools={collapseTools}
    />
  );
}
