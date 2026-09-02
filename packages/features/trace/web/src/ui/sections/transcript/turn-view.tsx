import { getDisplayRoleVisuals, useIsScenarioRole } from "../../elements/scenario-role";
import { AssistantTurnCard } from "./assistant-turn-card";
import { BlockStack } from "./block-stack";
import { SystemTurnView } from "./system-turn-view";
import type { ContentBlock, ConversationTurn } from "../../../model/transcript/types";
import { UserTurnBubble } from "./user-turn-bubble";

export function TurnView({
  turn,
  collapseTools = false,
  onCollapse,
}: {
  turn: ConversationTurn;
  collapseTools?: boolean;
  /**
   * When provided, the turn's inner header renders a chevron button
   * that calls this back. Used by the threaded layout so the
   * collapse affordance sits inline with the role chip instead of
   * duplicating it in an outer row.
   */
  onCollapse?: () => void;
}) {
  const isScenario = useIsScenarioRole();
  if (turn.kind === "system") {
    return <SystemTurnView role={turn.role} blocks={turn.blocks} onCollapse={onCollapse} />;
  }
  // In scenario mode the source role's `displayRole` is flipped, so a
  // `user` turn renders with the assistant card and an `assistant` turn
  // renders with the user bubble. The visuals carry the swapped label
  // and icon (e.g. "Simulator" + flask icon) into the bubble's header.
  const visuals = getDisplayRoleVisuals(turn.kind, { isScenario });
  if (visuals.displayRole === "user") {
    return (
      <UserTurnBubble
        blocks={turn.blocks}
        toolCalls={turn.toolCalls}
        visuals={visuals}
        collapseTools={collapseTools}
        onCollapse={onCollapse}
      />
    );
  }
  return (
    <AssistantTurnCard
      blocks={turn.blocks}
      toolCalls={turn.toolCalls}
      visuals={visuals}
      collapseTools={collapseTools}
      onCollapse={onCollapse}
    />
  );
}

/**
 * Render a list of content blocks as a vertical stack — used as the
 * fallback for plain-string content that has inline `{"type":…}` JSON
 * lines but no chat-array wrapper around them.
 */
export function ContentBlocks({ blocks }: { blocks: ContentBlock[] }) {
  if (blocks.length === 0) return null;
  return <BlockStack blocks={blocks} toolCalls={[]} />;
}
