import { Center, EmptyState } from "@chakra-ui/react";
import { LuFileText } from "react-icons/lu";

/**
 * Empty state for when user has prompts but no tabs open.
 * Single Responsibility: Guide users to open existing prompts or create new ones.
 */
export function NoTabsOpenState() {
  return (
    <Center width="full" height="full" bg="white">
      <EmptyState.Root>
        <EmptyState.Content>
          <EmptyState.Indicator>
            <LuFileText />
          </EmptyState.Indicator>
          <EmptyState.Title>No prompts open</EmptyState.Title>
          <EmptyState.Description>
            Click the + button in the sidebar to create your first prompt, or
            select an existing prompt to get started.
          </EmptyState.Description>
        </EmptyState.Content>
      </EmptyState.Root>
    </Center>
  );
}
