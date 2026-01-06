import { VStack } from "@chakra-ui/react";
import { type Node, useUpdateNodeInternals } from "@xyflow/react";
import debounce from "lodash.debounce";
import { useCallback, useMemo } from "react";
import { FormProvider, useFieldArray } from "react-hook-form";
import { useShallow } from "zustand/react/shallow";

import { toaster } from "~/components/ui/toaster";
import {
  type AvailableSource,
  type FieldMapping,
  FormVariablesSection,
  type PromptTextAreaOnAddMention,
} from "~/components/variables";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useSmartSetNode } from "~/optimization_studio/hooks/useSmartSetNode";
import { type PromptConfigFormValues, usePromptConfigForm } from "~/prompts";
import { DemonstrationsField } from "~/prompts/forms/fields/DemonstrationsField";
import { PromptMessagesField } from "~/prompts/forms/fields/message-history-fields/PromptMessagesField";
import {
  promptConfigFormValuesToOptimizationStudioNodeData,
  safeOptimizationStudioNodeDataToPromptConfigFormInitialValues,
  versionedPromptToPromptConfigFormValuesWithSystemMessage,
} from "~/prompts/utils/llmPromptConfigUtils";
import { api } from "~/utils/api";
import { useWizardContext } from "../../../../../components/evaluations/wizard/hooks/useWizardContext";
import { useWorkflowStore } from "../../../../hooks/useWorkflowStore";
import type { LlmPromptConfigComponent } from "../../../../types/dsl";
import { PromptSourceHeader } from "../promptSourceSelect/PromptSourceHeader";
import { WrappedOptimizationStudioLLMConfigField } from "../WrappedOptimizationStudioLLMConfigField";
import { computeMessageEdgeUpdate } from "./messageEdgeUtils";

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
    setEdges,
  } = useWorkflowStore(
    useShallow((state) => ({
      templateAdapter: state.getWorkflow().template_adapter,
      nodes: state.getWorkflow().nodes,
      edges: state.getWorkflow().edges,
      edgeConnectToNewHandle: state.edgeConnectToNewHandle,
      setNode: state.setNode,
      getWorkflow: state.getWorkflow,
      setNodeParameter: state.setNodeParameter,
      setEdges: state.setEdges,
    })),
  );

  const { isInsideWizard } = useWizardContext();

  // Initialize form with values from node data
  const initialConfigValues = useMemo(
    () =>
      safeOptimizationStudioNodeDataToPromptConfigFormInitialValues(node.data),
    [node.data],
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
    [node.id, setNode, node.data.name],
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
      // Use WithSystemMessage to ensure the system prompt is added to the messages array,
      // since PromptMessagesField expects system prompt to be in messages[0] with role: "system"
      formProps.methods.reset(
        versionedPromptToPromptConfigFormValuesWithSystemMessage(config),
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
    return node.data.inputs.map((input) => ({
      identifier: input.identifier,
      type: input.type,
    }));
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
          .map((edge) => edge.target),
      );
    }

    return Object.fromEntries(
      nodes
        .filter(
          (node) => !dependentNodes.includes(node.id) && node.id !== "end",
        )
        .map((node) => [
          node.id,
          node.data.outputs
            ?.map((output) => output.identifier)
            .filter(
              (id) => !currentConnections.includes(`${node.id}.outputs.${id}`),
            ) ?? [],
        ]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges, nodes, node.id, JSON.stringify(node.data.outputs)]);

  const updateNodeInternals = useUpdateNodeInternals();

  // Build availableSources for variable mappings
  const availableSources: AvailableSource[] = useMemo(() => {
    const dependentNodes: string[] = [];
    const toVisit = [node.id];
    while (toVisit.length > 0) {
      const currentNode = toVisit.shift();
      if (!currentNode) continue;
      dependentNodes.push(currentNode);
      toVisit.push(
        ...edges
          .filter((edge) => edge.source === currentNode)
          .map((edge) => edge.target),
      );
    }

    return nodes
      .filter((n) => !dependentNodes.includes(n.id) && n.id !== "end")
      .map((n) => {
        const isEntry = n.type === "entry";
        // For entry nodes, get dataset name from data.dataset
        const entryDataset = isEntry
          ? (n.data as { dataset?: { name?: string } }).dataset
          : undefined;
        return {
          id: n.id,
          name: isEntry
            ? (entryDataset?.name ?? "Dataset")
            : (n.data.name ?? n.id),
          type: isEntry ? "dataset" : (n.type as AvailableSource["type"]),
          fields:
            n.data.outputs?.map((output) => ({
              name: output.identifier,
              type: output.type,
            })) ?? [],
        };
      })
      .filter((source) => source.fields.length > 0);
  }, [edges, nodes, node.id]);

  // Build mappings from edges
  const variableMappings: Record<string, FieldMapping> = useMemo(() => {
    const mappings: Record<string, FieldMapping> = {};
    edges
      .filter((edge) => edge.target === node.id)
      .forEach((edge) => {
        // Parse targetHandle (e.g., "inputs.question") to get the input identifier
        const targetHandle = edge.targetHandle?.split(".")[1];
        // Parse sourceHandle (e.g., "outputs.answer") to get the source field
        const sourceField = edge.sourceHandle?.split(".")[1];
        if (targetHandle && sourceField && edge.source) {
          mappings[targetHandle] = {
            type: "source",
            sourceId: edge.source,
            field: sourceField,
          };
        }
      });
    return mappings;
  }, [edges, node.id]);

  // Handle mapping changes by creating/removing edges
  const onMappingChange = useCallback(
    (identifier: string, mapping: FieldMapping | undefined) => {
      const currentEdges = getWorkflow().edges;

      // Remove existing edge for this input
      const filteredEdges = currentEdges.filter(
        (edge) =>
          !(
            edge.target === node.id &&
            edge.targetHandle === `inputs.${identifier}`
          ),
      );

      if (mapping && mapping.type === "source") {
        // Add new edge
        const newEdge = {
          id: `edge-${identifier}-${Date.now()}`,
          source: mapping.sourceId,
          target: node.id,
          sourceHandle: `outputs.${mapping.field}`,
          targetHandle: `inputs.${identifier}`,
          type: "default",
        };
        setEdges([...filteredEdges, newEdge]);
      } else {
        setEdges(filteredEdges);
      }

      updateNodeInternals(node.id);
    },
    [getWorkflow, node.id, setEdges, updateNodeInternals],
  );

  const onAddEdge = (
    id: string,
    handle: string,
    content: PromptTextAreaOnAddMention,
  ) => {
    const newHandle = edgeConnectToNewHandle(id, handle, node.id);
    updateNodeInternals(node.id);

    const templateRef = `{{${newHandle}}}`;
    const content_ =
      content.value.substring(0, content.startPos) +
      templateRef +
      content.value.substring(content.endPos);

    const stateNode = getWorkflow().nodes.find((n) => n.id === node.id)!;
    return { node: stateNode, newPrompt: content_, newHandle };
  };

  const onAddPromptEdge = (
    id: string,
    handle: string,
    content: PromptTextAreaOnAddMention,
  ) => {
    const { node, newPrompt, newHandle } = onAddEdge(id, handle, content);

    setNodeParameter(node.id, {
      identifier: "instructions",
      type: "str",
      value: newPrompt,
    });

    return newHandle;
  };

  const onAddMessageEdge = (
    id: string,
    handle: string,
    content: PromptTextAreaOnAddMention,
    idx: number,
  ): string | undefined => {
    const {
      node: stateNode,
      newPrompt,
      newHandle,
    } = onAddEdge(id, handle, content);

    // Get form messages to correctly map form index to node parameter
    const formMessages = messageFields.fields.map((f) => ({
      role: f.role,
      content: f.content,
    }));

    const update = computeMessageEdgeUpdate({
      formMessages,
      nodeParameters: (stateNode.data.parameters ?? []) as Array<{
        identifier: string;
        type: string;
        value: Array<{ role: string; content: string }> | string;
      }>,
      formIndex: idx,
      newContent: newPrompt,
    });

    if (update.parameterToUpdate === "instructions") {
      setNodeParameter(stateNode.id, {
        identifier: "instructions",
        type: "str",
        value: update.newValue as string,
      });
    } else {
      setNodeParameter(stateNode.id, {
        identifier: "messages",
        type: "chat_messages",
        value: update.newValue as Array<{ role: string; content: string }>,
      });
    }

    return newHandle;
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
          {templateAdapter === "default" && (
            <PromptMessagesField
              messageFields={messageFields}
              availableFields={availableFields}
              otherNodesFields={otherNodesFields}
              availableSources={availableSources}
              onAddEdge={onAddMessageEdge}
            />
          )}
          <FormVariablesSection
            showMappings={true}
            title="Variables"
            availableSources={availableSources}
            mappings={variableMappings}
            onMappingChange={onMappingChange}
          />
          {!isInsideWizard && <DemonstrationsField />}
        </VStack>
      </form>
    </FormProvider>
  );
}
