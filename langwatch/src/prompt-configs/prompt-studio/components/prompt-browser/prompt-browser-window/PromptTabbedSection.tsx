import { Box, HStack, Tabs } from "@chakra-ui/react";
import { PromptStudioChat } from "../../chat/PromptStudioChat";
import { useFormContext } from "react-hook-form";
import type { PromptConfigFormValues } from "~/prompt-configs/types";
import { SettingsTabContent } from "./SettingsTabContent";
import { useMemo, useState } from "react";
import { VariablesForm } from "./VariablesForm";
import type { z } from "zod";
import { type runtimeInputsSchema } from "~/prompt-configs/schemas/field-schemas";

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
  const inputs = form.getValues().version.configData.inputs ?? [];
  const [variables, setVariables] = useState<
    z.infer<typeof runtimeInputsSchema>
  >([]);
  const formValues = useMemo(() => form.getValues(), [form]);
  const hasInputs = inputs.length > 0;

  return (
    <Tabs.Root
      defaultValue={PromptTab.Conversation}
      display="flex"
      flexDirection="column"
      flex={1}
      width="full"
    >
      <Tabs.List colorPalette="orange" paddingX={3}>
        <Tabs.Trigger value={PromptTab.Conversation}>Conversation</Tabs.Trigger>
        {hasInputs && (
          <Tabs.Trigger value={PromptTab.Variables}>Variables</Tabs.Trigger>
        )}
        <Tabs.Trigger value={PromptTab.Settings}>Settings</Tabs.Trigger>
      </Tabs.List>
      <HStack flex={1} width="full" margin="0 auto">
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
            height="full"
            maxHeight="full"
          >
            <PromptStudioChat formValues={formValues} variables={variables} />
          </Box>
        </Tabs.Content>
        <Tabs.Content value={PromptTab.Variables} height="full">
          <Box height="full" width="full">
            <VariablesForm inputs={inputs} onChange={setVariables} />
          </Box>
        </Tabs.Content>
        <Tabs.Content
          value={PromptTab.Settings}
          flex={1}
          width="full"
          height="full"
        >
          <Box height="full" width="full">
            <SettingsTabContent />
          </Box>
        </Tabs.Content>
      </HStack>
    </Tabs.Root>
  );
}
