import { api } from "~/utils/api";
import type { Node } from "@xyflow/react";
import type { LlmPromptConfigComponent } from "~/optimization_studio/types/dsl";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useMemo, useCallback } from "react";
import {
  isNodeDataEqual,
  versionedPromptToOptimizationStudioNodeData,
} from "~/prompt-configs/llmPromptConfigUtils";
import { versionedPromptToPromptConfigFormValues } from "~/prompt-configs/llmPromptConfigUtils";
import { toaster } from "~/components/ui/toaster";
import { createLogger } from "~/utils/logger";
import type { PromptConfigFormValues } from "~/prompt-configs";
import { useFormContext } from "react-hook-form";

const logger = createLogger("langwatch:optimization_studio:use-node-drift");

export function useNodeDrift(node: Node<LlmPromptConfigComponent>) {
  const { project } = useOrganizationTeamProject();
  const { configId, handle } = node.data;
  const idOrHandle = configId ?? handle ?? "";
  const { data: latestPrompt, isLoading: isLoadingPrompt } =
    api.prompts.getByIdOrHandle.useQuery(
      {
        idOrHandle,
        projectId: project?.id ?? "",
      },
      {
        enabled: !!idOrHandle && !!project?.id,
        // Check for changes every second to prevent user from accidentally overwriting changes
        // Disable refetching otherwise to prevent affecting other caches
        refetchInterval: 1000,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
        refetchOnReconnect: false,
      }
    );
  const formProps = useFormContext<PromptConfigFormValues>();
  /**
   * If the node data (saved in the studio node array) is different from the latest prompt in the database,
   * show a warning and provide a button to reload the latest version into the form (which should update the node data)
   */
  const hasDrift = useMemo(() => {
    if (!latestPrompt) return false;
    return !isNodeDataEqual(
      node.data,
      versionedPromptToOptimizationStudioNodeData(latestPrompt)
    );
  }, [latestPrompt, node.data]);

  /**
   * Reload the latest version into the form (which should update the node data)
   */
  const loadLatestVersion = useCallback(async () => {
    if (!latestPrompt) throw new Error("Latest prompt not found");

    try {
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
    isLoadingPrompt,
  };
}
