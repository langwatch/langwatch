import { Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../../types/trace";
import { MonoCell } from "../../../MonoCell";
import { dash } from "../dashPlaceholder";
import type { CellDef } from "../../types";

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
