import { nanoid } from "nanoid";
import { z } from "zod";
import type {
  Code,
  End,
  Entry,
  Field,
  Workflow,
} from "~/optimization_studio/types/dsl";

/**
 * Code evaluators: custom Python evaluation logic stored directly on the
 * Evaluator record (type "code") and executed through the engine's code
 * component via an ephemeral single-node workflow DSL. No Workflow record
 * is ever created for them.
 */

const codeEvaluatorFieldSchema = z.object({
  identifier: z.string().min(1),
  type: z.string().min(1),
});

export const codeEvaluatorConfigSchema = z.object({
  code: z.string().min(1),
  inputs: z.array(codeEvaluatorFieldSchema).min(1),
  outputs: z.array(codeEvaluatorFieldSchema).min(1),
});

export type CodeEvaluatorConfig = z.infer<typeof codeEvaluatorConfigSchema>;

/**
 * The fixed evaluator result contract. A code evaluator's function returns a
 * dictionary with any subset of these keys; whichever are present become the
 * evaluation result. These mirror the studio's evaluator End node, so the
 * outputs are not user-customizable, only the inputs are.
 */
export const CODE_EVALUATOR_OUTPUT_FIELDS: Array<{
  identifier: string;
  type: Field["type"];
}> = [
  { identifier: "passed", type: "bool" },
  { identifier: "score", type: "float" },
  { identifier: "label", type: "str" },
  { identifier: "details", type: "str" },
];

/** Default shape new code evaluators are seeded with in the editor. */
export const DEFAULT_CODE_EVALUATOR_CONFIG: CodeEvaluatorConfig = {
  code: `class Code:
    def __call__(self, output: str, expected_output: str):
        # Return a dict with any of: passed (bool), score (float),
        # label (str), details (str). All are optional.
        passed = output.strip() == expected_output.strip()

        return {"passed": passed, "score": 1.0 if passed else 0.0}
`,
  inputs: [
    { identifier: "output", type: "str" },
    { identifier: "expected_output", type: "str" },
  ],
  outputs: CODE_EVALUATOR_OUTPUT_FIELDS.map((field) => ({ ...field })),
};

/** checkType prefix routing a monitor/evaluation to a stored code evaluator. */
export const CODE_EVALUATOR_CHECK_PREFIX = "code/";

export const isCodeEvaluatorCheckType = (evaluatorType: string): boolean =>
  evaluatorType.startsWith(CODE_EVALUATOR_CHECK_PREFIX);

export const codeEvaluatorIdFromCheckType = (
  evaluatorType: string,
): string | undefined =>
  isCodeEvaluatorCheckType(evaluatorType)
    ? evaluatorType.slice(CODE_EVALUATOR_CHECK_PREFIX.length)
    : undefined;

const stripValues = (fields: CodeEvaluatorConfig["inputs"]): Field[] =>
  fields.map(({ identifier, type }) => ({
    identifier,
    type: type as Field["type"],
  }));

/**
 * Builds the ephemeral entry -> code -> end workflow the engine executes for
 * a code evaluator. The end node carries the evaluator contract fields the
 * code returns (passed/score/label/details by name).
 */
export const buildCodeEvaluatorDsl = ({
  name,
  config,
}: {
  name: string;
  config: CodeEvaluatorConfig;
}): Workflow => {
  const entryNode: {
    id: string;
    type: string;
    position: { x: number; y: number };
    data: Entry;
  } = {
    id: "entry",
    type: "entry",
    position: { x: 0, y: 0 },
    data: {
      name: "Entry",
      outputs: stripValues(config.inputs),
      entry_selection: "first",
      train_size: 1,
      test_size: 0,
      seed: 42,
    } as Entry,
  };

  const codeNode: {
    id: string;
    type: string;
    position: { x: number; y: number };
    data: Code;
  } = {
    id: "code_evaluator",
    type: "code",
    position: { x: 300, y: 0 },
    data: {
      name,
      cls: "Code",
      inputs: stripValues(config.inputs),
      // No declared outputs: the engine only enforces that *declared* code
      // outputs are present in the returned dict (a "missing_output" error).
      // An evaluator returns any subset of the contract, so declaring them
      // would break a function that returns only `passed`. The end node below
      // carries the contract and surfaces whichever keys the code returns.
      outputs: [],
      parameters: [{ identifier: "code", type: "code", value: config.code }],
    } as Code,
  };

  const endNode: {
    id: string;
    type: string;
    position: { x: number; y: number };
    data: End;
  } = {
    id: "end",
    type: "end",
    position: { x: 600, y: 0 },
    data: {
      name: "End",
      behave_as: "evaluator",
      // Always the fixed evaluator contract, independent of what the code
      // returns. resolveInputs only binds an input when the upstream key
      // exists, so a partial return surfaces just the keys it produced.
      inputs: stripValues(CODE_EVALUATOR_OUTPUT_FIELDS),
    } as End,
  };

  return {
    spec_version: "1.4",
    workflow_id: `code_evaluator_${nanoid(8)}`,
    name,
    icon: "🧩",
    description: "Code evaluator execution",
    version: "1.0",
    default_llm: {
      model: "openai/gpt-4o-mini",
      temperature: 0,
      max_tokens: 2048,
    },
    template_adapter: "default",
    enable_tracing: true,
    nodes: [entryNode, codeNode, endNode] as Workflow["nodes"],
    edges: [
      ...config.inputs.map(({ identifier }) => ({
        id: `entry_to_code_${identifier}`,
        source: "entry",
        sourceHandle: `outputs.${identifier}`,
        target: "code_evaluator",
        targetHandle: `inputs.${identifier}`,
        type: "default",
      })),
      ...CODE_EVALUATOR_OUTPUT_FIELDS.map(({ identifier }) => ({
        id: `code_to_end_${identifier}`,
        source: "code_evaluator",
        sourceHandle: `outputs.${identifier}`,
        target: "end",
        targetHandle: `inputs.${identifier}`,
        type: "default",
      })),
    ],
    state: {},
  };
};
