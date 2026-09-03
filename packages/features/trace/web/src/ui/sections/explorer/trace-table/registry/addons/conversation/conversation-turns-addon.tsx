import type { ConversationGroup } from "../../../conversation-groups";
import type { AddonDef } from "../../types";
import { ChatTurns } from "./chat-turns";
import { CompactTurns } from "./compact-turns";

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
