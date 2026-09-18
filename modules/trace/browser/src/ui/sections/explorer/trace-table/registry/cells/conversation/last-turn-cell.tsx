import { Text } from "@chakra-ui/react";
import { formatRelativeTime } from "../../../../../../../model/display-formatters.ts";
import type { ConversationGroup } from "../../../conversation-groups.ts";
import { MonoCell } from "../../../../../../elements/explorer/trace-table/mono-cell.tsx";
import type { CellDef } from "../../types.ts";

export const LastTurnCell: CellDef<ConversationGroup> = {
  id: "lastTurn",
  label: "Last Activity",
  render: ({ row }) => (
    <MonoCell color="fg.muted">{formatRelativeTime(row.latestTimestamp)}</MonoCell>
  ),
  renderComfortable: ({ row }) => (
    <Text textStyle="xs" color="fg">
      {formatRelativeTime(row.latestTimestamp)}
    </Text>
  ),
};
