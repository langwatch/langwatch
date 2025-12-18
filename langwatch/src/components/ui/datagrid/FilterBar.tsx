import {
  Button,
  Flex,
  HStack,
  Input,
  Tag,
  Text,
} from "@chakra-ui/react";
import { Search } from "lucide-react";
import type { DataGridColumnDef, FilterState } from "./types";

interface FilterBarProps<T> {
  columns: DataGridColumnDef<T>[];
  filters: FilterState[];
  globalSearch: string;
  onRemoveFilter: (columnId: string, index: number) => void;
  onClearFilters: () => void;
  onGlobalSearchChange: (search: string) => void;
}

/**
 * Filter bar showing active filters and global search
 */
export function FilterBar<T>({
  columns,
  filters,
  globalSearch,
  onRemoveFilter,
  onClearFilters,
  onGlobalSearchChange,
}: FilterBarProps<T>) {
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
