import type { Code } from "~/optimization_studio/types/dsl";
import type { NodeWithOptionalPosition } from "../../../../../../../types";

type CodeExecutionNode = NodeWithOptionalPosition<Code>;

const INPUT_FIELD_NAME = "input";
const OUTPUT_FIELD_NAME = "output";

const DEFAULT_CODE_NODE_PROPERTIES: CodeExecutionNode = {
  type: "code",
  id: "code_node",
  deletable: false,
  data: {
    name: "Code",
    description: "Python code block",
    parameters: [
      {
        identifier: "code",
        type: "code",
        value: `import dspy

class Code(dspy.Module):
    def forward(self, ${INPUT_FIELD_NAME}: str):
        # Your code goes here

        return {"${OUTPUT_FIELD_NAME}": "Hello world!"}
`,
      },
    ],
    inputs: [
      {
        identifier: INPUT_FIELD_NAME,
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
  static build(overrides?: Partial<CodeExecutionNode>): CodeExecutionNode {
    return {
      ...DEFAULT_CODE_NODE_PROPERTIES,
      ...overrides,
    };
  }
}
