import { Button, HStack, type StackProps, Text } from "@chakra-ui/react";
import clsx from "clsx";
import { Edit3 } from "react-feather";
import { useFormContext } from "react-hook-form";

import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { PromptConfigFormValues } from "~/prompts";
import { usePromptConfigContext } from "~/prompts/providers/PromptConfigProvider";
import { versionedPromptToPromptConfigFormValuesWithSystemMessage } from "~/prompts/utils/llmPromptConfigUtils";
import type { VersionedPrompt } from "~/server/prompt-config";
import { api } from "~/utils/api";
import { createLogger } from "~/utils/logger";
import { CopyButton } from "../../../components/CopyButton";

const logger = createLogger(
  "langwatch:prompt-configs:editable-prompt-handle-field",
);

type EditablePromptHandleFieldProps = StackProps;

/**
 * EditablePromptHandleField component
 * Single Responsibility: Displays and allows editing of prompt handle with permission checks
 * @param props - EditablePromptHandleFieldProps extending StackProps
 * @returns JSX.Element - Renders an editable prompt handle display with edit and copy buttons
 */
export function EditablePromptHandleField(
  props: EditablePromptHandleFieldProps,
) {
  const form = useFormContext<PromptConfigFormValues>();
  const { triggerChangeHandle } = usePromptConfigContext();
  const { project } = useOrganizationTeamProject();

  const configId = form.watch("configId");

  const { data: permission } = api.prompts.checkModifyPermission.useQuery(
    {
      idOrHandle: configId ?? "",
      projectId: project?.id ?? "",
    },
    {
      enabled: !!configId && !!project?.id,
    },
  );

  const canEdit = permission?.hasPermission ?? false;

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
      form.reset(
        versionedPromptToPromptConfigFormValuesWithSystemMessage(prompt),
      );
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
        description: error.message,
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
      minWidth="80px"
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
          textOverflow="ellipsis"
          whiteSpace="nowrap"
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
          <Tooltip
            content={permission?.reason ?? "Edit prompt handle"}
            disabled={canEdit}
            positioning={{ placement: "top" }}
            showArrow
            portalled={false}
          >
            <Button
              id="js-edit-prompt-handle"
              onClick={handleTriggerChangeHandle}
              variant="ghost"
              _hover={{
                backgroundColor: canEdit ? "gray.100" : undefined,
              }}
              textTransform="uppercase"
              size="xs"
              disabled={!canEdit}
              opacity={canEdit ? 1 : 0.5}
              cursor={canEdit ? "pointer" : "not-allowed"}
            >
              <Edit3 />
            </Button>
          </Tooltip>
          <CopyButton value={handle} label="Prompt ID" />
        </HStack>
      )}
    </HStack>
  );
}
