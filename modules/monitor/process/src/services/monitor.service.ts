import { isDeepStrictEqual } from "node:util";

import { resolveEvaluatorEffectiveSettings } from "@langwatch/evaluation-contract";
import type { Evaluator, EvaluatorApi } from "@langwatch/evaluator-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import {
  MonitorEvaluatorRequiredError,
  MonitorNotFoundError,
  MonitorParametersUnusedError,
  monitorCreateInputSchema,
  monitorEnabledGuardrailInputSchema,
  monitorExecutionModeSchema,
  monitorExperimentUpsertInputSchema,
  monitorIdInputSchema,
  monitorMappingsInputSchema,
  monitorNameAvailabilityInputSchema,
  monitorSettingsSchema,
  monitorReplicationInputSchema,
  monitorToggleInputSchema,
  monitorUpdateInputSchema,
  enabledGuardrailMonitorSchema,
  type EnabledGuardrailMonitor,
  type Monitor,
  type MonitorCreateInput,
  type MonitorEnabledGuardrailInput,
  type MonitorExperimentUpsertInput,
  type MonitorIdInput,
  type MonitorNameAvailabilityInput,
  type MonitorPatchInput,
  type MonitorReplicationInput,
  type MonitorToggleInput,
  type MonitorUpdateInput,
  type MonitorWithEvaluator,
} from "@langwatch/monitor-contract";
import { createLogger } from "@langwatch/observability";
import type { UserApi } from "@langwatch/user-contract";

import type { MonitorRepository } from "../repositories/monitor.repository.ts";

type MonitorServiceOptions = {
  repository: MonitorRepository;
  evaluators: Pick<EvaluatorApi, "getById" | "findById" | "atLabelOrLatest">;
  featureFlags: Pick<FeatureFlagApi, "isEnabled">;
  users: Pick<UserApi, "getProfiles">;
  generateId: () => string;
};

const logger = createLogger("langwatch:monitor:service");

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

  async getAllForProject(input: { projectId: string }): Promise<MonitorWithEvaluator[]> {
    return this.withPeople(await this.options.repository.findAll(input));
  }

  async findByEvaluator(input: {
    projectId: string;
    evaluatorId: string;
  }): Promise<{ id: string; name: string }[]> {
    const monitors = await this.options.repository.findAll({ projectId: input.projectId });

    return monitors
      .filter((monitor) => monitor.evaluatorId === input.evaluatorId)
      .map(({ id, name }) => ({ id, name }));
  }

  async listEnabledGuardrailMonitors(
    input: MonitorEnabledGuardrailInput,
  ): Promise<EnabledGuardrailMonitor[]> {
    const parsed = monitorEnabledGuardrailInputSchema.parse(input);
    const monitors = await this.options.repository.findEnabledGuardrails(parsed);
    return Promise.all(
      monitors.map((monitor) => this.guardrailAtLabel({ monitor, projectId: parsed.projectId })),
    );
  }

  /** A guardrail pinned to a label runs the evaluator's settings at it, or the latest when gone. */
  private async guardrailAtLabel({
    monitor,
    projectId,
  }: {
    monitor: EnabledGuardrailMonitor;
    projectId: string;
  }): Promise<EnabledGuardrailMonitor> {
    if (!monitor.evaluatorLabel) return monitor;
    const latest = await this.options.evaluators.findById({ id: monitor.evaluatorId, projectId });
    if (!latest) return monitor;
    const evaluator = await this.options.evaluators.atLabelOrLatest({
      evaluator: latest,
      label: monitor.evaluatorLabel,
    });
    const { config } = evaluator;
    const record =
      config !== null && typeof config === "object" && !Array.isArray(config) ? config : null;
    const parameters =
      monitor.parameters !== null &&
      typeof monitor.parameters === "object" &&
      !Array.isArray(monitor.parameters)
        ? monitor.parameters
        : null;
    const { settings } = resolveEvaluatorEffectiveSettings({
      config: record,
      parameters,
      evaluatorRecordType: evaluator.type,
      recoveryDisabled: await this.readRecoveryDisabled(),
    });
    return enabledGuardrailMonitorSchema.parse({
      ...monitor,
      checkType:
        typeof record?.evaluatorType === "string" ? record.evaluatorType : monitor.checkType,
      parameters: settings ?? monitor.parameters,
    });
  }

  async getById(input: MonitorIdInput): Promise<MonitorWithEvaluator> {
    const parsed = monitorIdInputSchema.parse(input);
    const monitor = await this.options.repository.findById(parsed);

    if (!monitor) throw new MonitorNotFoundError(parsed.id);

    return this.readable(monitor);
  }

  async findById(input: MonitorIdInput): Promise<MonitorWithEvaluator | undefined> {
    const monitor = await this.options.repository.findById(monitorIdInputSchema.parse(input));
    return monitor ? this.readable(monitor) : undefined;
  }

  async findBySlug(input: { projectId: string; slug: string }): Promise<MonitorWithEvaluator[]> {
    const monitors = await this.options.repository.findBySlug(input);
    return Promise.all(monitors.map((monitor) => this.readable(monitor)));
  }

  /** The monitor as it runs: its evaluator at the pinned label, and who wrote it. */
  private async readable(monitor: MonitorWithEvaluator): Promise<MonitorWithEvaluator> {
    const [named = monitor] = await this.withPeople([monitor]);
    if (!named.evaluator || !named.evaluatorLabel) return named;
    const evaluator = await this.options.evaluators.atLabelOrLatest({
      evaluator: named.evaluator,
      label: named.evaluatorLabel,
    });
    return { ...named, evaluator };
  }

  /** Fills `createdBy` and `updatedBy`; a monitor with no recorded creator keeps null. */
  private async withPeople<T extends Monitor>(monitors: T[]): Promise<T[]> {
    const ids = [...new Set(monitors.flatMap((row) => [row.createdById, row.updatedById]))].filter(
      (id): id is string => typeof id === "string",
    );
    const profiles = ids.length ? await this.options.users.getProfiles({ userIds: ids }) : [];
    const people = new Map(
      profiles.map((user) => [user.id, { id: user.id, name: user.name ?? user.email }]),
    );
    const person = (id: string | null | undefined) => (id ? (people.get(id) ?? null) : null);
    return monitors.map((row) => ({
      ...row,
      createdBy: person(row.createdById),
      updatedBy: person(row.updatedById),
    }));
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

    const evaluator = await this.options.evaluators.getById({
      id: parsed.evaluatorId,
      projectId: parsed.projectId,
    });
    await this.assertParametersWillRun({ evaluator, parameters: parsed.parameters });

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

  /**
   * Checks a patch against the evaluator the monitor runs with afterwards: the
   * one it moves to, else its own when the patch names parameters. A move
   * re-checks the stored parameters too.
   */
  async assertPatchParametersWillRun(input: {
    existing: MonitorWithEvaluator;
    changes: MonitorPatchInput["changes"];
  }): Promise<void> {
    const { existing, changes } = input;
    // Clearing the evaluator is refused by the update itself, ahead of any parameters.
    if (changes.evaluatorId === null) return;
    const scope = { projectId: existing.projectId };
    let evaluator: Evaluator | undefined;

    if (changes.evaluatorId) {
      evaluator = await this.options.evaluators.getById({ ...scope, id: changes.evaluatorId });
    } else if (changes.parameters !== undefined && existing.evaluatorId) {
      evaluator = await this.options.evaluators.findById({ ...scope, id: existing.evaluatorId });
    }
    if (!evaluator) return;

    const stored = monitorSettingsSchema.safeParse(existing.parameters);
    await this.assertParametersWillRun({
      evaluator,
      parameters: changes.parameters ?? (stored.success ? stored.data : undefined),
    });
  }

  /**
   * Refuses `parameters` the run would never read: the runner hands the judge
   * the evaluator's own settings whenever it has some, so parameters that
   * disagree with them would read back as the configuration while never running.
   */
  private async assertParametersWillRun(input: {
    evaluator: Pick<Evaluator, "id" | "type" | "config">;
    parameters: Record<string, unknown> | undefined;
  }): Promise<void> {
    const { evaluator, parameters } = input;
    if (!parameters || Object.keys(parameters).length === 0) return;

    const { config } = evaluator;
    const { settings, source } = resolveEvaluatorEffectiveSettings({
      config:
        config !== null && typeof config === "object" && !Array.isArray(config) ? config : null,
      parameters,
      evaluatorRecordType: evaluator.type,
      recoveryDisabled: await this.readRecoveryDisabled(),
    });
    if (source === "monitor-parameters" || isDeepStrictEqual(settings, parameters)) return;

    throw new MonitorParametersUnusedError(evaluator.id);
  }

  /** The operator's rollback switch; unreadable leaves recovery active, as the runner does. */
  private async readRecoveryDisabled(): Promise<boolean> {
    try {
      return await this.options.featureFlags.isEnabled("ops_evaluator_settings_recovery_disabled", {
        kind: "system",
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Settings-recovery rollback flag could not be read, leaving recovery active",
      );

      return false;
    }
  }

  async delete(input: MonitorIdInput): Promise<{ success: true }> {
    await this.options.repository.delete(monitorIdInputSchema.parse(input));

    return { success: true };
  }

  async deleteForExperiment(input: { projectId: string; experimentId: string }): Promise<void> {
    await this.options.repository.deleteForExperiment(input);
  }

  /** Removes the monitors still running a deleted evaluator; a rerun finds none left. */
  async deleteByEvaluator(input: { projectId: string; evaluatorId: string }): Promise<void> {
    const monitors = await this.findByEvaluator(input);
    for (const monitor of monitors) {
      await this.options.repository.delete({ id: monitor.id, projectId: input.projectId });
    }
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
      // Deploy labels stay with the source evaluator; the copy runs the latest.
      evaluatorLabel: null,
      createdById: parsed.actorId ?? null,
      updatedById: parsed.actorId ?? null,
      createdBy: undefined,
      updatedBy: undefined,
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
