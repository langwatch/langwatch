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
import { format, subDays, subMinutes, startOfDay } from "date-fns";
import {
  PopoverRoot,
  PopoverTrigger,
  PopoverContent,
  PopoverBody,
} from "../popover";
import { Radio, RadioGroup } from "../radio";
import type { DataGridColumnDef, FilterState, SortingState } from "./types";

interface ColumnPopoverProps<T> {
  column: DataGridColumnDef<T>;
  sorting: SortingState | null;
  filters: FilterState[];
  groupBy: string | null;
  onSort: (columnId: string, order: "asc" | "desc" | null) => void;
  onAddFilter: (filter: FilterState) => void;
  onRemoveFilter: (columnId: string, index: number) => void;
  onGroupBy: (columnId: string | null) => void;
  onToggleVisibility: (columnId: string) => void;
  onPin: (columnId: string, position: "left" | "right" | false) => void;
  enumOptions?: string[];
  enumLabels?: Record<string, string>;
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
  enumOptions,
  enumLabels,
}: ColumnPopoverProps<T>) {
  const [filterValue, setFilterValue] = useState("");
  const [selectedEnumValue, setSelectedEnumValue] = useState<string>("");
  const [dateStart, setDateStart] = useState<string>("");
  const [dateEnd, setDateEnd] = useState<string>("");

  const columnFilters = filters.filter((f) => f.columnId === column.id);
  const isSorted = sorting?.columnId === column.id;
  const sortOrder = isSorted ? sorting.order : null;
  const isGrouped = groupBy === column.id;

  const handleAddFilter = () => {
    if (column.filterType === "enum" && selectedEnumValue) {
      onAddFilter({
        columnId: column.id,
        operator: "eq",
        value: selectedEnumValue,
      });
      setSelectedEnumValue("");
    } else if (column.filterType === "date" && (dateStart || dateEnd)) {
      // For date filters, store as JSON with start/end
      onAddFilter({
        columnId: column.id,
        operator: "between",
        value: JSON.stringify({
          start: dateStart ? new Date(dateStart).toISOString() : null,
          end: dateEnd ? new Date(dateEnd).toISOString() : null,
        }),
      });
      setDateStart("");
      setDateEnd("");
    } else if (filterValue.trim()) {
      onAddFilter({
        columnId: column.id,
        operator: "contains",
        value: filterValue.trim(),
      });
      setFilterValue("");
    }
  };

  const handleQuickDateSelect = (minutes: number) => {
    const endDate = new Date();
    // For times less than a day, use minutes; otherwise use days
    const startDate =
      minutes < 1440
        ? subMinutes(endDate, minutes)
        : startOfDay(subDays(endDate, minutes / 1440 - 1));
    onAddFilter({
      columnId: column.id,
      operator: "between",
      value: JSON.stringify({
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      }),
    });
  };

  const formatDateFilterDisplay = (value: string) => {
    try {
      const parsed = JSON.parse(value);
      const start = parsed.start ? format(new Date(parsed.start), "MMM d") : "";
      const end = parsed.end ? format(new Date(parsed.end), "MMM d") : "";
      if (start && end) return `${start} - ${end}`;
      if (start) return `From ${start}`;
      if (end) return `Until ${end}`;
      return value;
    } catch {
      return value;
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
            {column.sortable && (
              <Box>
                <Text fontWeight="medium" fontSize="sm" mb={2}>
                  Sort
                </Text>
                <RadioGroup
                  value={sortOrder ?? "none"}
                  onValueChange={(details) => {
                    const value = details.value;
                    if (value === "none") {
                      onSort(column.id, null);
                    } else {
                      onSort(column.id, value as "asc" | "desc");
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
            {column.filterable && (
              <Box>
                <Text fontWeight="medium" fontSize="sm" mb={2}>
                  Filter
                </Text>
                {column.filterType === "enum" ? (
                  <HStack>
                    <select
                      value={selectedEnumValue}
                      onChange={(e) => setSelectedEnumValue(e.target.value)}
                      style={{
                        flex: 1,
                        padding: "6px 8px",
                        borderRadius: "4px",
                        border: "1px solid var(--chakra-colors-gray-200)",
                      }}
                    >
                      <option value="">Select value...</option>
                      {(enumOptions ?? column.enumValues ?? []).map((opt) => (
                        <option key={opt} value={opt}>
                          {(enumLabels ?? column.enumLabels)?.[opt] ?? opt}
                        </option>
                      ))}
                    </select>
                    <Button size="sm" onClick={handleAddFilter}>
                      Add
                    </Button>
                  </HStack>
                ) : column.filterType === "date" ? (
                  <VStack align="stretch" gap={2}>
                    <HStack gap={2} flexWrap="wrap">
                      {[
                        { label: "5m", minutes: 5 },
                        { label: "15m", minutes: 15 },
                        { label: "Today", minutes: 1440 },
                        { label: "7d", minutes: 7 * 1440 },
                        { label: "30d", minutes: 30 * 1440 },
                        { label: "90d", minutes: 90 * 1440 },
                      ].map((opt) => (
                        <Button
                          key={opt.label}
                          size="xs"
                          variant="outline"
                          onClick={() => handleQuickDateSelect(opt.minutes)}
                        >
                          {opt.label}
                        </Button>
                      ))}
                    </HStack>
                    <Field.Root>
                      <Field.Label fontSize="xs">Start</Field.Label>
                      <Input
                        type="datetime-local"
                        size="sm"
                        value={dateStart}
                        onChange={(e) => setDateStart(e.target.value)}
                      />
                    </Field.Root>
                    <Field.Root>
                      <Field.Label fontSize="xs">End</Field.Label>
                      <Input
                        type="datetime-local"
                        size="sm"
                        value={dateEnd}
                        onChange={(e) => setDateEnd(e.target.value)}
                      />
                    </Field.Root>
                    <Button size="sm" onClick={handleAddFilter}>
                      Apply Date Range
                    </Button>
                  </VStack>
                ) : (
                  <HStack>
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
                    <Button size="sm" onClick={handleAddFilter}>
                      Add
                    </Button>
                  </HStack>
                )}

                {/* Active Filters */}
                {columnFilters.length > 0 && (
                  <VStack align="stretch" mt={2} gap={1}>
                    <Text fontSize="xs" color="gray.500">
                      Active filters:
                    </Text>
                    {columnFilters.map((filter, index) => (
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
                          {filter.operator === "eq"
                            ? "="
                            : filter.operator === "between"
                              ? ""
                              : "contains"}{" "}
                          {filter.operator === "between"
                            ? formatDateFilterDisplay(String(filter.value))
                            : (enumLabels ?? column.enumLabels)?.[
                                String(filter.value)
                              ] ?? String(filter.value)}
                        </Text>
                        <IconButton
                          aria-label="Remove filter"
                          size="xs"
                          variant="ghost"
                          onClick={() => onRemoveFilter(column.id, index)}
                        >
                          <X size={12} />
                        </IconButton>
                      </Flex>
                    ))}
                  </VStack>
                )}
              </Box>
            )}

            {/* Group Section */}
            {column.groupable && (
              <Box>
                <Button
                  size="sm"
                  variant={isGrouped ? "solid" : "outline"}
                  width="full"
                  onClick={() => onGroupBy(isGrouped ? null : column.id)}
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
                onClick={() => onToggleVisibility(column.id)}
              >
                <EyeOff size={14} />
                <Text ml={1}>Hide</Text>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                flex={1}
                onClick={() => onPin(column.id, "left")}
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
