import {
  Box,
  Collapsible,
  Field,
  HStack,
  Icon,
  Spacer,
  useDisclosure,
} from "@chakra-ui/react";
import { useEffect, useMemo } from "react";
import { ChevronDown } from "react-feather";
import {
  Controller,
  type UseFieldArrayReturn,
  useFormContext,
} from "react-hook-form";
import { VerticalFormControl } from "~/components/VerticalFormControl";
import type { PromptConfigFormValues } from "~/prompts";
import { PropertySectionTitle } from "~/components/ui/PropertySectionTitle";
import {
  PromptTextArea,
  type PromptTextAreaOnAddMention,
} from "../../../components/ui/PromptTextArea";
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

/**
 * Single Responsibility: Render and manage the configurable prompt message list.
 */
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
          <HStack width="full" align="center">
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
        marginTop={idx === 0 ? 0 : 2}
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
              borderRadius="lg"
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
