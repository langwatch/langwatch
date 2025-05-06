import { IconButton } from "@chakra-ui/react";
import { Tooltip } from "./ui/tooltip";
import { UnplugIcon } from "lucide-react";

export function GenerateApiSnippetButton({
  onClick,
}: {
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <Tooltip
      content="Show API code snippet"
      positioning={{ placement: "top" }}
      openDelay={0}
      showArrow
    >
      <IconButton
        aria-label="Show API code snippet"
        size="sm"
        variant="outline"
        onClick={onClick}
      >
        <UnplugIcon />
      </IconButton>
    </Tooltip>
  );
}
