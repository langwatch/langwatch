import { IconButton } from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Row } from "@tanstack/react-table";

interface ExpandToggleCellProps<T> {
  row: Row<T>;
  onToggle: (rowId: string) => void;
  isExpanded: boolean;
}

/**
 * Cell renderer that displays an expand/collapse toggle button
 */
export function ExpandToggleCell<T>({
  row,
  onToggle,
  isExpanded,
}: ExpandToggleCellProps<T>) {
  return (
    <IconButton
      aria-label={isExpanded ? "Collapse row" : "Expand row"}
      size="xs"
      variant="ghost"
      onClick={(e) => {
        e.stopPropagation();
        onToggle(row.id);
      }}
    >
      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
    </IconButton>
  );
}
