import {
  MonitorEvaluatorRequiredError,
  MonitorNotFoundError,
  MonitorService as MonitorServiceContract,
  monitorCreateInputSchema,
  monitorIdInputSchema,
  monitorMappingsInputSchema,
  monitorNameAvailabilityInputSchema,
  monitorReplicationInputSchema,
  monitorToggleInputSchema,
  monitorUpdateInputSchema,
  type Monitor,
  type MonitorCreateInput,
  type MonitorIdInput,
  type MonitorNameAvailabilityInput,
  type MonitorReplicationInput,
  type MonitorSummary,
  type MonitorToggleInput,
  type MonitorUpdateInput,
  type MonitorWithEvaluator,
} from "@langwatch/monitor-contract";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import type { MonitorRepository } from "../repositories/monitor.repository";

export type MonitorServiceOptions = {
  repository: MonitorRepository;
  evaluators: EvaluatorService;
  generateId?: () => string;
};

const defaultGenerateId = (): string =>
  `monitor_${Date.now()}_${Math.random().toString(36).slice(2)}`;

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "monitor"
  );
}

export class MonitorService extends MonitorServiceContract {
  static create(options: MonitorServiceOptions): MonitorService {
    return new MonitorService(options);
  }

  private constructor(private readonly options: MonitorServiceOptions) {
    super();
  }

  getAllForProject(input: { projectId: string }): Promise<MonitorWithEvaluator[]> {
    return this.options.repository.findAll(input);
  }

  getEnabledOnMessageMonitors(projectId: string): Promise<MonitorSummary[]> {
    return this.options.repository.findEnabledOnMessage(projectId);
  }

  async getById(input: MonitorIdInput): Promise<MonitorWithEvaluator> {
    const parsed = monitorIdInputSchema.parse(input);
    const monitor = await this.options.repository.tryFindById(parsed);
    if (!monitor) throw new MonitorNotFoundError(parsed.id);
    return monitor;
  }

  tryGetMonitorById(input: MonitorIdInput): Promise<MonitorWithEvaluator | null> {
    return this.options.repository.tryFindById(monitorIdInputSchema.parse(input));
  }

  getAllByIds(input: { monitorIds: string[]; projectId: string }): Promise<Monitor[]> {
    return this.options.repository.findAllByIds(input);
  }

  async toggle(input: MonitorToggleInput): Promise<{ success: true }> {
    const parsed = monitorToggleInputSchema.parse(input);
    await this.options.repository.setEnabled(parsed);
    return { success: true };
  }

  async create(input: MonitorCreateInput): Promise<Monitor> {
    const parsed = monitorCreateInputSchema.parse(input);
    if (!parsed.evaluatorId) throw new MonitorEvaluatorRequiredError();
    await this.options.evaluators.getById({
      id: parsed.evaluatorId,
      projectId: parsed.projectId,
    });

    const name = await this.uniqueName(parsed.projectId, parsed.name);
    const id = (this.options.generateId ?? defaultGenerateId)();
    const mappings = monitorMappingsInputSchema.parse(parsed.mappings);
    return this.options.repository.create({
      ...parsed,
      id,
      name,
      slug: `${slugify(name)}-${id.slice(-5)}`,
      mappings,
    });
  }

  async update(input: MonitorUpdateInput): Promise<Monitor> {
    const parsed = monitorUpdateInputSchema.parse(input);
    if (parsed.evaluatorId === null) throw new MonitorEvaluatorRequiredError();
    if (parsed.evaluatorId !== undefined) {
      await this.options.evaluators.getById({
        id: parsed.evaluatorId,
        projectId: parsed.projectId,
      });
    }
    const mappings = monitorMappingsInputSchema.parse(parsed.mappings);
    return this.options.repository.update({
      ...parsed,
      slug: slugify(parsed.name),
      mappings,
    });
  }

  async delete(input: MonitorIdInput): Promise<{ success: true }> {
    const parsed = monitorIdInputSchema.parse(input);
    await this.options.repository.delete(parsed);
    return { success: true };
  }

  async deleteForExperiment(input: {
    projectId: string;
    experimentId: string;
  }): Promise<void> {
    await this.options.repository.deleteForExperiment(input);
  }

  async isNameAvailable(
    input: MonitorNameAvailabilityInput,
  ): Promise<{ available: boolean }> {
    const parsed = monitorNameAvailabilityInputSchema.parse(input);
    return { available: await this.options.repository.isNameAvailable(parsed) };
  }

  async replicate(input: MonitorReplicationInput): Promise<Monitor> {
    const parsed = monitorReplicationInputSchema.parse(input);
    const source = await this.getById({
      id: parsed.sourceMonitorId,
      projectId: parsed.sourceProjectId,
    });
    if (parsed.evaluatorId) {
      await this.options.evaluators.getById({
        id: parsed.evaluatorId,
        projectId: parsed.targetProjectId,
      });
    }

    const name = await this.uniqueName(parsed.targetProjectId, source.name);
    const id = (this.options.generateId ?? defaultGenerateId)();
    return this.options.repository.createReplica({
      ...source,
      id,
      projectId: parsed.targetProjectId,
      experimentId: null,
      evaluatorId: parsed.evaluatorId,
      name,
      slug: `${slugify(name)}-${id.slice(-5)}`,
      enabled: false,
      mappings: source.mappings ?? { mapping: {}, expansions: [] },
    });
  }

  private async uniqueName(projectId: string, baseName: string): Promise<string> {
    if (await this.options.repository.isNameAvailable({ projectId, name: baseName })) {
      return baseName;
    }
    let suffix = 2;
    while (
      !(await this.options.repository.isNameAvailable({
        projectId,
        name: `${baseName} (${suffix})`,
      }))
    ) {
      suffix += 1;
    }
    return `${baseName} (${suffix})`;
  }
}
