import { useUpdateNodeInternals, type Node } from "@xyflow/react";
import type { End } from "../../types/dsl";
import { BasePropertiesPanel } from "./BasePropertiesPanel";
import { Text, Switch, HStack } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { useWorkflowStore } from "~/optimization_studio/hooks/useWorkflowStore";

export function EndPropertiesPanel({ node: initialNode }: { node: Node<End> }) {
  const { node, setNode } = useWorkflowStore(
    (state) => ({
      node: state.nodes.find((n) => n.id === initialNode.id) as Node<End>,
      setNode: state.setNode,
    }),

    // Add equality function to ensure proper updates
    (prev, next) => prev.node === next.node
  );

  const updateNodeInternals = useUpdateNodeInternals();

  const [isEvaluator, setIsEvaluator] = useState(
    () =>
      node.data.inputs?.length === 3 &&
      node.data.inputs[0]?.identifier === "score"
  );

  const evaluatorInputs = [
    {
      type: "float",
      identifier: "score",
    },
    {
      type: "bool",
      identifier: "passed",
    },
    {
      type: "str",
      identifier: "details",
    },
  ];

  useEffect(() => {
    setIsEvaluator(
      node.data.inputs?.length === 3 &&
        node.data.inputs[0]?.identifier === "score"
    );
  }, [node.data.inputs]);

  const setAsEvaluator = () => {
    if (!isEvaluator) {
      setNode({
        id: node.id,
        data: {
          ...node.data,
          inputs: evaluatorInputs,
          behave_as: "evaluator",
          fields: [],
        } as End,
      });
      updateNodeInternals(node.id);
      setIsEvaluator(true);
    } else {
      setNode({
        id: node.id,
        data: {
          ...node.data,
          inputs: [{ type: "str", identifier: "output" }],
          fields: [],
          behave_as: undefined,
        } as End,
      });

      updateNodeInternals(node.id);
      setIsEvaluator(false);
    }
  };

  return (
    <BasePropertiesPanel
      node={node}
      hideOutputs
      hideParameters
      inputsTitle="Results"
      inputsReadOnly={isEvaluator}
    >
      <HStack>
        <Text>Use as Evaluator</Text>
        <Switch isChecked={isEvaluator} onChange={() => setAsEvaluator()} />
      </HStack>
    </BasePropertiesPanel>
  );
}
