import {
  MonitorEvaluatorRequiredError,
  MonitorNotFoundError,
  MonitorService as MonitorServiceContract,
  monitorCreateInputSchema,
  monitorEnabledGuardrailInputSchema,
  monitorExecutionModeSchema,
  monitorExperimentUpsertInputSchema,
  monitorIdInputSchema,
  monitorMappingsInputSchema,
  monitorNameAvailabilityInputSchema,
  monitorReplicationInputSchema,
  monitorToggleInputSchema,
  monitorUpdateInputSchema,
  type EnabledGuardrailMonitor,
  type Monitor,
  type MonitorCreateInput,
  type MonitorEnabledGuardrailInput,
  type MonitorExperimentUpsertInput,
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
import { MonitorCatalogService } from "./monitor-catalog.service";

export type MonitorServiceOptions = {
  repository: MonitorRepository;
  evaluators: EvaluatorService;
  generateId: () => string;
};

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
    return new MonitorService(
      options,
      MonitorCatalogService.create({ repository: options.repository }),
    );
  }

  private constructor(
    private readonly options: MonitorServiceOptions,
    private readonly catalog: MonitorCatalogService,
  ) {
    super();
  }

  getAllForProject(input: { projectId: string }): Promise<MonitorWithEvaluator[]> {
    return this.options.repository.findAll(input);
  }

  getEnabledOnMessageMonitors(projectId: string): Promise<MonitorSummary[]> {
    return this.catalog.getEnabledOnMessageMonitors(projectId);
  }

  listEnabledGuardrailMonitors(
    input: MonitorEnabledGuardrailInput,
  ): Promise<EnabledGuardrailMonitor[]> {
    const parsed = monitorEnabledGuardrailInputSchema.parse(input);

    return this.options.repository.listEnabledGuardrails(parsed);
  }

  async getById(input: MonitorIdInput): Promise<MonitorWithEvaluator> {
    const parsed = monitorIdInputSchema.parse(input);
    const monitor = await this.options.repository.tryFindById(parsed);

    if (!monitor) {
      throw new MonitorNotFoundError(parsed.id);
    }

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

    if (!parsed.evaluatorId) {
      throw new MonitorEvaluatorRequiredError();
    }

    await this.options.evaluators.getById({
      id: parsed.evaluatorId,
      projectId: parsed.projectId,
    });

    const name = await this.uniqueName(parsed.projectId, parsed.name);
    const id = this.options.generateId();
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

    if (parsed.evaluatorId === null) {
      throw new MonitorEvaluatorRequiredError();
    }

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

  async deleteForExperiment(input: { projectId: string; experimentId: string }): Promise<void> {
    await this.options.repository.deleteForExperiment(input);
  }

  async upsertForExperiment(input: MonitorExperimentUpsertInput): Promise<Monitor> {
    const parsed = monitorExperimentUpsertInputSchema.parse(input);

    return this.options.repository.upsertForExperiment({
      ...parsed,
      // A monitor the experiment already owns keeps its id; the generator only
      // answers for the row this call may have to create.
      id: this.options.generateId(),
      mappings: monitorMappingsInputSchema.parse(parsed.mappings),
      executionMode: monitorExecutionModeSchema.parse(parsed.executionMode),
    });
  }

  async isNameAvailable(input: MonitorNameAvailabilityInput): Promise<{ available: boolean }> {
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
    const id = this.options.generateId();

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
