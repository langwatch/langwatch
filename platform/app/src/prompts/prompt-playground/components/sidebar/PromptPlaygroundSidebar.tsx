import { PublishedPromptsList } from "./PublishedPromptsList";
import { Sidebar } from "@langwatch/prompt-web/screens/prompt-studio";

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
