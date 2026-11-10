/**
 * The concurrency a run starts with: the one it names, else a share of the cell budgets split
 * between the active runs, else the fixed EVAL_V3_CONCURRENCY. Spec:
 * specs/experiment-run-dynamic-concurrency.feature.
 */
import type { ExperimentServerConfig } from "@langwatch/experiment-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { ExperimentRunActivityRepository } from "../../../repositories/experiment-run-activity.repository.ts";
import {
  dynamicRunConcurrency,
  EXPERIMENT_RUN_ACTIVITY_WINDOW_MS,
} from "../rules/experiment-run-concurrency.rules.ts";

type ExperimentRunConcurrencyDeps = Readonly<{
  activity: ExperimentRunActivityRepository;
  config: Pick<ExperimentServerConfig, "runConcurrency"> &
    Partial<Pick<ExperimentServerConfig, "projectCellBudget" | "globalCellBudget">>;
  now?: () => number;
  logger?: Logger;
}>;

export class ExperimentRunConcurrencyService {
  static create(deps: ExperimentRunConcurrencyDeps): ExperimentRunConcurrencyService {
    return new ExperimentRunConcurrencyService(deps);
  }

  private readonly now: () => number;
  private readonly logger: Logger;

  private constructor(private readonly deps: ExperimentRunConcurrencyDeps) {
    this.now = deps.now ?? (() => nowInstant().epochMilliseconds);
    this.logger = deps.logger ?? createLogger("langwatch:experiment:run-concurrency");
  }

  /** Whether the default is shared between active runs, which only a project budget turns on. */
  get isDynamic(): boolean {
    return this.deps.config.projectCellBudget !== undefined;
  }

  /**
   * The concurrency a run starts with, computed once; the requested one wins. Where the default is
   * dynamic the run is claimed active in the same step, pinned or not, since it holds cells too.
   */
  async resolve({
    projectId,
    runId,
    requested,
  }: {
    projectId: string;
    runId: string;
    requested?: number | undefined;
  }): Promise<number> {
    const { runConcurrency, projectCellBudget, globalCellBudget } = this.deps.config;
    if (projectCellBudget === undefined) return requested ?? runConcurrency;
    const fallback = requested ?? runConcurrency;
    try {
      const now = this.now();
      const others = await this.deps.activity.claim({
        projectId,
        runId,
        now,
        expiresAt: now + EXPERIMENT_RUN_ACTIVITY_WINDOW_MS,
      });
      if (requested !== undefined) return requested;
      return dynamicRunConcurrency({
        projectActiveRuns: others.project,
        globalActiveRuns: others.global,
        projectBudget: projectCellBudget,
        globalBudget: globalCellBudget,
      });
    } catch (error) {
      this.logger.warn(
        { projectId, error, fallback },
        "active experiment runs could not be read; using the fixed default concurrency",
      );
      return fallback;
    }
  }

  /** Counts a started run as active for the activity window, where the default is dynamic. */
  async recordStarted({
    projectId,
    runId,
    startedAt,
  }: {
    projectId: string;
    runId: string;
    startedAt: number;
  }): Promise<void> {
    if (!this.isDynamic) return;
    await this.deps.activity.markActive({
      projectId,
      runId,
      expiresAt: startedAt + EXPERIMENT_RUN_ACTIVITY_WINDOW_MS,
    });
  }

  /** Stops counting a run once it completed, however it ended. */
  async recordCompleted({ projectId, runId }: { projectId: string; runId: string }): Promise<void> {
    if (!this.isDynamic) return;
    await this.deps.activity.markInactive({ projectId, runId });
  }
}
