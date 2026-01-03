import {
  Box,
  Field,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useCallback, useMemo, useState } from "react";
import {
  Controller,
  type UseFieldArrayReturn,
  useFieldArray,
  useFormContext,
} from "react-hook-form";
import { LuChevronDown } from "react-icons/lu";
import { VerticalFormControl } from "~/components/VerticalFormControl";
import {
  PromptTextAreaWithVariables,
  type PromptTextAreaOnAddMention,
  type Variable,
  type AvailableSource,
} from "~/components/variables";
import type { PromptConfigFormValues } from "~/prompts";
import { PropertySectionTitle } from "~/components/ui/PropertySectionTitle";
import { Menu } from "~/components/ui/menu";
import { AddMessageButton } from "./AddMessageButton";
import { MessageRoleLabel } from "./MessageRoleLabel";
import { RemoveMessageButton } from "./RemoveMessageButton";

/**
 * Editing mode for the prompt messages field.
 * - "prompt": Simple view showing only the system prompt
 * - "messages": Full view showing all messages with role labels
 */
export type PromptEditingMode = "prompt" | "messages";

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
  /** Whether to render the textarea without borders */
  borderless?: boolean;
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
            borderless={borderless}
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
 * Title with dropdown menu for switching between Prompt and Messages modes.
 */
function EditingModeTitle({
  mode,
  onChange,
}: {
  mode: PromptEditingMode;
  onChange: (mode: PromptEditingMode) => void;
}) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <HStack
          gap={1}
          cursor="pointer"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          role="button"
          _hover={{ opacity: 0.8 }}
        >
          <PropertySectionTitle padding={0}>
            {mode === "prompt" ? "Prompt" : "Messages"}
          </PropertySectionTitle>
          <Box
            opacity={isHovered ? 1 : 0}
            transition="opacity 0.15s"
            color="gray.500"
          >
            <LuChevronDown size={14} />
          </Box>
        </HStack>
      </Menu.Trigger>
      <Menu.Content portalled={false} zIndex={10}>
        <Menu.Item
          value="prompt"
          onClick={() => onChange("prompt")}
          data-testid="editing-mode-prompt"
        >
          <Text fontWeight={mode === "prompt" ? "medium" : "normal"}>
            Prompt
          </Text>
        </Menu.Item>
        <Menu.Item
          value="messages"
          onClick={() => onChange("messages")}
          data-testid="editing-mode-messages"
        >
          <Text fontWeight={mode === "messages" ? "medium" : "normal"}>
            Messages
          </Text>
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
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
  defaultMode = "prompt",
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
  /** Default editing mode */
  defaultMode?: PromptEditingMode;
}) {
  const form = useFormContext<PromptConfigFormValues>();
  const { formState, control } = form;
  const { errors } = formState;

  // Editing mode state
  const [editingMode, setEditingMode] = useState<PromptEditingMode>(defaultMode);

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
      <HStack width="full" marginBottom={2}>
        <EditingModeTitle mode={editingMode} onChange={handleModeChange} />
        <Spacer />
        {editingMode === "messages" && <AddMessageButton onAdd={handleAdd} />}
      </HStack>

      <VStack gap={0} align="stretch" width="full" borderBottomWidth="1px" borderColor="gray.200">
        {editingMode === "prompt" ? (
          // Prompt mode: Only show system message without controls
          systemField ? (
            <Box paddingBottom={3}>
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
                borderless
              />
            </Box>
          ) : null
        ) : (
          // Messages mode: Show all messages with controls
          <>
            {systemField && (
              <Box
                paddingBottom={3}
                borderBottomWidth="1px"
                borderColor="gray.200"
              >
                <PropertySectionTitle
                  padding={0}
                  fontSize="xs"
                  color="gray.500"
                  marginBottom={1}
                >
                  System prompt
                </PropertySectionTitle>
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
                  borderless
                />
              </Box>
            )}
            {nonSystemMessages.map((field, arrayIndex) => {
              const idx = messageFields.fields.findIndex(
                (f) => f.id === field.id,
              );
              const isLast = arrayIndex === nonSystemMessages.length - 1;
              return (
                <Box
                  key={`message-row-${field.id}`}
                  paddingY={3}
                  borderBottomWidth={isLast ? 0 : "1px"}
                  borderColor="gray.200"
                >
                  <MessageRow
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
                    borderless
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
