import { PublishedPromptsList } from "./published-prompts-list.tsx";
import { Sidebar } from "../studio-internals.ts";

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
