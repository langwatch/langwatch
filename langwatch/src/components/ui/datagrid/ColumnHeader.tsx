import { Flex, Text, Spacer } from "@chakra-ui/react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import type { Header, Table, Column } from "@tanstack/react-table";

interface ColumnHeaderProps<T> {
  table: Table<T>;
  column: Column<T, unknown>;
  header: Header<T, unknown>;
}

/**
 * Column header with sort indicator and popover menu
 */
export function ColumnHeader<T>({
  table,
  column,
  header,
}: ColumnHeaderProps<T>) {
  const isSorted = column.getIsSorted();
  const sortOrder = isSorted;

  const headerText =
    typeof header.column.columnDef.header === "string"
      ? header.column.columnDef.header
      : "";

  return (
    <Flex align="center" gap={1}>
      <Text fontWeight="bold" fontSize="xs">
        {headerText}
      </Text>

      <Spacer />

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

    </Flex>
  );
}
