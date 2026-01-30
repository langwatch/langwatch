import { useCallback } from "react";
import { useFormContext } from "react-hook-form";

import { toaster } from "~/components/ui/toaster";
import type { PromptConfigFormValues } from "~/prompts";
import { usePrompts } from "~/prompts/hooks/usePrompts";
import { versionedPromptToPromptConfigFormValues } from "~/prompts/utils/llmPromptConfigUtils";
import { createLogger } from "~/utils/logger.client";

const logger = createLogger(
  "langwatch:optimization_studio:use-reset-form-with-latest-version",
);

/**
 * useResetFormWithLatestDatabaseVersion hook provides drift detection and reload functionality for a node's prompt config.
 * - Provides a method (resetFormWithLatestVersion) to reload the latest version into the form via the useFormContext.
 * - Returns { resetFormWithLatestVersion } for use in UI components.
 */
export function useResetFormWithLatestDatabaseVersion(params: {
  configId?: string;
}) {
  const { configId } = params;
  const formProps = useFormContext<PromptConfigFormValues>();
  const { getPromptById } = usePrompts();

  /**
   * Reload the latest version into the form (which should update the node data)
   */
  const resetFormWithLatestVersion = useCallback(async () => {
    if (!configId) {
      toaster.create({
        title: "Cannot load latest version",
        description: "No config ID found",
        type: "error",
      });
      return;
    }

    try {
      const latestPrompt = await getPromptById({
        id: configId,
      });

      if (!latestPrompt) throw new Error("Latest prompt not found");

      formProps.reset(versionedPromptToPromptConfigFormValues(latestPrompt));

      toaster.create({
        title: "Latest version loaded",
        description: "Node has been updated with the latest database version",
        type: "success",
      });
    } catch (error) {
      logger.error({ error, configId }, "Failed to load latest version");
      toaster.create({
        title: "Failed to load latest version",
        description: "Please try again",
        type: "error",
      });
    }
  }, [getPromptById, formProps, configId]);

  return {
    resetFormWithLatestVersion,
  };
}
