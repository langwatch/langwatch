import { Text } from "@chakra-ui/react";
import { AddPromptButton } from "./AddPromptButton";
import { PublishedPromptsList } from "./PublishedPromptsList";
import { Sidebar } from "./ui/Sidebar";

/**
 * The Prompt Playground sidebar component.
 * Note: drafts and sessions are not yet supported
 */
export function PromptPlaygroundSidebar() {
  return (
    <Sidebar.Root>
      <Sidebar.Section>
        <PublishedPromptsList />
      </Sidebar.Section>
    </Sidebar.Root>
  );
}
