import {
  codeEvaluatorConfigSchema,
  codeEvaluatorOutputFields,
  type CodeEvaluatorConfig,
  type CodeEvaluatorExecutionInput,
  type SingleEvaluationResult,
} from "@langwatch/evaluator-contract";
import {
  type Code,
  type End,
  type Entry,
  type Field,
  LATEST_SPEC_VERSION,
  type StudioWorkflow,
  type StudioClientEvent,
  type WorkflowService,
} from "@langwatch/workflow-contract";
import type { EvaluatorCodeExecutionPort } from "../ports/evaluator.port";
import type { EvaluatorRepository } from "../repositories/evaluator.repository";

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
  static create(options: {
    repository: EvaluatorRepository;
    workflows: WorkflowService;
    codeExecution: EvaluatorCodeExecutionPort;
    generateId: () => string;
  }): EvaluatorCodeService {
    return new EvaluatorCodeService(options);
  }

  private constructor(
    private readonly options: {
      repository: EvaluatorRepository;
      workflows: WorkflowService;
      codeExecution: EvaluatorCodeExecutionPort;
      generateId: () => string;
    },
  ) {}

  async execute(input: CodeEvaluatorExecutionInput): Promise<SingleEvaluationResult> {
    try {
      const evaluator = await this.options.repository.findById({
        id: input.evaluatorId,
        projectId: input.projectId,
      });
      if (evaluator.type !== "code") {
        throw new Error(`Code evaluator not found: ${input.evaluatorId}`);
      }

      const config = codeEvaluatorConfigSchema.parse(evaluator.config);
      const inputs = Object.fromEntries(
        config.inputs.map(({ identifier }) => {
          const value = input.data[identifier];

          return [
            identifier,
            value === null || value === void 0
              ? ""
              : typeof value === "string"
                ? value
                : JSON.stringify(value),
          ];
        }),
      );
      const event: StudioClientEvent = {
        type: "execute_flow",
        payload: {
          trace_id: input.traceId ?? `trace_${this.options.generateId()}`,
          workflow: EvaluatorCodeService.buildDsl({
            name: evaluator.name,
            config,
            workflowId: `code_evaluator_${this.options.generateId()}`,
          }),
          inputs: [inputs],
          manual_execution_mode: false,
          do_not_trace: false,
          run_evaluations: false,
          origin: "evaluation",
        },
      };
      const enriched = await this.options.workflows.enrichStudioEvent({
        event,
        projectId: input.projectId,
      });
      const response = await this.options.codeExecution.execute({
        projectId: input.projectId,
        event: enriched,
        causalityDepth: input.parentCausalityDepth ?? 0,
        ...(input.parentTrace ? { parentTrace: input.parentTrace } : {}),
      });
      if (!response.ok) {
        throw new Error(`Error running code evaluator: ${response.statusText}`);
      }

      if (response.body.status !== "success") {
        return {
          status: "error",
          details: response.body.error?.message ?? "Code evaluator execution failed",
          error_type: "CODE_EVALUATOR_ERROR",
          traceback: response.body.error?.traceback ? [response.body.error.traceback] : [],
        };
      }

      return {
        ...this.coerceResult(response.body.result ?? {}),
        status: "processed",
      };
    } catch (error) {
      return {
        status: "error",
        details: error instanceof Error ? error.message : String(error),
        error_type: "CODE_EVALUATOR_ERROR",
        traceback: [error instanceof Error ? (error.stack ?? "") : ""],
      };
    }
  }

  private coerceResult(result: Record<string, unknown>): Record<string, unknown> {
    const coerced = { ...result };
    if (
      "score" in coerced &&
      (typeof coerced.score === "number" || typeof coerced.score === "string")
    ) {
      const score = Number.parseFloat(`${coerced.score}`);
      coerced.score = Number.isNaN(score) ? 0 : score;
    }

    if (
      "passed" in coerced &&
      (typeof coerced.passed === "boolean" || typeof coerced.passed === "string")
    ) {
      coerced.passed = coerced.passed === true || `${coerced.passed}` === "true";
    }

    return coerced;
  }

  /** Builds the ephemeral entry-code-end workflow used by code evaluators. */
  static buildDsl(input: {
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
