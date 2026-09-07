import { Alert, Box, HStack, Text } from "@chakra-ui/react";
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
 * four - fixed identifiers and types, no add/remove/rename. Every
 * result is optional: connect any combination (a pass/fail, a score,
 * both, or neither) and unconnected results are simply omitted.
 *
 * `details` comes first: it carries the reasoning, and for an LLM judge
 * the reasoning should precede the verdict so the model reasons before
 * deciding. It also keeps the scaffold's reasoning -> details edge from
 * crossing the verdict edge.
 */
export const EVALUATOR_RESULT_FIELDS: Field[] = [
  { identifier: "details", type: "str", optional: true },
  { identifier: "passed", type: "bool", optional: true },
  { identifier: "score", type: "float", optional: true },
  { identifier: "label", type: "str", optional: true },
];

const EVALUATOR_RESULT_TYPE_LABELS: Record<string, string> = {
  bool: "Boolean",
  float: "Number",
  str: "Text",
};

const EVALUATOR_RESULT_DESCRIPTIONS: Record<string, string> = {
  passed: "Whether the evaluation passed or not.",
  score: "Any numerical score.",
  label: "A category, for categorical evaluations.",
  details:
    "The reasoning behind the result, usually the LLM as judge explanation.",
};

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
  // connections survive (identifiers keep their handles); free-form fields
  // users created by hand are replaced by the contract. The check also
  // reconciles optionality and order, so older nodes that pinned passed/score
  // as required (or kept the fields in the wrong spot) normalize to the
  // all-optional, details-first vocabulary.
  useEffect(() => {
    if (!isEvaluator) return;
    const current = node.data.inputs ?? [];
    const matchesContract =
      node.data.behave_as === "evaluator" &&
      current.length === EVALUATOR_RESULT_FIELDS.length &&
      EVALUATOR_RESULT_FIELDS.every((f, i) => {
        const c = current[i];
        return (
          c &&
          c.identifier === f.identifier &&
          c.type === f.type &&
          !!c.optional === !!f.optional
        );
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
      updateNodeInternals(node.id);
    }
  }, [isEvaluator, node.id, node.data, setNode, updateNodeInternals]);

  const hasResultConnected = edges.some(
    (edge) =>
      edge.target === node.id &&
      (edge.targetHandle === "inputs.score" ||
        edge.targetHandle === "inputs.passed"),
  );

  // Non-evaluator end nodes keep free-form results, rendered through the
  // shared VariablesSection so the rows match every other node panel.
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
      {isEvaluator ? (
        <Box width="full" display="flex" flexDirection="column" gap={4}>
          <Text fontSize="14px" fontWeight="semibold">
            Results
          </Text>
          <Text fontSize="13px" color="fg.muted">
            Evaluators return up to these four results. Connect the ones your
            workflow produces; unconnected results are simply omitted.
          </Text>
          <Box display="flex" flexDirection="column" gap={3}>
            {EVALUATOR_RESULT_FIELDS.map((field) => (
              <Box key={field.identifier} width="full">
                <HStack gap={2} align="baseline">
                  <Text fontFamily="mono" fontSize="14px" fontWeight="medium">
                    {field.identifier}
                  </Text>
                  <Text fontSize="12px" color="fg.subtle">
                    {EVALUATOR_RESULT_TYPE_LABELS[field.type] ?? field.type}
                  </Text>
                </HStack>
                <Text fontSize="13px" color="fg.muted">
                  {EVALUATOR_RESULT_DESCRIPTIONS[field.identifier]}
                </Text>
              </Box>
            ))}
          </Box>
        </Box>
      ) : (
        <Box width="full">
          <VariablesSection
            variables={variables}
            onChange={handleResultsChange}
            showMappings={false}
            isMappingDisabled={true}
            canAddRemove={true}
            readOnly={false}
            title="Results"
          />
        </Box>
      )}
      {isEvaluator && !hasResultConnected && (
        <Alert.Root>
          <Alert.Indicator />
          <Alert.Content>
            <Text>
              Connect at least one result, usually a <b>passed</b> or a{" "}
              <b>score</b>, for this evaluator to be useful.
            </Text>
          </Alert.Content>
        </Alert.Root>
      )}
    </BasePropertiesPanel>
  );
}
