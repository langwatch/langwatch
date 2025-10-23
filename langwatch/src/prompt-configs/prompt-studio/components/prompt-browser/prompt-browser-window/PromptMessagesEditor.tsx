import { Box } from "@chakra-ui/react";
import { PromptMessagesField } from "~/prompt-configs/forms/fields/message-history-fields/PromptMessagesField";
import { useFieldArray, useFormContext } from "react-hook-form";
import type { PromptConfigFormValues } from "~/prompt-configs";
import { useMemo } from "react";

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
    <Box width="full" bg="white">
      <PromptMessagesField
        messageFields={messageFields}
        availableFields={availableMentions}
        otherNodesFields={{}}
      />
    </Box>
  );
}
