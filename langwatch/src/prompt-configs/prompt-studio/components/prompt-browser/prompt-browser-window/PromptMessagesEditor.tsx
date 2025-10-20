import { Box } from "@chakra-ui/react";
import { PromptMessagesField } from "~/prompt-configs/forms/fields/PromptMessagesField";
import { useFieldArray, useFormContext } from "react-hook-form";
import type { PromptConfigFormValues } from "~/prompt-configs";

export function PromptMessagesEditor() {
  const form = useFormContext<PromptConfigFormValues>();
  const messageFields = useFieldArray({
    control: form.control,
    name: "version.configData.messages",
  });
  return (
    <Box height="full" width="full" bg="white">
      <PromptMessagesField
        // TODO: Since this field needs to be used in the form context, consider not passing this prop
        messageFields={messageFields}
        availableFields={[]}
        otherNodesFields={{}}
      />
    </Box>
  );
}
