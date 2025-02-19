import { Alert, AlertIcon, Text } from "@chakra-ui/react";
import { type Node } from "@xyflow/react";
import { useState } from "react";
import { useWorkflowStore } from "~/optimization_studio/hooks/useWorkflowStore";
import type { End, Field } from "../../types/dsl";
import { BasePropertiesPanel } from "./BasePropertiesPanel";

export const evaluatorInputs: Field[] = [
  {
    type: "float",
    identifier: "score",
    optional: true,
  },
  {
    type: "bool",
    identifier: "passed",
    optional: true,
  },
  {
    type: "str",
    identifier: "details",
    optional: true,
  },
];

export function EndPropertiesPanel({ node: initialNode }: { node: Node<End> }) {
  const { node } = useWorkflowStore(
    (state) => ({
      node: state.nodes.find((n) => n.id === initialNode.id) as Node<End>,
    }),

    // Add equality function to ensure proper updates
    (prev, next) => prev.node === next.node
  );

  const [isEvaluator] = useState(() => node.data.behave_as === "evaluator");

  return (
    <BasePropertiesPanel
      node={node}
      hideOutputs
      hideParameters
      inputsTitle="Results"
    >
      {isEvaluator &&
        !node.data.inputs?.some(
          (input) =>
            (input.identifier === "score" && input.type === "float") ||
            (input.identifier === "passed" && input.type === "bool")
        ) && (
          <Alert status="warning">
            <AlertIcon />
            <Text>
              Results must include either a <b>score</b> or a <b>passed</b>{" "}
              field.
            </Text>
          </Alert>
        )}
    </BasePropertiesPanel>
  );
}
