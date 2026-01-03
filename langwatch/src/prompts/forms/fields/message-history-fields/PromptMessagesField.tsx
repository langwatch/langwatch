import { Box, Field, HStack, Spacer, VStack } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Controller,
  type UseFieldArrayReturn,
  useFieldArray,
  useFormContext,
} from "react-hook-form";
import { VerticalFormControl } from "~/components/VerticalFormControl";
import {
  PromptTextAreaWithVariables,
  type PromptTextAreaOnAddMention,
  type Variable,
  type AvailableSource,
} from "~/components/variables";
import type { PromptConfigFormValues } from "~/prompts";
import { AddMessageButton } from "./AddMessageButton";
import {
  EditingModeTitle,
  getDefaultEditingMode,
  type PromptEditingMode,
} from "./EditingModeTitle";
import { MessageRoleLabel } from "./MessageRoleLabel";
import { RemoveMessageButton } from "./RemoveMessageButton";

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
}: MessageRowProps) {
  const form = useFormContext<PromptConfigFormValues>();
  const role = field.role;

  return (
    <VerticalFormControl
      width="full"
      label={
        showControls ? (
          <HStack width="full" align="center">
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

  // Compute a signature from messages to detect changes
  const computeMessagesSignature = (
    messages: Array<{ role?: string; content?: string }>,
  ): string => {
    return messages
      .map((m) => `${m.role}:${m.content ?? ""}`)
      .join("|");
  };

  // Update editing mode when messages change (and user hasn't manually changed it)
  useEffect(() => {
    if (messageFields.fields.length === 0) return;

    const currentSignature = computeMessagesSignature(messageFields.fields);

    // Only re-compute mode if:
    // 1. User hasn't manually changed it, AND
    // 2. Messages have actually changed from what we last computed from
    if (!hasUserChangedMode && currentSignature !== lastMessagesSignatureRef.current) {
      const computedMode = getDefaultEditingMode(messageFields.fields);
      setEditingMode(computedMode);
      lastMessagesSignatureRef.current = currentSignature;
    }
  }, [messageFields.fields, hasUserChangedMode]);

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
  };

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

  // Get the system message field
  const systemField =
    systemIndex >= 0 ? messageFields.fields[systemIndex] : undefined;

  // Get non-system messages
  const nonSystemMessages = messageFields.fields.filter(
    (_, idx) => idx !== systemIndex,
  );

  return (
    <Box width="full" padding={0}>
      <HStack width="full">
        <EditingModeTitle mode={editingMode} onChange={handleModeChange} />
        <Spacer />
      </HStack>

      <VStack gap={2} align="stretch" width="full">
        {editingMode === "prompt" ? (
          // Prompt mode: Only show system message without controls
          systemField ? (
            <Box>
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
              />
            </Box>
          ) : null
        ) : (
          // Messages mode: Show all messages with controls
          <>
            {systemField && (
              <Box marginTop={2}>
                <HStack width="full">
                  <MessageRoleLabel role="system" />
                  <Spacer />
                  {editingMode === "messages" && (
                    <AddMessageButton onAdd={handleAdd} />
                  )}
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
                />
              </Box>
            )}
            {nonSystemMessages.map((field) => {
              const idx = messageFields.fields.findIndex(
                (f) => f.id === field.id,
              );
              return (
                <MessageRow
                  key={`message-row-${field.id}`}
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
                />
              );
            })}
          </>
        )}
      </VStack>
    </Box>
  );
}
