import { useCallback } from "react";

import { NodeDraggable } from "./NodeDraggable";

import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useSmartSetNode } from "~/optimization_studio/hooks/useSmartSetNode";
import { useWorkflowStore } from "~/optimization_studio/hooks/useWorkflowStore";
import { MODULES } from "~/optimization_studio/registry";
import type { Component } from "~/optimization_studio/types/dsl";
import {
  createNewOptimizationStudioPromptName,
  llmConfigToOptimizationStudioNodeData,
} from "~/prompt-configs/llmPromptConfigUtils";
import type { NodeWithOptionalPosition } from "~/types";
import { api } from "~/utils/api";

export function LlmSignatureNodeDraggable() {
  const { project } = useOrganizationTeamProject();
  const setNode = useSmartSetNode();
  const { getWorkflow } = useWorkflowStore((state) => ({
    getWorkflow: state.getWorkflow,
  }));

  const createConfigWithInitialVersion =
    api.llmConfigs.createConfigWithInitialVersion.useMutation();

  /**
   * When the node is dropped, we want to create
   * a new signature node in the database and link it.
   */
  const handleDragEnd = useCallback(
    (item: { node: NodeWithOptionalPosition<Component> }) => {
      void (async () => {
        if (!project?.id) {
          throw new Error("Project ID is required");
        }

        const { name: workflowName, nodes } = getWorkflow();
        const promptName = createNewOptimizationStudioPromptName(
          workflowName,
          nodes
        );
        // Do this right away so that it appears snappy
        setNode({
          id: item.node.id,
          data: {
            name: promptName,
          },
        });

        try {
          const config = await createConfigWithInitialVersion.mutateAsync({
            name: promptName,
            projectId: project.id,
          });

          setNode({
            id: item.node.id,
            data: llmConfigToOptimizationStudioNodeData(config),
          });
        } catch (error) {
          console.error("Error creating new prompt", error);
          toaster.error({
            title: "Error",
            description: "Error creating new prompt",
            type: "error",
          });
        }
      })();
    },
    [getWorkflow, createConfigWithInitialVersion, setNode, project?.id]
  );

  return (
    <NodeDraggable
      component={MODULES.signature}
      type="signature"
      onDragEnd={handleDragEnd}
    />
  );
}
