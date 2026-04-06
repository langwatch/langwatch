/**
 * Scenario job processor for BullMQ.
 *
 * Spawns isolated child processes for scenario execution to achieve OTEL
 * trace isolation. Each scenario runs in its own process with separate
 * LANGWATCH_API_KEY and LANGWATCH_ENDPOINT env vars.
 *
 * @see specs/scenarios/simulation-runner.feature (Worker-Based Execution scenarios)
 * @see https://github.com/langwatch/langwatch/issues/1088
 */

import { spawn, type ChildProcess } from "child_process";
import path from "path";
import type { Job, Worker } from "bullmq";
import { Worker as BullMQWorker } from "bullmq";
import { createLogger } from "~/utils/logger/server";
import { prisma } from "../db";
import { connection } from "../redis";
import { subscribeToCancellations, type CancellationMessage } from "./cancellation-channel";
import {
  type JobContextMetadata,
  createContextFromJobData,
  runWithContext,
} from "../context/asyncContext";
import {
  createDataPrefetcherDependencies,
  prefetchScenarioData,
} from "./execution/data-prefetcher";
import type { ChildProcessJobData, ScenarioExecutionResult } from "./execution/types";
import {
  recordJobWaitDuration,
  getJobProcessingCounter,
  getJobProcessingDurationHistogram,
} from "../metrics";
import { CHILD_PROCESS, SCENARIO_QUEUE, SCENARIO_WORKER } from "./scenario.constants";
import type { ScenarioJob, ScenarioJobResult } from "./scenario.queue";
import { ScenarioFailureHandler, type FailureEventParams } from "./scenario-failure-handler";
import { ScenarioService } from "./scenario.service";
import { resolveChildProcessSpawn } from "./execution/child-process-spawn";

// ============================================================================
// Dependency Interfaces (Dependency Inversion Principle)
// ============================================================================

/** Minimal interface for scenario lookup in failure handler */
export interface ScenarioLookup {
  getById(params: { projectId: string; id: string }): Promise<{
    name: string;
    situation: string;
  } | null>;
}

/** Minimal interface for failure event emission */
export interface FailureEmitter {
  ensureFailureEventsEmitted(params: FailureEventParams): Promise<void>;
}

/** Dependencies for the scenario processor's failure handling */
export interface ProcessorDependencies {
  scenarioLookup: ScenarioLookup;
  failureEmitter: FailureEmitter;
}

// ============================================================================
// Factory Function (wires up production dependencies)
// ============================================================================

/**
 * Creates production dependencies for the scenario processor.
 *
 * This factory wires up the real implementations:
 * - ScenarioService for scenario lookup
 * - ScenarioFailureHandler for failure event emission
 */
export function createProcessorDependencies(): ProcessorDependencies {
  const scenarioService = ScenarioService.create(prisma);
  const failureHandler = ScenarioFailureHandler.create();

  return {
    scenarioLookup: {
      getById: (params) => scenarioService.getById(params),
    },
    failureEmitter: {
      ensureFailureEventsEmitted: (params) =>
        failureHandler.ensureFailureEventsEmitted(params),
    },
  };
}

// ============================================================================
// Failure Handling (Single Responsibility)
// ============================================================================

/**
 * Handle a failed job result by emitting failure events to Elasticsearch.
 *
 * This function is responsible for:
 * - Fetching scenario metadata (name, description) for the failure event
 * - Emitting failure events via the failure handler
 *
 * Separated from logging concerns to follow Single Responsibility Principle.
 *
 * @param jobData - The job data containing project/scenario identifiers
 * @param error - Optional error message from the failed job
 * @param deps - Injected dependencies for scenario lookup and failure emission
 * @internal Exported for testing
 */
export async function handleFailedJobResult(
  jobData: ScenarioJob,
  error: string | undefined,
  deps: ProcessorDependencies,
): Promise<void> {
  // Fetch scenario to get name and description for the failure event
  const scenario = await deps.scenarioLookup.getById({
    projectId: jobData.projectId,
    id: jobData.scenarioId,
  });

  await deps.failureEmitter.ensureFailureEventsEmitted({
    projectId: jobData.projectId,
    scenarioId: jobData.scenarioId,
    setId: jobData.setId,
    batchRunId: jobData.batchRunId,
    scenarioRunId: jobData.scenarioRunId,
    error,
    name: scenario?.name,
    description: scenario?.situation,
  });
}

/**
 * Handle a cancelled job result by emitting cancellation events to Elasticsearch.
 *
 * Similar to handleFailedJobResult but writes CANCELLED status instead of ERROR.
 *
 * @param jobData - The job data containing project/scenario identifiers
 * @param error - Optional error message
 * @param deps - Injected dependencies for scenario lookup and failure emission
 * @internal Exported for testing
 */
export async function handleCancelledJobResult(
  jobData: ScenarioJob,
  error: string | undefined,
  deps: ProcessorDependencies,
): Promise<void> {
  const scenario = await deps.scenarioLookup.getById({
    projectId: jobData.projectId,
    id: jobData.scenarioId,
  });

  await deps.failureEmitter.ensureFailureEventsEmitted({
    projectId: jobData.projectId,
    scenarioId: jobData.scenarioId,
    setId: jobData.setId,
    batchRunId: jobData.batchRunId,
    error: error ?? "Cancelled by user",
    name: scenario?.name,
    description: scenario?.situation,
    cancelled: true,
  });
}

const logger = createLogger("langwatch:scenarios:processor");

/**
 * Module-level map tracking running child processes by scenarioRunId.
 * Used by the cancel subscription to find and SIGTERM the right child.
 * Safe as a module-level singleton because there's one worker per process.
 */
const runningChildren = new Map<string, ChildProcess>();

/**
 * Creates a child logger with scenario job context bound.
 * This ensures all logs from a job have consistent identifiers.
 */
function createJobLogger(job: Job<ScenarioJob, ScenarioJobResult, string>, jobData: ScenarioJob) {
  return logger.child({
    jobId: job.id,
    scenarioId: jobData.scenarioId,
    projectId: jobData.projectId,
    batchRunId: jobData.batchRunId,
    setId: jobData.setId,
  });
}

/**
 * Build OTEL resource attributes string for scenario labels and platform source.
 * Always includes langwatch.origin.source=platform; appends scenario.labels if labels are present.
 * @internal Exported for testing
 */
export function buildOtelResourceAttributes(labels: string[]): string {
  // Always include langwatch.origin.source=platform for platform-originated scenario traces
  const parts = ["langwatch.origin.source=platform"];
  if (labels.length) {
    // Escape backslashes first, then commas and equals per OTEL spec
    const escapedLabels = labels.map((l) => l.replace(/\\/g, "\\\\").replace(/[,=]/g, "\\$&"));
    parts.push(`scenario.labels=${escapedLabels.join(",")}`);
  }
  return parts.join(",");
}

/**
 * Build minimal env for child process - whitelist only what's needed.
 * Following the goose.ts pattern to prevent leaking sensitive vars.
 * @internal Exported for testing
 */
export function buildChildProcessEnv(
  scenarioVars: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  const vars: Record<string, string | undefined> = {
    // System vars (required for tsx/node to run)
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USER: process.env.USER,
    SHELL: process.env.SHELL,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    TERM: process.env.TERM,
    // Node.js vars
    NODE_ENV: process.env.NODE_ENV,
    NODE_OPTIONS: process.env.NODE_OPTIONS,
    // Skip t3-oss/env-nextjs validation — child process doesn't need server env vars
    SKIP_ENV_VALIDATION: "1",
    // Corepack vars (required for pnpm exec tsx in child processes)
    COREPACK_ENABLE_DOWNLOAD_PROMPT: process.env.COREPACK_ENABLE_DOWNLOAD_PROMPT,
    // Scenario-specific vars (passed in)
    ...scenarioVars,
  };

  // Filter out undefined values
  return Object.fromEntries(
    Object.entries(vars).filter(([, v]) => v !== undefined),
  ) as NodeJS.ProcessEnv;
}

/**
 * Process a scenario job by spawning an isolated child process.
 *
 * @param signal - BullMQ's native AbortSignal, fired when the job is cancelled.
 *   When provided and already aborted, processing is skipped immediately.
 *   When fired mid-execution, the spawned child process receives SIGTERM.
 */
export async function processScenarioJob(
  job: Job<ScenarioJob, ScenarioJobResult, string>,
  _token?: string,
  signal?: AbortSignal,
): Promise<ScenarioJobResult> {
  if (signal?.aborted) {
    return { success: false, error: "Job was cancelled before processing started", cancelled: true };
  }
  // Extract context metadata propagated from the queue (flat format: { ...payload, __context })
  const { __context: contextMetadata, ...jobData } = job.data as ScenarioJob & {
    __context?: JobContextMetadata;
  };

  recordJobWaitDuration(job, "scenario");

  const { projectId, scenarioId, target, setId, batchRunId, scenarioRunId } = jobData;

  // Ensure projectId is set in context metadata (may come from job data)
  const enrichedContextMetadata: JobContextMetadata = {
    ...contextMetadata,
    projectId: contextMetadata?.projectId ?? projectId,
  };

  // Create request context from job metadata
  const requestContext = createContextFromJobData(enrichedContextMetadata);

  // Create child logger with job context bound
  const jobLogger = createJobLogger(job, jobData);

  // Run the job processing within the restored context
  return runWithContext(requestContext, async () => {
    const startTime = Date.now();
    getJobProcessingCounter("scenario", "processing").inc();
    jobLogger.info("Processing scenario job");

    // Pre-fetch all data needed for child process
    const deps = createDataPrefetcherDependencies();
    const prefetchResult = await prefetchScenarioData(
      { projectId, scenarioId, setId, batchRunId, scenarioRunId },
      target,
      deps,
    );

    if (!prefetchResult.success) {
      jobLogger.error(
        { error: prefetchResult.error, phase: "prefetch" },
        "Failed to prefetch scenario data",
      );
      return { success: false, error: prefetchResult.error };
    }

    jobLogger.debug(
      { durationMs: Date.now() - startTime, phase: "prefetch" },
      "Scenario data prefetched",
    );

    // Inject pre-generated scenarioRunId if present in job data
    const childProcessData = jobData.scenarioRunId
      ? { ...prefetchResult.data, scenarioRunId: jobData.scenarioRunId }
      : prefetchResult.data;

    // Spawn child process with isolated OTEL context
    const childStartTime = Date.now();
    const result = await spawnScenarioChildProcess(
      job,
      jobData,
      childProcessData,
      prefetchResult.telemetry,
      signal,
    );

    const totalDurationMs = Date.now() - startTime;
    const childDurationMs = Date.now() - childStartTime;

    if (result.success) {
      getJobProcessingCounter("scenario", "completed").inc();
      getJobProcessingDurationHistogram("scenario").observe(totalDurationMs);
      jobLogger.info(
        { success: true, totalDurationMs, childDurationMs },
        "Scenario job completed",
      );
    } else {
      getJobProcessingCounter("scenario", "failed").inc();
      jobLogger.warn(
        { success: false, error: result.error, totalDurationMs, childDurationMs },
        "Scenario job completed with failure",
      );
    }

    return result;
  });
}

/**
 * Spawn a child process to execute the scenario with isolated OTEL context.
 *
 * The child process is self-contained and self-reporting via LangWatch SDK.
 * We just stream its output and check the exit code.
 */
async function spawnScenarioChildProcess(
  job: Job<ScenarioJob, ScenarioJobResult, string>,
  jobData: ScenarioJob,
  childProcessData: ChildProcessJobData,
  telemetry: { endpoint: string; apiKey: string },
  signal?: AbortSignal,
): Promise<ScenarioExecutionResult> {
  return new Promise((resolve) => {
    const { scenarioId, projectId, batchRunId, setId } = jobData;
    // Create child logger with scenario context bound for structured logging
    const childLogger = logger.child({
      jobId: job.id,
      scenarioId,
      projectId,
      batchRunId,
      setId,
      component: "child-process",
    });

    // Helper to log to both pino (stdout) and BullMQ job (visible in Bull Board)
    const log = (
      level: "info" | "warn" | "error",
      message: string,
      extra?: Record<string, unknown>,
    ) => {
      childLogger[level](extra ?? {}, message);
      void job.log(`[${level.toUpperCase()}] ${message}`);
    };

    // Build OTEL resource attributes including scenario labels
    const otelResourceAttrs = buildOtelResourceAttributes(childProcessData.scenario.labels);

    // Build minimal env for child process - whitelist only what's needed
    // Following the goose.ts pattern to prevent leaking sensitive vars
    // (especially OTEL_* which would corrupt telemetry isolation)
    const childEnv = buildChildProcessEnv({
      LANGWATCH_API_KEY: telemetry.apiKey,
      LANGWATCH_ENDPOINT: telemetry.endpoint,
      SCENARIO_HEADLESS: "true", // Prevent SDK from trying to open browser
      OTEL_RESOURCE_ATTRIBUTES: otelResourceAttrs,
    });

    // Resolve spawn command: pre-compiled bundle in production, tsx in development
    // Use __dirname to resolve package root reliably (works from source and built output paths)
    const packageRoot = path.resolve(__dirname, "../../..");
    const spawnStart = Date.now();
    const { command, args } = resolveChildProcessSpawn({
      packageRoot,
      nodeEnv: process.env.NODE_ENV,
    });
    logger.info(
      { command, args, jobId: job.id },
      "Spawning scenario child process",
    );
    const child: ChildProcess = spawn(command, args, {
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"],
      cwd: packageRoot,
    });
    logger.info(
      { pid: child.pid, jobId: job.id, spawnMs: Date.now() - spawnStart },
      "Child process spawned",
    );

    // Register in the running children map so cancel broadcasts can find this child
    runningChildren.set(jobData.scenarioRunId, child);

    // Kill the child process when the BullMQ abort signal fires (job cancelled)
    signal?.addEventListener("abort", () => {
      child.kill("SIGTERM");
    });

    let stderr = "";
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        child.kill();
      }
    };

    const timeout = setTimeout(() => {
      log("error", "Child process timed out", { timeoutMs: CHILD_PROCESS.TIMEOUT_MS });
      cleanup();
      resolve({
        success: false,
        error: "Scenario execution timed out",
      });
    }, CHILD_PROCESS.TIMEOUT_MS);

    // Stream child output to parent logs and Bull Board
    child.stdout?.on("data", (data: Buffer) => {
      const lines = data.toString().trim().split("\n");
      for (const line of lines) {
        if (line) log("info", line);
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
      const lines = data.toString().trim().split("\n");
      for (const line of lines) {
        if (line) log("warn", line);
      }
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      runningChildren.delete(jobData.scenarioRunId);
      if (resolved) return;
      resolved = true;

      if (signal?.aborted) {
        log("info", "Job cancelled via AbortSignal");
        resolve({ success: false, error: "Job was cancelled", cancelled: true });
        return;
      }

      if (code !== 0) {
        log("error", `Child process exited with code ${code}`, { exitCode: code, stderr });
        resolve({
          success: false,
          error: `Child process exited with code ${code}: ${stderr}`,
        });
        return;
      }

      log("info", "Scenario completed successfully", { exitCode: code });
      // Child reports results via LangWatch SDK, we just confirm it succeeded
      resolve({ success: true });
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      runningChildren.delete(jobData.scenarioRunId);
      if (resolved) return;
      resolved = true;

      log("error", `Child process error: ${error.message}`);
      resolve({
        success: false,
        error: `Child process error: ${error.message}`,
      });
    });

    // Send job data to child via stdin with error handling to prevent EPIPE crashes
    if (child.stdin) {
      child.stdin.on("error", (err) => {
        log("warn", "Child stdin error", { error: err.message });
      });
      try {
        child.stdin.write(JSON.stringify(childProcessData));
        child.stdin.end();
      } catch (err) {
        log("warn", "Child stdin write failed", { error: (err as Error).message });
      }
    }
  });
}

/**
 * Start the scenario processor (BullMQ worker).
 *
 * Currently runs as part of the main workers process. OTEL trace isolation
 * is handled at the child process level - each scenario spawns its own
 * process with an independent tracer context.
 *
 * A separate entry point (scenario-worker.ts) exists for future independent
 * scaling if needed.
 *
 * @param deps - Optional injected dependencies (defaults to production implementations)
 */
export async function startScenarioProcessor(
  deps: ProcessorDependencies = createProcessorDependencies(),
): Promise<Worker<ScenarioJob, ScenarioJobResult, string> | undefined> {
  if (!connection) {
    logger.info("No Redis connection, skipping scenario processor");
    return undefined;
  }

  const worker = new BullMQWorker<ScenarioJob, ScenarioJobResult, string>(
    SCENARIO_QUEUE.NAME,
    (job, token, signal) => processScenarioJob(job, token, signal),
    {
      connection,
      concurrency: SCENARIO_WORKER.CONCURRENCY,
      stalledInterval: SCENARIO_WORKER.STALLED_INTERVAL_MS,
      drainDelay: SCENARIO_WORKER.DRAIN_DELAY_MS,
    },
  );

  worker.on("ready", () => {
    logger.info(
      { concurrency: SCENARIO_WORKER.CONCURRENCY, queue: SCENARIO_QUEUE.NAME },
      "Scenario processor ready, waiting for jobs",
    );
  });

  worker.on("stalled", (jobId) => {
    logger.warn(
      { jobId },
      "Scenario job stalled - worker may have died mid-execution",
    );
  });

  worker.on("failed", (job, error) => {
    const jobData = job?.data;
    const eventLogger = job
      ? logger.child({
          jobId: job.id,
          scenarioId: jobData?.scenarioId,
          projectId: jobData?.projectId,
          batchRunId: jobData?.batchRunId,
          setId: jobData?.setId,
          event: "job_failed",
        })
      : logger;

    // Check if this was a cancellation (BullMQ throws AbortError when job is cancelled)
    const isCancellation = error?.name === "AbortError" || error?.message?.includes("cancelled");

    if (isCancellation) {
      eventLogger.info(
        { error: error?.message },
        "Scenario job cancelled",
      );
    } else {
      eventLogger.error(
        { error: error?.message, errorStack: error?.stack },
        "Scenario job failed unexpectedly",
      );
    }

    // Emit appropriate events for the failure/cancellation
    if (job && jobData) {
      if (isCancellation) {
        void handleCancelledJobResult(jobData, error?.message, deps).catch((emitError) =>
          eventLogger.error(
            { emitError },
            "Failed to emit cancellation events from failed handler",
          ),
        );
      } else {
        void handleFailedJobResult(jobData, error?.message, deps).catch((emitError) =>
          eventLogger.error(
            { emitError },
            "Failed to emit failure events from failed handler",
          ),
        );
      }
    }
  });

  worker.on("completed", async (job, result) => {
    const jobData = job.data;
    const eventLogger = logger.child({
      jobId: job.id,
      scenarioId: jobData.scenarioId,
      projectId: jobData.projectId,
      batchRunId: jobData.batchRunId,
      setId: jobData.setId,
      event: "job_completed",
    });

    // If job succeeded, log at info level
    if (result?.success) {
      eventLogger.info({ success: true }, "Scenario job completed successfully");
      return;
    }

    // Job was cancelled by user — write CANCELLED event, not ERROR
    if (result?.cancelled) {
      eventLogger.info("Scenario job cancelled by user");
      try {
        await handleCancelledJobResult(jobData, result.error, deps);
        eventLogger.debug("Cancellation events emitted to Elasticsearch");
      } catch (emitError) {
        eventLogger.error({ emitError }, "Failed to emit cancellation events");
      }
      return;
    }

    // Job completed but with a failure result - ensure failure events are emitted
    // to Elasticsearch so the frontend can show the error instead of timing out
    eventLogger.warn(
      { success: false, error: result?.error ?? "No error provided" },
      "Scenario job completed with failure",
    );

    try {
      await handleFailedJobResult(jobData, result?.error, deps);
      eventLogger.debug("Failure events emitted to Elasticsearch");
    } catch (emitError) {
      // Log but don't crash the worker - failure handler errors shouldn't affect other jobs
      eventLogger.error({ emitError }, "Failed to emit failure events");
    }
  });

  // Subscribe to cancellation signals from the event-sourcing reactor.
  // Redis pub/sub requires a dedicated connection — use duplicate() so the
  // subscriber doesn't interfere with BullMQ's command connection.
  const subscriber = connection.duplicate();
  const unsubscribe = await subscribeToCancellations({
    subscriber,
    onCancel: (message: CancellationMessage) => {
      const child = runningChildren.get(message.scenarioRunId);
      if (child) {
        logger.info(
          { scenarioRunId: message.scenarioRunId, pid: child.pid },
          "Killing child process via event-sourcing cancel broadcast",
        );
        child.kill("SIGTERM");
      }
    },
  });

  // Clean up the subscriber connection when the worker shuts down
  worker.on("closing", () => {
    void unsubscribe().catch((err: unknown) =>
      logger.warn({ err }, "Error closing cancellation subscriber"),
    );
  });

  logger.info(
    { concurrency: SCENARIO_WORKER.CONCURRENCY, queue: SCENARIO_QUEUE.NAME },
    "Scenario processor started",
  );
  return worker;
}
