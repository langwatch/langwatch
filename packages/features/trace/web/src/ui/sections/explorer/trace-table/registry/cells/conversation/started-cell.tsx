import { Text } from "@chakra-ui/react";
import { formatRelativeTime } from "../../../../../../../index";
import type { ConversationGroup } from "../../../conversation-groups";
import { MonoCell } from "../../../../../../elements/explorer/trace-table/mono-cell";
import type { CellDef } from "../../types";

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
