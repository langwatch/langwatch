import type { Node } from "@xyflow/react";
import type { End } from "../../types/dsl";
import { BasePropertiesPanel } from "./BasePropertiesPanel";
import { Text, Switch, HStack } from "@chakra-ui/react";
import { useState } from "react";
import { useWorkflowStore } from "~/optimization_studio/hooks/useWorkflowStore";

//  score: Optional[float] = None
// passed: Optional[bool] = None
// label: Optional[str] = None
// details: Optional[str] = Field(
//     default=None, description="Short human-readable description of the result"
// )
// cost: Optional[Money] = None

export function EndPropertiesPanel({ node }: { node: Node<End> }) {
  const [isEvaluator, setIsEvaluator] = useState(false);
  const { setNode } = useWorkflowStore(({ setNode }) => ({ setNode }));

  const evaluatorInputs = [
    {
      type: "str",
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

  // setNode({
  //   id: node.id,
  //   data: {
  //     ...node.data,
  //     inputs: evaluatorInputs,
  //   } as End,
  // });

  console.log("node_end", node);

  const setAsEvaluator = () => {
    if (!isEvaluator) {
      setNode({
        id: node.id,
        data: { ...node.data, inputs: evaluatorInputs } as End,
      });
      setIsEvaluator(true);
    } else {
      setNode({
        id: node.id,
        data: {
          ...node.data,
          inputs: [{ type: "str", identifier: "result" }],
        } as End,
      });
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
