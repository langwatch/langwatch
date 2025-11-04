import {
  Box,
  Field,
  HStack,
  Icon,
  Spacer,
  useDisclosure,
  Collapsible,
} from "@chakra-ui/react";
import { ChevronDown } from "react-feather";
import { useEffect, useMemo } from "react";
import {
  useFormContext,
  type UseFieldArrayReturn,
  Controller,
} from "react-hook-form";
// removed react-icons add/remove; handled by dedicated components

import { PropertySectionTitle } from "../../../../optimization_studio/components/properties/BasePropertiesPanel";
import {
  PromptTextArea,
  type PromptTextAreaOnAddMention,
} from "../../../components/ui/PromptTextArea";
import type { PromptConfigFormValues } from "~/prompt-configs";

import { VerticalFormControl } from "~/components/VerticalFormControl";
import { AddMessageButton } from "./AddMessageButton";
import { RemoveMessageButton } from "./RemoveMessageButton";
import { MessageRoleLabel } from "./MessageRoleLabel";

/**
 * Type for message field errors
 */
type MessageError = {
  role?: { message?: string };
  content?: { message?: string };
};

export function PromptMessagesField({
  messageFields,
  availableFields,
  otherNodesFields,
  onAddEdge,
}: {
  messageFields: UseFieldArrayReturn<
    PromptConfigFormValues,
    "version.configData.messages",
    "id"
  >;
  availableFields: string[];
  otherNodesFields: Record<string, string[]>;
  onAddEdge?: (
    id: string,
    handle: string,
    content: PromptTextAreaOnAddMention,
    idx: number,
  ) => void;
}) {
  const form = useFormContext<PromptConfigFormValues>();
  const { formState } = form;
  const { errors } = formState;

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

  const renderMessageRow = (
    field: (typeof messageFields.fields)[number],
    idx: number,
  ) => {
    const role = field.role;

    return (
      <VerticalFormControl
        width="full"
        key={field.id}
        label={
          <HStack width="full">
            {role !== "system" && open && (
              <MessageRoleLabel role={role} marginLeft={-1} />
            )}
            <Spacer />
            {role !== "system" && (
              <RemoveMessageButton onRemove={() => messageFields.remove(idx)} />
            )}
          </HStack>
        }
        invalid={!!errors.version?.configData?.messages}
        error={messageErrors}
        size="sm"
        marginTop={idx === 0 ? 2 : 4}
      >
        <Controller
          control={form.control}
          name={`version.configData.messages.${idx}.content`}
          render={({ field }) => (
            <Box
              border="1px solid"
              borderColor={
                getMessageError(idx, "content") ? "red.500" : "gray.200"
              }
              borderRadius={6}
              overflow="hidden"
            >
              <PromptTextArea
                availableFields={availableFields}
                otherNodesFields={otherNodesFields}
                value={field.value}
                onChange={field.onChange}
                bg="white"
                onAddEdge={(id, handle, content) => {
                  onAddEdge?.(id, handle, content, idx);
                }}
              />
            </Box>
          )}
        />
        {getMessageError(idx, "content") && (
          <Field.ErrorText fontSize="13px">
            {String(getMessageError(idx, "content")?.message ?? "")}
          </Field.ErrorText>
        )}
      </VerticalFormControl>
    );
  };

  return (
    <Box width="full" padding={2}>
      <HStack width="full">
        <HStack gap={2} cursor="pointer" onClick={() => setOpen(!open)}>
          <Icon
            asChild
            transform={open ? "rotate(0deg)" : "rotate(-90deg)"}
            transition="transform 0.15s ease"
            color="gray.700"
          >
            <ChevronDown size={16} />
          </Icon>
          <PropertySectionTitle transition="opacity 0.15s ease" padding={0}>
            {open ? "System prompt" : "Messages"}
          </PropertySectionTitle>
        </HStack>
        <Spacer />
        <AddMessageButton onAdd={handleAdd} />
      </HStack>

      <Collapsible.Root open={open}>
        <Collapsible.Content>
          {(() => {
            const systemField =
              systemIndex >= 0 ? messageFields.fields[systemIndex] : undefined;
            return systemField
              ? renderMessageRow(systemField, systemIndex)
              : null;
          })()}
          {messageFields.fields.map((field, idx) => {
            if (idx === systemIndex) return null;
            return renderMessageRow(field, idx);
          })}
        </Collapsible.Content>
      </Collapsible.Root>
    </Box>
  );
}
