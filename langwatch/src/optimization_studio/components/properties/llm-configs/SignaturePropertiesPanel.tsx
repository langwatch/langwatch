import { Separator, HStack, Text } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useCallback, useMemo } from "react";
import { FormProvider } from "react-hook-form";

import { useWorkflowStore } from "../../../hooks/useWorkflowStore";
import type { Signature } from "../../../types/dsl";
import { BasePropertiesPanel } from "../BasePropertiesPanel";

import { PromptSource } from "./prompt-source-select/PromptSource";

import { toaster } from "~/components/ui/toaster";
import { VerticalFormControl } from "~/components/VerticalFormControl";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  llmConfigToNodeData,
  nodeDataToPromptConfigFormInitialValues,
  promptConfigFormValuesToNodeData,
} from "~/optimization_studio/utils/llmPromptConfigUtils";
import { DemonstrationsField } from "~/prompt-configs/forms/fields/DemonstrationsField";
import { PromptConfigVersionFieldGroup } from "~/prompt-configs/forms/fields/PromptConfigVersionFieldGroup";
import { PromptNameField } from "~/prompt-configs/forms/fields/PromptNameField";
import { VersionHistoryButton } from "~/prompt-configs/forms/prompt-config-form/components/VersionHistoryButton";
import { VersionSaveButton } from "~/prompt-configs/forms/prompt-config-form/components/VersionSaveButton";
import { useGetPromptConfigByIdWithLatestVersionQuery } from "~/prompt-configs/hooks/useGetPromptConfigByIdWithLatestVersionQuery";
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
function SignaturePropertiesPanelInner({ node }: { node: Node<Signature> }) {
  const trpc = api.useContext();
  const { project } = useOrganizationTeamProject();
  const { triggerSaveVersion } = usePromptConfigContext();
  const configId = node.data.configId;
  const { setNode } = useWorkflowStore((state) => ({
    setNode: state.setNode,
  }));

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
export function SignaturePropertiesPanel({ node }: { node: Node<Signature> }) {
  return (
    <PromptConfigProvider>
      <SignaturePropertiesPanelInner node={node} />
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

// TODO: Consider moving this to its own file
function PromptSourceHeader({
  node,
  onPromptSourceSelect,
  triggerSaveVersion,
  values,
}: {
  node: Node<Signature>;
  onPromptSourceSelect: (config: { id: string; name: string }) => void;
  triggerSaveVersion: (
    configId: string,
    formValues: PromptConfigFormValues
  ) => void;
  values: PromptConfigFormValues;
}) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const configId = node.data.configId;
  const { setNode } = useWorkflowStore((state) => ({
    setNode: state.setNode,
  }));

  // Fetch the saved configuration to compare with current node data
  const { data: savedConfig } =
    useGetPromptConfigByIdWithLatestVersionQuery(configId);

  const { mutateAsync: createConfig } =
    api.llmConfigs.createConfigWithInitialVersion.useMutation();

  /**
   * Determines if the current node data has changed from the saved configuration
   * Used to enable/disable the save button
   */
  const hasDrifted = useMemo(() => {
    if (!savedConfig) return false;
    const savedConfigData = llmConfigToNodeData(savedConfig);
    return !isEqual(node.data, savedConfigData);
  }, [node.data, savedConfig]);

  const handleSaveVersion = async () => {
    // If no saved config, we will need to create a new one
    if (!savedConfig) {
      try {
        const newConfig = await createConfig({
          projectId,
          name: node.data.name,
        });

        // Update the node data with the new config ID
        setNode({
          ...node,
          data: {
            ...node.data,
            configId: newConfig.id,
          },
        });

        // Trigger the save version mutation for the new config
        triggerSaveVersion(newConfig.id, values);
      } catch (error) {
        console.error(error);
        toaster.error({
          title: "Failed to save prompt version",
          description: "Please try again.",
        });
      }
    } else {
      triggerSaveVersion(configId, values);
    }
  };

  return (
    <VerticalFormControl
      label="Source Prompt"
      width="full"
      helper={
        !savedConfig && (
          <Text fontSize="sm" color="red.500">
            This node's source prompt was deleted. Please save a new prompt
            version to continue using this configuration.
          </Text>
        )
      }
    >
      <HStack justifyContent="space-between">
        <HStack flex={1} width="50%">
          <PromptSource configId={configId} onSelect={onPromptSourceSelect} />
        </HStack>
        {node.data.configId && (
          <VersionHistoryButton configId={node.data.configId} />
        )}
        <VersionSaveButton
          disabled={savedConfig && !hasDrifted}
          onClick={() => void handleSaveVersion()}
        />
      </HStack>
    </VerticalFormControl>
  );
}
