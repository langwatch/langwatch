import { Box, HStack, Tabs } from "@chakra-ui/react";
import { PromptStudioChat } from "../../chat/PromptStudioChat";
import { useFormContext } from "react-hook-form";
import type { PromptConfigFormValues } from "~/prompt-configs/types";
import { SettingsTabContent } from "./SettingsTabContent";
import { useRef } from "react";

enum PromptTab {
  Conversation = "conversation",
  Variables = "variables",
  Settings = "settings",
}

/**
 * Tabbed section of the prompt browser window that contains the conversation, variables, and settings tabs.
 */
export function PromptTabbedSection() {
  const form = useFormContext<PromptConfigFormValues>();

  return (
    <Tabs.Root
      defaultValue={PromptTab.Conversation}
      display="flex"
      flexDirection="column"
      flex={1}
      width="full"
    >
      <Tabs.List colorPalette="orange">
        <Tabs.Trigger value={PromptTab.Conversation}>Conversation</Tabs.Trigger>
        <Tabs.Trigger value={PromptTab.Variables}>Variables</Tabs.Trigger>
        <Tabs.Trigger value={PromptTab.Settings}>Settings</Tabs.Trigger>
      </Tabs.List>
      <HStack flex={1} width="full">
        <Tabs.Content
          value={PromptTab.Conversation}
          flex={1}
          width="full"
          height="full"
          display="flex"
          position="relative"
        >
          <Box
            position="absolute"
            bottom={0}
            left={0}
            width="full"
            maxHeight="full"
            overflowY="scroll"
          >
            <PromptStudioChat formValues={form.getValues()} />
          </Box>
        </Tabs.Content>
        <Tabs.Content value={PromptTab.Variables}>
          <Box height="full" width="full">
            Prompt
          </Box>
        </Tabs.Content>
        <Tabs.Content value={PromptTab.Settings} flex={1} width="full">
          <Box height="full" width="full">
            <SettingsTabContent />
          </Box>
        </Tabs.Content>
      </HStack>
    </Tabs.Root>
  );
}
