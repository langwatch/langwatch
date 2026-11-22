import { type PromptConfigFormValues } from "@langwatch/prompt-contract";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";

import { PromptMessagesField } from "../../fields/prompt-messages-field.tsx";

export function PromptMessagesEditor() {
  const form = useFormContext<PromptConfigFormValues>();
  const messageFields = useFieldArray({
    control: form.control,
    name: "version.configData.messages",
  });

  // useWatch, not form.watch: the React Compiler memoises watch() on the stable form object.
  const inputs = useWatch({ control: form.control, name: "version.configData.inputs" }) ?? [];
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
