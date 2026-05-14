import type { ConversationGroup } from "../../../conversationGroups";
import type { AddonDef } from "../../types";
import { ChatTurns } from "./ChatTurns";
import { CompactTurns } from "./CompactTurns";

const MAX_VISIBLE_TURNS = 7;

export const ConversationTurnsAddon: AddonDef<ConversationGroup> = {
  id: "conversation-turns",
  label: "Conversation turns",
  shouldRender: ({ isExpanded }) => isExpanded,
  render: ({ row, colSpan, style, density, densityMode }) => {
    const visibleTurns = row.traces.slice(0, MAX_VISIBLE_TURNS);
    const overflow = row.traces.length - MAX_VISIBLE_TURNS;

    if (densityMode === "comfortable") {
      return (
        <ChatTurns
          group={row}
          colSpan={colSpan}
          style={style}
          visibleTurns={visibleTurns}
          overflow={overflow}
        />
      );
    }
    return (
      <CompactTurns
        group={row}
        colSpan={colSpan}
        style={style}
        density={density}
        visibleTurns={visibleTurns}
        overflow={overflow}
      />
    );
  },
};
