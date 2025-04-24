import { Separator, Spinner } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useCallback, useEffect, useRef } from "react";
import { FormProvider } from "react-hook-form";

import type { LatestConfigVersionSchema } from "~/server/prompt-config/repositories/llm-config-version-schema";

import { useWorkflowStore } from "../../../hooks/useWorkflowStore";
import type { LlmPromptConfigComponent, Signature } from "../../../types/dsl";
import { BasePropertiesPanel } from "../BasePropertiesPanel";

import { PromptSourceHeader } from "./prompt-source-select/PromptSourceHeader";

import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useSmartSetNode } from "~/optimization_studio/hooks/useSmartSetNode";
import {
  createNewPromptName,
  llmConfigToNodeData,
  nodeDataToPromptConfigFormInitialValues,
  promptConfigFormValuesToNodeData,
} from "~/optimization_studio/utils/llmPromptConfigUtils";
import { DemonstrationsField } from "~/prompt-configs/forms/fields/DemonstrationsField";
import { PromptConfigVersionFieldGroup } from "~/prompt-configs/forms/fields/PromptConfigVersionFieldGroup";
import { PromptNameField } from "~/prompt-configs/forms/fields/PromptNameField";
import { usePromptConfig } from "~/prompt-configs/hooks/usePromptConfig";
import {
  usePromptConfigForm,
  type PromptConfigFormValues,
} from "~/prompt-configs/hooks/usePromptConfigForm";
import { PromptConfigProvider } from "~/prompt-configs/providers/PromptConfigProvider";
import { usePromptConfigContext } from "~/prompt-configs/providers/PromptConfigProvider";
import { api } from "~/utils/api";
/**
 * Properties panel for the Signature node in the optimization studio.
 *
 * A Signature node represents an LLM calling component in the workflow
 * that can be connected with other nodes to build complex LLM-powered applications.
 * It is based on the DSPy concept, which defines an interface for LLM interactions.
 *
 * This panel allows users to configure:
 * - Prompt source selection and version history
 * - The LLM model to use
 * - Prompt template with input variables
 * - Output schema definition
 * - Demonstrations (few-shot examples)
 * - Advanced prompting techniques
 */
function SignaturePropertiesPanelInner({
  node,
}: {
  node: Node<LlmPromptConfigComponent>;
}) {
  const trpc = api.useContext();
  const { project } = useOrganizationTeamProject();
  const { triggerSaveVersion } = usePromptConfigContext();
  const configId = node.data.configId;
  const setNode = useSmartSetNode();

  /**
   * Converts form values to node data and updates the workflow store.
   * This ensures the node's data stays in sync with the form state.
   *
   * @param formValues - The current form values to sync with node data
   */
  const syncNodeDataWithFormValues = useCallback(
    (formValues: PromptConfigFormValues) => {
      const newNodeData = promptConfigFormValuesToNodeData(
        configId,
        formValues
      );
      setNode({
        ...node,
        data: newNodeData,
      });
    },
    [configId, node, setNode]
  );

  // Initialize form with values from node data
  const initialConfigValues = nodeDataToPromptConfigFormInitialValues(
    node.data
  );
  const formProps = usePromptConfigForm({
    configId,
    initialConfigValues,
    onChange: (formValues) => {
      const shouldUpdate = !isEqual(formValues, initialConfigValues);

      // Only update node data if form values have actually changed
      if (shouldUpdate) {
        syncNodeDataWithFormValues(formValues);
      }
    },
  });

  /**
   * Updates node data when a new prompt source is selected
   */
  const handlePromptSourceSelect = async (selectedConfig: {
    id: string;
    name: string;
  }) => {
    try {
      const config = await trpc.llmConfigs.getByIdWithLatestVersion.fetch({
        id: selectedConfig.id,
        projectId: project?.id ?? "",
      });

      const newNodeData = llmConfigToNodeData(config);

      // Update the node data with the new config
      setNode({
        ...node,
        data: newNodeData,
      });

      // Reset the form with the updated node data
      formProps.methods.reset(
        nodeDataToPromptConfigFormInitialValues(newNodeData)
      );
    } catch (error) {
      console.error(error);
      toaster.error({
        title: "Failed to update prompt source",
        description: "Please try again.",
      });
    }
  };

  // TODO: Consider refactoring the BasePropertiesPanel so that we don't need to hide everything like this
  return (
    <BasePropertiesPanel node={node} hideParameters hideInputs hideOutputs>
      <Separator />
      <PromptSourceHeader
        node={node}
        onPromptSourceSelect={(config) => void handlePromptSourceSelect(config)}
        triggerSaveVersion={triggerSaveVersion}
        values={formProps.methods.getValues()}
      />
      {/* Prompt Configuration Form */}
      <FormProvider {...formProps.methods}>
        <form style={{ width: "100%" }}>
          <PromptNameField />
          <PromptConfigVersionFieldGroup />
          <DemonstrationsField />
        </form>
      </FormProvider>
    </BasePropertiesPanel>
  );
}

/**
 * Wrapper component that provides the PromptConfigProvider context
 * to the inner panel component
 */
export function SignaturePropertiesPanel({
  node,
}: {
  node: Node<Signature | Node<LlmPromptConfigComponent>>;
}) {
  const { project } = useOrganizationTeamProject();
  const createMutation =
    api.llmConfigs.createConfigWithInitialVersion.useMutation();
  const setNode = useSmartSetNode();
  const { name: workflowName, nodes } = useWorkflowStore((state) => ({
    name: state.getWorkflow().name,
    nodes: state.getWorkflow().nodes,
  }));
  const nodeHasConfigId = "configId" in node.data;
  const idRef = useRef<string | null>(null);
  const { createNewVersion } = usePromptConfig();

  // For backwards compatibility, we need to check if there's a configId on the node data.
  // If not, we need to create a new config and update the node data.
  useEffect(() => {
    if (!project?.id) return;
    // If the node id is the same as the idRef, we've already checked this node
    if (idRef.current === node.id) return;
    // If the node has a configId, we don't need to create a new config
    if (!nodeHasConfigId) {
      void (async () => {
        try {
          // Create a new config
          const newConfig = await createMutation.mutateAsync({
            name:
              (node.data as LlmPromptConfigComponent).name ??
              createNewPromptName(workflowName, nodes),
            projectId: project?.id ?? "",
          });

          // Convert the node data to form initial values
          const initialValues = nodeDataToPromptConfigFormInitialValues(
            node.data as LlmPromptConfigComponent
          );

          // Use the initial values to create a new version
          const currentConfigData = newConfig.latestVersion.configData; // Use the defaults
          const nodeConfigData = initialValues.version.configData; // Use the node's config data
          const newVersion = await createNewVersion(
            newConfig.id,
            {
              inputs: nodeConfigData.inputs ?? currentConfigData.inputs,
              outputs: nodeConfigData.outputs ?? currentConfigData.outputs,
              model: nodeConfigData.model ?? currentConfigData.model,
              prompt: nodeConfigData.prompt ?? currentConfigData.prompt,
              demonstrations:
                nodeConfigData.demonstrations ??
                currentConfigData.demonstrations,
            },
            "Save from legacy node"
          );

          // Convert the new config and version to node data
          const newNodeData = llmConfigToNodeData({
            ...newConfig,
            latestVersion: newVersion as unknown as LatestConfigVersionSchema,
          });

          // Update the node data with the new config and version
          setNode({
            ...node,
            data: newNodeData,
          });
        } catch (error) {
          console.error(error);
          toaster.error({
            title: "Failed to migrate legacy node",
            description:
              "Please contact support if this issue persists. This should not happen.",
          });
        }
      })();
      // Set the idRef to the node id to prevent duplicate calls
      idRef.current = node.id;
    }
  }, [
    project?.id,
    createMutation,
    node,
    workflowName,
    nodes,
    setNode,
    nodeHasConfigId,
    createNewVersion,
  ]);

  if (!nodeHasConfigId) {
    return (
      <BasePropertiesPanel node={node} hideParameters hideInputs hideOutputs>
        <Spinner />
      </BasePropertiesPanel>
    );
  }

  return (
    <PromptConfigProvider>
      <SignaturePropertiesPanelInner
        node={node as Node<LlmPromptConfigComponent>}
      />
    </PromptConfigProvider>
  );
}

/**
 * Utility function to compare objects for equality
 * Used to determine if form values have changed
 */
function isEqual(a: any, b: any) {
  return JSON.stringify(a, null, 2) === JSON.stringify(b, null, 2);
}
