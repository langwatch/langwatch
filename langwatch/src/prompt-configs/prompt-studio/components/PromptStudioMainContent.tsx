import { HStack } from "@chakra-ui/react";
import { PromptStudioTabbedWorkSpace } from "./prompt-browser/PromptStudioTabbedWorkSpace";
import { usePromptStudioStore } from "../prompt-studio-store/store";
import { useMemo } from "react";

export function PromptStudioMainContent() {
  return (
    <HStack width="full" height="full" gap={0} overflowX="scroll">
      <PromptStudioTabbedWorkSpace />
    </HStack>
  );
}
