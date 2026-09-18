import {
  MonitorEvaluatorRequiredError,
  MonitorNotFoundError,
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
  type MonitorToggleInput,
  type MonitorUpdateInput,
  type MonitorWithEvaluator,
} from "@langwatch/monitor-contract";
import type { MonitorEvaluator } from "../app/monitor.app.ts";
import type { MonitorRepository } from "../repositories/monitor.repository.ts";

export type MonitorServiceOptions = {
  repository: MonitorRepository;
  evaluators: MonitorEvaluator;
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

/** Everything a monitor row is written and read through. */
export class MonitorService {
  static create(options: MonitorServiceOptions): MonitorService {
    return new MonitorService(options);
  }

  private constructor(private readonly options: MonitorServiceOptions) {}

  getAllForProject(input: { projectId: string }): Promise<MonitorWithEvaluator[]> {
    return this.options.repository.findAll(input);
  }

  async listEnabledGuardrailMonitors(
    input: MonitorEnabledGuardrailInput,
  ): Promise<EnabledGuardrailMonitor[]> {
    return this.options.repository.findEnabledGuardrails(
      monitorEnabledGuardrailInputSchema.parse(input),
    );
  }

  async getById(input: MonitorIdInput): Promise<MonitorWithEvaluator> {
    const parsed = monitorIdInputSchema.parse(input);
    const monitor = await this.options.repository.findById(parsed);

    if (!monitor) throw new MonitorNotFoundError(parsed.id);

    return monitor;
  }

  async findById(input: MonitorIdInput): Promise<MonitorWithEvaluator | undefined> {
    return this.options.repository.findById(monitorIdInputSchema.parse(input));
  }

  getAllByIds(input: { monitorIds: string[]; projectId: string }): Promise<Monitor[]> {
    return this.options.repository.findAllByIds(input);
  }

  async toggle(input: MonitorToggleInput): Promise<{ success: true }> {
    await this.options.repository.setEnabled(monitorToggleInputSchema.parse(input));

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
    const id = this.options.generateId();

    return this.options.repository.create({
      ...parsed,
      id,
      name,
      slug: `${slugify(name)}-${id.slice(-5)}`,
      mappings: monitorMappingsInputSchema.parse(parsed.mappings),
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

    return this.options.repository.update({
      ...parsed,
      slug: slugify(parsed.name),
      mappings: monitorMappingsInputSchema.parse(parsed.mappings),
    });
  }

  async delete(input: MonitorIdInput): Promise<{ success: true }> {
    await this.options.repository.delete(monitorIdInputSchema.parse(input));

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
    const holder = await this.options.repository.findIdByName(parsed);

    return { available: holder === undefined || holder === parsed.checkId };
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

    // Replicas start disabled: a real-time evaluator runs (and bills) on every
    // matching trace, so the reader opts in after reviewing it in the target
    // project rather than having it fire the moment it is replicated.
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
    if (await this.isFree(projectId, baseName)) return baseName;

    let suffix = 2;

    while (!(await this.isFree(projectId, `${baseName} (${suffix})`))) {
      suffix += 1;
    }

    return `${baseName} (${suffix})`;
  }

  private async isFree(projectId: string, name: string): Promise<boolean> {
    return (await this.options.repository.findIdByName({ projectId, name })) === undefined;
  }
}
