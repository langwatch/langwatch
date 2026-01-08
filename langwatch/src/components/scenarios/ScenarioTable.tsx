import { HStack, Table, Text } from "@chakra-ui/react";
import type { Scenario } from "@prisma/client";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnFiltersState,
  type FilterFn,
  type SortingState,
} from "@tanstack/react-table";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useMemo, useState } from "react";
import { formatTimeAgo } from "~/utils/formatTimeAgo";

type ScenarioTableProps = {
  scenarios: Scenario[];
  columnFilters: ColumnFiltersState;
  onColumnFiltersChange: (filters: ColumnFiltersState) => void;
  onRowClick: (scenarioId: string) => void;
};

const columnHelper = createColumnHelper<Scenario>();

/**
 * Custom filter function for array columns (labels).
 * Returns true if row has ANY of the filter values.
 */
const labelsFilterFn: FilterFn<Scenario> = (row, columnId, filterValue) => {
  const labels = row.getValue<string[]>(columnId);
  const activeLabels = filterValue as string[];
  if (!activeLabels || activeLabels.length === 0) return true;
  return activeLabels.some((label) => labels.includes(label));
};

/**
 * Table component for displaying scenarios with sorting and filtering.
 */
export function ScenarioTable({
  scenarios,
  columnFilters,
  onColumnFiltersChange,
  onRowClick,
}: ScenarioTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const columns = useMemo(
    () => [
      columnHelper.accessor("name", {
        header: "Name",
        cell: (info) => <Text fontWeight="medium">{info.getValue()}</Text>,
      }),
      columnHelper.accessor("labels", {
        header: "Labels",
        enableSorting: false,
        filterFn: labelsFilterFn,
        cell: (info) => (
          <HStack gap={1} flexWrap="wrap">
            {info.getValue().map((label) => (
              <Text
                key={label}
                fontSize="xs"
                bg="gray.100"
                px={2}
                py={0.5}
                borderRadius="md"
              >
                #{label}
              </Text>
            ))}
          </HStack>
        ),
      }),
      columnHelper.accessor("updatedAt", {
        header: "Updated",
        cell: (info) => (
          <Text color="gray.500">
            {formatTimeAgo(info.getValue().getTime())}
          </Text>
        ),
      }),
    ],
    []
  );

  const table = useReactTable({
    data: scenarios,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: (updater) => {
      const newFilters =
        typeof updater === "function" ? updater(columnFilters) : updater;
      onColumnFiltersChange(newFilters);
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.id,
  });

  return (
    <Table.Root variant="line" width="full" size="md">
      <Table.Header>
        {table.getHeaderGroups().map((headerGroup) => (
          <Table.Row key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <Table.ColumnHeader
                key={header.id}
                cursor={header.column.getCanSort() ? "pointer" : "default"}
                onClick={header.column.getToggleSortingHandler()}
                userSelect="none"
              >
                <HStack gap={1}>
                  {flexRender(
                    header.column.columnDef.header,
                    header.getContext()
                  )}
                  {header.column.getIsSorted() === "asc" && (
                    <ChevronUp size={14} />
                  )}
                  {header.column.getIsSorted() === "desc" && (
                    <ChevronDown size={14} />
                  )}
                </HStack>
              </Table.ColumnHeader>
            ))}
          </Table.Row>
        ))}
      </Table.Header>
      <Table.Body>
        {table.getRowModel().rows.map((row) => (
          <Table.Row
            key={row.id}
            cursor="pointer"
            _hover={{ bg: "gray.50" }}
            onClick={() => onRowClick(row.original.id)}
          >
            {row.getVisibleCells().map((cell) => (
              <Table.Cell key={cell.id}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </Table.Cell>
            ))}
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}
