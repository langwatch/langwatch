import { Text } from "@chakra-ui/react";
import { MonoCell } from "../../../MonoCell";
import type { ConversationGroup } from "../../../conversationGroups";
import type { CellDef } from "../../types";

export const TurnsCell: CellDef<ConversationGroup> = {
  id: "turns",
  label: "Turns",
  render: ({ row }) => (
    <MonoCell>
      {row.traces.length}
      <Text as="span" color="fg.subtle" textStyle="2xs">
        {" "}
        turns
      </Text>
    </MonoCell>
  ),
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted" textAlign="right">
      {row.traces.length} {row.traces.length === 1 ? "turn" : "turns"}
    </Text>
  ),
};
