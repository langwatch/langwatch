import type { Code } from "~/optimization_studio/types/dsl";
import type { NodeWithOptionalPosition } from "../types";
import type { Node } from "@xyflow/react";

type CodeExecutionNode = NodeWithOptionalPosition<Code>;

const OUTPUT_FIELD_NAME = "output";

const DEFAULT_CODE_NODE_PROPERTIES: CodeExecutionNode = {
  type: "code",
  id: "code_node",
  deletable: true,
  data: {
    name: "Code",
    description: "Python code block",
    parameters: [
      {
        identifier: "code",
        type: "code",
        value: `import dspy

class Code(dspy.Module):
    def forward(self, question: str):
        # Your code goes here

        return {"${OUTPUT_FIELD_NAME}": "Hello world!"}
`,
      },
    ],
    inputs: [
      {
        identifier: "input",
        type: "str",
      },
    ],
    outputs: [
      {
        identifier: OUTPUT_FIELD_NAME,
        type: "str",
      },
    ],
  },
};

/**
 * Simple factory for creating Code Execution Nodes
 */
export class CodeExecutionNodeFactory {
  static build(overrides?: Partial<CodeExecutionNode>): Node<Code> {
    return {
      ...DEFAULT_CODE_NODE_PROPERTIES,
      position: { x: 0, y: 0 },
      ...overrides,
    };
  }
}
