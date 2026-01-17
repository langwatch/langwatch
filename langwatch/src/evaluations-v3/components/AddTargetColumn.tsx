import { Button, HStack, Text } from "@chakra-ui/react";
import { Plus } from "lucide-react";

import { PulsingDot } from "./PulsingDot";

type AddTargetColumnProps = {
  onAddClick: () => void;
  hasTargets: boolean;
  isLoading?: boolean;
};

/**
 * Column content for the spacer column that shows the "Add" or "Add Comparison" button.
 * When there are no targets, shows the full CTA with pulsing dot.
 * When there are targets, shows just the "Add Comparison" button.
 */
export function AddTargetColumn({
  onAddClick,
  hasTargets,
  isLoading,
}: AddTargetColumnProps) {
  if (isLoading) {
    return null;
  }

  if (!hasTargets) {
    // No targets yet - show the full CTA
    return (
      <HStack gap={3}>
        <Button
          size="xs"
          variant="ghost"
          onClick={onAddClick}
          color="gray.500"
          _hover={{ color: "gray.700" }}
        >
          <Plus size={12} />
          Add
          <PulsingDot />
        </Button>
        <Text fontSize="xs" color="gray.400" fontStyle="italic">
          Click to get started
        </Text>
      </HStack>
    );
  }

  // Has targets - show "Add Comparison" button
  return (
    <HStack>
      <Button
        size="xs"
        variant="ghost"
        onClick={onAddClick}
        color="gray.500"
        _hover={{ color: "gray.700" }}
      >
        <Plus size={12} />
        Add Comparison
      </Button>
    </HStack>
  );
}
