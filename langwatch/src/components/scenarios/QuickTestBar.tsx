import { HStack, Text } from "@chakra-ui/react";
import { PromptSelector } from "./PromptSelector";

interface QuickTestBarProps {
  selectedPromptId: string[];
  onPromptChange: (value: string[]) => void;
}

/**
 * Quick Test section in the scenario editor footer.
 * Allows selecting a prompt for quick testing.
 */
export function QuickTestBar({
  selectedPromptId,
  onPromptChange,
}: QuickTestBarProps) {
  return (
    <HStack gap={4}>
      <Text
        fontSize="xs"
        fontWeight="bold"
        textTransform="uppercase"
        color="gray.500"
      >
        Quick Test
      </Text>
      <HStack gap={2}>
        <Text fontSize="sm" color="gray.600">
          Prompt:
        </Text>
        <PromptSelector value={selectedPromptId} onChange={onPromptChange} />
      </HStack>
    </HStack>
  );
}



