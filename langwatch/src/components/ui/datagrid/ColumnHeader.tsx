import { Flex, Text } from "@chakra-ui/react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { Header } from "@tanstack/react-table";
import { ColumnPopover } from "./ColumnPopover";
import type { DataGridColumnDef, FilterState, SortingState } from "./types";

interface ColumnHeaderProps<T> {
  header: Header<T, unknown>;
  column: DataGridColumnDef<T>;
  sorting: SortingState | null;
  filters: FilterState[];
  groupBy: string | null;
  onSort: (columnId: string, order: "asc" | "desc" | null) => void;
  onAddFilter: (filter: FilterState) => void;
  onRemoveFilter: (columnId: string, index: number) => void;
  onGroupBy: (columnId: string | null) => void;
  onToggleVisibility: (columnId: string) => void;
  onPin: (columnId: string, position: "left" | "right" | false) => void;
  enumOptions?: string[];
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
  enumOptions,
}: ColumnHeaderProps<T>) {
  const isSorted = sorting?.columnId === column.id;
  const sortOrder = isSorted ? sorting.order : null;
  const hasFilters = filters.some((f) => f.columnId === column.id);

  return (
    <Flex align="center" gap={1}>
      <Text
        fontWeight="medium"
        fontSize="sm"
        cursor={column.sortable ? "pointer" : "default"}
        onClick={() => {
          if (column.sortable) {
            if (!isSorted) {
              onSort(column.id, "asc");
            } else if (sortOrder === "asc") {
              onSort(column.id, "desc");
            } else {
              onSort(column.id, null);
            }
          }
        }}
        _hover={column.sortable ? { color: "blue.500" } : undefined}
      >
        {column.header}
      </Text>

      {/* Sort indicator */}
      {isSorted && (
        <Flex color="blue.500">
          {sortOrder === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
        </Flex>
      )}

      {/* Filter indicator */}
      {hasFilters && (
        <Flex
          w={2}
          h={2}
          borderRadius="full"
          bg="blue.500"
          title="Has active filters"
        />
      )}

      {/* Popover menu */}
      {(column.sortable || column.filterable || column.groupable) && (
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
          enumOptions={enumOptions}
        />
      )}
    </Flex>
  );
}
