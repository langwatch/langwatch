import { PublishedPromptsList } from "./published-prompts-list";
import { Sidebar } from "../studio-internals";

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
