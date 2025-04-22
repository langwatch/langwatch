import { Separator } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useCallback } from "react";

import { useWorkflowStore } from "../../../hooks/useWorkflowStore";
import type { Signature } from "../../../types/dsl";
import { BasePropertiesPanel } from "../BasePropertiesPanel";

import { PromptSource } from "./prompt-source-select/PromptSource";

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  nodeDataToPromptConfigFormValues,
  promptConfigFormValuesToNodeData,
} from "~/optimization_studio/utils/llmPromptConfigUtils";
import { PromptConfigForm } from "~/prompt-configs/forms/PromptConfigForm";
import {
  usePromptConfigForm,
  type PromptConfigFormValues,
} from "~/prompt-configs/hooks/usePromptConfigForm";

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

  /**
   * Syncs the node data with the form values.
   * formValues => nodeData
   */
  const syncNodeDataWithFormValues = useCallback(
    (formValues: PromptConfigFormValues) => {
      const newNodeData = promptConfigFormValuesToNodeData(
        node.data.configId,
        formValues
      );
      setNode({
        ...node,
        data: newNodeData,
      });
    },
    [node, setNode]
  );

  const initialConfigValues = nodeDataToPromptConfigFormValues(node.data);
  const formProps = usePromptConfigForm({
    configId: node.data.configId,
    initialConfigValues,
    projectId: project?.id ?? "",
    onChange: (formValues) => {
      // If the form values have changed, update the node data
      const shouldUpdate = isEqual(formValues, initialConfigValues);

      if (shouldUpdate) {
        syncNodeDataWithFormValues(formValues);
      }
    },
  });

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
      <PromptConfigForm {...formProps} />
    </BasePropertiesPanel>
  );
}

function isEqual(a: any, b: any) {
  return JSON.stringify(a) !== JSON.stringify(b);
}
