import type { ConversationGroup } from "../../../../../../../behavior/explorer/trace-table/conversation-groups.ts";
import type { AddonDef } from "../../types.ts";
import { ChatTurns } from "./chat-turns.tsx";
import { CompactTurns } from "./compact-turns.tsx";

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
