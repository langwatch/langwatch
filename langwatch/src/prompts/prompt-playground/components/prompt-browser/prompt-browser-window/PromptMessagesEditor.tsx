import { useFieldArray, useFormContext } from "react-hook-form";
import type { PromptConfigFormValues } from "~/prompts";
import { PromptMessagesField } from "~/prompts/forms/fields/message-history-fields/PromptMessagesField";

/**
 * PromptMessagesEditor
 * Single Responsibility: manage and render the message history fields within the Prompt Studio form.
 */
export function PromptMessagesEditor() {
  const form = useFormContext<PromptConfigFormValues>();
  const messageFields = useFieldArray({
    control: form.control,
    name: "version.configData.messages",
  });

  // Watch inputs directly - avoid useMemo to ensure reactivity on form changes
  const inputs = form.watch("version.configData.inputs") ?? [];
  // Map to Variable[] format with both identifier and type
  const availableVariables = inputs.map((input) => ({
    identifier: input.identifier,
    type: input.type,
  }));

  return (
    <PromptMessagesField
      messageFields={messageFields}
      availableFields={availableVariables}
      otherNodesFields={{}}
    />
  );
}
