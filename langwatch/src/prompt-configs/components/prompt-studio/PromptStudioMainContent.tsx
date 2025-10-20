import { Box } from "@chakra-ui/react";
import { PromptStudioTabbedWorkSpace } from "./tabbed-workspace/PromptStudioTabbedWorkSpace";

export function PromptStudioMainContent() {
  return (
    <Box>
      <PromptStudioTabbedWorkSpace />
      <PromptStudioTabbedWorkSpace />
    </Box>
  );
}
