import { HStack } from "@chakra-ui/react";
import { PromptStudioTabbedWorkspace } from "./prompt-browser/PromptStudioTabbedWorkspace";
import { useDraggableTabsBrowserStore } from "../prompt-studio-store/DraggableTabsBrowserStore";
import { MainContentEmptyState } from "./sidebar/ui/MainContentEmptyState";

export function PromptStudioMainContent() {
  const { windows } = useDraggableTabsBrowserStore();
  const hasNoTabs = windows.length === 0 || windows.every((w) => w.tabs.length === 0);

  if (hasNoTabs) {
    return <MainContentEmptyState />;
  }

  return (
    <HStack width="full" height="full" gap={0} overflowX="scroll" bg="white">
      <PromptStudioTabbedWorkspace />
    </HStack>
  );
}
