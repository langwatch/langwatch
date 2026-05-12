import { getDisplayRoleVisuals, useIsScenarioRole } from "../scenarioRoles";
import { AssistantTurnCard } from "./AssistantTurnCard";
import { BlockStack } from "./BlockStack";
import { SystemTurnView } from "./SystemTurnView";
import type { ContentBlock, ConversationTurn } from "./types";
import { UserTurnBubble } from "./UserTurnBubble";

export function TurnView({
  turn,
  collapseTools = false,
}: {
  turn: ConversationTurn;
  collapseTools?: boolean;
}) {
  const isScenario = useIsScenarioRole();
  if (turn.kind === "system") {
    return <SystemTurnView role={turn.role} blocks={turn.blocks} />;
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
      />
    );
  }
  return (
    <AssistantTurnCard
      blocks={turn.blocks}
      toolCalls={turn.toolCalls}
      visuals={visuals}
      collapseTools={collapseTools}
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
