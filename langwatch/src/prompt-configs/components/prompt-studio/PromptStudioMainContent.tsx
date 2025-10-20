import { HStack } from "@chakra-ui/react";
import { PromptStudioTabbedWorkSpace } from "./tabbed-workspace/PromptStudioTabbedWorkSpace";

export function PromptStudioMainContent() {
  return (
    <HStack width="full" height="full" gap={0} overflowX="scroll">
      <PromptStudioTabbedWorkSpace />
      <PromptStudioTabbedWorkSpace />
    </HStack>
  );
}
