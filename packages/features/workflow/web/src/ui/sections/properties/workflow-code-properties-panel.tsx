import { Box } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useUpdateNodeInternals } from "@xyflow/react";
import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkflowStore } from "../../../behavior/use-workflow-store";
import type { Component, Field } from "@langwatch/workflow-contract";
import {
  applyMappingChange,
  buildAvailableSources,
  buildInputMappings,
} from "../../../model/edge-mapping";
import type {
  WorkflowBasePropertiesPanelProps,
  WorkflowCodeEditorProps,
  WorkflowOutputsProps,
  WorkflowVariablesProps,
  WorkflowVariable,
  WorkflowPanelFieldMapping,
} from "./workflow-properties.ports";

const CODE_OUTPUT_TYPES: Field["type"][] = ["str", "float", "bool", "dict", "list", "image"];

/**
 * Properties panel for Code nodes in the optimization studio.
 * Uses VariablesSection for inputs and OutputsSection for outputs.
 */
export function CodePropertiesPanel({
  node,
  renderBase: BasePropertiesPanel,
  renderCodeEditor: CodeBlockEditor,
  renderVariables: VariablesSection,
  renderOutputs: OutputsSection,
}: {
  node: Node<Component>;
  renderBase: (props: WorkflowBasePropertiesPanelProps) => React.ReactNode;
  renderCodeEditor: (props: WorkflowCodeEditorProps) => React.ReactNode;
  renderVariables: (props: WorkflowVariablesProps) => React.ReactNode;
  renderOutputs: (props: WorkflowOutputsProps) => React.ReactNode;
}) {
  const { nodes, edges, setNode, setNodeParameter, setEdges, getWorkflow } = useWorkflowStore(
    useShallow((state) => ({
      nodes: state.getWorkflow().nodes,
      edges: state.getWorkflow().edges,
      setNode: state.setNode,
      setNodeParameter: state.setNodeParameter,
      setEdges: state.setEdges,
      getWorkflow: state.getWorkflow,
    })),
  );
  const updateNodeInternals = useUpdateNodeInternals();

  // Get code from parameters
  const codeParam = node.data.parameters?.find((p) => p.identifier === "code" && p.type === "code");
  const code = (codeParam?.value as string) ?? "";

  // Convert node inputs to Variable[] format
  const inputs: WorkflowVariable[] = (node.data.inputs ?? []).map((input) => ({
    identifier: input.identifier,
    type: input.type,
  }));

  // Convert node outputs to Output[] format
  const outputs: WorkflowOutputsProps["outputs"] = (node.data.outputs ?? []).map((output) => ({
    identifier: output.identifier,
    type: output.type,
  }));

  // Build mapping data from workflow graph
  const availableSources = useMemo(
    () => buildAvailableSources({ nodeId: node.id, nodes, edges }),
    [edges, nodes, node.id],
  );

  const inputMappings = useMemo(
    () =>
      buildInputMappings({
        nodeId: node.id,
        edges,
        inputs: node.data.inputs ?? [],
      }),
    [edges, node.id, node.data.inputs],
  );

  const handleMappingChange = useCallback(
    (identifier: string, mapping: WorkflowPanelFieldMapping | undefined) => {
      const workflow = getWorkflow();
      const currentInputs = workflow.nodes.find((n) => n.id === node.id)?.data.inputs ?? [];
      const result = applyMappingChange({
        nodeId: node.id,
        identifier,
        mapping,
        currentEdges: workflow.edges,
        currentInputs,
      });
      setEdges(result.edges);
      setNode({ id: node.id, data: { inputs: result.inputs } });
      updateNodeInternals(node.id);
    },
    [getWorkflow, node.id, setEdges, setNode, updateNodeInternals],
  );

  // Handle code change
  const handleCodeChange = useCallback(
    (newCode: string) => {
      setNodeParameter(node.id, {
        identifier: "code",
        type: "code",
        value: newCode,
      });
    },
    [node.id, setNodeParameter],
  );

  // Handle inputs change (preserves field.value for existing inputs)
  const handleInputsChange = useCallback(
    (newVariables: WorkflowVariable[]) => {
      const existingInputs = node.data.inputs ?? [];
      const newInputs: Field[] = newVariables.map((v) => {
        // Preserve field.value from existing input with same identifier
        const existing = existingInputs.find((i) => i.identifier === v.identifier);
        return {
          identifier: v.identifier,
          type: v.type as Field["type"],
          ...(existing?.value != null ? { value: existing.value } : {}),
        };
      });

      setNode({
        id: node.id,
        data: { inputs: newInputs },
      });
      updateNodeInternals(node.id);
    },
    [node.id, node.data.inputs, setNode, updateNodeInternals],
  );

  // Handle outputs change
  const handleOutputsChange = useCallback(
    (newOutputs: WorkflowOutputsProps["outputs"]) => {
      const outputs: Field[] = newOutputs.map((o) => ({
        identifier: o.identifier,
        type: o.type as Field["type"],
      }));

      setNode({
        id: node.id,
        data: { outputs },
      });
      updateNodeInternals(node.id);
    },
    [node.id, setNode, updateNodeInternals],
  );

  return (
    <BasePropertiesPanel node={node} hideParameters hideInputs hideOutputs paddingX={4}>
      {/* Code Editor */}
      <CodeBlockEditor
        code={code}
        onChange={handleCodeChange}
        language="python"
        inputs={inputs.map((i) => ({ identifier: i.identifier, type: i.type }))}
        outputs={outputs.map((o) => ({
          identifier: o.identifier,
          type: o.type,
        }))}
        viewStateKey={`code-node:${node.id}`}
      />

      {/* Inputs using VariablesSection */}
      <Box width="full">
        <VariablesSection
          variables={inputs}
          onChange={handleInputsChange}
          showMappings={true}
          mappings={inputMappings}
          onMappingChange={handleMappingChange}
          availableSources={availableSources}
          canAddRemove={true}
          readOnly={false}
          title="Inputs"
        />
      </Box>

      {/* Outputs using OutputsSection */}
      <Box width="full">
        <OutputsSection
          outputs={outputs}
          onChange={handleOutputsChange}
          canAddRemove={true}
          readOnly={false}
          title="Outputs"
          availableTypes={CODE_OUTPUT_TYPES}
        />
      </Box>
    </BasePropertiesPanel>
  );
}
