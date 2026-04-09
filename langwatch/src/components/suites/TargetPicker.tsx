/**
 * Picker component for selecting targets (agents and prompts) in a suite form.
 *
 * Renders: search input with inline "Add Target" button, scrollable checkbox
 * list with type indicators, and a footer with count + select all/clear buttons.
 */

import { Box, Button, HStack, IconButton, Text, VStack } from "@chakra-ui/react";
import { AlertTriangle, Plus, X } from "lucide-react";
import type { SuiteTarget } from "~/server/suites/types";
import { Tooltip } from "../ui/tooltip";
import { Checkbox } from "../ui/checkbox";
import { SearchInput } from "../ui/SearchInput";

interface AvailableTarget {
  name: string;
  type: "http" | "prompt";
  referenceId: string;
}

export interface TargetPickerProps {
  /** Filtered list of targets to display. */
  targets: AvailableTarget[];
  /** Currently selected targets. */
  selectedTargets: SuiteTarget[];
  /** Total number of available targets (before filtering). */
  totalCount: number;
  /** Check whether a target is selected. */
  isTargetSelected: (type: string, referenceId: string) => boolean;
  /** Toggle a target's selection. */
  onToggle: (target: SuiteTarget) => void;
  /** Current search query. */
  searchQuery: string;
  /** Update the search query. */
  onSearchChange: (query: string) => void;
  /** Handler for "Add Target" action (opens target creation drawer). */
  onAddTarget: () => void;
  /** Select all visible targets. */
  onSelectAll: () => void;
  /** Clear all selections. */
  onClear: () => void;
  /** Whether to show error styling on the border. */
  hasError?: boolean;
  /** Archived targets still linked to the suite, with display names. */
  archivedTargets?: (SuiteTarget & { name: string })[];
  /** Handler to remove an archived target. */
  onRemoveArchived?: (target: SuiteTarget) => void;
}

export function TargetPicker({
  targets,
  selectedTargets,
  totalCount,
  isTargetSelected,
  onToggle,
  searchQuery,
  onSearchChange,
  onAddTarget,
  onSelectAll,
  onClear,
  hasError,
  archivedTargets = [],
  onRemoveArchived,
}: TargetPickerProps) {
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
            placeholder="Search targets..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </Box>
        <Tooltip content="Add Target">
          <IconButton
            aria-label="Add Target"
            size="sm"
            variant="ghost"
            onClick={onAddTarget}
            data-testid="add-target-button"
          >
            <Plus size={16} />
          </IconButton>
        </Tooltip>
      </HStack>

      <VStack
        maxHeight="200px"
        overflow="auto"
        paddingX={3}
        gap={1}
        align="stretch"
      >
        {targets.map((target) => (
          <HStack
            key={`${target.type}-${target.referenceId}`}
            gap={2}
            paddingY={1}
            cursor="pointer"
          >
            <Checkbox
              checked={isTargetSelected(target.type, target.referenceId)}
              onCheckedChange={() =>
                onToggle({
                  type: target.type,
                  referenceId: target.referenceId,
                })
              }
              flex={1}
            >
              <HStack gap={2} flex={1}>
                <Text fontSize="sm" flex={1}>
                  {target.name}
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  ({target.type === "http" ? "HTTP" : "Prompt"})
                </Text>
              </HStack>
            </Checkbox>
          </HStack>
        ))}
        {targets.length === 0 && (
          <Text fontSize="sm" color="fg.muted" paddingY={2}>
            No targets available
          </Text>
        )}
      </VStack>

      {/* Archived targets warning */}
      {archivedTargets.length > 0 && (
        <VStack
          paddingX={3}
          paddingY={2}
          gap={1}
          align="stretch"
          borderTopWidth="1px"
          borderColor="border.muted"
          data-testid="archived-targets-section"
        >
          <HStack gap={2}>
            <AlertTriangle size={14} color="var(--chakra-colors-orange-500)" />
            <Text fontSize="xs" color="orange.fg">
              {archivedTargets.length} archived target{archivedTargets.length > 1 ? "s" : ""} linked:
            </Text>
          </HStack>
          {archivedTargets.map((target) => (
            <HStack key={`${target.type}-${target.referenceId}`} gap={2} paddingLeft={5}>
              <Text fontSize="sm" color="fg.muted" flex={1} fontStyle="italic">
                {target.name}
              </Text>
              {onRemoveArchived && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => onRemoveArchived(target)}
                  data-testid={`remove-archived-target-${target.referenceId}`}
                >
                  <X size={12} />
                  Remove
                </Button>
              )}
            </HStack>
          ))}
        </VStack>
      )}

      <HStack
        paddingX={3}
        paddingY={2}
        justify="space-between"
        borderTop="1px solid"
        borderColor="border"
      >
        <Text fontSize="xs" color="fg.muted">
          {selectedTargets.length - (archivedTargets?.length ?? 0)} of{" "}
          {totalCount} selected
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
