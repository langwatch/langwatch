import { HStack } from "@chakra-ui/react";
import { useLoadSpanIntoPromptPlayground } from "../hooks/useLoadSpanIntoPromptPlayground";
import { useDraggableTabsBrowserStore } from "../prompt-playground-store/DraggableTabsBrowserStore";
import { PromptPlaygroundBrowser } from "./prompt-browser/PromptPlaygroundBrowser";
import { MainContentEmptyState } from "./sidebar/ui/MainContentEmptyState";

/**
 * PromptPlaygroundMainContent
 * Single Responsibility: Render the main content area containing the tabbed workspace for prompts.
 */
export function PromptPlaygroundMainContent() {
  /**
   * Load the span into the prompt playground when the component mounts.
   * We need to do this here, because if there are no tabs, the rest of the tree
   * doesn't mount and it won't load the span.
   */
  useLoadSpanIntoPromptPlayground();
  const hasNoTabs = useDraggableTabsBrowserStore(
    ({ windows }) =>
      windows.length === 0 || windows.every((w) => w.tabs.length === 0),
  );

  if (hasNoTabs) return <MainContentEmptyState />;

  return (
    <HStack width="full" height="full" gap={0} overflowX="scroll" bg="white">
      <PromptPlaygroundBrowser />
    </HStack>
  );
}
