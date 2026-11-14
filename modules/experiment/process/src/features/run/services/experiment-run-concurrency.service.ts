/**
 * The concurrency a run starts with: the one it names, else a share of the cell budgets split
 * between the active runs; EVAL_V3_CONCURRENCY only when active runs can't be read. Spec:
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
  config: Pick<ExperimentServerConfig, "runConcurrency" | "projectCellBudget"> &
    Partial<Pick<ExperimentServerConfig, "globalCellBudget">>;
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

  /**
   * The concurrency a run starts with, computed once; the requested one wins. The run is claimed
   * active in the same step, pinned or not, since it holds cells too.
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

  /** Resolves the run's concurrency and starts it, giving the claim back when the start throws. */
  async startClaimed(
    claim: { projectId: string; runId: string; requested?: number | undefined },
    start: (concurrency: number) => Promise<void>,
  ): Promise<void> {
    const concurrency = await this.resolve(claim);
    try {
      await start(concurrency);
    } catch (error) {
      await this.release(claim);
      throw error;
    }
  }

  /** Gives back a claim whose run never started; a failed release only logs, the claim expires. */
  async release({ projectId, runId }: { projectId: string; runId: string }): Promise<void> {
    try {
      await this.deps.activity.markInactive({ projectId, runId });
    } catch (error) {
      this.logger.warn(
        { projectId, runId, error },
        "an unstarted run's claim could not be released",
      );
    }
  }

  /** Counts a started run as active for the activity window. */
  async recordStarted({
    projectId,
    runId,
    startedAt,
  }: {
    projectId: string;
    runId: string;
    startedAt: number;
  }): Promise<void> {
    await this.deps.activity.markActive({
      projectId,
      runId,
      expiresAt: startedAt + EXPERIMENT_RUN_ACTIVITY_WINDOW_MS,
    });
  }

  /** Stops counting a run once it completed, however it ended. */
  async recordCompleted({ projectId, runId }: { projectId: string; runId: string }): Promise<void> {
    await this.deps.activity.markInactive({ projectId, runId });
  }
}
