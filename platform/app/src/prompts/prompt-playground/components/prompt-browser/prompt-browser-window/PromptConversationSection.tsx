import { Box, Button, HStack, Text } from "@chakra-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFormContext } from "react-hook-form";
import { LuEraser } from "react-icons/lu";
import { useDebounceCallback } from "usehooks-ts";
import { Tooltip } from "~/components/ui/tooltip";
import type { PromptConfigFormValues } from "~/prompts/types";
import { useDraggableTabsBrowserStore } from "../../../prompt-playground-store/DraggableTabsBrowserStore";
import {
  PromptPlaygroundChat,
  type PromptPlaygroundChatRef,
} from "../../chat/PromptPlaygroundChat";
import { useTabId } from "../ui/TabContext";
import type { LayoutMode } from "./PromptBrowserWindowContent";
import { PANE_BAR_MIN_HEIGHT } from "./paneBar";
import { composerVariablesFor, runtimeVariablesFor } from "./promptVariables";
import { ResizableDivider } from "./ResizableDivider";

export type PromptConversationSectionProps = {
  /** Layout mode: "vertical" shows resizable divider, "horizontal" shows border-bottom */
  layoutMode: LayoutMode;
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
 * The pane you try a prompt in.
 *
 * It has no sub-tabs. Variables, parameters and demonstrations declare what the
 * prompt IS, so they sit with the messages in the editor pane; this pane is one
 * run of it. The values those variables take for a run are set on the message
 * box below, where the run is started — the only place they can be set, so no
 * two fields can disagree about what a run will substitute.
 */
export function PromptConversationSection({
  layoutMode,
  isPromptExpanded,
  onPositionChange,
  onDragEnd,
  onToggle,
}: PromptConversationSectionProps) {
  const form = useFormContext<PromptConfigFormValues>();
  const tabId = useTabId();
  const inputs = form.watch("version.configData.inputs") ?? [];
  const formValues = form.watch();

  // Variable values live per tab and survive a refresh.
  const { storedVariableValues, updateTabData } = useDraggableTabsBrowserStore(
    (state) => {
      const tabData = state.getByTabId(tabId);
      return {
        storedVariableValues: tabData?.variableValues ?? {},
        updateTabData: state.updateTabData,
      };
    },
  );

  const chatRef = useRef<PromptPlaygroundChatRef>(null);

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

  // Flush any pending variable-value write before unmount. useDebounceCallback
  // cancels on unmount, so without this a value typed just before switching
  // prompt tabs (which unmounts this tab) would be lost.
  useEffect(() => {
    return () => {
      debouncedPersistToStore.flush();
    };
  }, [debouncedPersistToStore]);

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

  const runtimeVariables = runtimeVariablesFor({
    declarations: inputs,
    values: localVariableValues,
  });

  return (
    <Box
      display="flex"
      flexDirection="column"
      flex={1}
      width="full"
      minHeight={0}
    >
      {/* Resize handle for the prompt above — it belongs directly under what it
          resizes, which puts it above the pane's bar rather than straddling it. */}
      {layoutMode === "vertical" && (
        <ResizableDivider
          isExpanded={isPromptExpanded}
          onPositionChange={onPositionChange}
          onDragEnd={onDragEnd}
          onToggle={onToggle}
        />
      )}

      {/* The pane's bar. It keeps the card's own surface — the conversation
          below it is the recessed one — and closes with a hairline, at the same
          height as the editor's toolbar beside it so the two read as one rule. */}
      <HStack
        data-testid="conversation-pane-bar"
        flexShrink={0}
        minHeight={PANE_BAR_MIN_HEIGHT}
        width="full"
        maxWidth={layoutMode === "horizontal" ? "full" : "768px"}
        margin="0 auto"
        paddingX={3}
        background="bg.panel"
        borderBottom="1px solid"
        borderColor="border.muted"
      >
        <Text fontSize="sm" fontWeight="medium" color="fg.muted">
          Conversation
        </Text>
        <Box flex={1} />
        <Tooltip
          content="Start a new conversation"
          positioning={{ placement: "top" }}
          openDelay={0}
        >
          <Button
            size="xs"
            variant="outline"
            flexShrink={0}
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
      </HStack>

      {/* The thread sits one step below the card surface, so the bar above it
          and the prompt editor beside it read as the raised chrome around a
          recessed well. */}
      <Box flex={1} minHeight={0} width="full" background="bg.subtle">
        <PromptPlaygroundChat
          ref={chatRef}
          formValues={formValues}
          variables={runtimeVariables}
          composerVariables={composerVariablesFor(runtimeVariables)}
          onVariableValueChange={handleValueChange}
        />
      </Box>
    </Box>
  );
}
