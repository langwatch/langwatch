import {
  CODE_EVALUATOR_CHECK_PREFIX,
  codeEvaluatorConfigSchema,
  evaluatorExecutionConfigSchema,
  EvaluatorInvalidConfigError,
  EvaluatorWorkflowNotFoundError,
  resolvedEvaluatorExecutionSchema,
  type EvaluatorIdOrSlugInput,
  type ResolvedEvaluatorExecution,
} from "@langwatch/evaluator-contract";
import {
  getWorkflowEntryOutputs,
  parseStudioWorkflow,
  WorkflowNotFoundError,
  type WorkflowService,
} from "@langwatch/workflow-contract";
import type { EvaluatorRepository } from "../repositories/evaluator.repository";

export class EvaluatorExecutionService {
  static create(options: {
    repository: EvaluatorRepository;
    workflows: WorkflowService;
  }): EvaluatorExecutionService {
    return new EvaluatorExecutionService(options);
  }

  private constructor(
    private readonly options: {
      repository: EvaluatorRepository;
      workflows: WorkflowService;
    },
  ) {}

  async resolve(input: EvaluatorIdOrSlugInput): Promise<ResolvedEvaluatorExecution> {
    const evaluator = await this.options.repository.findByIdOrSlug(input);
    const config = evaluatorExecutionConfigSchema.safeParse(evaluator.config);
    const settings = config.success ? config.data.settings : void 0;

    if (evaluator.type === "workflow" && evaluator.workflowId) {
      return this.resolveWorkflow(
        input,
        evaluator.id,
        evaluator.name,
        evaluator.workflowId,
        settings,
      );
    }

    if (evaluator.type === "code") {
      const codeConfig = codeEvaluatorConfigSchema.safeParse(evaluator.config);
      if (!codeConfig.success) {
        throw new EvaluatorInvalidConfigError(input.idOrSlug);
      }

      return resolvedEvaluatorExecutionSchema.parse({
        evaluatorId: evaluator.id,
        name: evaluator.name,
        checkType: `${CODE_EVALUATOR_CHECK_PREFIX}${evaluator.id}`,
        settings,
        requiredFields: codeConfig.data.inputs.map((field) => field.identifier),
      });
    }

    return resolvedEvaluatorExecutionSchema.parse({
      evaluatorId: evaluator.id,
      name: evaluator.name,
      checkType: config.success
        ? (config.data.evaluatorType ?? `evaluators/${input.idOrSlug}`)
        : `evaluators/${input.idOrSlug}`,
      settings,
    });
  }

  private async resolveWorkflow(
    input: EvaluatorIdOrSlugInput,
    evaluatorId: string,
    name: string,
    workflowId: string,
    settings: Record<string, unknown> | undefined,
  ): Promise<ResolvedEvaluatorExecution> {
    try {
      const workflow = await this.options.workflows.getById({
        id: workflowId,
        projectId: input.projectId,
        includeVersion: true,
      });
      const dsl = workflow.currentVersion?.dsl;
      const fields = dsl ? getWorkflowEntryOutputs(parseStudioWorkflow(dsl)) : [];

      return resolvedEvaluatorExecutionSchema.parse({
        evaluatorId,
        name,
        checkType: `custom/${workflowId}`,
        settings,
        requiredFields: fields.map((field) => field.identifier),
      });
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) {
        throw new EvaluatorWorkflowNotFoundError(input.idOrSlug, workflowId);
      }

      throw error;
    }
  }
}
