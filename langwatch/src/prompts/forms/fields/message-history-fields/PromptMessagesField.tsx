import {
  Box,
  Collapsible,
  Field,
  HStack,
  Icon,
  Spacer,
  useDisclosure,
} from "@chakra-ui/react";
import { useCallback, useEffect, useMemo } from "react";
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
import { PropertySectionTitle } from "~/components/ui/PropertySectionTitle";
import { AddMessageButton } from "./AddMessageButton";
import { MessageRoleLabel } from "./MessageRoleLabel";
import { RemoveMessageButton } from "./RemoveMessageButton";
import { LuChevronDown } from "react-icons/lu";

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
  open: boolean;
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
};

/**
 * Renders a single message row in the prompt messages field.
 */
function MessageRow({
  field,
  idx,
  open,
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
}: MessageRowProps) {
  const form = useFormContext<PromptConfigFormValues>();
  const role = field.role;

  return (
    <VerticalFormControl
      width="full"
      label={
        <HStack width="full" align="center">
          {role !== "system" && open && (
            <MessageRoleLabel role={role} marginLeft={-1} />
          )}
          <Spacer />
          {role !== "system" && <RemoveMessageButton onRemove={onRemove} />}
        </HStack>
      }
      invalid={hasMessagesError}
      error={messageErrors}
      size="sm"
      marginTop={idx === 0 ? 0 : 2}
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
   * @param index - The index of the message field
   * @param key - The key of the message field to get the error for
   * @returns The error for the message field
   */
  const getMessageError = (index: number, key: "role" | "content") => {
    const messageErrors =
      (errors.version?.configData?.messages as MessageError[] | undefined) ??
      [];
    return messageErrors[index]?.[key];
  };

  /**
   * Get the error for the messages field group
   * @returns The error for the messages field group
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
  const { open, setOpen } = useDisclosure();

  useEffect(() => {
    setOpen(true);
  }, [setOpen]);

  const systemIndex = useMemo(
    () => messageFields.fields.findIndex((m) => m.role === "system"),
    [messageFields.fields],
  );

  const handleAdd = (role: "user" | "assistant") => {
    messageFields.append({ role, content: "" });
  };

  const hasMessagesError = !!errors.version?.configData?.messages;

  return (
    <Box width="full" padding={0}>
      <HStack width="full">
        <HStack
          gap={2}
          cursor="pointer"
          onClick={() => setOpen(!open)}
          align="center"
        >
          <PropertySectionTitle transition="opacity 0.15s ease" padding={0}>
            {open ? "System prompt" : "Prompt"}
          </PropertySectionTitle>
          <Icon
            asChild
            transform={open ? "rotate(0deg)" : "rotate(-90deg)"}
            transition="transform 0.15s ease"
            color="gray.700"
            marginBottom="-2px"
          >
            <LuChevronDown size={16} />
          </Icon>
        </HStack>
        <Spacer />
        <AddMessageButton onAdd={handleAdd} />
      </HStack>

      <Collapsible.Root open={open}>
        <Collapsible.Content>
          {(() => {
            const systemField =
              systemIndex >= 0 ? messageFields.fields[systemIndex] : undefined;
            return systemField ? (
              <MessageRow
                key="system-message-row"
                field={systemField}
                idx={systemIndex}
                open={open}
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
              />
            ) : null;
          })()}
          {messageFields.fields.map((field, idx) => {
            if (idx === systemIndex) return null;
            return (
              <MessageRow
                key={`message-row-${idx}`}
                field={field}
                idx={idx}
                open={open}
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
              />
            );
          })}
        </Collapsible.Content>
      </Collapsible.Root>
    </Box>
  );
}
