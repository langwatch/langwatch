/**
 * The monitor feature's application: what both of its doors call.
 *
 * A monitor is answered over two transports — the wizard's tRPC procedures and
 * the `/api/monitors` REST family. They ask different questions in different
 * shapes, but every rule about a monitor lives here once: what a missing
 * monitor means, what an unmentioned field on a partial update means, whether a
 * check is runnable at all, and what copying one does to two projects.
 *
 * Transport-specific shaping stays in the doors: which fields go on the wire,
 * which status a refusal renders as. What a monitor IS, and what a write does
 * to one, is here.
 */
import { AuthzApi, type AuthzPermission } from "@langwatch/authz-contract";
import type { OnlineEvaluationPerformance } from "@langwatch/evaluation-contract";
import {
  AVAILABLE_EVALUATORS,
  evaluatorsSchema,
  getEvaluatorDefinitions,
  type EvaluatorTypes,
} from "@langwatch/evaluator-contract";
import {
  MonitorApi,
  MonitorCheckSettingsInvalidError,
  MonitorCheckTypeUnknownError,
  MonitorSourceProjectForbiddenError,
  monitorSettingsSchema,
  type Monitor,
  type MonitorCopyInput,
  type MonitorCreateInput,
  type MonitorEnabledGuardrailInput,
  type MonitorExperimentUpsertInput,
  type MonitorIdInput,
  type MonitorNameAvailabilityInput,
  type MonitorPatchInput,
  type MonitorPerformanceInput,
  type MonitorReplicationInput,
  type MonitorRunnableCheckInput,
  type MonitorToggleInput,
  type MonitorUpdateInput,
  type MonitorWithEvaluator,
} from "@langwatch/monitor-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { nowInstant } from "@langwatch/time";
import { ZodError } from "zod";

import type { MonitorEvaluatorPort } from "../ports/monitor-evaluator.port.ts";
import type { MonitorPerformancePort } from "../ports/monitor-performance.port.ts";
import type { MonitorReplicationPort } from "../ports/monitor-replication.port.ts";
import type { MonitorRepositories } from "../repositories/monitor.repositories.ts";
import { MonitorCatalogService } from "../services/monitor-catalog.service.ts";
import { MonitorService } from "../services/monitor.service.ts";

/** The window the performance strip reports, and compares to the one before it. */
const PERFORMANCE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

/** Technical ports the process supplies. Peer features arrive as API tokens. */
export interface MonitorAppInfrastructure {
  /** The evaluator a monitor runs, until `EvaluatorApi` publishes a lookup by id. */
  evaluators: MonitorEvaluatorPort;
  /** The online-evaluation results the seven-day trend is folded from. */
  performance: MonitorPerformancePort;
  /** Copying an evaluator, and its workflow, into another project. */
  replication: MonitorReplicationPort;
  /** Mints the id a new monitor row is written under. */
  generateId: () => string;
}

type MonitorSetup = FeatureSetup<
  typeof MonitorApp.dependencies,
  MonitorAppInfrastructure,
  undefined,
  MonitorRepositories
>;

export class MonitorApp implements MonitorApi {
  static readonly contract = MonitorApi;
  static readonly dependencies = { permissions: AuthzApi };

  #monitors: MonitorService;
  #catalogue: MonitorCatalogService;
  #permissions: AuthzApi;
  #performance: MonitorPerformancePort;
  #replication: MonitorReplicationPort;
  #evaluators: MonitorEvaluatorPort;

  private constructor(
    repositories: MonitorRepositories,
    dependencies: MonitorSetup["dependencies"],
    infrastructure: MonitorAppInfrastructure,
  ) {
    this.#monitors = MonitorService.create({
      repository: repositories.monitors,
      evaluators: infrastructure.evaluators,
      generateId: infrastructure.generateId,
    });
    this.#catalogue = MonitorCatalogService.create({ repository: repositories.monitors });
    this.#permissions = dependencies.permissions;
    this.#performance = infrastructure.performance;
    this.#replication = infrastructure.replication;
    this.#evaluators = infrastructure.evaluators;
  }

  static create({ repositories, dependencies, infrastructure }: MonitorSetup): MonitorApp {
    return new MonitorApp(repositories, dependencies, infrastructure);
  }

  list(input: Readonly<{ projectId: string }>): Promise<MonitorWithEvaluator[]> {
    return this.#monitors.getAllForProject(input);
  }

  getById(input: MonitorIdInput): Promise<MonitorWithEvaluator> {
    return this.#monitors.getById(input);
  }

  findById(input: MonitorIdInput): Promise<MonitorWithEvaluator | undefined> {
    return this.#monitors.findById(input);
  }

  isNameAvailable(input: MonitorNameAvailabilityInput): Promise<{ available: boolean }> {
    return this.#monitors.isNameAvailable(input);
  }

  /**
   * Refuses a check that cannot run, by name.
   *
   * A monitor names the evaluator it runs, and a built-in evaluator's settings
   * have to match the schema that evaluator declares. Workflow, code and custom
   * evaluators carry their settings elsewhere, so only their type is checked.
   *
   * Here rather than in a door because it is a statement about the monitor, not
   * about the request that arrived: a monitor whose `checkType` names nothing
   * runnable is a monitor that will never fire, however it was created.
   */
  async assertCheckRunnable(input: MonitorRunnableCheckInput): Promise<void> {
    const { checkType, parameters } = input;
    const isWorkflowEvaluator = checkType === "workflow";
    const isCodeEvaluator = checkType.startsWith("code/");
    const isCustomEvaluator = checkType.startsWith("custom/");

    if (
      AVAILABLE_EVALUATORS[checkType as EvaluatorTypes] === undefined &&
      !isCustomEvaluator &&
      !isWorkflowEvaluator &&
      !isCodeEvaluator
    ) {
      throw new MonitorCheckTypeUnknownError(checkType);
    }

    if (isCustomEvaluator || isWorkflowEvaluator || isCodeEvaluator) return;

    try {
      evaluatorsSchema.shape[checkType as EvaluatorTypes].shape.settings.parse(parameters);
    } catch (error) {
      if (error instanceof ZodError) throw new MonitorCheckSettingsInvalidError(checkType, error);
      throw error;
    }
  }

  create(input: MonitorCreateInput): Promise<Monitor> {
    return this.#monitors.create(input);
  }

  update(input: MonitorUpdateInput): Promise<Monitor> {
    return this.#monitors.update(input);
  }

  /**
   * Creates or replaces the monitor an experiment is published as.
   *
   * A wizard experiment publishes to exactly one monitor, and the experiment id
   * is what identifies it — so "Save as monitor" pressed a second time edits the
   * monitor the first press created rather than adding another one beside it.
   */
  upsertForExperiment(input: MonitorExperimentUpsertInput): Promise<Monitor> {
    return this.#monitors.upsertForExperiment(input);
  }

  /** Applies a partial change, keeping every field the caller did not mention. */
  async patch(input: MonitorPatchInput): Promise<Monitor> {
    const { id, projectId, changes } = input;
    const existing = await this.#monitors.getById({ id, projectId });

    // Settings that no longer parse against their evaluator's schema are
    // replaced with an empty object rather than carried forward, so a monitor
    // whose evaluator changed shape does not fail every later edit.
    const existingParameters = monitorSettingsSchema.safeParse(existing.parameters);

    return this.update({
      id,
      projectId,
      name: changes.name ?? existing.name,
      checkType: changes.checkType ?? existing.checkType,
      executionMode: changes.executionMode ?? existing.executionMode,
      preconditions: changes.preconditions ?? existing.preconditions,
      parameters: changes.parameters ?? (existingParameters.success ? existingParameters.data : {}),
      mappings: changes.mappings !== undefined ? changes.mappings : existing.mappings,
      sample: changes.sample ?? existing.sample,
      enabled: changes.enabled,
      evaluatorId: changes.evaluatorId,
      level: changes.level ?? (existing.level as "trace" | "thread"),
      threadIdleTimeout:
        changes.threadIdleTimeout !== undefined
          ? changes.threadIdleTimeout
          : existing.threadIdleTimeout,
    });
  }

  /** Enables or disables a monitor the project actually has. */
  async toggle(input: MonitorToggleInput): Promise<{ success: true }> {
    await this.#monitors.getById({ id: input.id, projectId: input.projectId });

    return this.#monitors.toggle(input);
  }

  /** Removes a monitor the project actually has. */
  async delete(input: MonitorIdInput): Promise<{ success: true }> {
    await this.#monitors.getById(input);

    return this.#monitors.delete(input);
  }

  /**
   * The last seven days of score and pass-rate for each of the project's
   * monitors, against the window before it.
   *
   * The window, the guardrail flag each monitor carries into the query, and the
   * short answer for a project with no monitors are all decided here.
   */
  async performanceForProject(
    input: MonitorPerformanceInput,
  ): Promise<OnlineEvaluationPerformance[]> {
    const monitors = await this.list({ projectId: input.projectId });
    if (monitors.length === 0) return [];

    const endMs = nowInstant().epochMilliseconds;
    const currentStartMs = endMs - PERFORMANCE_PERIOD_MS;

    return this.#performance.getMonitorPerformance({
      tenantId: input.projectId,
      monitors: monitors.map((monitor) => ({
        id: monitor.id,
        isGuardrail: getEvaluatorDefinitions(monitor.checkType)?.isGuardrail ?? false,
      })),
      previousStartMs: this.#performance.previousPeriodStartMs({
        projectId: input.projectId,
        startMs: currentStartMs,
        endMs,
      }),
      currentStartMs,
      endMs,
      timeZone: input.timeZone ?? "UTC",
    });
  }

  /**
   * Replicates a monitor into another project, carrying its evaluator with it.
   *
   * An evaluator-backed monitor keeps its settings (and, for a workflow
   * evaluator, the backing workflow) on a separate record scoped to the source
   * project, so the evaluator is copied first and the replica points at the
   * copy. A legacy wizard monitor has no evaluator — its settings live inline,
   * so replicating the monitor is the whole job.
   *
   * When the monitor insert then fails, the evaluator and the workflow this copy
   * created are rolled back. That rollback is the reason this lives on the
   * application: it is a statement about what the two projects hold, and a
   * second door writing its own copy of it would be a second chance to leave an
   * orphan behind.
   */
  async copy(input: MonitorCopyInput): Promise<Monitor> {
    const { monitorId, sourceProjectId, targetProjectId, actor } = input;

    // The declared check covers the project being copied INTO. Standing in the
    // project copied FROM is a second question, and only the caller's own
    // grants there can answer it.
    await this.#assertMayManage({ actor, projectId: sourceProjectId });

    const source = await this.getById({ id: monitorId, projectId: sourceProjectId });

    let newEvaluatorId: string | null = null;
    let newWorkflowId: string | null = null;

    if (source.evaluatorId) {
      const copied = await this.#replication.copyEvaluatorToProject({
        evaluatorId: source.evaluatorId,
        sourceProjectId,
        targetProjectId,
        actor,
      });
      newEvaluatorId = copied.id;
      newWorkflowId = copied.workflowId;
    }

    try {
      return await this.replicate({
        sourceMonitorId: monitorId,
        sourceProjectId,
        targetProjectId,
        evaluatorId: newEvaluatorId,
      });
    } catch (createError) {
      await this.#rollback({ newEvaluatorId, newWorkflowId, targetProjectId });
      throw createError;
    }
  }

  replicate(input: MonitorReplicationInput): Promise<Monitor> {
    return this.#monitors.replicate(input);
  }

  getEnabledOnMessageMonitors(projectId: string) {
    return this.#catalogue.getEnabledOnMessageMonitors(projectId);
  }

  listEnabledGuardrailMonitors(input: MonitorEnabledGuardrailInput) {
    return this.#monitors.listEnabledGuardrailMonitors(input);
  }

  getAllByIds(input: { monitorIds: string[]; projectId: string }) {
    return this.#monitors.getAllByIds(input);
  }

  deleteForExperiment(input: { projectId: string; experimentId: string }) {
    return this.#monitors.deleteForExperiment(input);
  }

  /** Standing in the project a monitor is copied FROM, which is the caller's own. */
  async #assertMayManage(
    input: Readonly<{ actor: Readonly<{ id: string }>; projectId: string }>,
  ): Promise<void> {
    const permitted = await this.#holds(input.actor, input.projectId, "evaluations:manage");

    if (!permitted) throw new MonitorSourceProjectForbiddenError(input.projectId);
  }

  #holds(
    actor: Readonly<{ id: string }>,
    projectId: string,
    permission: AuthzPermission,
  ): Promise<boolean> {
    return this.#permissions.hasProjectPermission({ userId: actor.id, projectId, permission });
  }

  /** Undoes the copies made for a replica the monitor insert then refused. */
  async #rollback(
    input: Readonly<{
      newEvaluatorId: string | null;
      newWorkflowId: string | null;
      targetProjectId: string;
    }>,
  ): Promise<void> {
    if (input.newEvaluatorId) {
      await this.#evaluators
        .archive({ id: input.newEvaluatorId, projectId: input.targetProjectId })
        .catch(() => undefined);
    }

    if (input.newWorkflowId) {
      await this.#replication
        .deleteReplicatedWorkflow({
          workflowId: input.newWorkflowId,
          projectId: input.targetProjectId,
        })
        .catch(() => undefined);
    }
  }
}
