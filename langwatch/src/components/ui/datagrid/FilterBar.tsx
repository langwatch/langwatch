import { useState } from "react";
import {
  Box,
  Button,
  Flex,
  HStack,
  IconButton,
  Input,
  Tag,
  Text,
} from "@chakra-ui/react";
import { Plus, Search, X } from "lucide-react";
import {
  PopoverRoot,
  PopoverTrigger,
  PopoverContent,
  PopoverBody,
} from "../popover";
import type { DataGridColumnDef, FilterState } from "./types";

interface FilterBarProps<T> {
  columns: DataGridColumnDef<T>[];
  filters: FilterState[];
  globalSearch: string;
  onAddFilter: (filter: FilterState) => void;
  onRemoveFilter: (columnId: string, index: number) => void;
  onClearFilters: () => void;
  onGlobalSearchChange: (search: string) => void;
  getEnumOptions?: (columnId: string) => string[];
}

/**
 * Filter bar showing active filters and global search
 */
export function FilterBar<T>({
  columns,
  filters,
  globalSearch,
  onAddFilter,
  onRemoveFilter,
  onClearFilters,
  onGlobalSearchChange,
  getEnumOptions,
}: FilterBarProps<T>) {
  const [selectedColumn, setSelectedColumn] = useState<string>("");
  const [filterValue, setFilterValue] = useState("");

  const filterableColumns = columns.filter((col) => col.filterable);

  const handleAddFilter = () => {
    if (!selectedColumn || !filterValue.trim()) return;

    const column = columns.find((c) => c.id === selectedColumn);
    if (!column) return;

    onAddFilter({
      columnId: selectedColumn,
      operator: column.filterType === "enum" ? "eq" : "contains",
      value: filterValue.trim(),
    });

    setSelectedColumn("");
    setFilterValue("");
  };

  const getColumnLabel = (columnId: string) => {
    return columns.find((c) => c.id === columnId)?.header ?? columnId;
  };

  // Group filters by column for display
  const filtersByColumn = filters.reduce(
    (acc, filter, index) => {
      if (!acc[filter.columnId]) {
        acc[filter.columnId] = [];
      }
      acc[filter.columnId]!.push({ filter, index });
      return acc;
    },
    {} as Record<string, { filter: FilterState; index: number }[]>
  );

  return (
    <Flex
      align="center"
      gap={3}
      py={2}
      px={3}
      bg="gray.50"
      borderRadius="md"
      flexWrap="wrap"
    >
      {/* Global Search */}
      <HStack flex="0 0 auto" minW="200px">
        <Search size={16} color="gray" />
        <Input
          size="sm"
          placeholder="Search..."
          value={globalSearch}
          onChange={(e) => onGlobalSearchChange(e.target.value)}
          bg="white"
          maxW="200px"
        />
      </HStack>

      {/* Add Filter Button */}
      <PopoverRoot>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline">
            <Plus size={14} />
            <Text ml={1}>Add Filter</Text>
          </Button>
        </PopoverTrigger>
        <PopoverContent width="300px">
          <PopoverBody>
            <Flex direction="column" gap={3}>
              <Box>
                <Text fontSize="sm" fontWeight="medium" mb={1}>
                  Column
                </Text>
                <select
                  value={selectedColumn}
                  onChange={(e) => {
                    setSelectedColumn(e.target.value);
                    setFilterValue("");
                  }}
                  style={{
                    width: "100%",
                    padding: "6px 8px",
                    borderRadius: "4px",
                    border: "1px solid var(--chakra-colors-gray-200)",
                  }}
                >
                  <option value="">Select column...</option>
                  {filterableColumns.map((col) => (
                    <option key={col.id} value={col.id}>
                      {col.header}
                    </option>
                  ))}
                </select>
              </Box>

              {selectedColumn && (
                <Box>
                  <Text fontSize="sm" fontWeight="medium" mb={1}>
                    Value
                  </Text>
                  {(() => {
                    const column = columns.find((c) => c.id === selectedColumn);
                    if (column?.filterType === "enum") {
                      const options =
                        getEnumOptions?.(selectedColumn) ??
                        column.enumValues ??
                        [];
                      return (
                        <select
                          value={filterValue}
                          onChange={(e) => setFilterValue(e.target.value)}
                          style={{
                            width: "100%",
                            padding: "6px 8px",
                            borderRadius: "4px",
                            border: "1px solid var(--chakra-colors-gray-200)",
                          }}
                        >
                          <option value="">Select value...</option>
                          {options.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      );
                    }
                    return (
                      <Input
                        size="sm"
                        placeholder="Contains..."
                        value={filterValue}
                        onChange={(e) => setFilterValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleAddFilter();
                          }
                        }}
                      />
                    );
                  })()}
                </Box>
              )}

              <Button
                size="sm"
                colorPalette="blue"
                onClick={handleAddFilter}
                disabled={!selectedColumn || !filterValue.trim()}
              >
                Apply Filter
              </Button>
            </Flex>
          </PopoverBody>
        </PopoverContent>
      </PopoverRoot>

      {/* Active Filters */}
      {Object.entries(filtersByColumn).map(([columnId, columnFilters]) => (
        <HStack key={columnId} gap={1}>
          <Text fontSize="sm" color="gray.600">
            {getColumnLabel(columnId)}:
          </Text>
          {columnFilters.map(({ filter, index }) => (
            <Tag.Root
              key={index}
              size="sm"
              colorPalette="blue"
              variant="subtle"
            >
              <Tag.Label>
                {filter.operator === "eq" ? "=" : "~"} {String(filter.value)}
              </Tag.Label>
              <Tag.CloseTrigger
                onClick={() => {
                  // Find the index within this column's filters
                  const columnFilterIndex = filters
                    .filter((f) => f.columnId === columnId)
                    .findIndex((f) => f === filter);
                  onRemoveFilter(columnId, columnFilterIndex);
                }}
              />
            </Tag.Root>
          ))}
        </HStack>
      ))}

      {/* Clear All */}
      {(filters.length > 0 || globalSearch) && (
        <Button size="sm" variant="ghost" onClick={onClearFilters}>
          Clear All
        </Button>
      )}
    </Flex>
  );
}
