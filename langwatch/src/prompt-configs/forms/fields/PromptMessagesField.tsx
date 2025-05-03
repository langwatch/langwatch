import {
  Box,
  Button,
  Field,
  HStack,
  NativeSelect,
  Spacer,
  Textarea,
} from "@chakra-ui/react";
import {
  useFormContext,
  type UseFieldArrayReturn,
  Controller,
} from "react-hook-form";

import type { PromptConfigFormValues } from "../../hooks/usePromptConfigForm";

import { LuMinus, LuPlus } from "react-icons/lu";
import { VerticalFormControl } from "~/components/VerticalFormControl";
import { ChevronDown } from "lucide-react";
import { PropertySectionTitle } from "../../../optimization_studio/components/properties/BasePropertiesPanel";

export function PromptMessagesField({
  messageFields,
}: {
  messageFields: UseFieldArrayReturn<
    PromptConfigFormValues,
    "version.configData.messages",
    "id"
  >;
}) {
  const form = useFormContext<PromptConfigFormValues>();
  const { register, formState } = form;
  const { errors } = formState;

  type MessageError = {
    role?: { message?: string };
    content?: { message?: string };
  };
  const getMessageError = (index: number, key: "role" | "content") => {
    const messageErrors =
      (errors.version?.configData?.messages as MessageError[] | undefined) ??
      [];
    return messageErrors[index]?.[key];
  };

  return messageFields.fields.map((field, idx) => (
    <VerticalFormControl
      key={field.id}
      label={
        <Controller
          control={form.control}
          name={`version.configData.messages.${idx}.role`}
          render={({ field }) => (
            <HStack width="full">
              <HStack position="relative">
                <PropertySectionTitle padding={0}>
                  {field.value}
                </PropertySectionTitle>
                <Box color="gray.600" paddingTop={1}>
                  <ChevronDown size={14} />
                </Box>
                <NativeSelect.Root
                  size="sm"
                  position="absolute"
                  top={0}
                  left={0}
                  height="32px"
                  width="100%"
                  cursor="pointer"
                  zIndex={10}
                  opacity={0}
                >
                  <NativeSelect.Field
                    {...field}
                    cursor="pointer"
                    _invalid={
                      getMessageError(idx, "role")
                        ? { borderColor: "red.500" }
                        : undefined
                    }
                  >
                    <option value="user">User</option>
                    <option value="assistant">Assistant</option>
                  </NativeSelect.Field>
                </NativeSelect.Root>
              </HStack>
              <Spacer />
              {idx === messageFields.fields.length - 1 && (
                <AddRemoveMessageFieldButton messageFields={messageFields} />
              )}
            </HStack>
          )}
        />
      }
      invalid={!!errors.version?.configData?.messages}
      helper={
        Array.isArray(errors.version?.configData?.messages)
          ? undefined
          : typeof errors.version?.configData?.messages === "string"
          ? errors.version?.configData?.messages
          : undefined
      }
      error={
        Array.isArray(errors.version?.configData?.messages)
          ? undefined
          : typeof errors.version?.configData?.messages === "string"
          ? errors.version?.configData?.messages
          : undefined
      }
      size="sm"
    >
      <Textarea
        {...register(`version.configData.messages.${idx}.content` as const)}
        placeholder="Message content"
        autoresize
        maxHeight="33vh"
        rows={3}
        _invalid={
          getMessageError(idx, "content")
            ? { borderColor: "red.500" }
            : undefined
        }
        size="sm"
        fontFamily="mono"
        fontSize="13px"
      />
      {getMessageError(idx, "content") && (
        <Field.ErrorText fontSize="13px">
          {String(getMessageError(idx, "content")?.message ?? "")}
        </Field.ErrorText>
      )}
    </VerticalFormControl>
  ));
}

export function AddRemoveMessageFieldButton({
  messageFields,
}: {
  messageFields: UseFieldArrayReturn<
    PromptConfigFormValues,
    "version.configData.messages",
    "id"
  >;
}) {
  const { append, remove } = messageFields;

  const handleAdd = () => {
    append({ role: "user", content: "" });
  };

  const handleRemove = () => {
    if (messageFields.fields.length > 0) {
      remove(messageFields.fields.length - 1);
    }
  };

  return (
    <HStack gap={2}>
      <Button
        size="xs"
        variant="ghost"
        onClick={handleRemove}
        type="button"
        disabled={messageFields.fields.length === 0}
      >
        <LuMinus size={16} />
      </Button>
      <Button size="xs" variant="ghost" onClick={handleAdd} type="button">
        <LuPlus size={16} />
      </Button>
    </HStack>
  );
}
