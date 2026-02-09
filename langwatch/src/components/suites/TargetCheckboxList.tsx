/**
 * Checkbox list for selecting targets (agents and prompts) in a suite form.
 *
 * Renders: search input, scrollable checkbox list with type indicators,
 * "Add New Agent" and "Add New Prompt" action rows, and a count footer.
 */

import { Box, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import type { SuiteTarget } from "~/server/suites/types";
import { Checkbox } from "../ui/checkbox";

interface AvailableTarget {
  name: string;
  type: "http" | "prompt";
  referenceId: string;
}

export interface TargetCheckboxListProps {
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
  /** Handler for "Add New Agent" action. */
  onCreateAgent: () => void;
  /** Handler for "Add New Prompt" action. */
  onCreatePrompt: () => void;
  /** Whether to show error styling on the border. */
  hasError?: boolean;
}

export function TargetCheckboxList({
  targets,
  selectedTargets,
  totalCount,
  isTargetSelected,
  onToggle,
  searchQuery,
  onSearchChange,
  onCreateAgent,
  onCreatePrompt,
  hasError,
}: TargetCheckboxListProps) {
  return (
    <Box
      border="1px solid"
      borderColor={hasError ? "red.500" : "border"}
      borderRadius="md"
      width="full"
    >
      <Box paddingX={3} paddingY={2}>
        <Input
          size="sm"
          placeholder="Search targets..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </Box>

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

      {/* Add new agent */}
      <HStack
        paddingX={3}
        paddingY={2}
        cursor="pointer"
        _hover={{ bg: "gray.100" }}
        borderTopWidth="1px"
        borderColor="border.muted"
        color="blue.500"
        onClick={onCreateAgent}
      >
        <Plus size={14} />
        <Text fontSize="sm">Add New Agent</Text>
      </HStack>

      {/* Add new prompt */}
      <HStack
        paddingX={3}
        paddingY={2}
        cursor="pointer"
        _hover={{ bg: "gray.100" }}
        borderTopWidth="1px"
        borderColor="border.muted"
        color="blue.500"
        onClick={onCreatePrompt}
      >
        <Plus size={14} />
        <Text fontSize="sm">Add New Prompt</Text>
      </HStack>

      <HStack
        paddingX={3}
        paddingY={2}
        borderTop="1px solid"
        borderColor="border"
      >
        <Text fontSize="xs" color="fg.muted">
          {selectedTargets.length} of {totalCount} selected
        </Text>
      </HStack>
    </Box>
  );
}
