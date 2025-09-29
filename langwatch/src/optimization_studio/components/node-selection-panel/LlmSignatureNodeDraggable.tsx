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
} from "~/prompt-configs/llmPromptConfigUtils";
import type { NodeWithOptionalPosition } from "~/types";
import { createLogger } from "~/utils/logger";
import { snakeCase } from "~/utils/stringCasing";

const logger = createLogger(
  "langwatch:optimization_studio:node-selection-panel:LlmSignatureNodeDraggable"
);

export function LlmSignatureNodeDraggable() {
  const { project } = useOrganizationTeamProject();
  const setNode = useSmartSetNode();
  const { getWorkflow } = useWorkflowStore((state) => ({
    getWorkflow: state.getWorkflow,
  }));

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

        /**
         * Convert the name to the handle standard
         */
        const handle = snakeCase(promptName);

        // Do this right away so that it appears snappy
        setNode({
          id: item.node.id,
          data: {
            name: handle,
          },
        });

        try {
          setNode({
            id: item.node.id,
            data: MODULES.signature
          });
        } catch (error) {
          logger.error("Error creating new prompt", {
            error,
            workflowName,
            handle,
          });

          toaster.error({
            title: "Error",
            description: "Error creating new prompt",
            type: "error",
          });
        }
      })();
    },
    [getWorkflow, setNode, project?.id]
  );

  return (
    <NodeDraggable
      component={MODULES.signature}
      type="signature"
      onDragEnd={handleDragEnd}
    />
  );
}
