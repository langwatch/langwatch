/**
 * Picker component for selecting scenarios in a suite form.
 *
 * Renders: search input with inline "Add Scenario" button, label filter chips,
 * scrollable checkbox list, and a footer with count + select all/clear.
 */

import {
  Badge,
  Box,
  Button,
  HStack,
  IconButton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { AlertTriangle, Plus, X } from "lucide-react";
import { Checkbox } from "../ui/checkbox";
import { Tooltip } from "../ui/tooltip";
import { SearchInput } from "../ui/SearchInput";

interface Scenario {
  id: string;
  name: string;
  labels: string[];
}

export interface ScenarioPickerProps {
  /** Filtered list of scenarios to display. */
  scenarios: Scenario[];
  /** Currently selected scenario IDs. */
  selectedIds: string[];
  /** Total number of scenarios (before filtering). */
  totalCount: number;
  /** Toggle a scenario's selection. */
  onToggle: (id: string) => void;
  /** Select all visible scenarios. */
  onSelectAll: () => void;
  /** Clear all selections. */
  onClear: () => void;
  /** Current search query. */
  searchQuery: string;
  /** Update the search query. */
  onSearchChange: (query: string) => void;
  /** All available label values for filtering. */
  allLabels: string[];
  /** Currently active label filter (null for "All"). */
  activeLabelFilter: string | null;
  /** Set the active label filter. */
  onLabelFilterChange: (label: string | null) => void;
  /** Handler for "Create New Scenario" action. */
  onCreateNew: () => void;
  /** Whether to show error styling on the border. */
  hasError?: boolean;
  /** Archived scenarios still linked to the suite. */
  archivedIds?: { id: string; name: string }[];
  /** Handler to remove an archived scenario. */
  onRemoveArchived?: (id: string) => void;
}

export function ScenarioPicker({
  scenarios,
  selectedIds,
  totalCount,
  onToggle,
  onSelectAll,
  onClear,
  searchQuery,
  onSearchChange,
  allLabels,
  activeLabelFilter,
  onLabelFilterChange,
  onCreateNew,
  hasError,
  archivedIds = [],
  onRemoveArchived,
}: ScenarioPickerProps) {
  return (
    <Box
      border="1px solid"
      borderColor={hasError ? "red.500" : "border"}
      borderRadius="md"
      width="full"
    >
      <HStack paddingX={3} paddingY={2} gap={2}>
        <Box flex={1}>
          <SearchInput
            size="sm"
            placeholder="Search scenarios..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </Box>
        <Tooltip content="Add Scenario">
          <IconButton
            aria-label="Add Scenario"
            size="sm"
            variant="ghost"
            onClick={onCreateNew}
            data-testid="add-scenario-button"
          >
            <Plus size={16} />
          </IconButton>
        </Tooltip>
      </HStack>

      {/* Label filter chips */}
      {allLabels.length > 0 && (
        <HStack paddingX={3} paddingBottom={2} gap={1} flexWrap="wrap">
          <Badge
            size="sm"
            cursor="pointer"
            variant={activeLabelFilter === null ? "solid" : "outline"}
            onClick={() => onLabelFilterChange(null)}
          >
            All
          </Badge>
          {allLabels.map((label) => (
            <Badge
              key={label}
              size="sm"
              cursor="pointer"
              variant={activeLabelFilter === label ? "solid" : "outline"}
              onClick={() =>
                onLabelFilterChange(
                  activeLabelFilter === label ? null : label,
                )
              }
            >
              #{label}
            </Badge>
          ))}
        </HStack>
      )}

      {/* Scenario list */}
      <VStack
        maxHeight="200px"
        overflow="auto"
        paddingX={3}
        gap={1}
        align="stretch"
      >
        {scenarios.map((scenario) => (
          <HStack key={scenario.id} gap={2} paddingY={1} cursor="pointer">
            <Checkbox
              checked={selectedIds.includes(scenario.id)}
              onCheckedChange={() => onToggle(scenario.id)}
              flex={1}
            >
              <HStack gap={2} flex={1}>
                <Text fontSize="sm" flex={1}>
                  {scenario.name}
                </Text>
                {scenario.labels.map((l) => (
                  <Text
                    key={l}
                    fontSize="xs"
                    bg="bg.muted"
                    px={2}
                    py={0.5}
                    borderRadius="md"
                  >
                    #{l}
                  </Text>
                ))}
              </HStack>
            </Checkbox>
          </HStack>
        ))}
      </VStack>

      {/* Archived scenarios warning */}
      {archivedIds.length > 0 && (
        <VStack
          paddingX={3}
          paddingY={2}
          gap={1}
          align="stretch"
          borderTopWidth="1px"
          borderColor="border.muted"
          data-testid="archived-scenarios-section"
        >
          <HStack gap={2}>
            <AlertTriangle size={14} color="var(--chakra-colors-orange-500)" />
            <Text fontSize="xs" color="orange.700" _dark={{ color: "orange.200" }}>
              {archivedIds.length} archived scenario{archivedIds.length > 1 ? "s" : ""} linked:
            </Text>
          </HStack>
          {archivedIds.map((item) => (
            <HStack key={item.id} gap={2} paddingLeft={5}>
              <Text fontSize="sm" color="fg.muted" flex={1} fontStyle="italic">
                {item.name}
              </Text>
              {onRemoveArchived && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => onRemoveArchived(item.id)}
                  data-testid={`remove-archived-scenario-${item.id}`}
                >
                  <X size={12} />
                  Remove
                </Button>
              )}
            </HStack>
          ))}
        </VStack>
      )}

      {/* Footer with count + select all / clear */}
      <HStack
        paddingX={3}
        paddingY={2}
        justify="space-between"
        borderTop="1px solid"
        borderColor="border"
      >
        <Text fontSize="xs" color="fg.muted">
          {selectedIds.length} of {totalCount} selected
        </Text>
        <HStack gap={2}>
          <Button size="xs" variant="ghost" onClick={onSelectAll}>
            Select All
          </Button>
          <Button size="xs" variant="ghost" onClick={onClear}>
            Clear
          </Button>
        </HStack>
      </HStack>
    </Box>
  );
}
