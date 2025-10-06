import { VStack } from "@chakra-ui/react";
import { useUpdateNodeInternals, type Node } from "@xyflow/react";
import debounce from "lodash/debounce";
import { useMemo } from "react";
import { FormProvider, useFieldArray } from "react-hook-form";
import { useShallow } from "zustand/react/shallow";

import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useSmartSetNode } from "~/optimization_studio/hooks/useSmartSetNode";
import {
  usePromptConfigForm,
  type PromptConfigFormValues,
} from "~/prompt-configs";
import type { PromptTextAreaOnAddMention } from "~/prompt-configs/components/ui/PromptTextArea";
import { DemonstrationsField } from "~/prompt-configs/forms/fields/DemonstrationsField";
import {
  InputsFieldGroup,
  OutputsFieldGroup,
} from "~/prompt-configs/forms/fields/PromptConfigVersionFieldGroup";
import { PromptField } from "~/prompt-configs/forms/fields/PromptField";
import {
  promptConfigFormValuesToOptimizationStudioNodeData,
  versionedPromptToPromptConfigFormValues,
  safeOptimizationStudioNodeDataToPromptConfigFormInitialValues,
} from "~/prompt-configs/utils/llmPromptConfigUtils";
import { api } from "~/utils/api";

import { useWizardContext } from "../../../../../components/evaluations/wizard/hooks/useWizardContext";
import { PromptMessagesField } from "../../../../../prompt-configs/forms/fields/PromptMessagesField";
import { useWorkflowStore } from "../../../../hooks/useWorkflowStore";
import type { LlmPromptConfigComponent } from "../../../../types/dsl";
import { PromptSourceHeader } from "../promptSourceSelect/PromptSourceHeader";
import { WrappedOptimizationStudioLLMConfigField } from "../WrappedOptimizationStudioLLMConfigField";

/**
 * Properties panel for the Signature node in the optimization studio.
 *
 * A Signature node represents an LLM calling component in the workflow
 * that can be connected with other nodes to build complex LLM-powered applications.
 */
export function SignaturePropertiesPanelForm({
  node,
}: {
  node: Node<LlmPromptConfigComponent>;
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

  /**
   * Converts form values to node data and updates the workflow store.
   * This ensures the node's data stays in sync with the form state.
   *
   * We use useMemo to create the debounced function to prevent unnecessary re-renders.
   *
   * @param formValues - The current form values to sync with node data
   */
  const syncNodeDataWithFormValues = useMemo(
    () =>
      debounce((formValues: PromptConfigFormValues) => {
        const updatedNodeData =
          promptConfigFormValuesToOptimizationStudioNodeData(formValues);

        setNode({
          id: node.id,
          data: {
            handle: formValues.handle,
            name: formValues.handle ?? node.data.name ?? "",
            ...updatedNodeData,
          },
        });
      }, 1000), // Lower than this slows down the UI significantly, since this will trigger a workspace/experiment save
    [node.id, setNode, node.data.name]
  );

  const formProps = usePromptConfigForm({
    configId,
    initialConfigValues,
    onChange: (formValues) => {
      syncNodeDataWithFormValues(formValues);
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
      const config = await trpc.prompts.getByIdOrHandle.fetch({
        idOrHandle: selectedConfig.id,
        projectId: project?.id ?? "",
      });

      if (!config) {
        throw new Error("Prompt not found");
      }

      // Reset the form with the updated node data
      formProps.methods.reset(versionedPromptToPromptConfigFormValues(config));
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
