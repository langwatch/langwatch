import { VStack } from "@chakra-ui/react";
import { useUpdateNodeInternals, type Node } from "@xyflow/react";
import { useMemo } from "react";
import { FormProvider, useFieldArray } from "react-hook-form";
import { useShallow } from "zustand/react/shallow";

import { useWizardContext } from "../../../../../components/evaluations/wizard/hooks/useWizardContext";
import { PromptMessagesField } from "../../../../../prompt-configs/forms/fields/PromptMessagesField";
import { useWorkflowStore } from "../../../../hooks/useWorkflowStore";
import type { LlmPromptConfigComponent } from "../../../../types/dsl";
import { PromptSourceHeader } from "../promptSourceSelect/PromptSourceHeader";
import { WrappedOptimizationStudioLLMConfigField } from "../WrappedOptimizationStudioLLMConfigField";

import { isEqual } from "./utils/is-equal";

import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useSmartSetNode } from "~/optimization_studio/hooks/useSmartSetNode";
import type { PromptTextAreaOnAddMention } from "~/prompt-configs/components/ui/PromptTextArea";
import { DemonstrationsField } from "~/prompt-configs/forms/fields/DemonstrationsField";
import {
  InputsFieldGroup,
  OutputsFieldGroup,
} from "~/prompt-configs/forms/fields/PromptConfigVersionFieldGroup";
import { PromptField } from "~/prompt-configs/forms/fields/PromptField";
import {
  usePromptConfigForm,
  type PromptConfigFormValues,
} from "~/prompt-configs";
import {
  llmConfigToOptimizationStudioNodeData,
  safeOptimizationStudioNodeDataToPromptConfigFormInitialValues,
} from "~/prompt-configs/llmPromptConfigUtils";
import { api } from "~/utils/api";
import { PromptDriftWarning } from "./PromptDriftWarning";

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
export function SignaturePropertiesPanelForm({
  node,
  onFormValuesChange,
}: {
  node: Node<LlmPromptConfigComponent>;
  onFormValuesChange?: (formValues: PromptConfigFormValues) => void;
}) {
  const trpc = api.useContext();
  const { project } = useOrganizationTeamProject();
  const configId = node.data.configId;
  const setNode = useSmartSetNode();

  const {
    templateAdapter,
    nodes,
    edges,
    edgeConnectToNewHandle,
    getWorkflow,
    setNodeParameter,
  } = useWorkflowStore(
    useShallow((state) => ({
      templateAdapter: state.getWorkflow().template_adapter,
      nodes: state.getWorkflow().nodes,
      edges: state.getWorkflow().edges,
      edgeConnectToNewHandle: state.edgeConnectToNewHandle,
      setNode: state.setNode,
      getWorkflow: state.getWorkflow,
      setNodeParameter: state.setNodeParameter,
    }))
  );

  const { isInsideWizard } = useWizardContext();

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
        onFormValuesChange?.(formValues);
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

  // TODO: Refactor so that all of the node call back methods are in the parent,
  // not here in the form logic
  const availableFields = useMemo(() => {
    return node.data.inputs.map((input) => input.identifier);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(node.data.inputs)]);

  // Find all nodes that depends on this node based on the edges
  const otherNodesFields = useMemo(() => {
    const currentConnections = edges
      .filter((edge) => edge.target === node.id)
      .map((edge) => edge.source + "." + edge.sourceHandle);

    const dependentNodes: string[] = [];
    const toVisit = [node.id];
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges, nodes, node.id, JSON.stringify(node.data.outputs)]);

  const updateNodeInternals = useUpdateNodeInternals();

  const onAddEdge = (
    id: string,
    handle: string,
    content: PromptTextAreaOnAddMention
  ) => {
    const newHandle = edgeConnectToNewHandle(id, handle, node.id);
    updateNodeInternals(node.id);

    const templateRef = `{{${newHandle}}}`;
    const content_ =
      content.value.substring(0, content.startPos) +
      templateRef +
      content.value.substring(content.endPos);

    const stateNode = getWorkflow().nodes.find((n) => n.id === node.id)!;
    return { node: stateNode, newPrompt: content_ };
  };

  const onAddPromptEdge = (
    id: string,
    handle: string,
    content: PromptTextAreaOnAddMention
  ) => {
    const { node, newPrompt } = onAddEdge(id, handle, content);

    setNodeParameter(node.id, {
      identifier: "instructions",
      type: "str",
      value: newPrompt,
    });
  };

  const onAddMessageEdge = (
    id: string,
    handle: string,
    content: PromptTextAreaOnAddMention,
    idx: number
  ) => {
    const { node, newPrompt } = onAddEdge(id, handle, content);
    const messagesParam = node.data.parameters?.find(
      (param) => param.identifier === "messages"
    );
    if (!messagesParam) return;

    setNodeParameter(node.id, {
      identifier: "messages",
      type: "chat_messages",
      value: (messagesParam.value as any[]).map((field, i) =>
        i === idx ? { ...field, content: newPrompt } : field
      ),
    });
  };

  return (
    <FormProvider {...formProps.methods}>
      <form style={{ width: "100%" }}>
        <VStack width="full" gap={4}>
          <PromptSourceHeader
            node={node}
            onPromptSourceSelect={(config) =>
              void handlePromptSourceSelect(config)
            }
          />
          <WrappedOptimizationStudioLLMConfigField />
          <PromptField
            messageFields={messageFields}
            templateAdapter={templateAdapter}
            availableFields={availableFields}
            otherNodesFields={otherNodesFields}
            onAddEdge={onAddPromptEdge}
            isTemplateSupported={templateAdapter === "default"}
          />
          {templateAdapter === "default" && (
            <PromptMessagesField
              messageFields={messageFields}
              availableFields={availableFields}
              otherNodesFields={otherNodesFields}
              onAddEdge={onAddMessageEdge}
            />
          )}
          <InputsFieldGroup />
          <OutputsFieldGroup />
          {!isInsideWizard && <DemonstrationsField />}
        </VStack>
      </form>
    </FormProvider>
  );
}
