import { Text } from "@langwatch/design-system/primitives";

import type { ConversationGroup } from "../../../../../../../behavior/explorer/trace-table/conversation-groups.ts";
import { MonoCell } from "../../../../../../elements/explorer/trace-table/mono-cell.tsx";
import type { CellDef } from "../../types.ts";

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
