import { Center, EmptyState, Spacer, VStack } from "@chakra-ui/react";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { LuFileText } from "react-icons/lu";

import { AddPromptButton } from "./add-prompt-button.tsx";

/**
 * Empty state for when user has prompts but no tabs open.
 * Single Responsibility: Guide users to open existing prompts or create new ones.
 */
export function NoTabsOpenState() {
  return (
    <VStack width="full" height="full">
      <PageLayout.Header withBorder={false}>
        <Spacer />
        <AddPromptButton />
      </PageLayout.Header>
      <Center width="full" height="full" bg="bg.panel">
        <EmptyState.Root>
          <EmptyState.Content>
            <EmptyState.Indicator>
              <LuFileText />
            </EmptyState.Indicator>
            <EmptyState.Title>No prompts open</EmptyState.Title>
            <EmptyState.Description>
              Create a new prompt or select an existing prompt to get started.
            </EmptyState.Description>
          </EmptyState.Content>
        </EmptyState.Root>
      </Center>
    </VStack>
  );
}
