import { Spinner, VStack } from "@chakra-ui/react";
import { useUpdateNodeInternals, type Node } from "@xyflow/react";
import debounce from "lodash.debounce";
import { useEffect, useMemo, useRef } from "react";
import { FormProvider, useFieldArray } from "react-hook-form";

import type { LatestConfigVersionSchema } from "~/server/prompt-config/repositories/llm-config-version-schema";

import { useWorkflowStore } from "../../../hooks/useWorkflowStore";
import type {
  LLMConfig,
  LlmPromptConfigComponent,
  Signature,
} from "../../../types/dsl";
import { BasePropertiesPanel } from "../BasePropertiesPanel";

import { PromptSourceHeader } from "./promptSourceSelect/PromptSourceHeader";
import { WrappedOptimizationStudioLLMConfigField } from "./WrappedOptimizationStudioLLMConfigField";

import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useSmartSetNode } from "~/optimization_studio/hooks/useSmartSetNode";
import { DemonstrationsField } from "~/prompt-configs/forms/fields/DemonstrationsField";
import {
  InputsFieldGroup,
  OutputsFieldGroup,
} from "~/prompt-configs/forms/fields/PromptConfigVersionFieldGroup";
import { PromptField } from "~/prompt-configs/forms/fields/PromptField";
import { usePromptConfig } from "~/prompt-configs/hooks/usePromptConfig";
import {
  usePromptConfigForm,
  type PromptConfigFormValues,
} from "~/prompt-configs/hooks/usePromptConfigForm";
import {
  createNewOptimizationStudioPromptName,
  llmConfigToOptimizationStudioNodeData,
  safeOptimizationStudioNodeDataToPromptConfigFormInitialValues,
  promptConfigFormValuesToOptimizationStudioNodeData,
} from "~/prompt-configs/llmPromptConfigUtils";
import { PromptConfigProvider } from "~/prompt-configs/providers/PromptConfigProvider";
import { usePromptConfigContext } from "~/prompt-configs/providers/PromptConfigProvider";
import { api } from "~/utils/api";
import { PromptMessagesField } from "../../../../prompt-configs/forms/fields/PromptMessagesField";
import { useShallow } from "zustand/react/shallow";

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

  const { templateAdapter, nodes, edges, edgeConnectToNewHandle } =
    useWorkflowStore(
      useShallow((state) => ({
        templateAdapter: state.getWorkflow().template_adapter,
        nodes: state.getWorkflow().nodes,
        edges: state.getWorkflow().edges,
        edgeConnectToNewHandle: state.edgeConnectToNewHandle,
      }))
    );

  /**
   * Converts form values to node data and updates the workflow store.
   * This ensures the node's data stays in sync with the form state.
   *
   * @param formValues - The current form values to sync with node data
   */
  const syncNodeDataWithFormValues = useMemo(
    () =>
      debounce((formValues: PromptConfigFormValues) => {
        const newNodeData = promptConfigFormValuesToOptimizationStudioNodeData(
          configId,
          formValues
        );
        setNode({
          id: node.id,
          data: newNodeData,
        });
      }, 200),
    [configId, node.id, setNode]
  );

  // Initialize form with values from node data
  const initialConfigValues = useMemo(
    () =>
      safeOptimizationStudioNodeDataToPromptConfigFormInitialValues(node.data),
    [node.data]
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

      const newNodeData = llmConfigToOptimizationStudioNodeData(config);

      // Update the node data with the new config
      setNode({
        ...node,
        data: newNodeData,
      });

      // Reset the form with the updated node data
      formProps.methods.reset(
        safeOptimizationStudioNodeDataToPromptConfigFormInitialValues(
          newNodeData
        )
      );
    } catch (error) {
      console.error(error);
      toaster.error({
        title: "Failed to update prompt source",
        description: "Please try again.",
      });
    }
  };

  const handleTriggerSaveVersion = (
    configId: string,
    saveFormValues: PromptConfigFormValues
  ) => {
    void (async () => {
      // Check form value validity
      const isValid = await formProps.methods.trigger();
      if (!isValid) return;

      triggerSaveVersion(configId, saveFormValues);
    })();
  };

  /**
   * It is a known limitation of react-hook-form useFieldArray that we cannot
   * access the fields array from the form provider using the context.
   *
   * So we need to create this in the parent and prop drill it down.
   */
  const messageFields = useFieldArray({
    control: formProps.methods.control,
    name: "version.configData.messages",
  });

  const availableFields = useMemo(() => {
    return node.data.inputs.map((input) => input.identifier);
  }, [node.data.inputs]);

  // Find all nodes that depends on this node based on the edges
  const otherNodesFields = useMemo(() => {
    const currentConnections = edges
      .filter((edge) => edge.target === node.id)
      .map((edge) => edge.source + "." + edge.sourceHandle);

    let dependentNodes = [];
    let toVisit = [node.id];
    while (toVisit.length > 0) {
      const currentNode = toVisit.shift();
      if (!currentNode) continue;
      dependentNodes.push(currentNode);
      toVisit.push(
        ...edges
          .filter((edge) => edge.source === currentNode)
          .map((edge) => edge.target)
      );
    }

    return Object.fromEntries(
      nodes
        .filter(
          (node) => !dependentNodes.includes(node.id) && node.id !== "end"
        )
        .map((node) => [
          node.id,
          node.data.outputs
            ?.map((output) => output.identifier)
            .filter(
              (id) => !currentConnections.includes(`${node.id}.outputs.${id}`)
            ) ?? [],
        ])
    );
  }, [edges, nodes, node.id]);

  const updateNodeInternals = useUpdateNodeInternals();

  const onAddEdge = (id: string, handle: string) => {
    const newHandle = edgeConnectToNewHandle(id, handle, node.id);
    updateNodeInternals(node.id);
    return newHandle;
  };

  // TODO: Consider refactoring the BasePropertiesPanel so that we don't need to hide everything like this
  return (
    <BasePropertiesPanel
      node={node}
      hideParameters
      hideInputs
      hideOutputs
      hideDescription
    >
      <VStack width="full" gap={4}>
        {/* Prompt Configuration Form */}
        <FormProvider {...formProps.methods}>
          <form style={{ width: "100%" }}>
            <VStack width="full" gap={4}>
              <PromptSourceHeader
                node={node}
                onPromptSourceSelect={(config) =>
                  void handlePromptSourceSelect(config)
                }
                triggerSaveVersion={handleTriggerSaveVersion}
                values={formProps.methods.getValues()}
              />
              <WrappedOptimizationStudioLLMConfigField />
              <PromptField
                messageFields={messageFields}
                templateAdapter={templateAdapter}
                availableFields={availableFields}
                otherNodesFields={otherNodesFields}
                onAddEdge={onAddEdge}
                isTemplateSupported={templateAdapter === "default"}
              />
              {templateAdapter === "default" && (
                <PromptMessagesField
                  messageFields={messageFields}
                  availableFields={availableFields}
                  otherNodesFields={otherNodesFields}
                  onAddEdge={onAddEdge}
                />
              )}
              <InputsFieldGroup />
              <OutputsFieldGroup />
              <DemonstrationsField />
            </VStack>
          </form>
        </FormProvider>
      </VStack>
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
  node: Node<Signature | LlmPromptConfigComponent>;
}) {
  const { project } = useOrganizationTeamProject();
  const createMutation =
    api.llmConfigs.createConfigWithInitialVersion.useMutation();
  const setNode = useSmartSetNode();
  const {
    name: workflowName,
    nodes,
    defaultLLMConfig,
  } = useWorkflowStore((state) => ({
    name: state.getWorkflow().name,
    nodes: state.getWorkflow().nodes,
    defaultLLMConfig: state.getWorkflow().default_llm,
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
              createNewOptimizationStudioPromptName(workflowName, nodes),
            projectId: project?.id ?? "",
          });

          // Convert the node data to form initial values
          const initialValues =
            safeOptimizationStudioNodeDataToPromptConfigFormInitialValues({
              ...node.data,
              parameters: setDefaultLlmConfigToParameters(
                (node.data.parameters ??
                  []) as LlmPromptConfigComponent["parameters"],
                defaultLLMConfig
              ),
            });

          // Use the initial values to create a new version
          const currentConfigData = newConfig.latestVersion.configData; // Use the defaults
          const nodeConfigData = initialValues.version?.configData; // Use the node's config data
          const { llm, ...rest } =
            nodeConfigData ??
            ({} as PromptConfigFormValues["version"]["configData"]);
          const newVersion = await createNewVersion(
            newConfig.id,
            {
              prompt: rest?.prompt ?? "",
              inputs: rest?.inputs ?? currentConfigData.inputs,
              outputs: rest?.outputs ?? currentConfigData.outputs,
              messages: rest?.messages ?? currentConfigData.messages,
              model: llm?.model ?? currentConfigData.model,
              temperature: llm?.temperature ?? currentConfigData.temperature,
              max_tokens: llm?.max_tokens ?? currentConfigData.max_tokens,
              demonstrations:
                rest?.demonstrations ?? currentConfigData.demonstrations,
            } as LatestConfigVersionSchema["configData"],
            "Save from legacy node"
          );

          // Convert the new config and version to node data
          const newNodeData = llmConfigToOptimizationStudioNodeData({
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
    defaultLLMConfig,
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

function setDefaultLlmConfigToParameters(
  parameters: LlmPromptConfigComponent["parameters"],
  defaultLLMConfig: LLMConfig
) {
  return parameters.map((item) => {
    if (item.identifier === "llm") {
      const value =
        typeof item.value === "object" ? item.value : defaultLLMConfig;

      return {
        ...item,
        value,
      };
    }

    return item;
  }) as LlmPromptConfigComponent["parameters"];
}
