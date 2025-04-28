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
    <Button
      onClick={onClick}
      justifyContent="space-between"
      variant="outline"
      width="full"
    >
      <HStack justifyContent="space-between" width="full">
        <HStack width="full">
          <Book size={16} />
          <Text width="90%" overflow="hidden" textOverflow="ellipsis">
            {selectedConfig ? selectedConfig.name : "Select a prompt"}
          </Text>
        </HStack>
        <ChevronDown size={16} />
      </HStack>
    </Button>
  );
}
