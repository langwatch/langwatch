import { HStack } from "@chakra-ui/react";
import { PromptStudioTabbedWorkspace } from "./prompt-browser/PromptStudioTabbedWorkspace";
import { useDraggableTabsBrowserStore } from "../prompt-studio-store/DraggableTabsBrowserStore";
import { MainContentEmptyState } from "./sidebar/ui/MainContentEmptyState";
import { useLoadSpanIntoPromptStudio } from "../hooks/useLoadSpanIntoPromptStudio";

export function PromptStudioMainContent() {
  /**
   * Load the span into the prompt studio when the component mounts.
   * We need to do this here, because if there are no tabs, the rest of the tree
   * doesn't mount and it won't load the span.
   */
  useLoadSpanIntoPromptStudio();
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
