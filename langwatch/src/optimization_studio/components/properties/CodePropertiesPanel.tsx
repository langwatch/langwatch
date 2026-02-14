import { Box } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useUpdateNodeInternals } from "@xyflow/react";
import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { CodeBlockEditor } from "~/components/blocks/CodeBlockEditor";
import {
  CODE_OUTPUT_TYPES,
  type Output,
  OutputsSection,
  type OutputType,
} from "~/components/outputs/OutputsSection";
import { type Variable, VariablesSection } from "~/components/variables";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import type { Component, Field } from "../../types/dsl";
import { BasePropertiesPanel } from "./BasePropertiesPanel";

/**
 * Properties panel for Code nodes in the optimization studio.
 * Uses VariablesSection for inputs and OutputsSection for outputs.
 */
export function CodePropertiesPanel({ node }: { node: Node<Component> }) {
  const { setNode, setNodeParameter } = useWorkflowStore(
    useShallow((state) => ({
      setNode: state.setNode,
      setNodeParameter: state.setNodeParameter,
    })),
  );
  const updateNodeInternals = useUpdateNodeInternals();

  // Get code from parameters
  const codeParam = node.data.parameters?.find(
    (p) => p.identifier === "code" && p.type === "code",
  );
  const code = (codeParam?.value as string) ?? "";

  // Convert node inputs to Variable[] format
  const inputs: Variable[] = (node.data.inputs ?? []).map((input) => ({
    identifier: input.identifier,
    type: input.type,
  }));

  // Convert node outputs to Output[] format
  const outputs: Output[] = (node.data.outputs ?? []).map((output) => ({
    identifier: output.identifier,
    type: output.type as OutputType,
  }));

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

  // Handle inputs change
  const handleInputsChange = useCallback(
    (newVariables: Variable[]) => {
      const newInputs: Field[] = newVariables.map((v) => ({
        identifier: v.identifier,
        type: v.type as Field["type"],
      }));

      setNode({
        id: node.id,
        data: { inputs: newInputs },
      });
      updateNodeInternals(node.id);
    },
    [node.id, setNode, updateNodeInternals],
  );

  // Handle outputs change
  const handleOutputsChange = useCallback(
    (newOutputs: Output[]) => {
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
    <BasePropertiesPanel node={node} hideParameters hideInputs hideOutputs>
      {/* Code Editor */}
      <CodeBlockEditor
        code={code}
        onChange={handleCodeChange}
        language="python"
      />

      {/* Inputs using VariablesSection */}
      <Box width="full">
        <VariablesSection
          variables={inputs}
          onChange={handleInputsChange}
          showMappings={false}
          isMappingDisabled={true}
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
