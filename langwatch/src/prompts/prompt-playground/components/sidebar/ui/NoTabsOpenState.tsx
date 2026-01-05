import { Center, EmptyState, HStack, Spacer, VStack } from "@chakra-ui/react";
import { LuFileText } from "react-icons/lu";
import { AddPromptButton } from "../AddPromptButton";

/**
 * Empty state for when user has prompts but no tabs open.
 * Single Responsibility: Guide users to open existing prompts or create new ones.
 */
export function NoTabsOpenState() {
  return (
    <VStack width="full" height="full">
      <HStack width="full" paddingTop="18px" paddingRight="12px">
        <Spacer />
        <AddPromptButton />
      </HStack>
      <Center width="full" height="full" bg="white">
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
