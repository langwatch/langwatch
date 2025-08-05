import { Button } from "@chakra-ui/react";
import { LuFolder } from "react-icons/lu";
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
        background="white"
      >
        <LuFolder size={16} />
      </Button>
    </Tooltip>
  );
}
