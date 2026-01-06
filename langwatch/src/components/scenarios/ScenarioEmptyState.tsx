import { Button, Text, VStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";

type ScenarioEmptyStateProps = {
  onCreateClick: () => void;
};

/**
 * Empty state shown when no scenarios exist.
 */
export function ScenarioEmptyState({ onCreateClick }: ScenarioEmptyStateProps) {
  return (
    <VStack gap={4} align="center" py={12}>
      <Text fontSize="lg" color="gray.500">
        No scenarios yet
      </Text>
      <Text fontSize="sm" color="gray.400">
        Create your first scenario to get started
      </Text>
      <Button colorPalette="blue" onClick={onCreateClick}>
        <Plus size={16} /> Create Scenario
      </Button>
    </VStack>
  );
}




