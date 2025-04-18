import { MODULES } from "~/optimization_studio/registry";
import { NodeDraggable } from "./NodeDraggable";
import type { NodeWithOptionalPosition } from "~/types";
import type { Component } from "~/optimization_studio/types/dsl";
import { useWorkflowStore } from "~/optimization_studio/hooks/useWorkflowStore";
import { useInitializeNewLlmConfig } from "~/prompt-configs/hooks/useCreateNewLlmConfig";
import { useCallback } from "react";
import { llmConfigToNodeData } from "~/optimization_studio/utils/registryUtils";
import type { LatestConfigVersionSchema } from "~/server/prompt-config/repositories/llm-config-version-schema";

export function LlmSignatureNodeDraggable() {
  const { setNode, getWorkflow } = useWorkflowStore((state) => ({
    setNode: state.setNode,
    getWorkflow: state.getWorkflow,
  }));

  const { initializeNewLlmConfigWithVersion } = useInitializeNewLlmConfig();

  /**
   * When the node is dropped, we want to create
   * a new signature node in the database and link it.
   */
  const handleDragEnd = useCallback(
    (item: { node: NodeWithOptionalPosition<Component> }) => {
      void (async () => {
        const { name: workflowName } = getWorkflow();
        const promptName = `${workflowName} Prompt`;
        // Do this right away so that it appears snappy
        setNode({
          id: item.node.id,
          data: {
            name: promptName,
          },
        });
        const { config, version } = await initializeNewLlmConfigWithVersion({
          name: promptName,
        });

        setNode({
          id: item.node.id,
          data: llmConfigToNodeData(
            config,
            version as unknown as LatestConfigVersionSchema
          ),
        });
      })();
    },
    [getWorkflow, initializeNewLlmConfigWithVersion, setNode]
  );

  return (
    <NodeDraggable
      component={MODULES.signature}
      type="signature"
      onDragEnd={handleDragEnd}
    />
  );
}
