import { Button, HStack, Text } from "@chakra-ui/react";
import { Archive } from "lucide-react";

/**
 * Action bar that appears when one or more table rows are selected.
 * Shows the number of selected items and provides bulk actions.
 */
export function BatchActionBar({
  selectedCount,
  onArchive,
}: {
  selectedCount: number;
  onArchive: () => void;
}) {
  if (selectedCount === 0) return null;

  return (
    <HStack
      bg="bg.muted"
      px={4}
      py={2}
      borderRadius="md"
      justify="space-between"
      data-testid="batch-action-bar"
    >
      <Text fontSize="sm" fontWeight="medium">
        {selectedCount} selected
      </Text>
      <Button
        size="sm"
        variant="outline"
        colorPalette="red"
        onClick={onArchive}
      >
        <Archive size={14} />
        Archive
      </Button>
    </HStack>
  );
}
