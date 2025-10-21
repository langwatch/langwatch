import { HStack } from "@chakra-ui/react";
import { PromptStudioTabbedWorkSpace } from "./prompt-browser/PromptStudioTabbedWorkSpace";

export function PromptStudioMainContent() {
  return (
    <HStack width="full" height="full" gap={0} overflowX="scroll">
      <PromptStudioTabbedWorkSpace />
    </HStack>
  );
}
