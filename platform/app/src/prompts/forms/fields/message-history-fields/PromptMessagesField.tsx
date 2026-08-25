import { Box, Button, Field, HStack, Spacer, VStack } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Controller,
  type UseFieldArrayReturn,
  useFieldArray,
  useFormContext,
} from "react-hook-form";
import { LuPlus } from "react-icons/lu";
import {
  AddMessageButton,
  MessageRoleLabel,
  RemoveMessageButton,
} from "~/components/ui/messages";
import { VerticalFormControl } from "~/components/VerticalFormControl";
import {
  type AvailableSource,
  type PromptTextAreaOnAddMention,
  PromptTextAreaWithVariables,
  type Variable,
} from "~/components/variables";
import type { PromptConfigFormValues } from "~/prompts";
import { useLayoutMode } from "~/prompts/prompt-playground/components/prompt-browser/prompt-browser-window/PromptBrowserWindowContent";
import {
  EditingModeTitle,
  getDefaultEditingMode,
  type PromptEditingMode,
} from "./EditingModeTitle";

// Re-export for backwards compatibility
export type { PromptEditingMode } from "./EditingModeTitle";

/**
 * Type for message field errors
 */
type MessageError = {
  role?: { message?: string };
  content?: { message?: string };
};

type MessageRowProps = {
  field: {
    id: string;
    role: "system" | "user" | "assistant";
    content?: string;
  };
  idx: number;
  availableFields: Variable[];
  otherNodesFields: Record<string, string[]>;
  /** Available sources for variable insertion (datasets, runners, etc.) */
  availableSources?: AvailableSource[];
  messageErrors?: string;
  hasMessagesError: boolean;
  getMessageError: (
    index: number,
    key: "role" | "content",
  ) => { message?: string } | undefined;
  onRemove: () => void;
  onCreateVariable: (variable: Variable) => void;
  /** Callback when a variable mapping should be set */
  onSetVariableMapping?: (
    identifier: string,
    sourceId: string,
    field: string,
  ) => void;
  onAddEdge?: (
    id: string,
    handle: string,
    content: PromptTextAreaOnAddMention,
    idx: number,
  ) => string | void;
  /** Whether to show role label and remove button */
  showControls?: boolean;
  /** Whether to render textarea in borderless mode (for horizontal layout) */
  borderless?: boolean;
  /** Whether this message should fill remaining height (only for last message in borderless mode) */
  fillHeight?: boolean;
};

/**
 * Renders a single message row in the prompt messages field.
 */
function MessageRow({
  field,
  idx,
  availableFields,
  otherNodesFields,
  availableSources,
  messageErrors,
  hasMessagesError,
  getMessageError,
  onRemove,
  onCreateVariable,
  onSetVariableMapping,
  onAddEdge,
  showControls = true,
  borderless = false,
  fillHeight = false,
}: MessageRowProps) {
  const form = useFormContext<PromptConfigFormValues>();
  const role = field.role;

  // Borderless mode: render simplified structure with flex support
  if (borderless) {
    return (
      <Box
        width="full"
        height={fillHeight ? "100%" : undefined}
        display="flex"
        flexDirection="column"
        flex={fillHeight ? 1 : undefined}
      >
        {showControls && (
          <HStack
            width="full"
            align="center"
            fontWeight="normal"
            textTransform="none"
            flexShrink={0}
            paddingX={3}
            paddingBottom={2}
          >
            {role !== "system" && (
              <MessageRoleLabel role={role} marginLeft={-1} />
            )}
            <Spacer />
            {role !== "system" && <RemoveMessageButton onRemove={onRemove} />}
          </HStack>
        )}
        <Box
          flex={fillHeight ? 1 : undefined}
          height={fillHeight ? "100%" : undefined}
        >
          <Controller
            key={`message-row-${idx}-content`}
            control={form.control}
            name={`version.configData.messages.${idx}.content`}
            render={({ field: controllerField }) => (
              <PromptTextAreaWithVariables
                variables={availableFields}
                otherNodesFields={otherNodesFields}
                availableSources={availableSources}
                value={controllerField.value ?? ""}
                onChange={controllerField.onChange}
                hasError={!!getMessageError(idx, "content")}
                onCreateVariable={onCreateVariable}
                onSetVariableMapping={onSetVariableMapping}
                onAddEdge={(id, handle, content) => {
                  return onAddEdge?.(id, handle, content, idx);
                }}
                showAddContextButton
                borderless={borderless}
                fillHeight={fillHeight}
                role={role}
              />
            )}
          />
        </Box>
      </Box>
    );
  }

  // Standard mode: use VerticalFormControl
  return (
    <VerticalFormControl
      width="full"
      label={
        showControls ? (
          <HStack
            width="full"
            align="center"
            fontWeight="normal"
            textTransform="none"
          >
            {role !== "system" && (
              <MessageRoleLabel role={role} marginLeft={-1} />
            )}
            <Spacer />
            {role !== "system" && <RemoveMessageButton onRemove={onRemove} />}
          </HStack>
        ) : undefined
      }
      invalid={hasMessagesError}
      error={messageErrors}
      size="sm"
      marginTop={0}
    >
      <Controller
        key={`message-row-${idx}-content`}
        control={form.control}
        name={`version.configData.messages.${idx}.content`}
        render={({ field: controllerField }) => (
          <PromptTextAreaWithVariables
            variables={availableFields}
            otherNodesFields={otherNodesFields}
            availableSources={availableSources}
            value={controllerField.value ?? ""}
            onChange={controllerField.onChange}
            hasError={!!getMessageError(idx, "content")}
            onCreateVariable={onCreateVariable}
            onSetVariableMapping={onSetVariableMapping}
            onAddEdge={(id, handle, content) => {
              return onAddEdge?.(id, handle, content, idx);
            }}
            showAddContextButton
            borderless={borderless}
            role={role}
          />
        )}
      />
      {getMessageError(idx, "content") && (
        <Field.ErrorText fontSize="13px">
          {String(getMessageError(idx, "content")?.message ?? "")}
        </Field.ErrorText>
      )}
    </VerticalFormControl>
  );
}

/**
 * Single Responsibility: Render and manage the configurable prompt message list.
 *
 * Supports two editing modes:
 * - "prompt": Simple view showing only the system prompt (default)
 * - "messages": Full view showing all messages with role labels and controls
 */
export function PromptMessagesField({
  messageFields,
  availableFields,
  otherNodesFields,
  availableSources,
  onSetVariableMapping,
  onAddEdge,
}: {
  messageFields: UseFieldArrayReturn<
    PromptConfigFormValues,
    "version.configData.messages",
    "id"
  >;
  /** Available variables with their types */
  availableFields: Variable[];
  otherNodesFields: Record<string, string[]>;
  /** Available sources for variable insertion (datasets, runners, etc.) */
  availableSources?: AvailableSource[];
  /** Callback when a variable mapping should be set */
  onSetVariableMapping?: (
    identifier: string,
    sourceId: string,
    field: string,
  ) => void;
  onAddEdge?: (
    id: string,
    handle: string,
    content: PromptTextAreaOnAddMention,
    idx: number,
  ) => string | void;
}) {
  const form = useFormContext<PromptConfigFormValues>();
  const { formState, control } = form;
  const { errors } = formState;

  // Editing mode state - initialize to "prompt", then update based on messages
  const [editingMode, setEditingMode] = useState<PromptEditingMode>("prompt");
  const [hasUserChangedMode, setHasUserChangedMode] = useState(false);

  // Track the last messages signature we computed mode from
  // This allows us to re-compute when messages change (e.g., form reset)
  const lastMessagesSignatureRef = useRef<string>("");

  // Which row the effect below should bring into view once it has actually
  // rendered: the one just appended, or the user row that "Add user message"
  // points at, which is not the last row when an assistant message follows it.
  const [pendingRevealTarget, setPendingRevealTarget] = useState<
    "last-row" | "last-user-row" | null
  >(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Compute a signature from messages to detect changes
  const computeMessagesSignature = (
    messages: Array<{ role?: string; content?: string }>,
  ): string => {
    return messages.map((m) => `${m.role}:${m.content ?? ""}`).join("|");
  };

  // Update editing mode when messages change (and user hasn't manually changed it)
  useEffect(() => {
    if (messageFields.fields.length === 0) return;

    const currentSignature = computeMessagesSignature(messageFields.fields);

    // Only re-compute mode if:
    // 1. User hasn't manually changed it, AND
    // 2. Messages have actually changed from what we last computed from
    if (
      !hasUserChangedMode &&
      currentSignature !== lastMessagesSignatureRef.current
    ) {
      const computedMode = getDefaultEditingMode(messageFields.fields);
      setEditingMode(computedMode);
      lastMessagesSignatureRef.current = currentSignature;
    }
  }, [messageFields.fields, hasUserChangedMode]);

  // Scroll the message that was just added or revealed into view and put the
  // cursor in it. Adding a message you cannot see is the same as nothing
  // happening, and the list is often taller than the pane.
  useEffect(() => {
    if (!pendingRevealTarget || editingMode !== "messages") return;
    setPendingRevealTarget(null);

    const container = containerRef.current;
    if (!container) return;
    const rows = container.querySelectorAll<HTMLElement>(
      pendingRevealTarget === "last-user-row"
        ? '[data-message-row="user"]'
        : "[data-message-row]",
    );
    const target = rows[rows.length - 1];
    if (!target) return;

    // jsdom does not implement scrollIntoView, and this is presentation only.
    target.scrollIntoView?.({ block: "nearest" });
    target.querySelector("textarea")?.focus();
  }, [pendingRevealTarget, editingMode]);

  // Access inputs field array to add new variables
  const inputsFieldArray = useFieldArray({
    control,
    name: "version.configData.inputs",
  });

  // Handle creating a new variable from the textarea
  const handleCreateVariable = useCallback(
    (variable: Variable) => {
      // Check if variable already exists
      const existingInputs = form.getValues("version.configData.inputs") ?? [];
      const alreadyExists = existingInputs.some(
        (input: { identifier: string }) =>
          input.identifier === variable.identifier,
      );

      if (!alreadyExists) {
        inputsFieldArray.append({
          identifier: variable.identifier,
          type: variable.type as "str" | "float" | "bool" | "image",
        });
      }
    },
    [form, inputsFieldArray],
  );

  /**
   * Get the error for a specific message field
   */
  const getMessageError = (index: number, key: "role" | "content") => {
    const messageErrors =
      (errors.version?.configData?.messages as MessageError[] | undefined) ??
      [];
    return messageErrors[index]?.[key];
  };

  /**
   * Get the error for the messages field group
   */
  const messageErrors = useMemo(() => {
    return Array.isArray(errors.version?.configData?.messages)
      ? errors.version?.configData?.messages
          .map((message) => message.content?.message)
          .join(", ")
      : typeof errors.version?.configData?.messages === "string"
        ? errors.version?.configData?.messages
        : undefined;
  }, [errors]);

  const systemIndex = useMemo(
    () => messageFields.fields.findIndex((m) => m.role === "system"),
    [messageFields.fields],
  );

  const handleAdd = (role: "user" | "assistant") => {
    messageFields.append({ role, content: "" });
    setPendingRevealTarget("last-row");
  };

  /**
   * Instructions mode hides every non-system message, so "Add user message"
   * has to do two things: make sure a user message exists, and switch to the
   * mode that shows it. A prompt often already carries a hidden `{{input}}`
   * user message — appending a second empty one would leave the customer with
   * a duplicate they never asked for, so we reveal the existing one instead.
   */
  const handleAddUserMessage = useCallback(() => {
    const hasUserMessage = messageFields.fields.some((f) => f.role === "user");
    if (!hasUserMessage) {
      messageFields.append({ role: "user", content: "" });
    }
    setEditingMode("messages");
    setHasUserChangedMode(true);
    setPendingRevealTarget("last-user-row");
  }, [messageFields]);

  // Ensure system message exists when switching to prompt mode
  const handleModeChange = useCallback(
    (newMode: PromptEditingMode) => {
      if (newMode === "prompt" && systemIndex < 0) {
        // Create a system message if it doesn't exist
        messageFields.prepend({ role: "system", content: "" });
      }
      setEditingMode(newMode);
      // Mark that user has manually changed the mode, so we don't override it
      setHasUserChangedMode(true);
    },
    [systemIndex, messageFields],
  );

  const hasMessagesError = !!errors.version?.configData?.messages;

  // Determine if we should use borderless mode (horizontal layout)
  const layoutMode = useLayoutMode();
  const borderless = layoutMode === "horizontal";

  // Get the system message field
  const systemField =
    systemIndex >= 0 ? messageFields.fields[systemIndex] : undefined;

  // Get non-system messages
  const nonSystemMessages = messageFields.fields.filter(
    (_, idx) => idx !== systemIndex,
  );

  return (
    <Box
      ref={containerRef}
      width="full"
      padding={0}
      height={borderless ? "100%" : undefined}
      display={borderless ? "flex" : undefined}
      flexDirection={borderless ? "column" : undefined}
    >
      {/*
        One action rail for the whole section: the mode switcher on the left,
        the add action on the right, in the same slot in both modes. The add
        control used to sit inside the system message's own row, which read as
        an action on that message rather than on the list.
      */}
      <HStack
        width="full"
        flexShrink={0}
        gap={2}
        paddingX={borderless ? 3 : 1}
        paddingY={borderless ? 2 : 0}
        borderBottomWidth={borderless ? "1px" : 0}
        borderColor="border.muted"
      >
        <EditingModeTitle mode={editingMode} onChange={handleModeChange} />
        <Spacer />
        {editingMode === "prompt" ? (
          <Button
            size="xs"
            variant="ghost"
            type="button"
            gap={1}
            color="fg.muted"
            onClick={handleAddUserMessage}
            data-testid="add-user-message-button"
          >
            <LuPlus />
            Add user message
          </Button>
        ) : (
          <AddMessageButton onAdd={handleAdd} />
        )}
      </HStack>

      <VStack
        gap={2}
        align="stretch"
        width="full"
        flex={borderless ? 1 : undefined}
        height={borderless ? "100%" : undefined}
      >
        {editingMode === "prompt" ? (
          // Prompt mode: Only show system message without controls
          systemField ? (
            <Box
              flex={borderless ? 1 : undefined}
              height={borderless ? "100%" : undefined}
              paddingX={borderless ? 1 : 0}
              paddingTop={borderless ? 2 : 0}
            >
              <MessageRow
                key="system-message-row"
                field={systemField}
                idx={systemIndex}
                availableFields={availableFields}
                otherNodesFields={otherNodesFields}
                availableSources={availableSources}
                messageErrors={messageErrors}
                hasMessagesError={hasMessagesError}
                getMessageError={getMessageError}
                onRemove={() => messageFields.remove(systemIndex)}
                onCreateVariable={handleCreateVariable}
                onSetVariableMapping={onSetVariableMapping}
                onAddEdge={onAddEdge}
                showControls={false}
                borderless={borderless}
                fillHeight={borderless}
              />
            </Box>
          ) : null
        ) : (
          // Messages mode: Show all messages with controls
          <>
            {systemField && (
              <Box
                paddingX={1}
                marginTop={2}
                paddingBottom={borderless ? 3 : 0}
                borderBottomWidth={borderless ? "1px" : 0}
                borderColor="border"
              >
                <HStack
                  width="full"
                  paddingX={borderless ? 2 : 0}
                  paddingBottom={borderless ? 2 : 0}
                >
                  <MessageRoleLabel role="system" />
                </HStack>
                <MessageRow
                  key="system-message-row"
                  field={systemField}
                  idx={systemIndex}
                  availableFields={availableFields}
                  otherNodesFields={otherNodesFields}
                  availableSources={availableSources}
                  messageErrors={messageErrors}
                  hasMessagesError={hasMessagesError}
                  getMessageError={getMessageError}
                  onRemove={() => messageFields.remove(systemIndex)}
                  onCreateVariable={handleCreateVariable}
                  onSetVariableMapping={onSetVariableMapping}
                  onAddEdge={onAddEdge}
                  showControls={false}
                  borderless={borderless}
                />
              </Box>
            )}
            {nonSystemMessages.map((field, mapIdx) => {
              const idx = messageFields.fields.findIndex(
                (f) => f.id === field.id,
              );
              const isLast = mapIdx === nonSystemMessages.length - 1;
              return (
                <Box
                  key={`message-box-${idx}`}
                  // Marks a row the reveal effect can scroll to; the last one
                  // in DOM order is the message that was just added.
                  data-message-row={field.role}
                  paddingBottom={borderless && !isLast ? 3 : 0}
                  borderBottomWidth={borderless && !isLast ? "1px" : 0}
                  borderColor="border"
                  flex={borderless && isLast ? 1 : undefined}
                  paddingX={borderless ? 1 : 0}
                  height={borderless && isLast ? "100%" : undefined}
                >
                  <MessageRow
                    key={`message-row-${idx}`}
                    field={field}
                    idx={idx}
                    availableFields={availableFields}
                    otherNodesFields={otherNodesFields}
                    availableSources={availableSources}
                    messageErrors={messageErrors}
                    hasMessagesError={hasMessagesError}
                    getMessageError={getMessageError}
                    onRemove={() => messageFields.remove(idx)}
                    onCreateVariable={handleCreateVariable}
                    onSetVariableMapping={onSetVariableMapping}
                    onAddEdge={onAddEdge}
                    showControls={true}
                    borderless={borderless}
                    fillHeight={borderless && isLast}
                  />
                </Box>
              );
            })}
          </>
        )}
      </VStack>
    </Box>
  );
}
