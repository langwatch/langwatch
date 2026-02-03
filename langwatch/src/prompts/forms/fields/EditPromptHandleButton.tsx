import { Button } from "@chakra-ui/react";
import { useFormContext } from "react-hook-form";
import { LuPencil } from "react-icons/lu";

import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { PromptConfigFormValues } from "~/prompts";
import { usePromptConfigContext } from "~/prompts/providers/PromptConfigProvider";
import { versionedPromptToPromptConfigFormValuesWithSystemMessage } from "~/prompts/utils/llmPromptConfigUtils";
import type { VersionedPrompt } from "~/server/prompt-config";
import { api } from "~/utils/api";
import { createLogger } from "~/utils/logger/client";

const logger = createLogger(
  "langwatch:prompt-configs:edit-prompt-handle-button",
);

/**
 * EditPromptHandleButton component
 * Single Responsibility: Renders an edit button that triggers the prompt handle change dialog
 * @returns JSX.Element - Renders a button with tooltip for editing prompt handle
 */
export function EditPromptHandleButton() {
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

  if (!configId) {
    return null;
  }

  return (
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
          backgroundColor: canEdit ? "bg.subtle" : undefined,
        }}
        textTransform="uppercase"
        size="xs"
        disabled={!canEdit}
        opacity={canEdit ? 1 : 0.5}
        cursor={canEdit ? "pointer" : "not-allowed"}
      >
        <LuPencil />
      </Button>
    </Tooltip>
  );
}
