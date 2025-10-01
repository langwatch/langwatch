import { Button, HStack, Text } from "@chakra-ui/react";
import { useFormContext } from "react-hook-form";
import { LuPencil } from "react-icons/lu";

import { CopyButton } from "../../../components/CopyButton";
import type { PromptConfigFormValues } from "~/prompt-configs";

import { usePromptConfigContext } from "~/prompt-configs/providers/PromptConfigProvider";
import {
  versionedPromptToPromptConfigFormValues,
} from "~/prompt-configs/llmPromptConfigUtils";
import { toaster } from "~/components/ui/toaster";

export function EditablePromptHandleField() {
  const form = useFormContext<PromptConfigFormValues>();
  const { triggerChangeHandle } = usePromptConfigContext();

  const handleTriggerChangeHandle = async () => {
    try {
      const id = form.watch("id");
      if (!id) {
        throw new Error("Config ID is required");
      }

      const prompt = await triggerChangeHandle({
        id,
      });
      form.reset(versionedPromptToPromptConfigFormValues(prompt));
      toaster.create({
        title: "Prompt handle changed",
        description: `Prompt handle has been changed to ${prompt.handle}`,
        type: "success",
      });
    } catch (error) {
      console.error(error);
      toaster.create({
        title: "Error changing prompt handle",
        description: "Failed to change prompt handle",
        type: "error",
      });
    }
  };

  const handle = form.watch("handle");

  return (
    <HStack
      paddingX={1}
      gap={1}
      className="group"
      width="full"
      position="relative"
      minWidth={0}
      _hover={{
        "& .handle-text": {
          opacity: 0.4,
        },
        "& .handle-actions": {
          opacity: 1,
        },
      }}
    >
      {handle ? (
        <Text
          className="handle-text"
          fontSize="sm"
          fontWeight="500"
          fontFamily="mono"
          textWrap="wrap"
          minWidth={0}
          overflow="hidden"
          transition="opacity 0.2s"
        >
          {handle}
        </Text>
      ) : (
        <Text color="gray.500">Draft</Text>
      )}
      {handle && (
        <HStack
          className="handle-actions"
          position="absolute"
          right={1}
          opacity={0}
          transition="opacity 0.2s"
          gap={1}
          background="gray.50"
          paddingX={1}
        >
          <Button
            id="js-edit-prompt-handle"
            onClick={() => void handleTriggerChangeHandle()}
            variant="ghost"
            _hover={{
              backgroundColor: "gray.100",
            }}
            textTransform="uppercase"
            size="xs"
          >
            <LuPencil />
          </Button>
          <CopyButton value={handle} label="Prompt ID" />
        </HStack>
      )}
    </HStack>
  );
}
