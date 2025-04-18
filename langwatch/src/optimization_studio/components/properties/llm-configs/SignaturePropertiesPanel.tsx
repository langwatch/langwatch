import { Separator } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";

import { useWorkflowStore } from "../../../hooks/useWorkflowStore";
import type { Signature } from "../../../types/dsl";
import { BasePropertiesPanel } from "../BasePropertiesPanel";

import { PromptSource } from "./prompt-source-select/PromptSource";

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { llmConfigToNodeData } from "~/optimization_studio/utils/registryUtils";
import { PromptConfigForm } from "~/prompt-configs/forms/PromptConfigForm";
import { api } from "~/utils/api";

/**
 * Properties panel for the Signature node in the optimization studio.
 *
 * A Signature in this context is based on the DSPy concept, which defines
 * an interface for LLM interactions with inputs, outputs, and parameters.
 *
 * This panel allows users to configure:
 * - The LLM model to use for this signature
 * - Instructions for the LLM
 * - Demonstrations (few-shot examples)
 * - Prompting techniques (like Chain of Thought)
 *
 * The Signature node represents an LLM calling component in the workflow
 * that can be connected with other nodes to build complex LLM-powered applications.
 */
export function SignaturePropertiesPanel({ node }: { node: Node<Signature> }) {
  const { project } = useOrganizationTeamProject();
  const { setNode } = useWorkflowStore((state) => ({
    setNode: state.setNode,
  }));

  // We need to refetch the latest config to update the node data
  // TODO: Consider moving this to a listener tied to the store
  const { refetch } = api.llmConfigs.getByIdWithLatestVersion.useQuery({
    id: node.data.configId,
    projectId: project?.id ?? "",
  });

  const handleSubmitSuccess = async () => {
    const latestConfig = await refetch();

    if (!latestConfig.data) return;

    setNode({
      ...node,
      data: llmConfigToNodeData(latestConfig.data),
    });

    if (!project?.id) {
      throw new Error("Project ID is required");
    }
  };

  const handlePromptSourceSelect = (config: { id: string; name: string }) => {
    setNode({
      ...node,
      data: {
        ...node.data,
        name: config.name,
        configId: config.id,
      },
    });
  };

  // TODO: Consider refactoring the BasePropertiesPanel so that we don't need to hide everything like this
  return (
    <BasePropertiesPanel node={node} hideParameters hideInputs hideOutputs>
      <PromptSource
        configId={node.data.configId}
        onSelect={handlePromptSourceSelect}
      />
      <Separator />
      <PromptConfigForm
        configId={node.data.configId}
        onSubmitSuccess={() => {
          void handleSubmitSuccess();
        }}
      />
    </BasePropertiesPanel>
  );
}
