import { Center, EmptyState } from "@chakra-ui/react";
import { LuFileText } from "react-icons/lu";

/**
 * Empty state component for the main content area when no tabs are open.
 * Single Responsibility: Display a welcoming empty state to guide users to create or open a prompt.
 */
export function MainContentEmptyState() {
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

