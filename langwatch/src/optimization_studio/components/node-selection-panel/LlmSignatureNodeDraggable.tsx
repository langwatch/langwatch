import { MODULES } from "~/optimization_studio/registry";
import { NodeDraggable } from "./NodeDraggable";
import type { NodeWithOptionalPosition } from "~/types";
import type {
  Component,
  Field,
  Signature,
} from "~/optimization_studio/types/dsl";
import { useWorkflowStore } from "~/optimization_studio/hooks/useWorkflowStore";
import { useInitializeNewLlmConfig } from "~/components/prompt-configs/hooks/useCreateNewLlmConfig";
import {
  findLowestAvailableName,
  nameToId,
} from "~/optimization_studio/utils/nodeUtils";
import { useCallback } from "react";
import {
  type LlmPromptConfig,
  type LlmPromptConfigVersion,
} from "@prisma/client";
import type { Node } from "@xyflow/react";
import type { LatestConfigVersionSchema } from "~/server/repositories/llm-config-version-schema";

function configToData(
  config: LlmPromptConfig,
  version: LatestConfigVersionSchema
): Node<Signature>["data"] {
  return {
    // We need this to be able to update the config
    configId: config.id,
    name: config.name,
    description: version.commitMessage,
    inputs: version.configData.inputs as Field[],
    outputs: version.configData.outputs as Field[],
    parameters: [
      {
        identifier: "llm",
        type: "llm",
        value: version.configData.model,
      },
      {
        identifier: "instructions",
        type: "str",
        value: version.configData.prompt,
      },
      {
        identifier: "demonstrations",
        type: "dataset",
        value: version.configData.demonstrations,
      },
    ],
  };
}

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
          data: configToData(
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
