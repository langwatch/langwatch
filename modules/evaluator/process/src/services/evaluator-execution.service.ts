import {
  CODE_EVALUATOR_CHECK_PREFIX,
  codeEvaluatorConfigSchema,
  evaluatorExecutionConfigSchema,
  EvaluatorInvalidConfigError,
  EvaluatorNotFoundError,
  EvaluatorWorkflowNotFoundError,
  parseEvaluatorAddress,
  resolvedEvaluatorExecutionSchema,
  type Evaluator,
  type EvaluatorIdOrSlugInput,
  type ResolvedEvaluatorExecution,
} from "@langwatch/evaluator-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import {
  getWorkflowEntryOutputs,
  parseStudioWorkflow,
  WorkflowNotFoundError,
} from "@langwatch/workflow-contract";

import type { EvaluatorRepository } from "../repositories/evaluator.repository.ts";
import type { EvaluatorVersionService } from "./evaluator-version.service.ts";

export class EvaluatorExecutionService {
  static create(options: {
    repository: EvaluatorRepository;
    workflows: WorkflowApi;
    versions?: EvaluatorVersionService;
  }): EvaluatorExecutionService {
    return new EvaluatorExecutionService(options);
  }

  private constructor(
    private readonly options: {
      repository: EvaluatorRepository;
      workflows: WorkflowApi;
      versions?: EvaluatorVersionService;
    },
  ) {}

  /** `toxicity`, `toxicity:production` or `toxicity:2`: the suffix picks the version run. */
  async resolve(addressed: EvaluatorIdOrSlugInput): Promise<ResolvedEvaluatorExecution> {
    const evaluator = await this.#evaluatorAt(addressed);
    const input = this.options.versions
      ? { ...addressed, idOrSlug: parseEvaluatorAddress(addressed.idOrSlug).idOrSlug }
      : addressed;

    const config = evaluatorExecutionConfigSchema.safeParse(evaluator.config);
    const settings = config.success ? config.data.settings : void 0;

    if (evaluator.type === "workflow" && evaluator.workflowId) {
      return this.resolveWorkflow({
        input,
        evaluatorId: evaluator.id,
        name: evaluator.name,
        workflowId: evaluator.workflowId,
        settings,
      });
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

  async #evaluatorAt(input: EvaluatorIdOrSlugInput): Promise<Evaluator> {
    if (this.options.versions) {
      const { evaluator } = await this.options.versions.resolve({
        projectId: input.projectId,
        address: input.idOrSlug,
        bySlug: true,
      });
      return evaluator;
    }
    const evaluator = await this.options.repository.findByIdOrSlug(input);
    if (!evaluator) throw new EvaluatorNotFoundError(input.idOrSlug);
    return evaluator;
  }

  private async resolveWorkflow({
    input,
    evaluatorId,
    name,
    workflowId,
    settings,
  }: {
    input: EvaluatorIdOrSlugInput;
    evaluatorId: string;
    name: string;
    workflowId: string;
    settings: Record<string, unknown> | undefined;
  }): Promise<ResolvedEvaluatorExecution> {
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
