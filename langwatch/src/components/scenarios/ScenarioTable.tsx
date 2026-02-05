import { HStack, IconButton, Table, Text } from "@chakra-ui/react";
import type { Scenario } from "@prisma/client";
import {
  type ColumnFiltersState,
  createColumnHelper,
  type FilterFn,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type RowSelectionState,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { Archive, ChevronDown, ChevronUp, MoreVertical } from "lucide-react";
import { useMemo, useState } from "react";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { Checkbox } from "../ui/checkbox";
import { Menu } from "../ui/menu";

export type ScenarioTableProps = {
  scenarios: Scenario[];
  columnFilters: ColumnFiltersState;
  onColumnFiltersChange: (filters: ColumnFiltersState) => void;
  onRowClick: (scenarioId: string) => void;
  rowSelection: RowSelectionState;
  onRowSelectionChange: (selection: RowSelectionState) => void;
  onArchive: (scenario: Scenario) => void;
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
 * Table component for displaying scenarios with sorting, filtering,
 * row selection, and row action menus.
 */
export function ScenarioTable({
  scenarios,
  columnFilters,
  onColumnFiltersChange,
  onRowClick,
  rowSelection,
  onRowSelectionChange,
  onArchive,
}: ScenarioTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: "select",
        header: ({ table }) => (
          <Checkbox
            aria-label="Select all"
            checked={table.getIsAllPageRowsSelected()}
            onChange={() => table.toggleAllPageRowsSelected()}
            onClick={(e) => e.stopPropagation()}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            aria-label={`Select ${row.original.name}`}
            checked={row.getIsSelected()}
            onChange={() => row.toggleSelected()}
            onClick={(e) => e.stopPropagation()}
          />
        ),
        enableSorting: false,
      }),
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
                bg="bg.muted"
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
          <Text color="fg.muted">
            {formatTimeAgo(info.getValue().getTime())}
          </Text>
        ),
      }),
      columnHelper.display({
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <Menu.Root>
            <Menu.Trigger asChild>
              <IconButton
                aria-label={`Actions for ${row.original.name}`}
                variant="ghost"
                size="sm"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical size={16} />
              </IconButton>
            </Menu.Trigger>
            <Menu.Content portalled={false}>
              <Menu.Item
                value="archive"
                color="red.500"
                onClick={(e) => {
                  e.stopPropagation();
                  onArchive(row.original);
                }}
              >
                <Archive size={14} />
                Archive
              </Menu.Item>
            </Menu.Content>
          </Menu.Root>
        ),
        enableSorting: false,
      }),
    ],
    [onArchive],
  );

  const table = useReactTable({
    data: scenarios,
    columns,
    state: { sorting, columnFilters, rowSelection },
    enableRowSelection: true,
    onRowSelectionChange: (updater) => {
      const newSelection =
        typeof updater === "function" ? updater(rowSelection) : updater;
      onRowSelectionChange(newSelection);
    },
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
                width={header.id === "select" ? "40px" : header.id === "actions" ? "48px" : undefined}
              >
                <HStack gap={1}>
                  {flexRender(
                    header.column.columnDef.header,
                    header.getContext(),
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
