import { codeEvaluatorOutputFields, type CodeEvaluatorConfig } from "@langwatch/evaluator-contract";
import {
  type Code,
  type End,
  type Entry,
  type Field,
  LATEST_SPEC_VERSION,
  type StudioWorkflow,
} from "@langwatch/workflow-contract";

const outputFields: Field[] = codeEvaluatorOutputFields.map((field) => ({
  ...field,
  type: field.type as Field["type"],
}));

const stripValues = (fields: CodeEvaluatorConfig["inputs"]): Field[] =>
  fields.map(({ identifier, type }) => ({
    identifier,
    type: type as Field["type"],
  }));

export class EvaluatorCodeService {
  static create(): EvaluatorCodeService {
    return new EvaluatorCodeService();
  }

  private constructor() {}

  /** Builds the ephemeral entry-code-end workflow used by code evaluators. */
  buildDsl(input: {
    name: string;
    config: CodeEvaluatorConfig;
    workflowId: string;
  }): StudioWorkflow {
    const entryNode = {
      id: "entry",
      type: "entry",
      position: { x: 0, y: 0 },
      data: {
        name: "Entry",
        outputs: stripValues(input.config.inputs),
        entry_selection: "first",
        train_size: 1,
        test_size: 0,
        seed: 42,
      } as Entry,
    };
    const codeNode = {
      id: "code_evaluator",
      type: "code",
      position: { x: 300, y: 0 },
      data: {
        name: input.name,
        cls: "Code",
        inputs: stripValues(input.config.inputs),
        outputs: [],
        parameters: [{ identifier: "code", type: "code", value: input.config.code }],
      } as Code,
    };
    const endNode = {
      id: "end",
      type: "end",
      position: { x: 600, y: 0 },
      data: {
        name: "End",
        behave_as: "evaluator",
        inputs: stripValues(outputFields),
      } as End,
    };

    return {
      spec_version: LATEST_SPEC_VERSION,
      workflow_id: input.workflowId,
      name: input.name,
      icon: "🧩",
      description: "Code evaluator execution",
      version: "1.0",
      template_adapter: "default",
      enable_tracing: true,
      nodes: [entryNode, codeNode, endNode] as StudioWorkflow["nodes"],
      edges: [
        ...input.config.inputs.map(({ identifier }) => ({
          id: `entry_to_code_${identifier}`,
          source: "entry",
          sourceHandle: `outputs.${identifier}`,
          target: "code_evaluator",
          targetHandle: `inputs.${identifier}`,
          type: "default",
        })),
        ...outputFields.map(({ identifier }) => ({
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
  }
}
