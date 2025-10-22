import { Box, Tabs, VStack } from "@chakra-ui/react";
import { PromptStudioChat } from "../../chat/PromptStudioChat";
import { useFormContext } from "react-hook-form";
import type { PromptConfigFormValues } from "~/prompt-configs/types";
import { ModelSelectField } from "~/prompt-configs/forms/fields/ModelSelectField";
import {
  InputsFieldGroup,
  OutputsFieldGroup,
} from "~/prompt-configs/forms/fields/PromptConfigVersionFieldGroup";
import { DemonstrationsField } from "~/prompt-configs/forms/fields/DemonstrationsField";

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
            <PromptStudioChat formValues={form.getValues()} />
          </Box>
        </Tabs.Content>
        <Tabs.Content value={PromptTab.Variables}>
          <Box height="full" width="full" bg="white">
            Prompt
          </Box>
        </Tabs.Content>
        <Tabs.Content value={PromptTab.Settings}>
          <Box height="full" width="full" bg="white">
            <VStack width="full" gap={6} p={3} align="start">
              <ModelSelectField />
              <InputsFieldGroup />
              <OutputsFieldGroup />
              <DemonstrationsField />
            </VStack>
          </Box>
        </Tabs.Content>
      </Tabs.Root>
    </Box>
  );
}
