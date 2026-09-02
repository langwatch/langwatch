import { Text } from "@chakra-ui/react";
import type { ConversationGroup } from "../../../conversation-groups";
import { MonoCell } from "../../../../../../elements/explorer/trace-table/mono-cell";
import type { CellDef } from "../../types";

/**
 * True per-session trace count from the server rollup. `traces` only holds
 * the lazily loaded turn rows for the expanded session, so its length is not
 * the total.
 */
export const TurnsCell: CellDef<ConversationGroup> = {
  id: "turns",
  label: "Traces",
  render: ({ row }) => (
    <MonoCell>
      {row.traceCount}
      <Text as="span" color="fg.subtle" textStyle="2xs">
        {" "}
        {row.traceCount === 1 ? "trace" : "traces"}
      </Text>
    </MonoCell>
  ),
  renderComfortable: ({ row }) => (
    <Text textStyle="xs" color="fg.muted" textAlign="right">
      {row.traceCount} {row.traceCount === 1 ? "trace" : "traces"}
    </Text>
  ),
};
