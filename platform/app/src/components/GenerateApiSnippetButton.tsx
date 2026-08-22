import { Button, type ButtonProps } from "@chakra-ui/react";
import { UnplugIcon } from "lucide-react";

import { Tooltip } from "./ui/tooltip";

export function GenerateApiSnippetButton({
  hasHandle,
  onClick,
  size = "sm",
}: {
  hasHandle: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /** Matches the row it sits in. The editor header runs a tighter scale. */
  size?: ButtonProps["size"];
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
      {/* No background of its own: it sits in rows next to other outline
          buttons, and painting `bg` on this one alone made it the odd colour
          out on any surface that is not `bg` — every card in the product. */}
      <Button
        aria-label="Show API code snippet"
        disabled={!hasHandle}
        size={size}
        variant="outline"
        onClick={onClick}
      >
        <UnplugIcon size={12} />
        API
      </Button>
    </Tooltip>
  );
}
