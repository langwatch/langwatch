import {
  AVAILABLE_EVALUATORS,
  codeEvaluatorConfigSchema,
  evaluatorConfigSchema,
  evaluatorTypeSchema,
  fieldType,
  getEvaluatorDefaultSettings,
  standardEvaluatorOutputFields,
  type Evaluator,
  type EvaluatorCreateInput,
  type EvaluatorField,
  type EvaluatorHistoryEntry,
  EvaluatorService as EvaluatorServiceContract,
  type EvaluatorUpdateInput,
  type EvaluatorWithFields,
  EvaluatorNotFoundError,
  EvaluatorCopySelectionError,
  EvaluatorInvalidTypeError,
  EvaluatorIsNotCopyError,
  EvaluatorSourceNotFoundError,
  EvaluatorWorkflowAlreadyAssignedError,
  type EvaluatorCopy,
} from "@langwatch/evaluator-contract";
import type { WorkflowService } from "@langwatch/workflow-contract";
import type { EvaluatorAuditLogPort } from "../ports/evaluator.port";
import type { EvaluatorRepository } from "../repositories/evaluator.repository";

export type EvaluatorServiceOptions = {
  repository: EvaluatorRepository;
  workflows: WorkflowService;
  auditLog?: EvaluatorAuditLogPort;
  fallbackModels?: { defaultModel: string; embeddingsModel: string };
};

export class EvaluatorService extends EvaluatorServiceContract {
  static create(options: EvaluatorServiceOptions): EvaluatorService {
    return new EvaluatorService(options);
  }

  private constructor(private readonly options: EvaluatorServiceOptions) { super(); }

  async tryGetById(input: { id: string; projectId: string }): Promise<Evaluator | null> {
    return this.options.repository.tryFindById(input);
  }
  async getById(input: { id: string; projectId: string }): Promise<Evaluator> {
    const evaluator = await this.options.repository.tryFindById(input);
    if (!evaluator) throw new EvaluatorNotFoundError(input.id);
    return evaluator;
  }
  async tryGetByIdWithFields(input: { id: string; projectId: string }): Promise<EvaluatorWithFields | null> {
    const evaluator = await this.tryGetById(input);
    return evaluator ? this.enrichWithFields(evaluator) : null;
  }
  async getByIdWithFields(input: { id: string; projectId: string }): Promise<EvaluatorWithFields> {
    return this.enrichWithFields(await this.getById(input));
  }
  tryGetBySlug(input: { slug: string; projectId: string }): Promise<Evaluator | null> {
    return this.options.repository.tryFindBySlug(input);
  }
  async getBySlug(input: { slug: string; projectId: string }): Promise<Evaluator> {
    const evaluator = await this.options.repository.tryFindBySlug(input);
    if (!evaluator) throw new EvaluatorNotFoundError(input.slug);
    return evaluator;
  }
  tryGetByWorkflow(input: { workflowId: string; projectId: string }): Promise<Evaluator | null> {
    return this.options.repository.tryFindByWorkflow(input);
  }
  getAll(input: { projectId: string }): Promise<Evaluator[]> {
    return this.options.repository.findAll(input);
  }
  async getAllWithFields(input: { projectId: string }): Promise<EvaluatorWithFields[]> {
    const evaluators = await this.getAll(input);
    return Promise.all(evaluators.map((evaluator) => this.enrichWithFields(evaluator)));
  }

  async create(input: EvaluatorCreateInput): Promise<Evaluator> {
    const parsed = evaluatorTypeSchema.safeParse(input.type);
    if (!parsed.success) throw new EvaluatorInvalidTypeError(input.type);
    const config = evaluatorConfigSchema.parse(input.config);
    if (parsed.data === "code") codeEvaluatorConfigSchema.parse(config);
    if (input.workflowId) {
      await this.options.workflows.assertInProject({
        workflowId: input.workflowId,
        projectId: input.projectId,
      });
      const existing = await this.tryGetByWorkflow({
        workflowId: input.workflowId,
        projectId: input.projectId,
      });
      if (existing) {
        throw new EvaluatorWorkflowAlreadyAssignedError(input.workflowId);
      }
    }
    return this.options.repository.create({ ...input, type: parsed.data, config });
  }

  async createWithDefaults(input: EvaluatorCreateInput): Promise<Evaluator> {
    const config = evaluatorConfigSchema.parse(input.config);
    const evaluatorConfig = evaluatorConfigSchema.safeParse(config);
    const evaluatorType = evaluatorConfig.success && typeof evaluatorConfig.data.evaluatorType === "string"
      ? evaluatorConfig.data.evaluatorType
      : undefined;
    const definition = evaluatorType
      ? AVAILABLE_EVALUATORS[evaluatorType as keyof typeof AVAILABLE_EVALUATORS]
      : undefined;
    if (definition && input.type === "evaluator") {
      config.settings = {
        ...getEvaluatorDefaultSettings(definition, input.resolved, this.options.fallbackModels),
        ...(config.settings && typeof config.settings === "object" ? config.settings : {}),
      };
    }
    return this.create({ ...input, config });
  }

  async update(input: EvaluatorUpdateInput): Promise<Evaluator> {
    const existing = await this.getById({
      id: input.id,
      projectId: input.projectId,
    });
    if (input.data.type !== undefined) evaluatorTypeSchema.parse(input.data.type);
    if (input.data.config !== undefined) {
      const config = evaluatorConfigSchema.parse(input.data.config);
      if ((input.data.type ?? existing.type) === "code") {
        codeEvaluatorConfigSchema.parse(config);
      }
    }
    if (input.data.workflowId) {
      await this.options.workflows.assertInProject({
        workflowId: input.data.workflowId,
        projectId: input.projectId,
      });
    }
    return this.options.repository.update(input);
  }
  async archive(input: { id: string; projectId: string }): Promise<Evaluator> {
    await this.getById(input);
    return this.options.repository.archive(input);
  }

  private async enrichWithFields(
    evaluator: Evaluator,
  ): Promise<EvaluatorWithFields> {
    if (evaluator.type === "workflow" && evaluator.workflowId) {
      const workflow = await this.options.workflows.getFields({ workflowId: evaluator.workflowId, projectId: evaluator.projectId });
      return {
        ...evaluator,
        fields: workflow.fields,
        outputFields: workflow.outputFields.length ? workflow.outputFields : [...standardEvaluatorOutputFields],
        ...(workflow.workflowName ? { workflowName: workflow.workflowName } : {}),
        ...(workflow.workflowIcon ? { workflowIcon: workflow.workflowIcon } : {}),
      };
    }
    if (evaluator.type === "code") {
      const config = codeEvaluatorConfigSchema.safeParse(evaluator.config);
      return {
        ...evaluator,
        fields: config.success ? config.data.inputs : [],
        outputFields: config.success ? config.data.outputs : [...standardEvaluatorOutputFields],
      };
    }
    const evaluatorConfig = evaluatorConfigSchema.safeParse(evaluator.config);
    const evaluatorType = evaluatorConfig.success && typeof evaluatorConfig.data.evaluatorType === "string"
      ? evaluatorConfig.data.evaluatorType
      : undefined;
    const definition = evaluatorType ? AVAILABLE_EVALUATORS[evaluatorType as keyof typeof AVAILABLE_EVALUATORS] : undefined;
    const fields: EvaluatorField[] = definition
      ? [...definition.requiredFields.map((identifier) => ({ identifier, type: fieldType(identifier) })), ...definition.optionalFields.map((identifier) => ({ identifier, type: fieldType(identifier), optional: true }))]
      : [];
    const outputFields = definition
      ? Object.entries(definition.result).map(([identifier, result]) => ({ identifier, type: identifier === "score" ? "float" : identifier === "passed" ? "bool" : "str", ...(result ? {} : {}) }))
      : [...standardEvaluatorOutputFields];
    return { ...evaluator, fields, outputFields: outputFields.length ? outputFields : [...standardEvaluatorOutputFields] };
  }

  async getWorkflowFields(input: { id: string; projectId: string }): Promise<{
    evaluatorId: string; evaluatorType: string; workflowId?: string; workflowName?: string;
    workflowIcon?: string; fields: EvaluatorField[]; outputFields: EvaluatorField[];
  }> {
    const evaluator = await this.getById(input);
    if (evaluator.type !== "workflow" || !evaluator.workflowId) {
      return {
        evaluatorId: evaluator.id,
        evaluatorType: evaluator.type,
        fields: [],
        outputFields: [...standardEvaluatorOutputFields],
      };
    }
    const workflow = await this.options.workflows.getFields({ workflowId: evaluator.workflowId, projectId: input.projectId });
    return {
      evaluatorId: evaluator.id, evaluatorType: evaluator.type, workflowId: evaluator.workflowId,
      ...(workflow.workflowName ? { workflowName: workflow.workflowName } : {}),
      ...(workflow.workflowIcon ? { workflowIcon: workflow.workflowIcon } : {}),
      fields: workflow.fields,
      outputFields: workflow.outputFields.length
        ? workflow.outputFields
        : [...standardEvaluatorOutputFields],
    };
  }

  async getCopies(input: { evaluatorId: string; projectId: string }): Promise<EvaluatorCopy[]> {
    await this.getById({ id: input.evaluatorId, projectId: input.projectId });
    return this.options.repository.findCopies({ evaluatorId: input.evaluatorId });
  }

  async pushToCopies(input: { projectId: string; evaluatorId: string; copyIds?: string[]; allowedProjectIds?: string[] }): Promise<{ pushedTo: number; selectedCopies: number }> {
    const source = await this.getById({ id: input.evaluatorId, projectId: input.projectId });
    const copies = await this.options.repository.findCopies({ evaluatorId: input.evaluatorId });
    const selected = input.copyIds ? copies.filter((copy) => input.copyIds?.includes(copy.id)) : copies;
    if (!selected.length) throw new EvaluatorCopySelectionError(input.evaluatorId);
    const allowed = input.allowedProjectIds ? new Set(input.allowedProjectIds) : undefined;
    const writable = allowed ? selected.filter((copy) => allowed.has(copy.projectId)) : selected;
    const config = evaluatorConfigSchema.safeParse(source.config);
    await Promise.all(writable.map((copy) => this.options.repository.updateNameAndConfig({ id: copy.id, projectId: copy.projectId, name: source.name, config: config.success ? config.data : {} })));
    return { pushedTo: writable.length, selectedCopies: selected.length };
  }

  async syncFromSource(input: { projectId: string; evaluatorId: string }): Promise<{ ok: true }> {
    const copy = await this.getById({ id: input.evaluatorId, projectId: input.projectId });
    const { source } = await this.getCopySource({ projectId: input.projectId, evaluatorId: input.evaluatorId });
    const config = evaluatorConfigSchema.safeParse(source.config);
    await this.options.repository.updateNameAndConfig({ id: copy.id, projectId: input.projectId, name: source.name, config: config.success ? config.data : {} });
    return { ok: true };
  }

  async getCopySource(input: { projectId: string; evaluatorId: string }): Promise<{ copy: Evaluator; source: Evaluator }> {
    const copy = await this.getById({ id: input.evaluatorId, projectId: input.projectId });
    if (!copy.copiedFromEvaluatorId) throw new EvaluatorIsNotCopyError(copy.id);
    const source = await this.options.repository.tryFindByIdOnly(copy.copiedFromEvaluatorId);
    if (!source) throw new EvaluatorSourceNotFoundError(copy.copiedFromEvaluatorId);
    return { copy, source };
  }

  async getHistory(input: { evaluatorId: string; projectId: string }): Promise<EvaluatorHistoryEntry[]> {
    if (!this.options.auditLog) return [];
    const logs = await this.options.auditLog.history({ ...input, limit: 100 });
    const users = await this.options.auditLog.users({ userIds: [...new Set(logs.map((log) => log.userId).filter((id): id is string => Boolean(id)))] });
    const usersById = new Map(users.map((user) => [user.id, user]));
    return logs.map((log) => ({ id: log.id, action: log.action, createdAt: log.createdAt, args: log.args, user: log.userId ? usersById.get(log.userId) ?? null : null }));
  }
}
