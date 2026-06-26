/**
 * Scenario execution processor.
 *
 * Spawns isolated child processes for scenario execution to achieve OTEL
 * trace isolation. Each scenario runs in its own process with separate
 * LANGWATCH_API_KEY and LANGWATCH_ENDPOINT env vars.
 *
 * Execution is triggered by the scenarioExecution reactor (event-driven via
 * GroupQueue), NOT by BullMQ. The execution pool manages concurrency.
 *
 * @see specs/scenarios/simulation-runner.feature
 * @see specs/scenarios/event-driven-execution-prep.feature
 */

import { type ChildProcess, spawn } from "child_process";
import path from "path";
import { createLogger } from "~/utils/logger/server";
import { getSharedClickHouseClient } from "../clickhouse/clickhouseClient";
import {
  createContextFromJobData,
  getJobContextMetadata,
  type JobContextMetadata,
  runWithContext,
} from "../context/asyncContext";
import { prisma } from "../db";
import {
  getJobProcessingCounter,
  getJobProcessingDurationHistogram,
} from "../metrics";
import { connection } from "../redis";
import {
  type CancellationMessage,
  subscribeToCancellations,
} from "./cancellation-channel";
import {
  encodeScenarioLogContext,
  SCENARIO_LOG_CONTEXT_ENV,
} from "./execution/child-logger";
import { resolveChildProcessSpawn } from "./execution/child-process-spawn";
import {
  createDataPrefetcherDependencies,
  prefetchScenarioData,
} from "./execution/data-prefetcher";
import type {
  ExecutionJobData,
  ScenarioExecutionPool,
} from "./execution/execution-pool";
import type {
  ChildProcessJobData,
  ScenarioExecutionResult,
} from "./execution/types";
import { CHILD_PROCESS, SCENARIO_WORKER } from "./scenario.constants";
import { ScenarioService } from "./scenario.service";
import {
  type FailureEventParams,
  ScenarioFailureHandler,
} from "./scenario-failure-handler";
import {
  findQueuedRunCandidates,
  LOOKBACK_MS,
  ORPHAN_QUEUED_THRESHOLD_MS,
  reconcileOrphanedQueuedRuns,
} from "./scenario-orphan-reconciler";

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
 * Handle a failed job result by emitting failure events.
 */
export async function handleFailedJobResult(
  jobData: ExecutionJobData,
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
    scenarioRunId: jobData.scenarioRunId,
    error,
    name: scenario?.name,
    description: scenario?.situation,
  });
}

/**
 * Emit a terminal failure for every run still in flight, then drain the pool.
 *
 * Called on processor shutdown — including the worker's max-runtime restart,
 * which awaits `close()` before it rejects/restarts. Without this, in-flight
 * runs (running children killed by drain, and buffered pending jobs silently
 * dropped) would never get a terminal event and would orphan at QUEUED, with
 * the suites page polling them forever.
 *
 * Each emission is isolated by a per-job try/catch so one failure can't block
 * draining the rest. Double-emitting for
 * a running child whose own close handler also emits is safe — finishRun is
 * idempotent.
 */
export async function drainInFlightRuns(
  pool: ScenarioExecutionPool,
  deps: ProcessorDependencies,
): Promise<void> {
  const inFlight = pool.inFlightJobs;
  if (inFlight.length > 0) {
    logger.info(
      { count: inFlight.length },
      "Draining: emitting terminal failure for in-flight scenario runs before shutdown",
    );
    await Promise.all(
      inFlight.map(async (jobData) => {
        try {
          if (pool.wasCancelled(jobData.scenarioRunId)) {
            await handleCancelledJobResult(
              jobData,
              "Cancelled before execution started",
              deps,
            );
          } else {
            await handleFailedJobResult(
              jobData,
              "Worker restarting — scenario run terminated before completion",
              deps,
            );
          }
        } catch (err) {
          logger.warn(
            { err, scenarioRunId: jobData.scenarioRunId },
            "Failed to emit terminal failure for in-flight run during drain",
          );
        }
      }),
    );
  }

  // Kills running children and clears the pending buffer.
  pool.drain();
}

/**
 * Handle a cancelled job result by emitting cancellation events.
 */
export async function handleCancelledJobResult(
  jobData: ExecutionJobData,
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
    scenarioRunId: jobData.scenarioRunId,
    error: error ?? "Cancelled by user",
    name: scenario?.name,
    description: scenario?.situation,
    cancelled: true,
  });
}

const logger = createLogger("langwatch:scenarios:processor");

/**
 * Creates a child logger with scenario job context bound.
 */
function createScenarioLogger(jobData: ExecutionJobData) {
  return logger.child({
    scenarioId: jobData.scenarioId,
    projectId: jobData.projectId,
    batchRunId: jobData.batchRunId,
    setId: jobData.setId,
    scenarioRunId: jobData.scenarioRunId,
  });
}

/**
 * Build OTEL resource attributes string for scenario labels and platform source.
 * @internal Exported for testing
 */
export function buildOtelResourceAttributes(labels: string[]): string {
  const parts = ["langwatch.origin.source=platform"];
  if (labels.length) {
    const escapedLabels = labels.map((l) =>
      l.replace(/\\/g, "\\\\").replace(/[,=]/g, "\\$&"),
    );
    parts.push(`scenario.labels=${escapedLabels.join(",")}`);
  }
  return parts.join(",");
}

/**
 * Build minimal env for child process - whitelist only what's needed.
 * @internal Exported for testing
 */
export function buildChildProcessEnv(
  scenarioVars: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  const vars: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USER: process.env.USER,
    SHELL: process.env.SHELL,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    TERM: process.env.TERM,
    NODE_ENV: process.env.NODE_ENV,
    NODE_OPTIONS: process.env.NODE_OPTIONS,
    SKIP_ENV_VALIDATION: "1",
    COREPACK_ENABLE_DOWNLOAD_PROMPT:
      process.env.COREPACK_ENABLE_DOWNLOAD_PROMPT,
    ...scenarioVars,
  };

  return Object.fromEntries(
    Object.entries(vars).filter(([, v]) => v !== undefined),
  ) as NodeJS.ProcessEnv;
}

/**
 * Execute a scenario run by spawning an isolated child process.
 *
 * Called by the ScenarioExecutionPool when a slot is available.
 * The pool manages concurrency and tracks running children.
 */
export async function executeScenarioRun(
  jobData: ExecutionJobData,
  pool: ScenarioExecutionPool,
  deps: ProcessorDependencies = createProcessorDependencies(),
): Promise<void> {
  const contextMetadata: JobContextMetadata = {
    projectId: jobData.projectId,
  };
  const requestContext = createContextFromJobData(contextMetadata);
  const jobLogger = createScenarioLogger(jobData);

  await runWithContext(requestContext, async () => {
    const startTime = Date.now();
    getJobProcessingCounter("scenario", "processing").inc();
    jobLogger.info("Processing scenario job");

    const prefetchDeps = createDataPrefetcherDependencies();
    const prefetchResult = await prefetchScenarioData(
      {
        projectId: jobData.projectId,
        scenarioId: jobData.scenarioId,
        setId: jobData.setId,
        batchRunId: jobData.batchRunId,
        scenarioRunId: jobData.scenarioRunId,
      },
      jobData.target,
      prefetchDeps,
    );

    // Check if cancellation was requested while we were prefetching
    if (pool.wasCancelled(jobData.scenarioRunId)) {
      jobLogger.info("Scenario cancelled during prefetch");
      await handleCancelledJobResult(
        jobData,
        "Cancelled before execution started",
        deps,
      );
      return;
    }

    if (!prefetchResult.success) {
      jobLogger.error(
        { error: prefetchResult.error, phase: "prefetch" },
        "Failed to prefetch scenario data",
      );
      await handleFailedJobResult(jobData, prefetchResult.error, deps);
      return;
    }

    jobLogger.debug(
      { durationMs: Date.now() - startTime, phase: "prefetch" },
      "Scenario data prefetched",
    );

    const childProcessData = {
      ...prefetchResult.data,
      scenarioRunId: jobData.scenarioRunId,
    };

    const childStartTime = Date.now();
    const result = await spawnScenarioChildProcess(
      jobData,
      childProcessData,
      prefetchResult.telemetry,
      pool,
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
    } else if (result.cancelled) {
      jobLogger.info("Scenario job cancelled by user");
      await handleCancelledJobResult(jobData, result.error, deps);
    } else {
      getJobProcessingCounter("scenario", "failed").inc();
      jobLogger.warn(
        {
          success: false,
          error: result.error,
          totalDurationMs,
          childDurationMs,
        },
        "Scenario job completed with failure",
      );
      await handleFailedJobResult(jobData, result.error, deps);
    }
  });
}

/**
 * Spawn a child process to execute the scenario with isolated OTEL context.
 */
async function spawnScenarioChildProcess(
  jobData: ExecutionJobData,
  childProcessData: ChildProcessJobData,
  telemetry: { endpoint: string; apiKey: string },
  pool: ScenarioExecutionPool,
): Promise<ScenarioExecutionResult> {
  return new Promise((resolve) => {
    const { scenarioId, projectId, batchRunId, setId } = jobData;
    const childLogger = logger.child({
      scenarioId,
      projectId,
      batchRunId,
      setId,
      scenarioRunId: jobData.scenarioRunId,
      component: "child-process",
    });

    const log = (
      level: "info" | "warn" | "error",
      message: string,
      extra?: Record<string, unknown>,
    ) => {
      childLogger[level](extra ?? {}, message);
    };

    const otelResourceAttrs = buildOtelResourceAttributes(
      childProcessData.scenario.labels,
    );
    const logContext = encodeScenarioLogContext({
      scenarioRunId: jobData.scenarioRunId,
      batchRunId,
      projectId,
      scenarioId,
      setId,
    });
    const childEnv = buildChildProcessEnv({
      LANGWATCH_API_KEY: telemetry.apiKey,
      LANGWATCH_ENDPOINT: telemetry.endpoint,
      SCENARIO_HEADLESS: "true",
      OTEL_RESOURCE_ATTRIBUTES: otelResourceAttrs,
      [SCENARIO_LOG_CONTEXT_ENV]: logContext,
    });

    const packageRoot = path.resolve(__dirname, "../../..");
    const spawnStart = Date.now();
    const { command, args } = resolveChildProcessSpawn({
      packageRoot,
      nodeEnv: process.env.NODE_ENV,
    });
    log("info", "Spawning scenario child process", { command, args });
    const child: ChildProcess = spawn(command, args, {
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"],
      cwd: packageRoot,
    });
    log("info", "Child process spawned", {
      pid: child.pid,
      spawnMs: Date.now() - spawnStart,
    });

    // Register in the pool so cancel broadcasts can find this child
    pool.registerChild(jobData.scenarioRunId, child);

    let stderr = "";
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        child.kill();
      }
    };

    const timeout = setTimeout(() => {
      log("error", "Child process timed out", {
        timeoutMs: CHILD_PROCESS.TIMEOUT_MS,
      });
      cleanup();
      resolve({
        success: false,
        error: "Scenario execution timed out",
      });
    }, CHILD_PROCESS.TIMEOUT_MS);

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
      pool.deregisterChild(jobData.scenarioRunId);
      if (resolved) return;
      resolved = true;

      // Check if this was killed by the cancel subscription
      if (pool.wasCancelled(jobData.scenarioRunId)) {
        log("info", "Job cancelled via cancel broadcast");
        resolve({
          success: false,
          error: "Job was cancelled",
          cancelled: true,
        });
        return;
      }

      if (code !== 0) {
        log("error", `Child process exited with code ${code}`, {
          exitCode: code,
          stderr,
        });
        resolve({
          success: false,
          error: `Child process exited with code ${code}: ${stderr}`,
        });
        return;
      }

      log("info", "Scenario completed successfully", { exitCode: code });
      resolve({ success: true });
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      pool.deregisterChild(jobData.scenarioRunId);
      if (resolved) return;
      resolved = true;

      log("error", `Child process error: ${error.message}`);
      resolve({
        success: false,
        error: `Child process error: ${error.message}`,
      });
    });

    if (child.stdin) {
      child.stdin.on("error", (err) => {
        log("warn", "Child stdin error", { error: err.message });
      });
      try {
        child.stdin.write(JSON.stringify(childProcessData));
        child.stdin.end();
      } catch (err) {
        log("warn", "Child stdin write failed", {
          error: (err as Error).message,
        });
      }
    }
  });
}

/**
 * Start the scenario processor.
 *
 * Sets up the cancel subscription (Redis pub/sub) and wires the execution
 * pool's spawn function. The actual job processing is triggered by the
 * scenarioExecution reactor via the GroupQueue.
 *
 * @returns A shutdown handle, or undefined if Redis is not available.
 */
export async function startScenarioProcessor(
  pool: ScenarioExecutionPool,
  deps: ProcessorDependencies = createProcessorDependencies(),
): Promise<{ close: () => Promise<void> } | undefined> {
  if (!connection) {
    logger.info("No Redis connection, skipping scenario processor");
    return undefined;
  }

  // Wire the spawn function into the pool
  pool.setSpawnFunction(async (jobData) => {
    await executeScenarioRun(jobData, pool, deps);
  });

  // Wire the callback for when the pool skips a cancelled job —
  // dispatch finished(CANCELLED) so the run reaches terminal state
  pool.setOnSkipCancelled((jobData) => {
    logger.info(
      { scenarioRunId: jobData.scenarioRunId },
      "Dispatching finished(CANCELLED) for skipped cancelled job",
    );
    void handleCancelledJobResult(
      jobData,
      "Cancelled before execution started",
      deps,
    );
  });

  // Subscribe to cancellation signals from the event-sourcing reactor
  const subscriber = connection.duplicate();
  const unsubscribe = await subscribeToCancellations({
    subscriber,
    onCancel: (message: CancellationMessage) => {
      const child = pool.runningChildren.get(message.scenarioRunId);
      if (child) {
        logger.info(
          { scenarioRunId: message.scenarioRunId, pid: child.pid },
          "Killing child process via event-sourcing cancel broadcast",
        );
        child.kill("SIGTERM");
      }
      pool.markCancelled(message.scenarioRunId);
    },
  });

  logger.info(
    { concurrency: SCENARIO_WORKER.CONCURRENCY },
    "Scenario processor started (event-driven)",
  );

  // Belt-and-braces for hard kills (OOM/SIGKILL) where the graceful drain
  // above never ran: reconcile runs left orphaned at QUEUED by a previous
  // worker. Fire-and-forget — a slow or failing cross-tenant ClickHouse scan
  // must never wedge worker startup. Uses the shared (non-tenant) client
  // because the scan is intentionally cross-tenant.
  const sharedClickHouseClient = getSharedClickHouseClient();
  if (sharedClickHouseClient) {
    const reconcilerNow = Date.now();
    void reconcileOrphanedQueuedRuns({
      findCandidates: () =>
        findQueuedRunCandidates({
          client: sharedClickHouseClient,
          lookbackMs: LOOKBACK_MS,
          now: reconcilerNow,
          orphanThresholdMs: ORPHAN_QUEUED_THRESHOLD_MS,
        }),
      emitFailure: (candidate) =>
        deps.failureEmitter.ensureFailureEventsEmitted({
          projectId: candidate.projectId,
          scenarioId: candidate.scenarioId,
          setId: candidate.setId,
          batchRunId: candidate.batchRunId,
          scenarioRunId: candidate.scenarioRunId,
          error:
            "Reconciled: orphaned QUEUED run with no live worker (worker restart/crash)",
        }),
      now: reconcilerNow,
      thresholdMs: ORPHAN_QUEUED_THRESHOLD_MS,
    }).catch((err) => logger.warn({ err }, "orphan reconciler failed"));
  }

  return {
    close: async () => {
      // Emit a terminal failure for every in-flight run, then drain. This is
      // what makes the worker's max-runtime restart (which awaits close()
      // before it rejects/restarts) safe: in-flight runs reach a terminal
      // state instead of orphaning at QUEUED.
      await drainInFlightRuns(pool, deps);
      await unsubscribe().catch((err: unknown) =>
        logger.warn({ err }, "Error closing cancellation subscriber"),
      );
    },
  };
}
