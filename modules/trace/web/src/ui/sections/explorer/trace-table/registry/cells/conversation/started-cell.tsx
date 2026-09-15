import { Text } from "@chakra-ui/react";
import { formatRelativeTime } from "../../../../../../../model/display-formatters.ts";
import type { ConversationGroup } from "../../../conversation-groups.ts";
import { MonoCell } from "../../../../../../elements/explorer/trace-table/mono-cell.tsx";
import type { CellDef } from "../../types.ts";

export const StartedCell: CellDef<ConversationGroup> = {
  id: "started",
  label: "Started",
  render: ({ row }) => (
    <MonoCell color="fg.subtle">{formatRelativeTime(row.earliestTimestamp)}</MonoCell>
  ),
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted">
      {formatRelativeTime(row.earliestTimestamp)}
    </Text>
  ),
};
