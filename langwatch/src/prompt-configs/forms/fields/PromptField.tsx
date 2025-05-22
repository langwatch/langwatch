import { Field, HStack, Spacer } from "@chakra-ui/react";
import {
  Controller,
  useFormContext,
  type UseFieldArrayReturn,
} from "react-hook-form";
import type { PromptConfigFormValues } from "../../hooks/usePromptConfigForm";
import { VerticalFormControl } from "~/components/VerticalFormControl";
import { PropertySectionTitle } from "../../../optimization_studio/components/properties/BasePropertiesPanel";
import { AddRemoveMessageFieldButton } from "./PromptMessagesField";
import {
  PromptTextArea,
  type PromptTextAreaOnAddMention,
} from "../../components/ui/PromptTextArea";

export function PromptField({
  templateAdapter,
  messageFields,
  availableFields,
  otherNodesFields,
  onAddEdge,
  isTemplateSupported = true,
}: {
  templateAdapter: "default" | "dspy_chat_adapter";
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
    content: PromptTextAreaOnAddMention
  ) => void;
  isTemplateSupported?: boolean;
}) {
  const form = useFormContext<PromptConfigFormValues>();
  const { formState } = form;
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
      <Controller
        control={form.control}
        name="version.configData.prompt"
        render={({ field }) => (
          <PromptTextArea
            {...field}
            availableFields={availableFields}
            otherNodesFields={otherNodesFields}
            onAddEdge={onAddEdge}
            isTemplateSupported={isTemplateSupported}
          />
        )}
      />
    </VerticalFormControl>
  );
}
