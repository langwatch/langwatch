import { Button } from "@chakra-ui/react";
import { LuFolder } from "react-icons/lu";
import { Tooltip } from "@langwatch/design-system/tooltip";

interface PromptSelectionButtonProps {
  onClick: () => void;
}

export function PromptSelectionButton({ onClick }: PromptSelectionButtonProps) {
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
        background="bg"
      >
        <LuFolder size={16} />
      </Button>
    </Tooltip>
  );
}
