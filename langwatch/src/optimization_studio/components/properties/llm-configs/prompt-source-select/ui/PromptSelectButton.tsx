import { Button, HStack, Text } from "@chakra-ui/react";
import { Book, ChevronDown } from "react-feather";

// Prompt Selection Button Component
interface PromptSelectionButtonProps {
  selectedConfig: any;
  onClick: () => void;
}

export function PromptSelectionButton({
  selectedConfig,
  onClick,
}: PromptSelectionButtonProps) {
  return (
    <Button onClick={onClick} justifyContent="space-between" variant="outline">
      <HStack width="full" justifyContent="space-between">
        <HStack>
          <Book size={16} />
          <Text width="full" overflow="hidden" textOverflow="ellipsis">
            {selectedConfig ? selectedConfig.name : "Select a prompt"}
          </Text>
        </HStack>
        <ChevronDown size={16} />
      </HStack>
    </Button>
  );
}
