import { Sidebar } from "./ui/Sidebar";
import { PublishedPromptsList } from "./PublishedPromptsList";
import { DraftPromptsList } from "./DraftPromptsList";
import { Text } from "@chakra-ui/react";
import { AddPromptButton } from "./AddPromptButton";
import { SessionSnapshotsList } from "./SessionSnapshotsList";
import { ConversationHistoryList } from "./ConversationHistoryList";

export function PromptStudioSidebar() {
  return (
    <Sidebar.Root>
      <Sidebar.Section>
        <Sidebar.SectionHeader>
          <Text>Prompts</Text>
          <AddPromptButton />
        </Sidebar.SectionHeader>
        <PublishedPromptsList />
        <DraftPromptsList />
      </Sidebar.Section>
      <Sidebar.Section>
        <Sidebar.SectionHeader>
          <Text>Sessions</Text>
        </Sidebar.SectionHeader>
        <SessionSnapshotsList />
        <ConversationHistoryList />
      </Sidebar.Section>
    </Sidebar.Root>
  );
}
