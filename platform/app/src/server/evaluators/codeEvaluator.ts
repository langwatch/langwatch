import { nanoid } from "nanoid";
import {
  CODE_EVALUATOR_CHECK_PREFIX,
  codeEvaluatorConfigSchema,
  codeEvaluatorIdFromCheckType,
  codeEvaluatorOutputFields,
  defaultCodeEvaluatorConfig,
  isCodeEvaluatorCheckType,
  type CodeEvaluatorConfig,
} from "@langwatch/evaluator-contract";
import {
  type Code,
  type End,
  type Entry,
  type Field,
  LATEST_SPEC_VERSION,
  type StudioWorkflow,
} from "@langwatch/workflow-contract";

/**
 * Code evaluators: custom Python evaluation logic stored directly on the
 * Evaluator record (type "code") and executed through the engine's code
 * component via an ephemeral single-node workflow DSL. No Workflow record
 * is ever created for them.
 */

/**
 * Compatibility exports for the evaluation runtime's DSL builder. The portable
 * evaluator contract owns this vocabulary; this module only builds the Studio
 * execution DSL.
 */
export {
  CODE_EVALUATOR_CHECK_PREFIX,
  codeEvaluatorConfigSchema,
  codeEvaluatorIdFromCheckType,
  isCodeEvaluatorCheckType,
};
export type { CodeEvaluatorConfig };

export const CODE_EVALUATOR_OUTPUT_FIELDS: Array<{
  identifier: string;
  type: Field["type"];
}> = codeEvaluatorOutputFields.map((field) => ({
  ...field,
  type: field.type as Field["type"],
}));

/** Default shape new code evaluators are seeded with in the editor. */
export const DEFAULT_CODE_EVALUATOR_CONFIG: CodeEvaluatorConfig =
  defaultCodeEvaluatorConfig;

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
}): StudioWorkflow => {
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
    spec_version: LATEST_SPEC_VERSION,
    workflow_id: `code_evaluator_${nanoid(8)}`,
    name,
    icon: "🧩",
    description: "Code evaluator execution",
    version: "1.0",
    template_adapter: "default",
    enable_tracing: true,
    nodes: [entryNode, codeNode, endNode] as StudioWorkflow["nodes"],
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
