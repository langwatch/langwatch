import {
  Button,
  Center,
  EmptyState,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { LuFileText } from "react-icons/lu";
import { useAllPromptsForProject } from "~/prompts/hooks/useAllPromptsForProject";
import { getDisplayHandle } from "~/prompts/utils/promptHandle";
import { useOpenPromptInPlayground } from "../../../hooks/useOpenPromptInPlayground";
import { AddPromptButton } from "../AddPromptButton";

/** Useful landing state when the library exists but the workspace is empty. */
export function NoTabsOpenState() {
  const { data } = useAllPromptsForProject();
  const openPrompt = useOpenPromptInPlayground();
  const recentPrompts = [...(data ?? [])]
    .filter((prompt) => prompt.version > 0)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 3);

  return (
    <Center width="full" height="full" background="bg.subtle">
      <EmptyState.Root maxWidth="520px">
        <EmptyState.Content>
          <EmptyState.Indicator>
            <LuFileText />
          </EmptyState.Indicator>
          <EmptyState.Title>Open a prompt to start working</EmptyState.Title>
          <EmptyState.Description>
            Choose one from the library, or start a new prompt. Open prompts
            stay in their tabs when you come back.
          </EmptyState.Description>
          <VStack gap={3}>
            {recentPrompts.length > 0 && (
              <HStack gap={2} flexWrap="wrap" justify="center">
                {recentPrompts.map((prompt) => (
                  <Button
                    key={prompt.id}
                    size="sm"
                    variant="outline"
                    onClick={() => openPrompt(prompt)}
                  >
                    {getDisplayHandle(prompt.handle)}
                    <Text as="span" textStyle="2xs" color="fg.subtle">
                      v{prompt.version}
                    </Text>
                  </Button>
                ))}
              </HStack>
            )}
            <AddPromptButton size="sm" colorPalette="blue" />
          </VStack>
        </EmptyState.Content>
      </EmptyState.Root>
    </Center>
  );
}
