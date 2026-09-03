/**
 * The monitor feature's application: what both of its doors call.
 *
 * A monitor is answered over two transports — the wizard's tRPC procedures and
 * the `/api/monitors` REST family. They ask different questions in different
 * shapes, but every rule about a monitor lives here once. Before this, each
 * door declared its own bag of services and each decided for itself what a
 * missing monitor meant, what an unmentioned field on a partial update meant,
 * and whether a check was runnable at all — and the two answers had already
 * drifted.
 *
 * Transport-specific shaping stays in the doors: which status code a missing
 * monitor becomes, which fields go on the wire, which permission gates the
 * call. What a monitor IS, and what a write does to one, is here.
 */
import type {
  EvaluationService,
  OnlineEvaluationPerformance,
} from "@langwatch/evaluation-contract";
import {
  AVAILABLE_EVALUATORS,
  evaluatorsSchema,
  getEvaluatorDefinitions,
  type EvaluatorService,
  type EvaluatorTypes,
} from "@langwatch/evaluator-contract";
import {
  monitorSettingsSchema,
  type Monitor,
  type MonitorCreateInput,
  type MonitorExperimentUpsertInput,
  type MonitorIdInput,
  type MonitorNameAvailabilityInput,
  type MonitorService,
  type MonitorToggleInput,
  type MonitorUpdateInput,
  type MonitorWithEvaluator,
} from "@langwatch/monitor-contract";
import { ZodError } from "zod";

/** The window the performance strip reports, and compares to the one before it. */
const PERFORMANCE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Why a monitor's check cannot run, or `null` when it can.
 *
 * A decision rather than a throw: the two doors answer a refusal differently
 * on the wire, and neither may decide WHETHER it is a refusal. Returning the
 * reason lets each render its own error without owning the rule.
 */
export type MonitorCheckFailure =
  | Readonly<{ reason: "unknown_check_type" }>
  | Readonly<{ reason: "invalid_settings"; cause: ZodError }>;

/**
 * The fields a partial update may carry. Anything left out keeps the value the
 * monitor already has — the merge below is the one description of that rule.
 */
export type MonitorPatch = Readonly<{
  name?: string;
  enabled?: boolean;
  checkType?: string;
  executionMode?: MonitorUpdateInput["executionMode"];
  preconditions?: MonitorUpdateInput["preconditions"];
  parameters?: MonitorUpdateInput["parameters"];
  mappings?: unknown;
  sample?: number;
  evaluatorId?: string | null;
  level?: "trace" | "thread";
  threadIdleTimeout?: number | null;
}>;

/**
 * Copying a monitor's evaluator into another project, bound to one request.
 *
 * Both belong to other features, and the process resolves per-request state to
 * reach them, so they arrive as arguments to the one operation that needs them
 * rather than living on the application.
 */
export type MonitorReplicationPorts = Readonly<{
  /** Replicates an evaluator, and the workflow backing it, into another project. */
  copyEvaluatorToProject(
    input: Readonly<{ evaluatorId: string; sourceProjectId: string; targetProjectId: string }>,
  ): Promise<Readonly<{ id: string; workflowId: string | null }>>;
  /** Removes a workflow the copy above created, when the monitor insert fails. */
  deleteReplicatedWorkflow(
    input: Readonly<{ workflowId: string; projectId: string }>,
  ): Promise<void>;
}>;

/** What the process composes this feature's application from. */
export interface MonitorAppDependencies {
  monitors: MonitorService;
  /** Reads the online-evaluation results the performance strip renders. */
  evaluations: Pick<EvaluationService, "getMonitorPerformance">;
  /** Rolls back an evaluator a copy created, when the monitor insert fails. */
  evaluators: Pick<EvaluatorService, "archive">;
}

export class MonitorApp {
  static create(dependencies: MonitorAppDependencies): MonitorApp {
    return new MonitorApp(dependencies);
  }

  private constructor(private readonly dependencies: MonitorAppDependencies) {}

  /**
   * The service itself, for the process function that still takes it whole.
   *
   * The gateway's guardrail check (`server/gateway/guardrailEvaluation.service.ts`)
   * is not a monitor door: it resolves a virtual key's guardrails against the
   * monitors backing them while a request is in flight on the data plane, and
   * declares a `MonitorService` parameter. Until it moves, this getter is the
   * seam that remains — the same one `WorkflowApp.workflowService` keeps.
   */
  get monitorService(): MonitorService {
    return this.dependencies.monitors;
  }

  /** Every monitor configured on the project, with its evaluator. */
  list(input: Readonly<{ projectId: string }>): Promise<MonitorWithEvaluator[]> {
    return this.dependencies.monitors.getAllForProject(input);
  }

  /** One monitor. Throws `MonitorNotFoundError` when the project has none. */
  getById(input: MonitorIdInput): Promise<MonitorWithEvaluator> {
    return this.dependencies.monitors.getById(input);
  }

  /** One monitor, or `null`. The read behind every door's own not-found answer. */
  tryGetById(input: MonitorIdInput): Promise<MonitorWithEvaluator | null> {
    return this.dependencies.monitors.tryGetMonitorById(input);
  }

  /** Whether the wizard may still take this name. */
  isNameAvailable(input: MonitorNameAvailabilityInput): Promise<{ available: boolean }> {
    return this.dependencies.monitors.isNameAvailable(input);
  }

  /**
   * Why this check cannot run, or `null`.
   *
   * A monitor names the evaluator it runs, and a built-in evaluator's settings
   * have to match the schema that evaluator declares. Workflow, code and
   * custom evaluators carry their settings elsewhere, so only their type is
   * checked.
   *
   * Lives here because it is a statement about the monitor, not about the
   * request that arrived: a monitor whose `checkType` names nothing runnable is
   * a monitor that will never fire, however it was created.
   */
  checkFailure(
    input: Readonly<{ checkType: string; parameters: unknown }>,
  ): MonitorCheckFailure | null {
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
      return { reason: "unknown_check_type" };
    }

    if (isCustomEvaluator || isWorkflowEvaluator || isCodeEvaluator) return null;

    try {
      evaluatorsSchema.shape[checkType as EvaluatorTypes].shape.settings.parse(parameters);
      return null;
    } catch (error) {
      if (error instanceof ZodError) return { reason: "invalid_settings", cause: error };
      throw error;
    }
  }

  /** Adds a monitor to the project. */
  create(input: MonitorCreateInput): Promise<Monitor> {
    return this.dependencies.monitors.create(input);
  }

  /** Replaces a monitor's configuration in full. */
  update(input: MonitorUpdateInput): Promise<Monitor> {
    return this.dependencies.monitors.update(input);
  }

  /**
   * Creates or replaces the monitor an experiment is published as.
   *
   * A wizard experiment publishes to exactly one monitor, and the experiment id
   * is what identifies it — so "Save as monitor" pressed a second time edits the
   * monitor the first press created rather than adding another one beside it.
   */
  upsertForExperiment(input: MonitorExperimentUpsertInput): Promise<Monitor> {
    return this.dependencies.monitors.upsertForExperiment(input);
  }

  /**
   * Applies a partial change to a monitor, keeping every field the caller did
   * not mention.
   *
   * @returns the updated monitor, or `null` when the project has no such
   * monitor — the doors turn that into their own not-found answer.
   */
  async patch(
    input: Readonly<{ id: string; projectId: string; changes: MonitorPatch }>,
  ): Promise<Monitor | null> {
    const { id, projectId, changes } = input;
    const existing = await this.tryGetById({ id, projectId });
    if (!existing) return null;

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

  /** Enables or disables a monitor. */
  toggle(input: MonitorToggleInput): Promise<{ success: true }> {
    return this.dependencies.monitors.toggle(input);
  }

  /**
   * Enables or disables a monitor the project actually has.
   *
   * @returns false when it has none, which is what a door turns into 404.
   */
  async toggleExisting(input: MonitorToggleInput): Promise<boolean> {
    const existing = await this.tryGetById({ id: input.id, projectId: input.projectId });
    if (!existing) return false;
    await this.toggle(input);
    return true;
  }

  /** Removes a monitor from the project. */
  delete(input: MonitorIdInput): Promise<{ success: true }> {
    return this.dependencies.monitors.delete(input);
  }

  /**
   * Removes a monitor the project actually has.
   *
   * @returns false when it has none, which is what a door turns into 404.
   */
  async deleteExisting(input: MonitorIdInput): Promise<boolean> {
    const existing = await this.tryGetById(input);
    if (!existing) return false;
    await this.delete(input);
    return true;
  }

  /**
   * The last seven days of score and pass-rate for each of the project's
   * monitors, against the window before it.
   *
   * The window, the guardrail flag each monitor carries into the query, and
   * the short answer for a project with no monitors are all decided here. The
   * start of the comparison window is the analytics page's own, so the trend
   * covers the exact runs a user sees when they open analytics — the process
   * supplies it because it is the analytics vertical's answer, not the
   * monitor's.
   */
  async performanceForProject(
    input: Readonly<{ projectId: string; timeZone?: string }>,
    resolvePreviousPeriodStartMs: (
      range: Readonly<{ projectId: string; startMs: number; endMs: number }>,
    ) => number,
  ): Promise<OnlineEvaluationPerformance[]> {
    const monitors = await this.list({ projectId: input.projectId });
    if (monitors.length === 0) return [];

    const endMs = Date.now();
    const currentStartMs = endMs - PERFORMANCE_PERIOD_MS;

    return this.dependencies.evaluations.getMonitorPerformance({
      tenantId: input.projectId,
      monitors: monitors.map((monitor) => ({
        id: monitor.id,
        isGuardrail: getEvaluatorDefinitions(monitor.checkType)?.isGuardrail ?? false,
      })),
      previousStartMs: resolvePreviousPeriodStartMs({
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
   * When the monitor insert then fails, the evaluator and the workflow this
   * copy created are rolled back. That rollback is the reason this lives on
   * the application: it is a statement about what the two projects hold, and a
   * second door writing its own copy of it would be a second chance to leave
   * an orphan behind.
   */
  async copy(
    input: Readonly<{ monitorId: string; sourceProjectId: string; targetProjectId: string }>,
    replication: MonitorReplicationPorts,
  ): Promise<Monitor> {
    const { monitorId, sourceProjectId, targetProjectId } = input;
    const source = await this.getById({ id: monitorId, projectId: sourceProjectId });

    let newEvaluatorId: string | null = null;
    let newWorkflowId: string | null = null;
    if (source.evaluatorId) {
      const copiedEvaluator = await replication.copyEvaluatorToProject({
        evaluatorId: source.evaluatorId,
        sourceProjectId,
        targetProjectId,
      });
      newEvaluatorId = copiedEvaluator.id;
      newWorkflowId = copiedEvaluator.workflowId;
    }

    try {
      // Replicas start disabled: a real-time evaluator runs (and bills) on
      // every matching trace, so the user opts in after reviewing it in the
      // target project rather than having it fire the moment it is replicated.
      return await this.dependencies.monitors.replicate({
        sourceMonitorId: monitorId,
        sourceProjectId,
        targetProjectId,
        evaluatorId: newEvaluatorId,
      });
    } catch (createError) {
      if (newEvaluatorId) {
        await this.dependencies.evaluators
          .archive({ id: newEvaluatorId, projectId: targetProjectId })
          .catch(() => undefined);
      }
      if (newWorkflowId) {
        await replication
          .deleteReplicatedWorkflow({ workflowId: newWorkflowId, projectId: targetProjectId })
          .catch(() => undefined);
      }
      throw createError;
    }
  }
}
