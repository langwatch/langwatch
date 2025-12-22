import { Box, Button, Flex, HStack, Spinner, Text } from "@chakra-ui/react";
import { Columns, Download, RotateCcw } from "lucide-react";
import {
  PopoverRoot,
  PopoverTrigger,
  PopoverContent,
  PopoverBody,
} from "../popover";
import { Checkbox } from "../checkbox";
import { FilterBar } from "./FilterBar";
import type { DataGridColumnDef, FilterState, SortingState } from "./types";

interface DataGridToolbarProps {
  children: ReactNode;
}

/**
 * Toolbar with filter bar, column visibility, and export controls
 */
function DataGridToolbarRoot({
  children,
}: DataGridToolbarProps<T>) {
  return (
    <Flex direction="row" align="center" justify="space-between" gap={4} px={3}>
      {children}
    </Flex>
  );
}

function DataGridToolbarLoadingIndicator({
  isLoading,
}: {
  isLoading: boolean;
}) {
  if (!isLoading) return null;
  return (
    <Spinner size="sm" color="gray.500" />
  );
}

function DataGridToolbarResetFiltersAndSorting({
  onResetFiltersAndSorting,
}: {
  onResetFiltersAndSorting: () => void;
}) {
  return (
    <Button size="sm" variant="outline" onClick={onResetFiltersAndSorting}>
      <RotateCcw size={14} />
      <Text ml={1}>Reset</Text>
    </Button>
  );
}

function DataGridToolbarColumnVisibility({
  columns,
  visibleColumns,
  onToggleColumnVisibility,
}: {
  columns: DataGridColumnDef<T>[];
  visibleColumns: Record<string, boolean>;
  onToggleColumnVisibility: (columnId: string) => void;
}) {
  return (
    <PopoverRoot>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">
          <Columns size={14} />
          <Text ml={1}>Columns</Text>
        </Button>
      </PopoverTrigger>
      <PopoverContent width="250px">
        <PopoverBody>
          <Flex direction="column" gap={2}>
            <Text fontWeight="medium" fontSize="sm" mb={1}>
              Visible Columns
            </Text>
            {columns.map((column) => (
              <Checkbox
                key={column.id}
                checked={visibleColumns[column.id]}
                onCheckedChange={() => onToggleColumnVisibility(column.id)}
              >
                {column.header}
              </Checkbox>
            ))}
          </Flex>
        </PopoverBody>
      </PopoverContent>
    </PopoverRoot>
  );
}

function DataGridToolbarExport({
  onExport,
}: {
  onExport: () => void;
}) {
  return (
    <Button size="sm" variant="outline" onClick={onExport}>
      <Download size={14} />
      <Text ml={1}>Export CSV</Text>
    </Button>
  );
}

export const DataGridToolbar = {
  Root: DataGridToolbarRoot,
  LoadingIndicator: DataGridToolbarLoadingIndicator,
  ResetFiltersAndSorting: DataGridToolbarResetFiltersAndSorting,
  ColumnVisibility: DataGridToolbarColumnVisibility,
  Export: DataGridToolbarExport,
  FilterBar
};
