import { Box, chakra } from "@chakra-ui/react";

const ChakraButton = chakra("button");

import { Checkbox } from "@langwatch/design-system/checkbox";
import { useSelectionStore } from "@langwatch/trace-browser-kit";
import type React from "react";

import { ariaCheckedFor, checkboxStateFor } from "../../../../model/tri-state-checkbox.ts";

interface SelectHeaderCheckboxProps {
  /** Every trace id currently rendered on this page across every row. */
  traceIds: string[];
}

export const SelectHeaderCheckbox: React.FC<SelectHeaderCheckboxProps> = ({ traceIds }) => {
  const traceIdSet = useSelectionStore((s) => s.selection.traceIds);
  const mode = useSelectionStore((s) => s.selection.mode);
  const setMany = useSelectionStore((s) => s.setSelectedMany);

  if (traceIds.length === 0) return null;

  const total = traceIds.length;
  const selectedCount =
    mode === "all-matching"
      ? total
      : traceIds.reduce((n, id) => n + (traceIdSet.has(id) ? 1 : 0), 0);

  const checked = checkboxStateFor({ selectedCount, total });

  return (
    <ChakraButton
      type="button"
      aria-label="Select all on this page"
      aria-checked={ariaCheckedFor(checked)}
      display="flex"
      alignItems="center"
      justifyContent="center"
      width="100%"
      height="100%"
      minHeight="28px"
      paddingX={2}
      bg="transparent"
      border="none"
      cursor="pointer"
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation();
        // Treat indeterminate→click as "select all" (matches Gmail/Linear UX).
        setMany(traceIds, checked !== true);
      }}
    >
      <Box pointerEvents="none" display="inline-flex">
        <Checkbox size="sm" checked={checked} />
      </Box>
    </ChakraButton>
  );
};
