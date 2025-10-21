import { HStack } from "@chakra-ui/react";
import { PromptStudioTabbedWorkspace } from "./prompt-browser/PromptStudioTabbedWorkspace";

export function PromptStudioMainContent() {
  return (
    <HStack width="full" height="full" gap={0} overflowX="scroll">
      <PromptStudioTabbedWorkspace />
    </HStack>
  );
}
