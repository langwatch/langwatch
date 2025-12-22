import { useState } from "react";
import {
  Box,
  Button,
  Field,
  Flex,
  HStack,
  IconButton,
  Input,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  ArrowDown,
  ArrowUp,
  EyeOff,
  MoreVertical,
  Pin,
  X,
} from "lucide-react";
import {
  PopoverRoot,
  PopoverTrigger,
  PopoverContent,
  PopoverBody,
} from "../popover";
import { Radio, RadioGroup } from "../radio";
import type { DataGridColumnDef, SortingState, ColumnFiltersState } from "./types";

interface ColumnPopoverProps<T> {
  column: DataGridColumnDef<T>;
  sorting: SortingState;
  filters: ColumnFiltersState;
  groupBy: string | null;
  onSort: (columnId: string, order: "asc" | "desc" | null) => void;
  onAddFilter: (columnId: string, value: unknown) => void;
  onRemoveFilter: (columnId: string, index: number) => void;
  onGroupBy: (columnId: string | null) => void;
  onToggleVisibility: (columnId: string) => void;
  onPin: (columnId: string, position: "left" | "right" | false) => void;
}

/**
 * Popover menu for column header with sort, filter, group, and visibility options
 */
export function ColumnPopover<T>({
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
}: ColumnPopoverProps<T>) {
  const [filterValue, setFilterValue] = useState("");

  const columnId = column.id!;
  const columnFilters = filters.filter((f) => f.id === columnId);
  const sortEntry = sorting.find((s) => s.id === columnId);
  const isSorted = !!sortEntry;
  const sortOrder = isSorted ? (sortEntry.desc ? "desc" : "asc") : null;
  const isGrouped = groupBy === columnId;

  const handleAddFilter = () => {
    if (filterValue.trim()) {
      onAddFilter(columnId, { operator: "contains", value: filterValue.trim() });
      setFilterValue("");
    }
  };


  return (
    <PopoverRoot>
      <PopoverTrigger asChild>
        <IconButton
          aria-label={`${column.header} options`}
          size="xs"
          variant="ghost"
          ml={1}
        >
          <MoreVertical size={14} />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent width="280px">
        <PopoverBody>
          <VStack align="stretch" gap={3}>
            {/* Sort Section */}
            {column.enableSorting && (
              <Box>
                <Text fontWeight="medium" fontSize="sm" mb={2}>
                  Sort
                </Text>
                <RadioGroup
                  value={sortOrder ?? "none"}
                  onValueChange={(details) => {
                    const value = details.value;
                    if (value === "none") {
                      onSort(columnId, null);
                    } else {
                      onSort(columnId, value as "asc" | "desc");
                    }
                  }}
                >
                  <HStack gap={4}>
                    <Radio value="none">None</Radio>
                    <Radio value="asc">
                      <HStack gap={1}>
                        <ArrowUp size={14} />
                        <span>Asc</span>
                      </HStack>
                    </Radio>
                    <Radio value="desc">
                      <HStack gap={1}>
                        <ArrowDown size={14} />
                        <span>Desc</span>
                      </HStack>
                    </Radio>
                  </HStack>
                </RadioGroup>
              </Box>
            )}

            {/* Filter Section */}
            {column.enableColumnFilter && (
              <Box>
                <Text fontWeight="medium" fontSize="sm" mb={2}>
                  Filter
                </Text>
                <HStack>
                  <Input
                    size="sm"
                    placeholder="Filter value..."
                    value={filterValue}
                    onChange={(e) => setFilterValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && filterValue.trim()) {
                        handleAddFilter();
                      }
                    }}
                  />
                  <Button size="sm" onClick={handleAddFilter}>
                    Add
                  </Button>
                </HStack>

                {/* Active Filters */}
                {columnFilters.length > 0 && (
                  <VStack align="stretch" mt={2} gap={1}>
                    <Text fontSize="xs" color="gray.500">
                      Active filters:
                    </Text>
                    {columnFilters.map((filter, index) => {
                      // Filter value may contain operator, extract it
                      const filterValue = filter.value as { operator?: string; value?: unknown } | unknown;
                      const operator = filterValue && typeof filterValue === "object" && "operator" in filterValue
                        ? filterValue.operator
                        : "contains";
                      const value = filterValue && typeof filterValue === "object" && "value" in filterValue
                        ? filterValue.value
                        : filter.value;

                      return (
                        <Flex
                          key={index}
                          align="center"
                          justify="space-between"
                          bg="gray.50"
                          px={2}
                          py={1}
                          borderRadius="md"
                          fontSize="sm"
                        >
                          <Text>
                            {operator === "eq" ? "=" : operator === "between" ? "" : "contains"}{" "}
                            {String(value)}
                          </Text>
                          <IconButton
                            aria-label="Remove filter"
                            size="xs"
                            variant="ghost"
                            onClick={() => onRemoveFilter(columnId, index)}
                          >
                            <X size={12} />
                          </IconButton>
                        </Flex>
                      );
                    })}
                  </VStack>
                )}
              </Box>
            )}

            {/* Group Section */}
            {column.enableGrouping && (
              <Box>
                <Button
                  size="sm"
                  variant={isGrouped ? "solid" : "outline"}
                  width="full"
                  onClick={() => onGroupBy(isGrouped ? null : columnId)}
                >
                  {isGrouped ? "Ungroup" : `Group by ${column.header}`}
                </Button>
              </Box>
            )}

            {/* Column Actions */}
            <Flex gap={2} pt={2} borderTop="1px solid" borderColor="gray.100">
              <Button
                size="sm"
                variant="ghost"
                flex={1}
                onClick={() => onToggleVisibility(columnId)}
              >
                <EyeOff size={14} />
                <Text ml={1}>Hide</Text>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                flex={1}
                onClick={() => onPin(columnId, "left")}
              >
                <Pin size={14} />
                <Text ml={1}>Pin</Text>
              </Button>
            </Flex>
          </VStack>
        </PopoverBody>
      </PopoverContent>
    </PopoverRoot>
  );
}
