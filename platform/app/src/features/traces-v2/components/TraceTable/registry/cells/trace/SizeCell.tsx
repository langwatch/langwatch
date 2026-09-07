import { Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../../types/trace";
import { formatBytes } from "../../../../../utils/formatters";
import { MonoCell } from "../../../MonoCell";
import type { CellDef } from "../../types";

/**
 * Stored payload size of the trace (`_size_bytes` on trace_summaries),
 * humanised into decimal byte units ("12 kB", "1.4 MB"). Right-aligned like
 * the other numeric columns; an empty / zero size reads as an em-dash via
 * `formatBytes`.
 */
export const SizeCell = {
  id: "size",
  label: "Storage size",
  render: ({ row }) => <MonoCell>{formatBytes(row.sizeBytes)}</MonoCell>,
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted" textAlign="right">
      {formatBytes(row.sizeBytes)}
    </Text>
  ),
} as const satisfies CellDef<TraceListItem>;
