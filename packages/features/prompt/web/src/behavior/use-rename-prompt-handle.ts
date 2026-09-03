import { useCallback } from "react";

import { usePromptHost } from "../model/prompt-host";
import { usePromptProject } from "./use-prompt-project";
import { usePromptConfigContext } from "../model/prompt-config-context";
import type { VersionedPrompt } from "@langwatch/prompt-contract";
import { promptApi } from "./prompt-api";

type UseRenamePromptHandleOptions = {
  promptId: string;
  onSuccess?: (prompt: VersionedPrompt) => void;
};

/**
 * Hook for renaming a prompt handle.
 * Single Responsibility: Provides the action and permission state for renaming a prompt handle.
 */
export const useRenamePromptHandle = ({ promptId, onSuccess }: UseRenamePromptHandleOptions) => {
  const { triggerChangeHandle } = usePromptConfigContext();
  const host = usePromptHost();
  const { project } = usePromptProject();
  const utils = promptApi.useUtils();

  const { data: permission } = promptApi.prompts.checkModifyPermission.useQuery(
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
      // A local precondition, not a server failure. It travels as a real
      // Error so the host's failure lane shows the fallback title; the
      // two-level feedback port carries no description on a failure, which is
      // the cost the data-governance family recorded first.
      host.failed({
        error: new Error("Save this prompt before renaming its handle."),
        fallbackTitle: "Save this prompt before renaming its handle",
      });
      return;
    }

    const handleSuccess = (prompt: VersionedPrompt) => {
      void utils.prompts.getAllPromptsForProject.invalidate();
      host.succeeded({
        title: "Prompt handle changed",
        description: `Prompt handle has been changed to ${prompt.handle}`,
      });
      onSuccess?.(prompt);
    };

    const handleError = (error: Error) => {
      // The toast shows the registry's copy for the code, so the raw error
      // reaches no surface — this is its only local diagnostic.
      host.failed({ error, fallbackTitle: "Couldn't change the prompt handle" });
    };

    triggerChangeHandle({
      id: promptId,
      onSuccess: handleSuccess,
      onError: handleError,
    });
  }, [promptId, triggerChangeHandle, utils, onSuccess, host]);

  return {
    renameHandle,
    canRename,
    permissionReason: permission?.reason,
  };
};
