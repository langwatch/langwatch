import { Sidebar } from "./ui/Sidebar";
import { PublishedPromptsList } from "./PublishedPromptsList";
import { Text } from "@chakra-ui/react";
import { AddPromptButton } from "./AddPromptButton";

/**
 * The Prompt Playground sidebar component.
 * Note: drafts and sessions are not yet supported
 */
export function PromptPlaygroundSidebar() {
  return (
    <Sidebar.Root>
      <Sidebar.Section>
        <Sidebar.SectionHeader>
          <Text>Prompts</Text>
          <AddPromptButton />
        </Sidebar.SectionHeader>
        <PublishedPromptsList />
      </Sidebar.Section>
    </Sidebar.Root>
  );
}
