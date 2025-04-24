import { Separator, HStack } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useCallback, useMemo } from "react";
import { FormProvider } from "react-hook-form";

import { useWorkflowStore } from "../../../hooks/useWorkflowStore";
import type { Signature } from "../../../types/dsl";
import { BasePropertiesPanel } from "../BasePropertiesPanel";

import { PromptSource } from "./prompt-source-select/PromptSource";

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
  const handlePromptSourceSelect = (config: { id: string; name: string }) => {
    setNode({
      ...node,
      data: {
        ...node.data,
        name: config.name,
        configId,
      },
    });
  };

  // TODO: Consider refactoring the BasePropertiesPanel so that we don't need to hide everything like this
  return (
    <BasePropertiesPanel node={node} hideParameters hideInputs hideOutputs>
      <Separator />
      <PromptSourceHeader
        node={node}
        onPromptSourceSelect={handlePromptSourceSelect}
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
    <PromptConfigProvider configId={node.data.configId}>
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
  triggerSaveVersion: (formValues: PromptConfigFormValues) => void;
  values: PromptConfigFormValues;
}) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const configId = node.data.configId;

  // Fetch the saved configuration to compare with current node data
  const { data: savedConfig } =
    api.llmConfigs.getByIdWithLatestVersion.useQuery(
      {
        id: configId,
        projectId,
      },
      { enabled: !!configId && !!projectId }
    );

  /**
   * Determines if the current node data has changed from the saved configuration
   * Used to enable/disable the save button
   */
  const hasDrifted = useMemo(() => {
    if (!savedConfig) return false;
    const savedConfigData = llmConfigToNodeData(savedConfig);
    return !isEqual(node.data, savedConfigData);
  }, [node.data, savedConfig]);

  return (
    <VerticalFormControl label="Prompt Source" width="full">
      <HStack justifyContent="space-between">
        <HStack flex={1} width="50%">
          <PromptSource configId={configId} onSelect={onPromptSourceSelect} />
        </HStack>
        {node.data.configId && (
          <VersionHistoryButton configId={node.data.configId} />
        )}
        <VersionSaveButton
          disabled={!hasDrifted}
          onClick={() => void triggerSaveVersion(values)}
        />
      </HStack>
    </VerticalFormControl>
  );
}
