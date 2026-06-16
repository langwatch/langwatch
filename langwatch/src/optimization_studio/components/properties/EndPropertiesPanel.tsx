import { Alert, Box, Text } from "@chakra-ui/react";
import { type Node, useUpdateNodeInternals } from "@xyflow/react";
import { useCallback, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { type Variable, VariablesSection } from "~/components/variables";
import { useWorkflowStore } from "~/optimization_studio/hooks/useWorkflowStore";
import type { End, Field } from "../../types/dsl";
import { BasePropertiesPanel } from "./BasePropertiesPanel";

/**
 * The full vocabulary an evaluator can return. When the workflow
 * behaves as an evaluator, the End node's results are exactly these
 * four - fixed identifiers and types, no add/remove/rename. Unused
 * fields simply stay unconnected.
 */
export const EVALUATOR_RESULT_FIELDS: Field[] = [
  { identifier: "passed", type: "bool", optional: true },
  { identifier: "score", type: "float", optional: true },
  { identifier: "details", type: "str", optional: true },
  { identifier: "label", type: "str", optional: true },
];

export function EndPropertiesPanel({ node: initialNode }: { node: Node<End> }) {
  const { node, edges, setNode, workflowType } = useWorkflowStore(
    useShallow((state) => ({
      node: state.nodes.find((n) => n.id === initialNode.id) as Node<End>,
      edges: state.edges,
      setNode: state.setNode,
      workflowType: state.workflow_type,
    })),
  );
  const updateNodeInternals = useUpdateNodeInternals();

  // Treat the end node as an evaluator from EITHER signal: the node's own
  // behave_as flag OR the workflow being an evaluator. Older evaluator
  // workflows (and any where the two drifted) carry workflow_type without
  // the node flag, and those were the ones still showing free-form fields
  // where users hand-created "score"/"passed" - the exact confusion this
  // contract removes.
  const isEvaluator =
    node.data.behave_as === "evaluator" || workflowType === "evaluator";

  // Pin the evaluator end node to the fixed result vocabulary. Existing
  // connections survive (identifiers passed/score keep their handles);
  // free-form fields users created by hand are replaced by the
  // contract, which is the point - the four options should be obvious,
  // not discovered by renaming "output" to "score" on a call. Also stamp
  // behave_as so the node carries the flag forward once normalized.
  useEffect(() => {
    if (!isEvaluator) return;
    const current = node.data.inputs ?? [];
    const matchesContract =
      node.data.behave_as === "evaluator" &&
      current.length === EVALUATOR_RESULT_FIELDS.length &&
      EVALUATOR_RESULT_FIELDS.every((f, i) => {
        const c = current[i];
        return c && c.identifier === f.identifier && c.type === f.type;
      });
    if (!matchesContract) {
      setNode({
        id: node.id,
        data: {
          ...node.data,
          behave_as: "evaluator",
          inputs: EVALUATOR_RESULT_FIELDS,
        },
      });
    }
  }, [isEvaluator, node.id, node.data, setNode]);

  const hasResultConnected = edges.some(
    (edge) =>
      edge.target === node.id &&
      (edge.targetHandle === "inputs.score" ||
        edge.targetHandle === "inputs.passed"),
  );

  // The End node's "results" are its inputs (data flows in). Render them
  // through the shared VariablesSection so the rows match every other node
  // panel (type selector on the left, name, remove). Connections come from
  // the canvas edges, so the per-row value/mapping column is hidden.
  const variables: Variable[] = (node.data.inputs ?? []).map((f) => ({
    identifier: f.identifier,
    type: f.type as Variable["type"],
  }));

  const handleResultsChange = useCallback(
    (newVariables: Variable[]) => {
      const existing = node.data.inputs ?? [];
      const newInputs: Field[] = newVariables.map((variable) => {
        const prev = existing.find((i) => i.identifier === variable.identifier);
        return {
          identifier: variable.identifier,
          type: variable.type as Field["type"],
          ...(prev?.optional != null ? { optional: prev.optional } : {}),
          ...(prev?.value != null ? { value: prev.value } : {}),
        };
      });
      setNode({ id: node.id, data: { inputs: newInputs } });
      updateNodeInternals(node.id);
    },
    [node.id, node.data.inputs, setNode, updateNodeInternals],
  );

  return (
    <BasePropertiesPanel node={node} hideInputs hideOutputs hideParameters>
      <Box width="full">
        <VariablesSection
          variables={variables}
          onChange={handleResultsChange}
          showMappings={false}
          isMappingDisabled={true}
          canAddRemove={!isEvaluator}
          readOnly={isEvaluator}
          title="Results"
        />
      </Box>
      {isEvaluator && (
        <Text fontSize="13px" color="fg.muted">
          Evaluators return up to these four results. Connect the ones your
          workflow produces - unconnected results are simply omitted.
        </Text>
      )}
      {isEvaluator && !hasResultConnected && (
        <Alert.Root>
          <Alert.Indicator />
          <Alert.Content>
            <Text>
              Connect either a <b>score</b> or a <b>passed</b> result for this
              evaluator to be useful.
            </Text>
          </Alert.Content>
        </Alert.Root>
      )}
    </BasePropertiesPanel>
  );
}
