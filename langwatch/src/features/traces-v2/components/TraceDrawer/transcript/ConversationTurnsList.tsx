import { Box } from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef } from "react";
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
  // Pin the *latest* turn to the visible bottom on mount. As a chat-style
  // input grows (each turn carries the whole prefix), the panel fills with
  // history the operator has already seen — what they actually want is the
  // newest message, which conventionally lives at the bottom in any chat
  // UI. We let the parent scroll container do the scrolling (the inline
  // path doesn't bound its own height), so we ask the last child to scroll
  // itself into view via `scrollIntoView({ block: "end" })`. Behaviour is
  // "auto" — instantaneous on mount; smooth scrolling here would draw the
  // operator's eye through every prior message, defeating the point.
  const tailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tailRef.current?.scrollIntoView({ block: "end" });
    // Only on mount + when the turn count changes (new trace opened).
  }, [turns.length]);

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
      <Box ref={tailRef} aria-hidden />
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

  // Same idea as InlineList — start scrolled to the latest turn so the
  // operator lands on what's new, not a wall of carried-forward context.
  // We use the virtualizer's `scrollToIndex` rather than `scrollIntoView`
  // because the rows are absolutely positioned inside a virtual sizer and
  // most of them aren't mounted on first render anyway. `align: "end"`
  // matches the chat convention (latest message bottom-aligned).
  useEffect(() => {
    if (turns.length === 0) return;
    virtualizer.scrollToIndex(turns.length - 1, { align: "end" });
    // Re-pin only when the turn count changes — manual scroll-up to read
    // history shouldn't be undone by a render.
  }, [turns.length, virtualizer]);

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
