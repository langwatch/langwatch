import { Box, chakra, Flex, Icon, Text } from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, useState } from "react";
import { LuChevronDown, LuChevronUp } from "react-icons/lu";
import { ThreadedTurnView } from "./ThreadedTurnView";
import { TurnView } from "./TurnView";
import {
  type ChatLayout,
  type ConversationTurn,
  LONG_THREAD_THRESHOLD,
  VIRTUALIZE_AT,
} from "./types";

// When a thread runs longer than this we hide all but the tail behind a
// "Show N earlier turns" expander. Each LLM call carries the prior context
// forward, so without this you scroll past dozens of collapsed rows just to
// reach the message that actually matters.
const TAIL_VISIBLE_TURNS = 3;
const COLLAPSE_EARLIER_AT = LONG_THREAD_THRESHOLD;

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
  const canCollapseEarlier =
    layout === "thread" && turns.length > COLLAPSE_EARLIER_AT;
  const [showEarlier, setShowEarlier] = useState(false);
  const hiddenCount =
    canCollapseEarlier && !showEarlier
      ? Math.max(0, turns.length - TAIL_VISIBLE_TURNS)
      : 0;
  const visibleTurns =
    hiddenCount > 0 ? turns.slice(hiddenCount) : turns;

  // Once the user has revealed earlier turns we still want a way to collapse
  // them again — otherwise the only escape is closing and reopening the
  // drawer, which is jarring.
  const header = canCollapseEarlier ? (
    hiddenCount > 0 ? (
      <EarlierTurnsExpander
        hiddenCount={hiddenCount}
        onClick={() => setShowEarlier(true)}
      />
    ) : (
      <CollapseEarlierToggle onClick={() => setShowEarlier(false)} />
    )
  ) : null;

  const list =
    visibleTurns.length >= VIRTUALIZE_AT ? (
      <VirtualizedList
        turns={visibleTurns}
        totalTurns={turns.length}
        indexOffset={hiddenCount}
        layout={layout}
        collapseTools={collapseTools}
        maxHeightPx={maxHeightPx ?? 600}
      />
    ) : (
      <InlineList
        turns={visibleTurns}
        totalTurns={turns.length}
        indexOffset={hiddenCount}
        layout={layout}
        collapseTools={collapseTools}
      />
    );

  return (
    <>
      {header}
      {list}
    </>
  );
}

// Matches the visual structure of `ThreadedTurnView`: a relative box with
// `paddingLeft={6}` so the inner button aligns with the threaded turn's
// summary text, and the chevron lives in the role-icon column rather than
// hanging out on the far left.
function EarlierTurnsHeader({
  icon,
  label,
  onClick,
}: {
  icon: typeof LuChevronDown;
  label: string;
  onClick: () => void;
}) {
  return (
    <Box position="relative" paddingLeft={6} paddingY={0}>
      <Flex
        position="absolute"
        left={0}
        top="6px"
        width="14px"
        height="14px"
        align="center"
        justify="center"
        flexShrink={0}
      >
        <Icon as={icon} boxSize="10px" color="fg.subtle" />
      </Flex>
      <chakra.button
        type="button"
        onClick={onClick}
        display="flex"
        alignItems="center"
        paddingY={0.5}
        paddingX={1.5}
        borderRadius="sm"
        cursor="pointer"
        _hover={{ bg: "bg.muted" }}
        textAlign="left"
        width="full"
      >
        <Text
          textStyle="2xs"
          color="fg.muted"
          fontWeight="600"
          textTransform="uppercase"
          letterSpacing="0.06em"
          lineHeight={1.4}
        >
          {label}
        </Text>
      </chakra.button>
    </Box>
  );
}

function EarlierTurnsExpander({
  hiddenCount,
  onClick,
}: {
  hiddenCount: number;
  onClick: () => void;
}) {
  return (
    <EarlierTurnsHeader
      icon={LuChevronDown}
      label={`Show ${hiddenCount} earlier turn${hiddenCount === 1 ? "" : "s"}`}
      onClick={onClick}
    />
  );
}

function CollapseEarlierToggle({ onClick }: { onClick: () => void }) {
  return (
    <EarlierTurnsHeader
      icon={LuChevronUp}
      label="Hide earlier turns"
      onClick={onClick}
    />
  );
}

function InlineList({
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
    // Re-pin only when the underlying trace changes (totalTurns) — not when
    // the user reveals earlier turns from the same trace, which would yank
    // them straight back to the bottom they were trying to escape.
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

function VirtualizedList({
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

  // Same idea as InlineList — start scrolled to the latest turn so the
  // operator lands on what's new, not a wall of carried-forward context.
  // We use the virtualizer's `scrollToIndex` rather than `scrollIntoView`
  // because the rows are absolutely positioned inside a virtual sizer and
  // most of them aren't mounted on first render anyway. `align: "end"`
  // matches the chat convention (latest message bottom-aligned).
  useEffect(() => {
    if (turns.length === 0) return;
    virtualizer.scrollToIndex(turns.length - 1, { align: "end" });
    // Re-pin only when the underlying trace changes (totalTurns) — not when
    // the user reveals earlier turns from the same trace.
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
