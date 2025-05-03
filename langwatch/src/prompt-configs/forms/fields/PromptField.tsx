import { Field, HStack, Spacer, Textarea } from "@chakra-ui/react";
import { useFormContext, type UseFieldArrayReturn } from "react-hook-form";

import type { PromptConfigFormValues } from "../../hooks/usePromptConfigForm";

import { VerticalFormControl } from "~/components/VerticalFormControl";
import { PropertySectionTitle } from "../../../optimization_studio/components/properties/BasePropertiesPanel";
import { AddRemoveMessageFieldButton } from "./PromptMessagesField";

export function PromptField({
  templateAdapter,
  messageFields,
}: {
  templateAdapter: "default" | "dspy_chat_adapter";
  messageFields: UseFieldArrayReturn<
    PromptConfigFormValues,
    "version.configData.messages",
    "id"
  >;
}) {
  const form = useFormContext<PromptConfigFormValues>();
  const { register, formState } = form;
  const { errors } = formState;

  return (
    <VerticalFormControl
      label={
        <HStack width="full">
          <Field.Label margin={0}>
            <PropertySectionTitle padding={0}>
              System Prompt
            </PropertySectionTitle>
          </Field.Label>
          <Spacer />

          {templateAdapter === "default" &&
            messageFields.fields.length === 0 && (
              <AddRemoveMessageFieldButton messageFields={messageFields} />
            )}
        </HStack>
      }
      invalid={!!errors.version?.configData?.prompt}
      helper={errors.version?.configData?.prompt?.message?.toString()}
      error={errors.version?.configData?.prompt}
      size="sm"
    >
      <Textarea
        {...register("version.configData.prompt")}
        placeholder="You are a helpful assistant"
        autoresize
        maxHeight="33vh"
        rows={3}
        fontFamily="mono"
        fontSize="13px"
      />
    </VerticalFormControl>
  );
}
