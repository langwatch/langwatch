import { Text } from "@chakra-ui/react";
import { formatRelativeTime } from "../../../../../utils/formatters";
import { MonoCell } from "../../../MonoCell";
import type { ConversationGroup } from "../../../conversationGroups";
import type { CellDef } from "../../types";

export const LastTurnCell: CellDef<ConversationGroup> = {
  id: "lastTurn",
  label: "Last Turn",
  render: ({ row }) => (
    <MonoCell color="fg.muted">
      {formatRelativeTime(row.latestTimestamp)}
    </MonoCell>
  ),
  renderComfortable: ({ row }) => (
    <Text textStyle="xs" color="fg">
      {formatRelativeTime(row.latestTimestamp)}
    </Text>
  ),
};
