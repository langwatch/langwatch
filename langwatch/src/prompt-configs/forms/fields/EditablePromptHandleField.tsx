import { Button, HStack, Text, type StackProps } from "@chakra-ui/react";
import clsx from "clsx";
import { useFormContext } from "react-hook-form";
import { LuPencil } from "react-icons/lu";

import { toaster } from "~/components/ui/toaster";
import type { PromptConfigFormValues } from "~/prompt-configs";
import { versionedPromptToPromptConfigFormValues } from "~/prompt-configs/utils/llmPromptConfigUtils";
import { usePromptConfigContext } from "~/prompt-configs/providers/PromptConfigProvider";
import type { VersionedPrompt } from "~/server/prompt-config";
import { createLogger } from "~/utils/logger";
import { CopyButton } from "../../../components/CopyButton";

const logger = createLogger(
  "langwatch:prompt-configs:editable-prompt-handle-field",
);

type EditablePromptHandleFieldProps = StackProps;

export function EditablePromptHandleField(
  props: EditablePromptHandleFieldProps,
) {
  const form = useFormContext<PromptConfigFormValues>();
  const { triggerChangeHandle } = usePromptConfigContext();

  const handleTriggerChangeHandle = () => {
    const id = form.watch("configId");
    if (!id) {
      logger.error({ id }, "Config ID is required");
      toaster.create({
        title: "Error changing prompt handle",
        description: "Failed to change prompt handle",
        type: "error",
      });
      return;
    }

    const onSuccess = (prompt: VersionedPrompt) => {
      form.reset(versionedPromptToPromptConfigFormValues(prompt));
      toaster.create({
        title: "Prompt handle changed",
        description: `Prompt handle has been changed to ${prompt.handle}`,
        type: "success",
      });
    };

    const onError = (error: Error) => {
      console.error(error);
      toaster.create({
        title: "Error changing prompt handle",
        description: "Failed to change prompt handle",
        type: "error",
      });
    };

    triggerChangeHandle({ id, onSuccess, onError });
  };

  const handle = form.watch("handle");

  return (
    <HStack
      paddingX={1}
      gap={1}
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
      {...props}
      className={clsx("group", props.className)}
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
            onClick={handleTriggerChangeHandle}
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
