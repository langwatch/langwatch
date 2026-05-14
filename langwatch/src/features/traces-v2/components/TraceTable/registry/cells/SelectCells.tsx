import { Box, chakra } from "@chakra-ui/react";

const ChakraButton = chakra("button");

import type React from "react";
import { Checkbox } from "~/components/ui/checkbox";
import { useSelectionStore } from "../../../../stores/selectionStore";
import type { TraceListItem } from "../../../../types/trace";
import type { ConversationGroup } from "../../conversationGroups";
import type { CellDef } from "../types";
import type { TraceGroup } from "./group/types";

export const SELECT_COLUMN_ID = "select";

interface RowCheckboxProps {
  /** Trace IDs the checkbox represents (1 for trace lens, N for parents). */
  traceIds: string[];
  ariaLabel: string;
}

const RowCheckbox: React.FC<RowCheckboxProps> = ({ traceIds, ariaLabel }) => {
  const traceIdSet = useSelectionStore((s) => s.traceIds);
  const mode = useSelectionStore((s) => s.mode);
  const setMany = useSelectionStore((s) => s.setMany);

  const totalCount = traceIds.length;
  const checkedCount =
    mode === "all-matching"
      ? totalCount
      : traceIds.reduce((n, id) => n + (traceIdSet.has(id) ? 1 : 0), 0);

  const checked: boolean | "indeterminate" =
    checkedCount === 0
      ? false
      : checkedCount === totalCount
        ? true
        : "indeterminate";

  // Whole-cell hit target — the Td has padding=0 so this Box fills every
  // pixel of the cell. Native <button> guarantees click + keyboard
  // (Space/Enter) handling. The Checkbox inside is purely visual; the
  // inner pointer-events:none wrapper makes sure clicks land on the button
  // and not on the label that wraps the hidden input.
  return (
    <ChakraButton
      type="button"
      aria-label={ariaLabel}
      aria-checked={
        checked === true ? "true" : checked === false ? "false" : "mixed"
      }
      display="flex"
      alignItems="center"
      justifyContent="center"
      width="100%"
      height="100%"
      minHeight="32px"
      paddingX={2}
      paddingY={1}
      bg="transparent"
      border="none"
      cursor="pointer"
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation();
        setMany(traceIds, checked !== true);
      }}
    >
      <Box pointerEvents="none" display="inline-flex">
        <Checkbox size="sm" checked={checked} />
      </Box>
    </ChakraButton>
  );
};

export const TraceSelectCell = {
  id: SELECT_COLUMN_ID,
  label: "Select",
  render: ({ row }) => (
    <RowCheckbox
      traceIds={[row.traceId]}
      ariaLabel={`Select trace ${row.traceId}`}
    />
  ),
} as const satisfies CellDef<TraceListItem>;

export const ConversationSelectCell = {
  id: SELECT_COLUMN_ID,
  label: "Select",
  render: ({ row }) => (
    <RowCheckbox
      traceIds={row.traces.map((t) => t.traceId)}
      ariaLabel={`Select conversation ${row.conversationId}`}
    />
  ),
} as const satisfies CellDef<ConversationGroup>;

export const GroupSelectCell = {
  id: SELECT_COLUMN_ID,
  label: "Select",
  render: ({ row }) => (
    <RowCheckbox
      traceIds={row.traces.map((t) => t.traceId)}
      ariaLabel={`Select group ${row.label}`}
    />
  ),
} as const satisfies CellDef<TraceGroup>;
