import type { Node } from "@xyflow/react";
import { useMemo } from "react";
import { useFormContext } from "react-hook-form";

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { LlmPromptConfigComponent } from "~/optimization_studio/types/dsl";
import type { PromptConfigFormValues } from "~/prompt-configs";
import {
  isNodeDataEqual,
  versionedPromptToOptimizationStudioNodeData,
} from "~/prompt-configs/utils/llmPromptConfigUtils";
import { api } from "~/utils/api";
import { createLogger } from "~/utils/logger";

const logger = createLogger("langwatch:optimization_studio:use-node-drift");

/**
 * useNodeDrift hook provides drift detection and reload functionality for a node's prompt config.
 * - Detects if the node's data is out of sync with the latest version in the database (hasDrift).
 * - Provides a method (loadLatestVersion) to reload the latest version into the form and node.
 * - Returns { hasDrift, loadLatestVersion } for use in UI components.
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
   * If the node data (saved in the studio node array) is different from the latest prompt in the database,
   * show a warning and provide a button to reload the latest version into the form (which should update the node data)
   */
  const hasDrift = useMemo(() => {
    if (!latestPrompt || isFetchingLatestPrompt || isLoadingPrompt)
      return false;
    return !isNodeDataEqual(
      node.data,
      versionedPromptToOptimizationStudioNodeData(latestPrompt)
    );
  }, [latestPrompt, node.data, isFetchingLatestPrompt, isLoadingPrompt]);

  return {
    hasDrift,
    isLoading: isLoadingPrompt || isFetchingLatestPrompt,
  };
}
