import { Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../../types/trace";
import { MonoCell } from "../../../MonoCell";
import type { CellDef } from "../../types";

export const ServiceCell: CellDef<TraceListItem> = {
  id: "service",
  label: "Service",
  render: ({ row }) => (
    <MonoCell color="fg.subtle" truncate whiteSpace={undefined}>
      {row.serviceName || "—"}
    </MonoCell>
  ),
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted" truncate>
      {row.serviceName || "—"}
    </Text>
  ),
};
