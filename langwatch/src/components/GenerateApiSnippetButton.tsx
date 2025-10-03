import { Button } from "@chakra-ui/react";
import { UnplugIcon } from "lucide-react";

import { Tooltip } from "./ui/tooltip";

export function GenerateApiSnippetButton({
  hasHandle,
  onClick,
}: {
  hasHandle: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <Tooltip
      content={
        hasHandle
          ? "Show API code snippet"
          : "Save the prompt to call it from the API"
      }
      positioning={{ placement: "top" }}
      openDelay={0}
      showArrow
    >
      <Button
        aria-label="Show API code snippet"
        disabled={!hasHandle}
        size="sm"
        variant="outline"
        backgroundColor="white"
        onClick={onClick}
      >
        <UnplugIcon />
        API
      </Button>
    </Tooltip>
  );
}
