import { useState } from "react";
import {
  EarlierTurnsExpander,
  CollapseEarlierToggle,
} from "./conversation-turn-list-controls";
import {
  InlineTurnList,
  VirtualizedTurnList,
} from "./conversation-turn-list-virtualized";
import {
  type ChatLayout,
  type ConversationTurn,
  LONG_THREAD_THRESHOLD,
  VIRTUALIZE_AT,
} from "./types";

const TAIL_VISIBLE_TURNS = 3;
const COLLAPSE_EARLIER_AT = LONG_THREAD_THRESHOLD;

interface ConversationTurnsListProps {
  turns: ConversationTurn[];
  layout: ChatLayout;
  collapseTools?: boolean;
  maxHeightPx?: number;
}

export function ConversationTurnsList({
  turns,
  layout,
  collapseTools = false,
  maxHeightPx,
}: ConversationTurnsListProps) {
  const canCollapseEarlier = layout === "thread" && turns.length > COLLAPSE_EARLIER_AT;
  const [showEarlier, setShowEarlier] = useState(false);
  const hiddenCount =
    canCollapseEarlier && !showEarlier
      ? Math.max(0, turns.length - TAIL_VISIBLE_TURNS)
      : 0;
  const visibleTurns = hiddenCount > 0 ? turns.slice(hiddenCount) : turns;

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
      <VirtualizedTurnList
        turns={visibleTurns}
        totalTurns={turns.length}
        indexOffset={hiddenCount}
        layout={layout}
        collapseTools={collapseTools}
        maxHeightPx={maxHeightPx ?? 600}
      />
    ) : (
      <InlineTurnList
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
