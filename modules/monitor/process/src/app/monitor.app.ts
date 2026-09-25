/**
 * The monitor feature's application layer; all business rules for monitors
 * live here.
 */
import { AuthzApi, type AuthzPermission } from "@langwatch/authz-contract";
import {
  EvaluationApi,
  type MonitorPerformanceQuery,
  type OnlineEvaluationPerformance,
} from "@langwatch/evaluation-contract";
import {
  AVAILABLE_EVALUATORS,
  EvaluatorApi,
  evaluatorsSchema,
  getEvaluatorDefinitions,
  type EvaluatorTypes,
} from "@langwatch/evaluator-contract";
import type { FeatureSetup } from "@langwatch/kernel";
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
  type MonitorUsageCount,
  type EnabledGuardrailMonitor,
  type MonitorSummary,
} from "@langwatch/monitor-contract";
import { nowInstant } from "@langwatch/time";

import type { MonitorRepositories } from "../repositories/monitor.repositories.ts";
import { monitorPlatformUrl } from "../rules/monitor-platform-url.rules.ts";
import { MonitorCatalogService } from "../services/monitor-catalog.service.ts";
import { MonitorService } from "../services/monitor.service.ts";
import { buildMonitorInfrastructure } from "./monitor-composition.build.ts";

/** The window the performance strip reports, and compares to the one before it. */
const PERFORMANCE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Copies an evaluator and its workflow into another project; owned by the
 * Evaluator feature.
 */
export interface MonitorReplicationReader {
  copyEvaluatorToProject(
    input: Readonly<{
      evaluatorId: string;
      sourceProjectId: string;
      targetProjectId: string;
      actor: Readonly<{ id: string }>;
    }>,
  ): Promise<Readonly<{ id: string; workflowId: string | null }>>;

  /** Removes a workflow the copy above created, when the monitor insert fails. */
  deleteReplicatedWorkflow(
    input: Readonly<{ workflowId: string; projectId: string }>,
  ): Promise<void>;
}

/** Technical ports the process supplies. Peer features arrive as API tokens. */
export interface MonitorAppInfrastructure {
  /** The evaluator a monitor runs, until `EvaluatorApi` publishes a lookup by id. */
  evaluators: MonitorEvaluator;
  /** The online-evaluation results the seven-day trend is folded from. */
  performance: MonitorPerformance;
  /** Copying an evaluator, and its workflow, into another project. */
  replication: MonitorReplicationReader;
  /** Mints the id a new monitor row is written under. */
  generateId: () => string;
  /** The deployment's public origin, for `platformUrl`. Optional: not every install serves REST. */
  publicBaseUrl?: string;
}

type MonitorSetup = FeatureSetup<
  typeof MonitorApp.dependencies,
  Readonly<{ monitor: MonitorAppInfrastructure | undefined }>,
  undefined,
  MonitorRepositories
>;

export class MonitorApp implements MonitorApi {
  static readonly contract = MonitorApi;
  static readonly dependencies = {
    permissions: AuthzApi,
    /** Evaluator service for the port and copy replication. */
    evaluators: EvaluatorApi,
    /** Seven-day trend, read through the evaluation application. */
    evaluation: EvaluationApi,
  };
  static readonly reads = ["monitor"] as const;

  #monitors: MonitorService;
  #usage: MonitorRepositories["monitors"];
  #catalogue: MonitorCatalogService;
  #permissions: AuthzApi;
  #performance: MonitorPerformance;
  #replication: MonitorReplicationReader;
  #evaluators: MonitorEvaluator;
  readonly #publicBaseUrl: string | undefined;

  private constructor(
    repositories: MonitorRepositories,
    dependencies: MonitorSetup["dependencies"],
    members: MonitorAppInfrastructure,
  ) {
    this.#monitors = MonitorService.create({
      repository: repositories.monitors,
      evaluators: members.evaluators,
      generateId: members.generateId,
    });
    this.#catalogue = MonitorCatalogService.create({ repository: repositories.monitors });
    this.#usage = repositories.monitors;
    this.#permissions = dependencies.permissions;
    this.#performance = members.performance;
    this.#replication = members.replication;
    this.#evaluators = members.evaluators;
    this.#publicBaseUrl = members.publicBaseUrl;
  }

  /**
   * Builds this process's own {@link MonitorAppInfrastructure} from its
   * evaluator/evaluation peers, then composes as {@link MonitorApp.fromInfrastructure}
   * does. Replaces apps/api's hand composition, deleted in b383462d96.
   */
  static create(setup: MonitorSetup): MonitorApp {
    const infrastructure =
      setup.members.monitor ??
      buildMonitorInfrastructure({
        evaluators: setup.dependencies.evaluators,
        evaluation: setup.dependencies.evaluation,
      });

    return MonitorApp.fromInfrastructure({
      infrastructure,
      dependencies: setup.dependencies,
      repositories: setup.repositories,
    });
  }

  /**
   * Composes over an already-built {@link MonitorAppInfrastructure}. Kept
   * because every unit test's fixture still builds one directly rather than
   * reading process members.
   */
  static fromInfrastructure(setup: {
    infrastructure: MonitorAppInfrastructure;
    dependencies: MonitorSetup["dependencies"];
    repositories: MonitorRepositories;
  }): MonitorApp {
    return new MonitorApp(setup.repositories, setup.dependencies, setup.infrastructure);
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
   * Refuses checks that cannot run. Built-in evaluators validated against their
   * schema; others just check type.
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

    const settings =
      evaluatorsSchema.shape[checkType as EvaluatorTypes].shape.settings.safeParse(parameters);
    if (!settings.success) throw new MonitorCheckSettingsInvalidError(checkType, settings.error);
  }

  create(input: MonitorCreateInput): Promise<Monitor> {
    return this.#monitors.create(input);
  }

  update(input: MonitorUpdateInput): Promise<Monitor> {
    return this.#monitors.update(input);
  }

  /**
   * Creates or replaces the monitor an experiment is published as. A wizard
   * experiment publishes to exactly one monitor, keyed by experiment id — so
   * "Save as monitor" pressed twice edits the same monitor, not a second one.
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
   * monitors, against the window before it. The window, each monitor's
   * guardrail flag, and the answer for a project with no monitors live here.
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
   * Replicates a monitor with its evaluator into another project; rolls back
   * both if the insert fails.
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

  getEnabledOnMessageMonitors(projectId: string): Promise<MonitorSummary[]> {
    return this.#catalogue.getEnabledOnMessageMonitors(projectId);
  }

  listEnabledGuardrailMonitors(
    input: MonitorEnabledGuardrailInput,
  ): Promise<EnabledGuardrailMonitor[]> {
    return this.#monitors.listEnabledGuardrailMonitors(input);
  }

  getAllByIds(input: { monitorIds: string[]; projectId: string }): Promise<Monitor[]> {
    return this.#monitors.getAllByIds(input);
  }

  deleteForExperiment(input: { projectId: string; experimentId: string }): Promise<void> {
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

  // ── the platform's own links ──────────────────────────────────────────────

  /**
   * The platform's own address for one monitor resource. A deployment that
   * serves this family but named no public origin refuses by name.
   */
  countUsage(input: { projectIds: readonly string[]; since?: number }): Promise<MonitorUsageCount> {
    return this.#usage.countUsage(input);
  }

  platformUrl(input: { projectSlug: string; path: string }): string {
    if (this.#publicBaseUrl === undefined) {
      throw new Error(
        "The monitors REST family was asked for a platform link, but this deployment named no public base URL",
      );
    }

    return monitorPlatformUrl({ publicBaseUrl: this.#publicBaseUrl, ...input });
  }
}

/**
 * The evaluator behind a monitor, as this feature reads it. A PORT until
 * EvaluatorApi grows a lookup-by-id capability.
 */
export interface MonitorEvaluator {
  /** Refuses by the evaluator feature's own error when the project has none. */
  getById(input: Readonly<{ id: string; projectId: string }>): Promise<unknown>;
  /** Rolls a copied evaluator back when the replicated monitor cannot be written. */
  archive(input: Readonly<{ id: string; projectId: string }>): Promise<unknown>;
}

export interface MonitorPerformance {
  getMonitorPerformance(query: MonitorPerformanceQuery): Promise<OnlineEvaluationPerformance[]>;

  /** The start of the window the trend compares against. */
  previousPeriodStartMs(
    range: Readonly<{ projectId: string; startMs: number; endMs: number }>,
  ): number;
}
