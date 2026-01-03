import { Box, Button, HStack, Tabs } from "@chakra-ui/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useFormContext } from "react-hook-form";
import { LuSquarePen } from "react-icons/lu";
import { VariablesSection, type Variable } from "~/components/variables";
import { Tooltip } from "~/components/ui/tooltip";
import type { PromptConfigFormValues } from "~/prompts/types";
import type { LlmConfigInputType } from "~/types";
import {
  PromptPlaygroundChat,
  type PromptPlaygroundChatRef,
} from "../../chat/PromptPlaygroundChat";
import { SettingsTabContent } from "./SettingsTabContent";

/** The default "input" variable is locked - cannot be removed or renamed */
const LOCKED_VARIABLES = new Set(["input"]);

/** Info tooltips for special variables */
const VARIABLE_INFO: Record<string, string> = {
  input: "This value comes from the Conversation tab input",
};

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
  // Track runtime variable values (keyed by identifier)
  const [variableValues, setVariableValues] = useState<Record<string, string>>(
    {},
  );
  const formValues = form.watch();
  const hasInputs = inputs.length > 0;
  const chatRef = useRef<PromptPlaygroundChatRef>(null);
  const [activeTab, setActiveTab] = useState<PromptTab>(PromptTab.Conversation);

  // Convert inputs to Variable[] format
  const variables: Variable[] = inputs.map((input) => ({
    identifier: input.identifier,
    type: input.type,
  }));

  // Handle value changes
  const handleValueChange = useCallback(
    (identifier: string, value: string) => {
      setVariableValues((prev) => ({
        ...prev,
        [identifier]: value,
      }));
    },
    [],
  );

  // Handle variable schema changes (add/remove/edit identifier/type)
  const handleVariablesChange = useCallback(
    (newVariables: Variable[]) => {
      form.setValue(
        "version.configData.inputs",
        newVariables.map((v) => ({
          identifier: v.identifier,
          type: v.type as LlmConfigInputType,
        })),
      );
    },
    [form],
  );

  // Convert variableValues to the format expected by PromptPlaygroundChat
  const runtimeVariables = inputs.map((input) => ({
    identifier: input.identifier,
    type: input.type,
    value: variableValues[input.identifier] ?? "",
  }));

  return (
    <Tabs.Root
      value={activeTab}
      onValueChange={(change) => setActiveTab(change.value as PromptTab)}
      display="flex"
      flexDirection="column"
      flex={1}
      width="full"
      variant="subtle"
      size="sm"
    >
      <Tabs.List
        paddingX={3}
        display="flex"
        alignItems="center"
        borderBottom="1px solid"
        borderColor="gray.100"
        height={8}
        paddingBottom={2}
      >
        <HStack width="full" maxWidth="768px" margin="0 auto">
          <Tabs.Trigger value={PromptTab.Conversation}>
            Conversation
          </Tabs.Trigger>
          {hasInputs && (
            <Tabs.Trigger value={PromptTab.Variables}>Variables</Tabs.Trigger>
          )}
          <Tabs.Trigger value={PromptTab.Settings}>Settings</Tabs.Trigger>
          <Tabs.Context>
            {(tabs) => (
              <>
                <Box flex={1} />
                {tabs.value === PromptTab.Conversation && (
                  <Tooltip
                    content="Start a new conversation"
                    positioning={{ placement: "top" }}
                    openDelay={0}
                  >
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => chatRef.current?.resetChat()}
                      aria-label="Reset chat"
                    >
                      <LuSquarePen />
                    </Button>
                  </Tooltip>
                )}
              </>
            )}
          </Tabs.Context>
        </HStack>
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
              variables={runtimeVariables}
            />
          </Box>
        </Tabs.Content>
        <Tabs.Content value={PromptTab.Variables} height="full">
          <Box
            height="full"
            width="full"
            maxWidth="768px"
            margin="0 auto"
            padding={3}
          >
            <VariablesSection
              variables={variables}
              onChange={handleVariablesChange}
              values={variableValues}
              onValueChange={handleValueChange}
              showMappings={false}
              canAddRemove={true}
              readOnly={false}
              title="Variables"
              lockedVariables={LOCKED_VARIABLES}
              variableInfo={VARIABLE_INFO}
              disabledMappings={LOCKED_VARIABLES}
            />
          </Box>
        </Tabs.Content>
        {activeTab === PromptTab.Settings && (
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
        )}
      </HStack>
    </Tabs.Root>
  );
}
