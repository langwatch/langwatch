/**
 * Run State Manager - Manages evaluation run state in Redis for polling.
 *
 * This enables the polling API pattern where:
 * 1. POST /run starts execution and returns runId immediately
 * 2. GET /runs/{runId} polls for current status
 *
 * Run state is stored in Redis with TTL for automatic cleanup.
 */

import type { SerializedHandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { tryGetApp } from "~/server/app-layer/app";
import type { EvaluationV3Event, ExecutionSummary } from "./types";

const logger = createLogger("experiments-v3:run-state-manager");

/**
 * Redis key prefix for run state.
 */
const RUN_STATE_KEY_PREFIX = "eval_v3_run:";

/**
 * TTL for run state in seconds (24 hours - keeps completed runs queryable).
 */
const RUN_STATE_TTL_SECONDS = 86400;

/**
 * Run state stored in Redis.
 */
export type RunState = {
  runId: string;
  projectId: string;
  experimentId?: string;
  experimentSlug: string;
  status: "pending" | "running" | "completed" | "failed" | "stopped";
  progress: number;
  total: number;
  startedAt: number;
  finishedAt?: number;
  summary?: ExecutionSummary & {
    /** Extended summary for CI output */
    targets?: Array<{
      targetId: string;
      name: string;
      passed: number;
      failed: number;
      avgLatency: number;
      totalCost: number;
    }>;
    evaluators?: Array<{
      evaluatorId: string;
      name: string;
      passed: number;
      failed: number;
      passRate: number;
      avgScore?: number;
    }>;
    totalPassed?: number;
    totalFailed?: number;
    passRate?: number;
    totalCost?: number;
    runUrl?: string;
  };
  /**
   * The failure's stable code — a handled error's own, or the unnamed-failure
   * marker. Never the thrown error's message: `GET /runs/:runId` hands this
   * straight to any API consumer, and a raw message there is the same leak the
   * live stream stopped shipping (ADR-045).
   */
  error?: string;
  /** The serialised handled error, when the failure had one. */
  domainError?: SerializedHandledError;
  /** The trace to hand support — all an unnamed failure gives a caller. */
  traceId?: string;
  /** Recent events for debugging (last 50) */
  recentEvents?: EvaluationV3Event[];
};

/**
 * Manages run state for the polling API.
 */
export const runStateManager = {
  /**
   * Create initial run state when execution starts.
   */
  async createRun(params: {
    runId: string;
    projectId: string;
    experimentId?: string;
    experimentSlug: string;
    total: number;
  }): Promise<void> {
    const connection = tryGetApp()?.redis ?? null;
    if (!connection) {
      logger.warn(
        { runId: params.runId },
        "Redis not available, run state not stored",
      );
      return;
    }

    const state: RunState = {
      runId: params.runId,
      projectId: params.projectId,
      experimentId: params.experimentId,
      experimentSlug: params.experimentSlug,
      status: "running",
      progress: 0,
      total: params.total,
      startedAt: Date.now(),
      recentEvents: [],
    };

    const key = `${RUN_STATE_KEY_PREFIX}${params.runId}`;
    await connection.set(
      key,
      JSON.stringify(state),
      "EX",
      RUN_STATE_TTL_SECONDS,
    );
    logger.info({ runId: params.runId }, "Run state created");
  },

  /**
   * Update run progress.
   */
  async updateProgress(runId: string, progress: number): Promise<void> {
    const connection = tryGetApp()?.redis ?? null;
    if (!connection) return;

    const state = await this.getRunState(runId);
    if (!state) return;

    state.progress = progress;

    const key = `${RUN_STATE_KEY_PREFIX}${runId}`;
    await connection.set(
      key,
      JSON.stringify(state),
      "EX",
      RUN_STATE_TTL_SECONDS,
    );
  },

  /**
   * Add an event to recent events (for debugging).
   */
  async addEvent(runId: string, event: EvaluationV3Event): Promise<void> {
    const connection = tryGetApp()?.redis ?? null;
    if (!connection) return;

    const state = await this.getRunState(runId);
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

    const key = `${RUN_STATE_KEY_PREFIX}${runId}`;
    await connection.set(
      key,
      JSON.stringify(state),
      "EX",
      RUN_STATE_TTL_SECONDS,
    );
  },

  /**
   * Mark run as completed with summary.
   */
  async completeRun(
    runId: string,
    summary: RunState["summary"],
  ): Promise<void> {
    const connection = tryGetApp()?.redis ?? null;
    if (!connection) return;

    const state = await this.getRunState(runId);
    if (!state) return;

    state.status = "completed";
    state.finishedAt = Date.now();
    state.summary = summary;
    state.progress = state.total;

    const key = `${RUN_STATE_KEY_PREFIX}${runId}`;
    await connection.set(
      key,
      JSON.stringify(state),
      "EX",
      RUN_STATE_TTL_SECONDS,
    );
    logger.info({ runId }, "Run completed");
  },

  /**
   * Mark run as failed.
   *
   * Takes the CODE, not the thrown message — the caller maps the failure
   * through `mapThrownErrorEvent` first, so what is stored (and later served
   * by the run API) is what the customer is allowed to read.
   */
  async failRun(
    runId: string,
    failure: {
      code: string;
      domainError?: SerializedHandledError;
      traceId?: string;
    },
  ): Promise<void> {
    const connection = tryGetApp()?.redis ?? null;
    if (!connection) return;

    const state = await this.getRunState(runId);
    if (!state) return;

    state.status = "failed";
    state.finishedAt = Date.now();
    state.error = failure.code;
    state.domainError = failure.domainError;
    state.traceId = failure.traceId;

    const key = `${RUN_STATE_KEY_PREFIX}${runId}`;
    await connection.set(
      key,
      JSON.stringify(state),
      "EX",
      RUN_STATE_TTL_SECONDS,
    );
    logger.error(
      { runId, errorCode: failure.code, traceId: failure.traceId },
      "Run failed",
    );
  },

  /**
   * Mark run as stopped (aborted by user).
   */
  async stopRun(runId: string): Promise<void> {
    const connection = tryGetApp()?.redis ?? null;
    if (!connection) return;

    const state = await this.getRunState(runId);
    if (!state) return;

    state.status = "stopped";
    state.finishedAt = Date.now();

    const key = `${RUN_STATE_KEY_PREFIX}${runId}`;
    await connection.set(
      key,
      JSON.stringify(state),
      "EX",
      RUN_STATE_TTL_SECONDS,
    );
    logger.info({ runId }, "Run stopped");
  },

  /**
   * Get current run state.
   */
  async getRunState(runId: string): Promise<RunState | null> {
    const connection = tryGetApp()?.redis ?? null;
    if (!connection) {
      return null;
    }

    const key = `${RUN_STATE_KEY_PREFIX}${runId}`;
    const value = await connection.get(key);

    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value) as RunState;
    } catch {
      logger.error({ runId }, "Failed to parse run state");
      return null;
    }
  },

  /**
   * Delete run state (cleanup).
   */
  async deleteRun(runId: string): Promise<void> {
    const connection = tryGetApp()?.redis ?? null;
    if (!connection) return;

    const key = `${RUN_STATE_KEY_PREFIX}${runId}`;
    await connection.del(key);
    logger.debug({ runId }, "Run state deleted");
  },
};

export type RunStateManager = typeof runStateManager;
