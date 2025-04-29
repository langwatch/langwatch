import { Button, HStack, Text } from "@chakra-ui/react";
import { Book, ChevronDown } from "react-feather";
import { Tooltip } from "../../../../../../components/ui/tooltip";

// Prompt Selection Button Component
interface PromptSelectionButtonProps {
  selectedConfig?: { name: string };
  onClick: () => void;
}

export function PromptSelectionButton({
  selectedConfig,
  onClick,
}: PromptSelectionButtonProps) {
  return (
    <Tooltip
      content="Select another prompt"
      positioning={{ placement: "top" }}
      openDelay={0}
      showArrow
    >
      <Button
        onClick={onClick}
        justifyContent="space-between"
        variant="outline"
      >
        <Book size={16} />
      </Button>
    </Tooltip>
  );
}
