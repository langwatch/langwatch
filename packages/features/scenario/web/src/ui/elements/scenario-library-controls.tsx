import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { Popover } from "@langwatch/design-system/popover";
import { Archive, Plus, Tag } from "lucide-react";
import { SmallButton } from "./agent-testing/shared/small-button";

export function ScenarioLabelFilter({
  allLabels,
  activeLabels,
  onToggle,
  triggerSize,
}: {
  allLabels: string[];
  activeLabels: string[];
  onToggle(label: string): void;
  /**
   * "header" draws the trigger at the page-header button size, matching the
   * PageLayout.HeaderButton beside it. Unset keeps the Agent Testing small
   * button, which is what the scenarios panel wants.
   */
  triggerSize?: "header";
}) {
  const hasActiveFilters = activeLabels.length > 0;

  const triggerContent = (
    <>
      <Tag size={triggerSize === "header" ? 16 : 13} />
      Labels
      {hasActiveFilters && (
        <Text as="span" fontSize="12px" ml={1}>
          ({activeLabels.length})
        </Text>
      )}
    </>
  );

  return (
    <Popover.Root positioning={{ placement: "bottom-start" }}>
      <Popover.Trigger asChild>
        {triggerSize === "header" ? (
          <Button
            size="sm"
            variant={hasActiveFilters ? "solid" : "outline"}
            colorPalette={hasActiveFilters ? "blue" : "gray"}
          >
            {triggerContent}
          </Button>
        ) : (
          <SmallButton>{triggerContent}</SmallButton>
        )}
      </Popover.Trigger>
      <Popover.Content width="200px">
        <Popover.Body>
          {allLabels.length === 0 ? (
            <Text fontSize="sm" color="fg.muted">
              No labels available
            </Text>
          ) : (
            <VStack align="stretch" gap={2}>
              {allLabels.map((label) => (
                <HStack key={label} cursor="pointer" onClick={() => onToggle(label)}>
                  <Checkbox checked={activeLabels.includes(label)} />
                  <Text fontSize="sm">{label}</Text>
                </HStack>
              ))}
            </VStack>
          )}
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
}

export function ScenarioBatchActionBar({
  selectedCount,
  onArchive,
}: {
  selectedCount: number;
  onArchive(): void;
}) {
  if (selectedCount === 0) {
    return null;
  }

  return (
    <Box
      position="fixed"
      bottom={10}
      left="50%"
      transform="translateX(-50%)"
      backgroundColor="#ffffff"
      border="1px solid #ccc"
      boxShadow="0 0 15px rgba(0, 0, 0, 0.2)"
      borderRadius="md"
      padding="8px"
      paddingX="16px"
      zIndex={1000}
      data-bottom-floating-bar=""
      data-testid="batch-action-bar"
    >
      <HStack gap={3}>
        <Text whiteSpace="nowrap" fontSize="sm" fontWeight="medium">
          {selectedCount} selected
        </Text>
        <Button size="sm" variant="outline" colorPalette="orange" onClick={onArchive}>
          <Archive size={14} />
          Archive
        </Button>
      </HStack>
    </Box>
  );
}

export function ScenarioEmptyState({ onCreateClick }: { onCreateClick(): void }) {
  return (
    <VStack gap={4} align="center" py={12}>
      <Text fontSize="lg" color="fg.muted">
        No scenarios yet
      </Text>
      <Text fontSize="sm" color="fg.subtle">
        Create your first scenario to get started
      </Text>
      <Button colorPalette="blue" onClick={onCreateClick}>
        <Plus size={16} /> Create Scenario
      </Button>
    </VStack>
  );
}
