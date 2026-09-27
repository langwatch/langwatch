import { Box, Field, HStack, Spacer, type StackProps, VStack } from "@chakra-ui/react";
import {
  type AvailableSource,
  PromptTextAreaWithVariables,
  useLayoutMode,
  type Variable,
} from "@langwatch/prompt-browser-kit";
import { type PromptConfigFormValues } from "@langwatch/prompt-contract";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Controller,
  type UseFieldArrayReturn,
  useFieldArray,
  useFormContext,
} from "react-hook-form";

import { VerticalFormControl } from "../../../../ui/elements/vertical-form-control.tsx";
import {
  EditingModeTitle,
  getDefaultEditingMode,
  type PromptEditingMode,
} from "./editing-mode-title.tsx";
import { AddMessageButton, MessageRoleLabel, RemoveMessageButton } from "./messages/index.ts";

/**
 * Type for message field errors
 */
type MessageError = {
  role?: { message?: string };
  content?: { message?: string };
};

type MessageFieldArray = UseFieldArrayReturn<
  PromptConfigFormValues,
  "version.configData.messages",
  "id"
>;

type MessageField = MessageFieldArray["fields"][number];

/** What every message row of one field shares. */
type MessageRowShared = {
  availableFields: Variable[];
  otherNodesFields: Record<string, string[]>;
  /** Available sources for variable insertion (datasets, runners, etc.) */
  availableSources?: AvailableSource[];
  messageErrors?: string;
  hasMessagesError: boolean;
  getMessageError: (index: number, key: "role" | "content") => { message?: string } | undefined;
  onCreateVariable: (variable: Variable) => void;
  /** Callback when a variable mapping should be set */
  onSetVariableMapping?: (identifier: string, sourceId: string, field: string) => void;
  /** Whether to render textareas in borderless mode (for horizontal layout) */
  borderless: boolean;
};

type MessageRowProps = {
  shared: MessageRowShared;
  field: {
    id: string;
    role: "system" | "user" | "assistant";
    content?: string;
  };
  idx: number;
  onRemove: () => void;
  /** Whether to show role label and remove button */
  showControls?: boolean;
  /** Whether this message fills remaining height (last message, borderless mode only). */
  fillHeight?: boolean;
};

/** Flex-fill props, applied only where a message fills the remaining height. */
const fillWhen = (fill: boolean) => (fill ? { flex: 1, height: "100%" } : {});

function MessageRowControls({
  role,
  onRemove,
  ...layout
}: {
  role: MessageRowProps["field"]["role"];
  onRemove: () => void;
} & StackProps) {
  return (
    <HStack width="full" align="center" fontWeight="normal" textTransform="none" {...layout}>
      {role !== "system" && <MessageRoleLabel messageRole={role} marginLeft={-1} />}
      <Spacer />
      {role !== "system" && <RemoveMessageButton onRemove={onRemove} />}
    </HStack>
  );
}

function MessageContent({
  shared,
  idx,
  role,
  fillHeight,
}: {
  shared: MessageRowShared;
  idx: number;
  role: MessageRowProps["field"]["role"];
  fillHeight?: boolean;
}) {
  const form = useFormContext<PromptConfigFormValues>();
  return (
    <Controller
      key={`message-row-${idx}-content`}
      control={form.control}
      name={`version.configData.messages.${idx}.content`}
      render={({ field: controllerField }) => (
        <PromptTextAreaWithVariables
          variables={shared.availableFields}
          otherNodesFields={shared.otherNodesFields}
          availableSources={shared.availableSources}
          value={controllerField.value ?? ""}
          onChange={controllerField.onChange}
          hasError={!!shared.getMessageError(idx, "content")}
          onCreateVariable={shared.onCreateVariable}
          onSetVariableMapping={shared.onSetVariableMapping}
          showAddContextButton
          borderless={shared.borderless}
          fillHeight={fillHeight}
          role={role}
        />
      )}
    />
  );
}

/**
 * Renders a single message row in the prompt messages field.
 */
function MessageRow({
  shared,
  field,
  idx,
  onRemove,
  showControls = true,
  fillHeight = false,
}: MessageRowProps) {
  const role = field.role;

  // Borderless mode: render simplified structure with flex support
  if (shared.borderless) {
    return (
      <Box width="full" display="flex" flexDirection="column" {...fillWhen(fillHeight)}>
        {showControls && (
          <MessageRowControls
            role={role}
            onRemove={onRemove}
            flexShrink={0}
            paddingX={3}
            paddingBottom={2}
          />
        )}
        <Box {...fillWhen(fillHeight)}>
          <MessageContent shared={shared} idx={idx} role={role} fillHeight={fillHeight} />
        </Box>
      </Box>
    );
  }

  const contentError = shared.getMessageError(idx, "content");
  // Standard mode: use VerticalFormControl
  return (
    <VerticalFormControl
      width="full"
      label={showControls ? <MessageRowControls role={role} onRemove={onRemove} /> : undefined}
      invalid={shared.hasMessagesError}
      error={shared.messageErrors}
      size="sm"
      marginTop={0}
    >
      <MessageContent shared={shared} idx={idx} role={role} />
      {contentError && (
        <Field.ErrorText fontSize="13px">{String(contentError.message ?? "")}</Field.ErrorText>
      )}
    </VerticalFormControl>
  );
}

/** A signature of the messages, to tell a real change from a re-render. */
const computeMessagesSignature = (messages: { role?: string; content?: string }[]): string =>
  messages.map((m) => `${m.role}:${m.content ?? ""}`).join("|");

/**
 * The editing mode, derived from the messages until the user picks one, and
 * switching to prompt mode ensures a system message exists.
 */
function useEditingMode(messageFields: MessageFieldArray) {
  const [editingMode, setEditingMode] = useState<PromptEditingMode>("prompt");
  const [hasUserChangedMode, setHasUserChangedMode] = useState(false);

  // The signature last computed from, so a form reset re-derives the mode.
  const lastMessagesSignatureRef = useRef<string>("");

  useEffect(() => {
    if (messageFields.fields.length === 0) return;

    const currentSignature = computeMessagesSignature(messageFields.fields);
    if (!hasUserChangedMode && currentSignature !== lastMessagesSignatureRef.current) {
      setEditingMode(getDefaultEditingMode(messageFields.fields));
      lastMessagesSignatureRef.current = currentSignature;
    }
  }, [messageFields.fields, hasUserChangedMode]);

  const systemIndex = useMemo(
    () => messageFields.fields.findIndex((m) => m.role === "system"),
    [messageFields.fields],
  );

  const handleModeChange = useCallback(
    (newMode: PromptEditingMode) => {
      if (newMode === "prompt" && systemIndex < 0) {
        messageFields.prepend({ role: "system", content: "" });
      }
      setEditingMode(newMode);
      // The user chose, so the messages no longer override the mode.
      setHasUserChangedMode(true);
    },
    [systemIndex, messageFields],
  );

  return { editingMode, systemIndex, handleModeChange };
}

/** Adds a variable the textarea created to the prompt's inputs, once. */
function useCreateVariable() {
  const form = useFormContext<PromptConfigFormValues>();
  const inputsFieldArray = useFieldArray({
    control: form.control,
    name: "version.configData.inputs",
  });

  return useCallback(
    (variable: Variable) => {
      const existingInputs = form.getValues("version.configData.inputs") ?? [];
      const alreadyExists = existingInputs.some(
        (input: { identifier: string }) => input.identifier === variable.identifier,
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
}

/** The messages' validation errors: per field, and joined for the group. */
function useMessageErrors() {
  const { errors } = useFormContext<PromptConfigFormValues>().formState;

  const getMessageError = (index: number, key: "role" | "content") => {
    const messageErrors =
      (errors.version?.configData?.messages as MessageError[] | undefined) ?? [];
    return messageErrors[index]?.[key];
  };

  const messageErrors = useMemo(() => {
    const messages = errors.version?.configData?.messages;
    if (Array.isArray(messages)) {
      return messages.map((message) => message.content?.message).join(", ");
    }

    return typeof messages === "string" ? messages : undefined;
  }, [errors]);

  return {
    getMessageError,
    messageErrors,
    hasMessagesError: !!errors.version?.configData?.messages,
  };
}

/** Prompt mode: only the system message, with no controls. */
function PromptModeMessage({
  shared,
  systemField,
  systemIndex,
  onRemove,
}: {
  shared: MessageRowShared;
  systemField: MessageField;
  systemIndex: number;
  onRemove: () => void;
}) {
  const { borderless } = shared;
  return (
    <Box {...fillWhen(borderless)} paddingX={borderless ? 1 : 0} paddingTop={borderless ? 2 : 0}>
      <MessageRow
        key="system-message-row"
        shared={shared}
        field={systemField}
        idx={systemIndex}
        onRemove={onRemove}
        showControls={false}
        fillHeight={borderless}
      />
    </Box>
  );
}

/** Messages mode: every message, with controls. */
function MessagesModeList({
  shared,
  messageFields,
  systemField,
  systemIndex,
  showAddMessage,
}: {
  shared: MessageRowShared;
  messageFields: MessageFieldArray;
  systemField: MessageField | undefined;
  systemIndex: number;
  showAddMessage: boolean;
}) {
  const { borderless } = shared;
  const nonSystemMessages = messageFields.fields.filter((_, idx) => idx !== systemIndex);
  const handleAdd = (role: "user" | "assistant") => {
    messageFields.append({ role, content: "" });
  };

  return (
    <>
      {systemField && (
        <Box
          paddingX={1}
          marginTop={2}
          paddingBottom={borderless ? 3 : 0}
          borderBottomWidth={borderless ? "1px" : 0}
          borderColor="border"
        >
          <HStack width="full" paddingX={borderless ? 2 : 0} paddingBottom={borderless ? 2 : 0}>
            <MessageRoleLabel messageRole="system" />
            <Spacer />
            {showAddMessage && <AddMessageButton onAdd={handleAdd} />}
          </HStack>
          <MessageRow
            key="system-message-row"
            shared={shared}
            field={systemField}
            idx={systemIndex}
            onRemove={() => messageFields.remove(systemIndex)}
            showControls={false}
          />
        </Box>
      )}
      {nonSystemMessages.map((field, mapIdx) => {
        const idx = messageFields.fields.findIndex((f) => f.id === field.id);
        const divided = borderless && mapIdx !== nonSystemMessages.length - 1;
        const fills = borderless && !divided;
        return (
          <Box
            key={`message-box-${idx}`}
            paddingBottom={divided ? 3 : 0}
            borderBottomWidth={divided ? "1px" : 0}
            borderColor="border"
            {...fillWhen(fills)}
            paddingX={borderless ? 1 : 0}
          >
            <MessageRow
              key={`message-row-${idx}`}
              shared={shared}
              field={field}
              idx={idx}
              onRemove={() => messageFields.remove(idx)}
              showControls={true}
              fillHeight={fills}
            />
          </Box>
        );
      })}
    </>
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
}: {
  messageFields: MessageFieldArray;
  /** Available variables with their types */
  availableFields: Variable[];
  otherNodesFields: Record<string, string[]>;
  /** Available sources for variable insertion (datasets, runners, etc.) */
  availableSources?: AvailableSource[];
  /** Callback when a variable mapping should be set */
  onSetVariableMapping?: (identifier: string, sourceId: string, field: string) => void;
}) {
  const { editingMode, systemIndex, handleModeChange } = useEditingMode(messageFields);
  const onCreateVariable = useCreateVariable();
  const errors = useMessageErrors();

  // Borderless mode is the horizontal layout.
  const borderless = useLayoutMode() === "horizontal";

  const shared: MessageRowShared = {
    availableFields,
    otherNodesFields,
    availableSources,
    ...errors,
    onCreateVariable,
    onSetVariableMapping,
    borderless,
  };

  const systemField = systemIndex >= 0 ? messageFields.fields[systemIndex] : undefined;

  return (
    <Box
      width="full"
      padding={0}
      {...(borderless && { height: "100%", display: "flex", flexDirection: "column" })}
    >
      <HStack width="full" flexShrink={0} paddingX={borderless ? 3 : 1}>
        <EditingModeTitle mode={editingMode} onChange={handleModeChange} />
        <Spacer />
      </HStack>

      <VStack gap={2} align="stretch" width="full" {...fillWhen(borderless)}>
        {editingMode === "prompt" ? (
          systemField && (
            <PromptModeMessage
              shared={shared}
              systemField={systemField}
              systemIndex={systemIndex}
              onRemove={() => messageFields.remove(systemIndex)}
            />
          )
        ) : (
          <MessagesModeList
            shared={shared}
            messageFields={messageFields}
            systemField={systemField}
            systemIndex={systemIndex}
            showAddMessage={editingMode === "messages"}
          />
        )}
      </VStack>
    </Box>
  );
}
