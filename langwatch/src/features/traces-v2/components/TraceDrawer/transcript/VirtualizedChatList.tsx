import { Box } from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import { ThreadedTurnView } from "./ThreadedTurnView";
import { TurnView } from "./TurnView";
import {
  type ChatLayout,
  type ConversationTurn,
  LONG_THREAD_THRESHOLD,
} from "./types";

/**
 * Virtualized list of turns. Re-measures on layout shift (expand/collapse
 * a thinking block, etc.). Use only when the turn count is high enough
 * that mounting every turn would lag — see `VIRTUALIZE_AT`.
 */
export function VirtualizedChatList({
  turns,
  maxHeightPx,
  layout,
  collapseTools = false,
}: {
  turns: ConversationTurn[];
  maxHeightPx: number;
  layout: ChatLayout;
  collapseTools?: boolean;
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
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const i = virtualRow.index;
          const turn = turns[i]!;
          // For long conversations, default to only the last turn expanded —
          // expanding the last 2 (or all of them on shorter convos) buries
          // the user in noise. Tuned at the same threshold as virtualization.
          const isLong = turns.length > LONG_THREAD_THRESHOLD;
          const defaultExpanded = isLong
            ? i === turns.length - 1
            : i >= turns.length - 2;
          return (
            <Box
              key={virtualRow.key}
              ref={virtualizer.measureElement}
              data-index={i}
              position="absolute"
              top={0}
              left={0}
              width="full"
              transform={`translateY(${virtualRow.start}px)`}
            >
              {layout === "thread" ? (
                <ThreadedTurnView
                  turn={turn}
                  index={i}
                  isLast={i === turns.length - 1}
                  defaultExpanded={defaultExpanded}
                  collapseTools={collapseTools}
                />
              ) : (
                <TurnView turn={turn} collapseTools={collapseTools} />
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
