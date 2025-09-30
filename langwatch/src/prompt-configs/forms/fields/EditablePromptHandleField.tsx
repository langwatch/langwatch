import { Button, HStack, Text } from "@chakra-ui/react";
import { useFormContext } from "react-hook-form";
import { LuPencil } from "react-icons/lu";

import { CopyButton } from "../../../components/CopyButton";
import type { PromptConfigFormValues } from "~/prompt-configs";

import { usePromptConfigContext } from "~/prompt-configs/providers/PromptConfigProvider";
import {
  formValuesToTriggerSaveVersionParams,
  versionedPromptToPromptConfigFormValues,
} from "~/prompt-configs/llmPromptConfigUtils";

export function EditablePromptHandleField() {
  const form = useFormContext<PromptConfigFormValues>();
  const { triggerChangeHandle } = usePromptConfigContext();

  const handleTriggerChangeHandle = () => {
    triggerChangeHandle({
      id: form.watch("id"),
      data: formValuesToTriggerSaveVersionParams(form.getValues()),
      onSuccess: (prompt) => {
        console.log('handle success', prompt)
        form.reset(versionedPromptToPromptConfigFormValues(prompt));
      },
    });
  };

  const handle = form.watch("handle");

  return (
    <HStack paddingX={1} gap={1} className="group" width="full">
      {handle ? (
        <Text fontSize="sm" fontWeight="500" fontFamily="mono">
          {handle}
        </Text>
      ) : (
        <Text color="gray.500">Draft</Text>
      )}
      {handle && (
        <Button
          // Do not remove this id, it is used to trigger the edit dialog
          id="js-edit-prompt-handle"
          onClick={handleTriggerChangeHandle}
          variant="ghost"
          _hover={{
            backgroundColor: "gray.100",
          }}
          textTransform="uppercase"
          visibility="hidden"
          _groupHover={{
            visibility: "visible",
          }}
          marginRight={"auto"}
        >
          <LuPencil />
        </Button>
      )}
      {handle && <CopyButton value={handle} label="Prompt ID" />}
    </HStack>
  );
}
