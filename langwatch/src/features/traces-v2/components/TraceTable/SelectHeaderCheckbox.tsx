import { Box, chakra } from "@chakra-ui/react";

const ChakraButton = chakra("button");

import type React from "react";
import { Checkbox } from "~/components/ui/checkbox";
import { useSelectionStore } from "../../stores/selectionStore";

interface SelectHeaderCheckboxProps {
  /** Every trace id currently rendered on this page across every row. */
  traceIds: string[];
}

export const SelectHeaderCheckbox: React.FC<SelectHeaderCheckboxProps> = ({
  traceIds,
}) => {
  const traceIdSet = useSelectionStore((s) => s.traceIds);
  const mode = useSelectionStore((s) => s.mode);
  const setMany = useSelectionStore((s) => s.setMany);

  if (traceIds.length === 0) return null;

  const total = traceIds.length;
  const selectedCount =
    mode === "all-matching"
      ? total
      : traceIds.reduce((n, id) => n + (traceIdSet.has(id) ? 1 : 0), 0);

  const checked: boolean | "indeterminate" =
    selectedCount === 0
      ? false
      : selectedCount === total
        ? true
        : "indeterminate";

  return (
    <ChakraButton
      type="button"
      aria-label="Select all on this page"
      aria-checked={
        checked === true ? "true" : checked === false ? "false" : "mixed"
      }
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
