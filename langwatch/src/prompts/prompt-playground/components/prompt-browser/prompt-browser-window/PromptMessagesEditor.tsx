import { Box } from "@chakra-ui/react";
import { PromptMessagesField } from "~/prompts/forms/fields/message-history-fields/PromptMessagesField";
import { useFieldArray, useFormContext } from "react-hook-form";
import type { PromptConfigFormValues } from "~/prompts";
import { useMemo } from "react";

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
  return (
    <Box width="full" bg="gray.100" paddingY={1} paddingX={2} borderRadius="md">
      <PromptMessagesField
        messageFields={messageFields}
        availableFields={availableMentions}
        otherNodesFields={{}}
      />
    </Box>
  );
}
