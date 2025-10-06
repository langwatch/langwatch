import type { Node } from "@xyflow/react";
import { useMemo, useCallback } from "react";
import { useFormContext } from "react-hook-form";

import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { LlmPromptConfigComponent } from "~/optimization_studio/types/dsl";
import type { PromptConfigFormValues } from "~/prompt-configs";
import { versionedPromptToPromptConfigFormValues } from "~/prompt-configs/llmPromptConfigUtils";
import { api } from "~/utils/api";
import { createLogger } from "~/utils/logger";


const logger = createLogger("langwatch:optimization_studio:use-node-drift");

/**
 * Detects drift between optimization studio node data and database version.
 */
export function useNodeDrift(node: Node<LlmPromptConfigComponent>) {
  const { project } = useOrganizationTeamProject();
  const { configId, handle } = node.data;
  const idOrHandle = configId ?? handle ?? "";
  const {
    data: latestPrompt,
    isLoading: isLoadingPrompt,
    isFetching: isFetchingLatestPrompt,
  } = api.prompts.getByIdOrHandle.useQuery(
    {
      idOrHandle,
      projectId: project?.id ?? "",
    },
    {
      enabled: !!idOrHandle && !!project?.id,
    }
  );
  const formProps = useFormContext<PromptConfigFormValues>();
  /**
   * If the node data version is less than the latest prompt version,
   * we want to prompt the user to update the node data to the latest version.
   */
  const hasDrift = useMemo(() => {
    if (!latestPrompt || isFetchingLatestPrompt || isLoadingPrompt)
      return false;
    return latestPrompt.version > (node.data.versionNumber ?? 0);
  }, [latestPrompt, node.data, isFetchingLatestPrompt, isLoadingPrompt]);

  /**
   * Reload the latest version into the form (which should update the node data)
   */
  const loadLatestVersion = useCallback(async () => {
    try {
      if (!latestPrompt) throw new Error("Latest prompt not found");

      formProps.reset(versionedPromptToPromptConfigFormValues(latestPrompt));

      toaster.create({
        title: "Latest version loaded",
        description: "Node has been updated with the latest database version",
        type: "success",
      });
    } catch (error) {
      logger.error(
        { error, configId, handle },
        "Failed to load latest version"
      );
      toaster.create({
        title: "Failed to load latest version",
        description: "Please try again",
        type: "error",
      });
    }
  }, [latestPrompt, formProps, configId, handle]);

  return {
    hasDrift,
    loadLatestVersion,
    isLoadingPrompt: isLoadingPrompt || isFetchingLatestPrompt,
  };
}
