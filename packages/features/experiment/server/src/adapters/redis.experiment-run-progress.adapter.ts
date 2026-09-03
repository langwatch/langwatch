/**
 * One run's progress, in Redis, under a 24-hour TTL.
 *
 * This is what makes the polling API work across processes: `POST /run` starts
 * execution on one replica and answers immediately, and `GET /runs/{runId}` is
 * served by whichever replica took the poll, so the progress has to live where
 * both can see it. Completed runs stay queryable until the TTL drops them.
 *
 * The connection is injected rather than resolved from a process singleton:
 * two replicas answering from two different Redis instances would let a poll
 * report a run that another replica has already finished.
 */
import { createLogger } from "@langwatch/observability";
import type { EvaluationV3Event } from "@langwatch/experiment-contract";
import type { Redis } from "ioredis";
import {
  ExperimentRunProgressPort,
  type ExperimentRunProgressFailure,
  type ExperimentRunProgressState,
  type ExperimentRunProgressSummary,
} from "../ports/experiment-run-progress.port";

const logger = createLogger("langwatch:experiment:run-progress");

/** Redis key prefix for run state. */
const RUN_STATE_KEY_PREFIX = "eval_v3_run:";

/** TTL for run state in seconds (24 hours - keeps completed runs queryable). */
const RUN_STATE_TTL_SECONDS = 86400;

export class RedisExperimentRunProgressAdapter extends ExperimentRunProgressPort {
  static create(options: { redis: Redis }): RedisExperimentRunProgressAdapter {
    return new RedisExperimentRunProgressAdapter(options.redis);
  }

  private constructor(private readonly redis: Redis) {
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
      startedAt: Date.now(),
      recentEvents: [],
    };

    await this.write(input.runId, state);
    logger.info({ runId: input.runId }, "Run state created");
  }

  async updateProgress(runId: string, progress: number): Promise<void> {
    const state = await this.tryGetRunState(runId);
    if (!state) return;

    state.progress = progress;
    await this.write(runId, state);
  }

  async addEvent(runId: string, event: EvaluationV3Event): Promise<void> {
    const state = await this.tryGetRunState(runId);
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
    const state = await this.tryGetRunState(runId);
    if (!state) return;

    state.status = "completed";
    state.finishedAt = Date.now();
    state.summary = summary;
    state.progress = state.total;

    await this.write(runId, state);
    logger.info({ runId }, "Run completed");
  }

  /**
   * Marks a run as failed.
   *
   * Takes the CODE, not the thrown message — the caller maps the failure
   * through the result mapper first, so what is stored (and later served by the
   * run API) is what the customer is allowed to read.
   */
  async failRun(runId: string, failure: ExperimentRunProgressFailure): Promise<void> {
    const state = await this.tryGetRunState(runId);
    if (!state) return;

    state.status = "failed";
    state.finishedAt = Date.now();
    state.error = failure.code;
    state.domainError = failure.domainError;
    state.traceId = failure.traceId;

    await this.write(runId, state);
    logger.error({ runId, errorCode: failure.code, traceId: failure.traceId }, "Run failed");
  }

  async stopRun(runId: string): Promise<void> {
    const state = await this.tryGetRunState(runId);
    if (!state) return;

    state.status = "stopped";
    state.finishedAt = Date.now();

    await this.write(runId, state);
    logger.info({ runId }, "Run stopped");
  }

  async tryGetRunState(runId: string): Promise<ExperimentRunProgressState | null> {
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
