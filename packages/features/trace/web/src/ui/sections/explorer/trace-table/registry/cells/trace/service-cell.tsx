import { Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../types/trace";
import { MonoCell } from "../../../../../../elements/explorer/trace-table/mono-cell";
import type { CellDef } from "../../types";
import { dash } from "../../../../../../elements/explorer/trace-table/registry/cells/dash-placeholder";

export const ServiceCell = {
  id: "service",
  label: "Service",
  render: ({ row }) => (
    <MonoCell color="fg.subtle" truncate whiteSpace={undefined}>
      {row.serviceName || dash}
    </MonoCell>
  ),
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted" truncate>
      {row.serviceName || dash}
    </Text>
  ),
} as const satisfies CellDef<TraceListItem>;
