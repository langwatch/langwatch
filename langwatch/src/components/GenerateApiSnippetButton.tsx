import { Button } from "@chakra-ui/react";
import { Tooltip } from "./ui/tooltip";
import { UnplugIcon } from "lucide-react";
import type { LlmConfigWithLatestVersion } from "../server/prompt-config/repositories/llm-config.repository";

export function GenerateApiSnippetButton({
  config,
  onClick,
}: {
  config: LlmConfigWithLatestVersion;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <Tooltip
      content={
        config.handle
          ? "Show API code snippet"
          : "Save the prompt to call it from the API"
      }
      positioning={{ placement: "top" }}
      openDelay={0}
      showArrow
    >
      <Button
        aria-label="Show API code snippet"
        disabled={!config.handle}
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
