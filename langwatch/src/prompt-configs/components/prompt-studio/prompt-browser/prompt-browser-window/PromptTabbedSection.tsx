import { Box, Tabs } from "@chakra-ui/react";

enum PromptTab {
  Conversation = "conversation",
  Variables = "variables",
  Settings = "settings",
}

export function PromptTabbedSection() {
  return (
    <Box height="full" width="full" bg="white">
      <Tabs.Root defaultValue={PromptTab.Conversation}>
        <Tabs.List colorPalette="orange">
          <Tabs.Trigger value={PromptTab.Conversation}>
            Conversation
          </Tabs.Trigger>
          <Tabs.Trigger value={PromptTab.Variables}>Variables</Tabs.Trigger>
          <Tabs.Trigger value={PromptTab.Settings}>Settings</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value={PromptTab.Conversation}>
          <Box height="full" width="full" bg="white">
            Prompt
          </Box>
        </Tabs.Content>
        <Tabs.Content value={PromptTab.Variables}>
          <Box height="full" width="full" bg="white">
            Prompt
          </Box>
        </Tabs.Content>
        <Tabs.Content value={PromptTab.Settings}>
          <Box height="full" width="full" bg="white">
            Prompt
          </Box>
        </Tabs.Content>
      </Tabs.Root>
    </Box>
  );
}
