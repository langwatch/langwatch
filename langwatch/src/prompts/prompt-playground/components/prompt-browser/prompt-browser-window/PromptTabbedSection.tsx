import { Box, HStack, Tabs, IconButton } from "@chakra-ui/react";
import {
  PromptPlaygroundChat,
  type PromptPlaygroundChatRef,
} from "../../chat/PromptPlaygroundChat";
import { useFormContext } from "react-hook-form";
import type { PromptConfigFormValues } from "~/prompts/types";
import { SettingsTabContent } from "./SettingsTabContent";
import { useState, useRef } from "react";
import { VariablesForm } from "./VariablesForm";
import type { z } from "zod";
import { type runtimeInputsSchema } from "~/prompts/schemas/field-schemas";
import { LuPencil } from "react-icons/lu";

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
  const inputs = form.watch("version.configData.inputs") ?? [];
  const [variables, setVariables] = useState<
    z.infer<typeof runtimeInputsSchema>
  >([]);
  const formValues = form.watch();
  const hasInputs = inputs.length > 0;
  const chatRef = useRef<PromptPlaygroundChatRef>(null);

  return (
    <Tabs.Root
      defaultValue={PromptTab.Conversation}
      display="flex"
      flexDirection="column"
      flex={1}
      width="full"
    >
      <Tabs.List
        colorPalette="orange"
        paddingX={3}
        display="flex"
        alignItems="center"
      >
        <Tabs.Trigger value={PromptTab.Conversation}>Conversation</Tabs.Trigger>
        {hasInputs && (
          <Tabs.Trigger value={PromptTab.Variables}>Variables</Tabs.Trigger>
        )}
        <Tabs.Trigger value={PromptTab.Settings}>Settings</Tabs.Trigger>
        <Tabs.Context>
          {(tabs) => (
            <>
              <Box flex={1} />
              {tabs.value === PromptTab.Conversation && (
                <IconButton
                  size="sm"
                  variant="ghost"
                  onClick={() => chatRef.current?.resetChat()}
                  aria-label="Reset chat"
                >
                  <LuPencil size={16} />
                </IconButton>
              )}
            </>
          )}
        </Tabs.Context>
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
            <PromptPlaygroundChat
              ref={chatRef}
              formValues={formValues}
              variables={variables}
            />
          </Box>
        </Tabs.Content>
        <Tabs.Content value={PromptTab.Variables} height="full">
          <Box height="full" width="full" maxWidth="768px" margin="0 auto">
            <VariablesForm inputs={inputs} onChange={setVariables} />
          </Box>
        </Tabs.Content>
        <Tabs.Content
          value={PromptTab.Settings}
          flex={1}
          width="full"
          height="full"
        >
          <Box height="full" width="full" maxWidth="768px" margin="0 auto">
            <SettingsTabContent />
          </Box>
        </Tabs.Content>
      </HStack>
    </Tabs.Root>
  );
}
