import { Box, HStack, Text } from "@langwatch/design-system/primitives";
import { SegmentedControl } from "@langwatch/design-system/segmented-control";
import type { Component, Field } from "@langwatch/workflow-contract";
import type { Node } from "@xyflow/react";
import { useUpdateNodeInternals } from "@xyflow/react";
import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { useWorkflowStore } from "../../../behavior/use-workflow-store.ts";
import {
  CODE_LANGUAGES,
  type CodeLanguage,
  codeLanguageFrom,
  codeLanguageOf,
} from "../../../model/code-language.ts";
import { codeEditorLanguage } from "../../../model/code/code-editor-language.ts";
import { switchCodeLanguage } from "../../../model/code/code-templates.ts";
import {
  applyMappingChange,
  buildAvailableSources,
  buildInputMappings,
} from "../../../model/edge-mapping.ts";
import type {
  WorkflowBasePropertiesPanelProps,
  WorkflowCodeEditorProps,
  WorkflowOutputsProps,
  WorkflowVariablesProps,
  WorkflowVariable,
  WorkflowPanelFieldMapping,
} from "./workflow-properties-panel-props.ts";

const LANGUAGE_ITEMS = CODE_LANGUAGES.map((language) => ({
  value: language,
  label: codeEditorLanguage({ language }).label,
}));

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
  const language = codeLanguageOf({ parameters: node.data.parameters });

  // Memoised so the editor contract and the field rows see stable arrays.
  const inputs: WorkflowVariable[] = useMemo(
    () =>
      (node.data.inputs ?? []).map((input) => ({
        identifier: input.identifier,
        type: input.type,
      })),
    [node.data.inputs],
  );
  const outputs: WorkflowOutputsProps["outputs"] = useMemo(
    () =>
      (node.data.outputs ?? []).map((output) => ({
        identifier: output.identifier,
        type: output.type,
      })),
    [node.data.outputs],
  );

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

  const handleLanguageChange = (to: CodeLanguage) => {
    if (to === language) return;
    setNode({
      id: node.id,
      data: {
        parameters: switchCodeLanguage({
          parameters: node.data.parameters ?? [],
          inputs,
          outputs,
          to,
        }),
      },
    });
  };

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
      <HStack width="full" justify="space-between">
        <Text textStyle="sm" color="fg.muted">
          Language
        </Text>
        <SegmentedControl
          size="xs"
          value={language}
          onValueChange={({ value }) => {
            if (value) handleLanguageChange(codeLanguageFrom({ value }));
          }}
          items={LANGUAGE_ITEMS}
          data-testid="code-language-picker"
        />
      </HStack>

      {/* Code Editor */}
      <CodeBlockEditor
        code={code}
        onChange={handleCodeChange}
        language={language}
        inputs={inputs}
        outputs={outputs}
        viewStateKey={`code-node:${node.id}`}
        langySubject={{
          nodeId: node.id,
          nodeName: node.data.name ?? node.id,
          ...(node.data.execution_state?.status === "error" && node.data.execution_state.error
            ? { lastError: node.data.execution_state.error }
            : {}),
        }}
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
