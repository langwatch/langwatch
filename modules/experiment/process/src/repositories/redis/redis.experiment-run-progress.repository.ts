import type { EvaluationV3Event } from "@langwatch/experiment-contract";
/**
 * One run's progress in Redis under a 24-hour TTL. Enables polling across processes; `POST
 * /run` starts on one replica, `GET /runs/{runId}` is served by any. Connection injected to
 * ensure both see the same Redis instance.
 */
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import {
  ExperimentRunProgressRepository,
  type ExperimentRunProgressFailure,
  type ExperimentRunProgressState,
  type ExperimentRunProgressSummary,
} from "../experiment-run-progress.repository.ts";

const logger = createLogger("langwatch:experiment:run-progress");

/** Redis key prefix for run state. */
const RUN_STATE_KEY_PREFIX = "eval_v3_run:";

/** TTL for run state in seconds (24 hours - keeps completed runs queryable). */
const RUN_STATE_TTL_SECONDS = 86400;

/**
 * The three commands this repository issues, named rather than the whole
 * client: a clustered deployment's connection serves them identically.
 */
export type RunProgressStore = Readonly<{
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
  del(key: string): Promise<number>;
}>;

export class RedisExperimentRunProgressRepository extends ExperimentRunProgressRepository {
  static create(options: { redis: RunProgressStore }): RedisExperimentRunProgressRepository {
    return new RedisExperimentRunProgressRepository(options.redis);
  }

  private constructor(private readonly redis: RunProgressStore) {
    super();
  }

  async createRun(input: {
    runId: string;
    projectId: string;
    experimentId?: string;
    experimentSlug: string;
    total: number;
  }): Promise<void> {
    const state: ExperimentRunProgressState = {
      runId: input.runId,
      projectId: input.projectId,
      experimentId: input.experimentId,
      experimentSlug: input.experimentSlug,
      status: "running",
      progress: 0,
      total: input.total,
      startedAt: nowInstant().epochMilliseconds,
      recentEvents: [],
    };

    await this.write(input.runId, state);
    logger.info({ runId: input.runId }, "Run state created");
  }

  async updateProgress(runId: string, progress: number): Promise<void> {
    const state = await this.findRunState(runId);
    if (!state) return;

    state.progress = progress;
    await this.write(runId, state);
  }

  async addEvent(runId: string, event: EvaluationV3Event): Promise<void> {
    const state = await this.findRunState(runId);
    if (!state) return;

    // Keep last 50 events
    state.recentEvents = state.recentEvents ?? [];
    state.recentEvents.push(event);
    if (state.recentEvents.length > 50) {
      state.recentEvents = state.recentEvents.slice(-50);
    }

    // Update progress from progress events
    if (event.type === "progress") {
      state.progress = event.completed;
    }

    await this.write(runId, state);
  }

  async completeRun(
    runId: string,
    summary: ExperimentRunProgressSummary | undefined,
  ): Promise<void> {
    const state = await this.findRunState(runId);
    if (!state) return;

    state.status = "completed";
    state.finishedAt = nowInstant().epochMilliseconds;
    state.summary = summary;
    state.progress = state.total;

    await this.write(runId, state);
    logger.info({ runId }, "Run completed");
  }

  /**
   * Marks a run as failed. Takes the CODE, not the thrown message — the
   * caller maps the failure through the result mapper first, so what is
   * stored (and later served by the run API) is what the customer may read.
   */
  async failRun(runId: string, failure: ExperimentRunProgressFailure): Promise<void> {
    const state = await this.findRunState(runId);
    if (!state) return;

    state.status = "failed";
    state.finishedAt = nowInstant().epochMilliseconds;
    state.error = failure.code;
    state.domainError = failure.domainError;
    state.traceId = failure.traceId;

    await this.write(runId, state);
    logger.error({ runId, errorCode: failure.code, traceId: failure.traceId }, "Run failed");
  }

  async stopRun(runId: string): Promise<void> {
    const state = await this.findRunState(runId);
    if (!state) return;

    state.status = "stopped";
    state.finishedAt = nowInstant().epochMilliseconds;

    await this.write(runId, state);
    logger.info({ runId }, "Run stopped");
  }

  async findRunState(runId: string): Promise<ExperimentRunProgressState | null> {
    const value = await this.redis.get(`${RUN_STATE_KEY_PREFIX}${runId}`);
    if (!value) return null;

    try {
      return JSON.parse(value) as ExperimentRunProgressState;
    } catch {
      logger.error({ runId }, "Failed to parse run state");
      return null;
    }
  }

  async deleteRun(runId: string): Promise<void> {
    await this.redis.del(`${RUN_STATE_KEY_PREFIX}${runId}`);
    logger.debug({ runId }, "Run state deleted");
  }

  private async write(runId: string, state: ExperimentRunProgressState): Promise<void> {
    await this.redis.set(
      `${RUN_STATE_KEY_PREFIX}${runId}`,
      JSON.stringify(state),
      "EX",
      RUN_STATE_TTL_SECONDS,
    );
  }
}
