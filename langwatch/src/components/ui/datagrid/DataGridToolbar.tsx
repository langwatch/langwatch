import { Button, Flex, Spinner, Text } from "@chakra-ui/react";
import { useMemo } from "react";
import { Columns, Download, RotateCcw } from "lucide-react";
import {
  PopoverRoot,
  PopoverTrigger,
  PopoverContent,
  PopoverBody,
} from "../popover";
import { Checkbox } from "../checkbox";
import { FilterBar } from "./FilterBar";
import type { ReactNode } from "react";
import type { Column } from "@tanstack/react-table";

interface DataGridToolbarProps {
  children: ReactNode;
}

/**
 * Toolbar with filter bar, column visibility, and export controls
 */
function DataGridToolbarRoot({
  children,
}: DataGridToolbarProps) {
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

function DataGridToolbarColumnVisibility<TData>({
  columns,
}: {
  columns: Column<TData>[];
}) {
  const displayColumns = useMemo(() => columns.filter((column) => column.getCanHide()), [columns]);
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
            {displayColumns.map((column) => (
              <Checkbox
                key={column.id}
                checked={column.getIsVisible()}
                onCheckedChange={column.getToggleVisibilityHandler()}
              >
                {typeof column.columnDef.header === "string" ? column.columnDef.header : ""}
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
