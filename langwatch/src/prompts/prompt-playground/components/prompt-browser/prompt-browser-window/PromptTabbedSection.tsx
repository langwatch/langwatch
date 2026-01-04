import { Box, Button, HStack, Tabs } from "@chakra-ui/react";
import { useCallback, useRef, useState } from "react";
import { useFormContext } from "react-hook-form";
import { LuEraser } from "react-icons/lu";
import { useDebounceCallback } from "usehooks-ts";
import { VariablesSection, type Variable } from "~/components/variables";
import { Tooltip } from "~/components/ui/tooltip";
import { transposeColumnsFirstToRowsFirstWithId } from "~/optimization_studio/utils/datasetUtils";
import type { PromptConfigFormValues } from "~/prompts/types";
import type { LlmConfigInputType } from "~/types";
import {
  PromptPlaygroundChat,
  type PromptPlaygroundChatRef,
} from "../../chat/PromptPlaygroundChat";
import { useDraggableTabsBrowserStore } from "../../../prompt-playground-store/DraggableTabsBrowserStore";
import { useTabId } from "../ui/TabContext";
import { DemonstrationsTabContent } from "./DemonstrationsTabContent";
import { ResizableDivider } from "./ResizableDivider";

/** The default "input" variable is locked - cannot be removed or renamed */
const LOCKED_VARIABLES = new Set(["input"]);

/** Info tooltips for special variables */
const VARIABLE_INFO: Record<string, string> = {
  input: "This value comes from the Conversation tab input",
};

enum PromptTab {
  Conversation = "conversation",
  Variables = "variables",
  Demonstrations = "demonstrations",
}

export type PromptTabbedSectionProps = {
  /** Whether the prompt area above is expanded */
  isPromptExpanded: boolean;
  /** Callback when position changes (absolute Y) */
  onPositionChange: (clientY: number) => void;
  /** Callback when dragging ends */
  onDragEnd: () => void;
  /** Callback to toggle expand/collapse */
  onToggle: () => void;
};

/**
 * Tabbed section of the prompt browser window that contains the conversation, variables, and demonstrations tabs.
 */
export function PromptTabbedSection({
  isPromptExpanded,
  onPositionChange,
  onDragEnd,
  onToggle,
}: PromptTabbedSectionProps) {
  const form = useFormContext<PromptConfigFormValues>();
  const tabId = useTabId();
  const inputs = form.watch("version.configData.inputs") ?? [];
  const demonstrations = form.watch("version.configData.demonstrations");

  // Get variable values from persisted store
  const { storedVariableValues, updateTabData } = useDraggableTabsBrowserStore(
    (state) => {
      const tabData = state.getByTabId(tabId);
      return {
        storedVariableValues: tabData?.variableValues ?? {},
        updateTabData: state.updateTabData,
      };
    },
  );

  const formValues = form.watch();
  const hasInputs = inputs.length > 0;
  const demonstrationRows = transposeColumnsFirstToRowsFirstWithId(
    demonstrations?.inline?.records ?? {},
  );
  const hasDemonstrations = demonstrationRows.length > 0;
  const chatRef = useRef<PromptPlaygroundChatRef>(null);
  const [activeTab, setActiveTab] = useState<PromptTab>(PromptTab.Conversation);

  // Local state for variable values - allows fast typing without store re-renders
  const [localVariableValues, setLocalVariableValues] =
    useState<Record<string, string>>(storedVariableValues);

  // Debounced persistence to store (300ms delay)
  const debouncedPersistToStore = useDebounceCallback(
    (values: Record<string, string>) => {
      updateTabData({
        tabId,
        updater: (data) => ({
          ...data,
          variableValues: values,
        }),
      });
    },
    300,
  );

  // Convert inputs to Variable[] format
  const variables: Variable[] = inputs.map((input) => ({
    identifier: input.identifier,
    type: input.type,
  }));

  // Handle value changes - update local state immediately, persist to store with debounce
  const handleValueChange = useCallback(
    (identifier: string, value: string) => {
      setLocalVariableValues((prev) => {
        const updated = { ...prev, [identifier]: value };
        debouncedPersistToStore(updated);
        return updated;
      });
    },
    [debouncedPersistToStore],
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
    value: localVariableValues[input.identifier] ?? "",
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
      minHeight={0}
      paddingTop={1}
    >
      <Tabs.List
        display="flex"
        alignItems="center"
        flexShrink={0}
        minHeight="32px"
      >
        <HStack width="full" maxWidth="768px" margin="0 auto" paddingX={3}>
          <Tabs.Trigger value={PromptTab.Conversation}>
            Conversation
          </Tabs.Trigger>
          {hasInputs && (
            <Tabs.Trigger value={PromptTab.Variables}>Variables</Tabs.Trigger>
          )}
          {hasDemonstrations && (
            <Tabs.Trigger value={PromptTab.Demonstrations}>
              Demonstrations
            </Tabs.Trigger>
          )}
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
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        chatRef.current?.resetChat();
                        chatRef.current?.focusInput();
                      }}
                      aria-label="Reset chat"
                    >
                      <LuEraser />
                      Reset chat
                    </Button>
                  </Tooltip>
                )}
              </>
            )}
          </Tabs.Context>
        </HStack>
      </Tabs.List>

      {/* Resizable divider - below tab buttons */}
      <ResizableDivider
        isExpanded={isPromptExpanded}
        onPositionChange={onPositionChange}
        onDragEnd={onDragEnd}
        onToggle={onToggle}
      />

      <HStack flex={1} width="full" margin="0 auto" overflow="hidden">
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
              values={localVariableValues}
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
        {activeTab === PromptTab.Demonstrations && (
          <Tabs.Content
            value={PromptTab.Demonstrations}
            flex={1}
            width="full"
            height="full"
          >
            <Box height="full" width="full" maxWidth="768px" margin="0 auto">
              <DemonstrationsTabContent />
            </Box>
          </Tabs.Content>
        )}
      </HStack>
    </Tabs.Root>
  );
}
