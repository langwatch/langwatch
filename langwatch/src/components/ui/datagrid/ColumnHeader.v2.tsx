import { Flex, Text, Button } from "@chakra-ui/react";
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Filter,
  Ungroup,
} from "lucide-react";
import type { Header, Table, Column } from "@tanstack/react-table";
import { ColumnPopover } from "./ColumnPopover";

interface ColumnHeaderProps<T> {
  table: Table<T>;
  column: Column<T, unknown>;
  header: Header<T, unknown>;
}

/**
 * Column header with sort indicator and popover menu
 */
export function ColumnHeader<T>({
  title,
  table,
  column,
  header,
}: ColumnHeaderProps<T>) {
  const columnId = column.id;
  const isSorted = column.getIsSorted();
  const sortOrder = isSorted;
  const hasFilters = column.getIsFiltered();
  const isGrouped = column.getIsGrouped();

  const headerText =
    typeof header.column.columnDef.header === "string"
      ? header.column.columnDef.header
      : "";

  return (
    <Flex align="center" gap={1}>
      <Text fontWeight="bold" fontSize="xs">
        {headerText}
      </Text>

      {/* Sort indicator */}
      {column.getCanSort() && (
        <Flex
          color={isSorted ? "blue.500" : "gray.400"}
          cursor="pointer"
          onClick={column.getToggleSortingHandler()}
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
      <Flex
      cursor="pointer"
        color="blue.500"
        title="Grouped by this column"
        border="1px solid"
        borderColor="blue.500"
        borderRadius="sm"
        onClick={column.getToggleGroupingHandler()}
        opacity={isGrouped ? 1 : 0.5}
      >
        <Ungroup size={14} />
      </Flex>

      {/* Filter indicator */}
      {hasFilters && (
        <Flex color="blue.500" title="Has active filters">
          <Filter size={14} />
        </Flex>
      )}

      {/* Popover menu */}
      {(column.getCanSort() ||
        column.getCanFilter() ||
        column.getCanGroup()) && (
        <ColumnPopover
          column={column}
          sorting={table.getState().sorting}
          filters={table.getState().columnFilters}
          // groupBy={table.getState().grouping.length > 0 ? table.getState().grouping[0] : null}
          groupBy={null}
          onSort={(columnId, order) => {
            if (order === null) {
              table.getColumn(columnId)?.clearSorting();
            } else {
              table.getColumn(columnId)?.toggleSorting(order === "desc");
            }
          }}
          onAddFilter={(columnId, value) => {
            table.getColumn(columnId)?.setFilterValue(value);
          }}
          onRemoveFilter={(columnId, index) => {
            // For now, clear all filters for the column
            table.getColumn(columnId)?.setFilterValue(undefined);
          }}
          onGroupBy={(columnId) => {
            if (columnId) {
              table.getColumn(columnId)?.toggleGrouping();
            } else {
              table.resetGrouping();
            }
          }}
          onToggleVisibility={(columnId) => {
            table.getColumn(columnId)?.toggleVisibility();
          }}
          onPin={(columnId, position) => {
            table.getColumn(columnId)?.pin(position || false);
          }}
        />
      )}
    </Flex>
  );
}
