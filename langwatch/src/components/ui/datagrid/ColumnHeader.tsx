import { Flex, Text } from "@chakra-ui/react";
import { ChevronDown, ChevronUp, ChevronsUpDown, Filter, Ungroup } from "lucide-react";
import type { Header } from "@tanstack/react-table";
import { ColumnPopover } from "./ColumnPopover";
import type { DataGridColumnDef, SortingState, ColumnFiltersState } from "./types";

interface ColumnHeaderProps<T> {
  header: Header<T, unknown>;
  column: DataGridColumnDef<T>;
  sorting: SortingState;
  filters: ColumnFiltersState;
  groupBy: string | null;
  onSort: (columnId: string, order: "asc" | "desc" | null) => void;
  onAddFilter: (columnId: string, value: unknown) => void;
  onRemoveFilter: (columnId: string, index: number) => void;
  onGroupBy: (columnId: string | null) => void;
  onToggleVisibility: (columnId: string) => void;
  onPin: (columnId: string, position: "left" | "right" | false) => void;
}

/**
 * Column header with sort indicator and popover menu
 */
export function ColumnHeader<T>({
  header,
  column,
  sorting,
  filters,
  groupBy,
  onSort,
  onAddFilter,
  onRemoveFilter,
  onGroupBy,
  onToggleVisibility,
  onPin,
}: ColumnHeaderProps<T>) {
  const columnId = column.id!;
  const sortEntry = sorting.find((s) => s.id === columnId);
  const isSorted = !!sortEntry;
  const sortOrder = isSorted ? (sortEntry.desc ? "desc" : "asc") : null;
  const hasFilters = filters.some((f) => f.id === columnId);
  const isGrouped = groupBy === columnId;

  const headerText = typeof column.header === "string" ? column.header : "";

  return (
    <Flex align="center" gap={1}>
      <Text fontWeight="bold" fontSize="xs">
        {headerText}
      </Text>

      {/* Sort indicator */}
      {column.enableSorting && (
        <Flex
          color={isSorted ? "blue.500" : "gray.400"}
          cursor="pointer"
          onClick={() => {
            if (!isSorted) {
              onSort(columnId, "asc");
            } else if (sortOrder === "asc") {
              onSort(columnId, "desc");
            } else {
              onSort(columnId, null);
            }
          }}
        >
          {isSorted ? (
            sortOrder === "asc" ? (
              <ChevronUp size={14} />
            ) : (
              <ChevronDown size={14} />
            )
          ) : (
            <ChevronsUpDown size={14} />
          )}
        </Flex>
      )}

      {/* Grouped indicator */}
      {isGrouped && (
        <Flex color="blue.500" title="Grouped by this column"
        border="1px solid"
        borderColor="blue.500"
        borderRadius="sm"
        >
          <Ungroup size={14} />
        </Flex>
      )}

      {/* Filter indicator */}
      {hasFilters && (
        <Flex color="blue.500" title="Has active filters">
          <Filter size={14} />
        </Flex>
      )}

      {/* Popover menu */}
      {(column.enableSorting || column.enableColumnFilter || column.enableGrouping) && (
        <ColumnPopover
          column={column}
          sorting={sorting}
          filters={filters}
          groupBy={groupBy}
          onSort={onSort}
          onAddFilter={onAddFilter}
          onRemoveFilter={onRemoveFilter}
          onGroupBy={onGroupBy}
          onToggleVisibility={onToggleVisibility}
          onPin={onPin}
        />
      )}
    </Flex>
  );
}
