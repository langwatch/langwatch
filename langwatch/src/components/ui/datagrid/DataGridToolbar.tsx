import { Box, Button, Flex, HStack, Text } from "@chakra-ui/react";
import { Download, Eye, RefreshCw } from "lucide-react";
import {
  PopoverRoot,
  PopoverTrigger,
  PopoverContent,
  PopoverBody,
} from "../popover";
import { Checkbox } from "../checkbox";
import { FilterBar } from "./FilterBar";
import type { DataGridColumnDef, FilterState } from "./types";

interface DataGridToolbarProps<T> {
  columns: DataGridColumnDef<T>[];
  visibleColumns: Set<string>;
  filters: FilterState[];
  globalSearch: string;
  isExporting: boolean;
  onAddFilter: (filter: FilterState) => void;
  onRemoveFilter: (columnId: string, index: number) => void;
  onClearFilters: () => void;
  onGlobalSearchChange: (search: string) => void;
  onToggleColumnVisibility: (columnId: string) => void;
  onExport: () => void;
  onRefresh?: () => void;
  getEnumOptions?: (columnId: string) => string[];
}

/**
 * Toolbar with filter bar, column visibility, and export controls
 */
export function DataGridToolbar<T>({
  columns,
  visibleColumns,
  filters,
  globalSearch,
  isExporting,
  onAddFilter,
  onRemoveFilter,
  onClearFilters,
  onGlobalSearchChange,
  onToggleColumnVisibility,
  onExport,
  onRefresh,
  getEnumOptions,
}: DataGridToolbarProps<T>) {
  return (
    <Flex direction="row" align="center" justify="space-between" gap={4} px={3}>
      {/* Filter Bar - takes available space */}
      <Box flex={1}>
        <FilterBar
          columns={columns}
          filters={filters}
          globalSearch={globalSearch}
          onAddFilter={onAddFilter}
          onRemoveFilter={onRemoveFilter}
          onClearFilters={onClearFilters}
          onGlobalSearchChange={onGlobalSearchChange}
          getEnumOptions={getEnumOptions}
        />
      </Box>

      {/* Right side controls */}
      <HStack gap={2} flexShrink={0}>
        {/* Column Visibility */}
        <PopoverRoot>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline">
              <Eye size={14} />
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
                    checked={visibleColumns.has(column.id)}
                    onCheckedChange={() =>
                      onToggleColumnVisibility(column.id)
                    }
                  >
                    {column.header}
                  </Checkbox>
                ))}
              </Flex>
            </PopoverBody>
          </PopoverContent>
        </PopoverRoot>

        {/* Refresh */}
        {onRefresh && (
          <Button size="sm" variant="outline" onClick={onRefresh}>
            <RefreshCw size={14} />
            <Text ml={1}>Refresh</Text>
          </Button>
        )}

        {/* Export */}
        <Button
          size="sm"
          variant="outline"
          onClick={onExport}
          loading={isExporting}
        >
          <Download size={14} />
          <Text ml={1}>Export CSV</Text>
        </Button>
      </HStack>
    </Flex>
  );
}
