import { Box, Card } from "@chakra-ui/react";
import { useMemo } from "react";
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
  const inputs = form.watch("version.configData.inputs");
  const availableMentions = useMemo(() => {
    return inputs.map((input) => input.identifier);
  }, [inputs]);
  console.log('messageFields', messageFields.fields);
  return (
    <PromptMessagesField
      messageFields={messageFields}
      availableFields={availableMentions}
      otherNodesFields={{}}
    />
  );
}
