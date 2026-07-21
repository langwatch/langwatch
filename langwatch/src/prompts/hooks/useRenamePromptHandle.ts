import { useCallback } from "react";

import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePromptConfigContext } from "~/prompts/providers/PromptConfigProvider";
import type { VersionedPrompt } from "~/server/prompt-config";
import { api } from "~/utils/api";

type UseRenamePromptHandleOptions = {
  promptId: string;
  onSuccess?: (prompt: VersionedPrompt) => void;
};

/**
 * Hook for renaming a prompt handle.
 * Single Responsibility: Provides the action and permission state for renaming a prompt handle.
 */
export const useRenamePromptHandle = ({
  promptId,
  onSuccess,
}: UseRenamePromptHandleOptions) => {
  const { triggerChangeHandle } = usePromptConfigContext();
  const { project } = useOrganizationTeamProject();
  const utils = api.useContext();

  const { data: permission } = api.prompts.checkModifyPermission.useQuery(
    {
      idOrHandle: promptId,
      projectId: project?.id ?? "",
    },
    {
      enabled: !!promptId && !!project?.id,
    },
  );

  const canRename = permission?.hasPermission ?? false;

  const renameHandle = useCallback(() => {
    if (!promptId) {
      // A local precondition, not a server failure.
      toaster.create({
        title: "Couldn't change the prompt handle",
        description: "Save this prompt before renaming its handle.",
        type: "error",
        meta: { closable: true },
      });
      return;
    }

    const handleSuccess = (prompt: VersionedPrompt) => {
      void utils.prompts.getAllPromptsForProject.invalidate();
      toaster.create({
        title: "Prompt handle changed",
        description: `Prompt handle has been changed to ${prompt.handle}`,
        type: "success",
      });
      onSuccess?.(prompt);
    };

    const handleError = (error: Error) =>
      showErrorToast(error, {
        fallbackTitle: "Couldn't change the prompt handle",
      });

    triggerChangeHandle({
      id: promptId,
      onSuccess: handleSuccess,
      onError: handleError,
    });
  }, [promptId, triggerChangeHandle, utils, onSuccess]);

  return {
    renameHandle,
    canRename,
    permissionReason: permission?.reason,
  };
};
