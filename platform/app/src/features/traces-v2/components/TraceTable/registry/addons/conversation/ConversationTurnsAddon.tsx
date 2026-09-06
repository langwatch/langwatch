import type { ConversationGroup } from "../../../conversationGroups";
import type { AddonDef } from "../../types";
import { ChatTurns } from "./ChatTurns";
import { CompactTurns } from "./CompactTurns";

export const ConversationTurnsAddon: AddonDef<ConversationGroup> = {
  id: "conversation-turns",
  label: "Conversation turns",
  shouldRender: ({ isExpanded }) => isExpanded,
  render: ({ row, colSpan, style, density, densityMode, tanstackRow }) => {
    if (densityMode === "comfortable") {
      return <ChatTurns group={row} colSpan={colSpan} style={style} />;
    }
    return (
      <CompactTurns
        group={row}
        colSpan={colSpan}
        style={style}
        density={density}
        cells={tanstackRow.getVisibleCells()}
      />
    );
  },
};
