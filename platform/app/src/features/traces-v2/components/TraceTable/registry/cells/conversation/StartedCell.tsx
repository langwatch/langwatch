import { Text } from "@chakra-ui/react";
import { formatRelativeTime } from "../../../../../utils/formatters";
import type { ConversationGroup } from "../../../conversationGroups";
import { MonoCell } from "../../../MonoCell";
import type { CellDef } from "../../types";

export const StartedCell: CellDef<ConversationGroup> = {
  id: "started",
  label: "Started",
  render: ({ row }) => (
    <MonoCell color="fg.subtle">
      {formatRelativeTime(row.earliestTimestamp)}
    </MonoCell>
  ),
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted">
      {formatRelativeTime(row.earliestTimestamp)}
    </Text>
  ),
};
