/**
 * Scenario execution processor.
 *
 * Spawns isolated child processes for scenario execution to achieve OTEL
 * trace isolation. Each scenario runs in its own process with separate
 * LANGWATCH_API_KEY and LANGWATCH_ENDPOINT env vars.
 *
 * Execution is triggered by the `simulation_run_execution` process manager's
 * `execute` intent (event-driven via GroupQueue), NOT by BullMQ. The execution
 * pool manages concurrency.
 *
 * @see specs/scenarios/simulation-runner.feature
 * @see specs/scenarios/event-driven-execution-prep.feature
 */

import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import type { App } from "~/server/app-layer/app";
import { type ChildProcess, spawn } from "child_process";
import { resolveAppPackageRoot } from "../appPackageRoot";
import {
  createContextFromJobData,
  type JobContextMetadata,
  runWithContext,
} from "../context/asyncContext";
import {
  getJobProcessingCounter,
  getJobProcessingDurationHistogram,
} from "../metrics";
import {
  type CancellationMessage,
  subscribeToCancellations,
} from "./cancellation-channel";
import { buildChildEnvironment } from "./execution/child-environment";
import { resolveChildProcessSpawn } from "./execution/child-process-spawn";
import {
  createDataPrefetcherDependencies,
  type DataPrefetcherDependencies,
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
import {
  type FailureEventParams,
  ScenarioFailureHandler,
} from "./scenario-failure-handler";

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
  dataPrefetcher?: DataPrefetcherDependencies;
}

// ============================================================================
// Factory Function (wires up production dependencies)
// ============================================================================

/**
 * Creates production dependencies for the scenario processor.
 */
export function createProcessorDependencies({
  app,
  prisma,
}: {
  app: Pick<App, "agents" | "prompts" | "scenarios">;
  prisma: PrismaClient;
}): ProcessorDependencies {
  const failureHandler = ScenarioFailureHandler.create();

  return {
    scenarioLookup: {
      getById: (params) => app.scenarios.tryGetById(params),
    },
    failureEmitter: {
      ensureFailureEventsEmitted: (params) =>
        failureHandler.ensureFailureEventsEmitted(params),
    },
    dataPrefetcher: createDataPrefetcherDependencies({ app, prisma }),
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
    target: jobData.target,
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

/** The runner's structured stdout result line. */
export interface ChildProcessResult {
  success: boolean;
  error?: string;
  reasoning?: string;
}

/** Parse a single stdout line as the runner's result, or null if it isn't one. */
function parseResultLine(line: string): ChildProcessResult | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.success !== "boolean") return null;
  return {
    success: record.success,
    ...(typeof record.error === "string" ? { error: record.error } : {}),
    ...(typeof record.reasoning === "string"
      ? { reasoning: record.reasoning }
      : {}),
  };
}

/**
 * Extract the runner's structured result from its stdout.
 *
 * The runner emits its logs (pino JSON) AND its final result line
 * (`{"success":false,"error":"…"}`) on stdout; the result line is the only one
 * carrying a boolean `success`. Scanning from the end returns it without
 * mistaking a log line for the result. This lets the parent surface the child's
 * real error (e.g. the flattened TLS cause) instead of the near-empty stderr.
 *
 * @internal Exported for testing
 */
export function parseChildProcessResult(
  stdout: string,
): ChildProcessResult | null {
  const lines = stdout.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const result = parseResultLine(lines[i] ?? "");
    if (result) return result;
  }
  return null;
}

/** The identity and resolved values the prefetch reads off one pool job. */
function prefetchContext(jobData: ExecutionJobData) {
  return {
    projectId: jobData.projectId,
    scenarioId: jobData.scenarioId,
    setId: jobData.setId,
    batchRunId: jobData.batchRunId,
    scenarioRunId: jobData.scenarioRunId,
    parameters: jobData.parameters,
    secretParameters: jobData.secretParameters,
  };
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
  deps: ProcessorDependencies,
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

    const prefetchDeps = deps.dataPrefetcher;
    if (!prefetchDeps) {
      throw new Error(
        "Scenario processor requires data-prefetcher dependencies at composition.",
      );
    }
    const prefetchResult = await prefetchScenarioData({
      context: prefetchContext(jobData),
      target: jobData.target,
      deps: prefetchDeps,
    });

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

    const childEnv = buildChildEnvironment({
      jobData,
      labels: childProcessData.scenario.labels,
      telemetry,
    });

    const packageRoot = resolveAppPackageRoot();
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
    let stdout = "";
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
      const chunk = data.toString();
      stdout += chunk;
      const lines = chunk.trim().split("\n");
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
        // Prefer the runner's own structured error (its flattened cause chain,
        // e.g. the TLS reason) over the near-empty stderr — the failure handler
        // classifies this string into a handled error for the drawer.
        const childResult = parseChildProcessResult(stdout);
        const error =
          childResult?.error && childResult.error.trim().length > 0
            ? childResult.error
            : `Child process exited with code ${code}: ${stderr}`;
        log("error", `Child process exited with code ${code}`, {
          exitCode: code,
          stderr,
        });
        resolve({
          success: false,
          error,
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
 * scenarioExecution subscriber via the GroupQueue.
 *
 * @returns A shutdown handle, or undefined if Redis is not available.
 */
export async function startScenarioProcessor({
  pool,
  injectedDeps,
  app,
  prisma,
}: {
  pool: ScenarioExecutionPool;
  injectedDeps?: ProcessorDependencies | undefined;
  app: Pick<App, "agents" | "prompts" | "scenarios" | "redis">;
  prisma?: PrismaClient;
}): Promise<{ close: () => Promise<void> } | undefined> {
  // Skipping the processor is this function's documented outcome when there
  // is no Redis, so absence must not raise (ADR-093).
  const connection = app.redis;
  if (!connection) {
    logger.info("No Redis connection, skipping scenario processor");
    return undefined;
  }

  // Resolved after the guard rather than as a default parameter, because
  // defaults evaluate before the body runs: on the "no Redis, skip" path that
  // would build the Prisma-backed services this immediately throws away.
  const deps = injectedDeps
    ? injectedDeps
    : (() => {
        if (!prisma) {
          throw new Error(
            "Scenario processor must receive the process App and Prisma client at composition.",
          );
        }
        return createProcessorDependencies({ app, prisma });
      })();

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

  // Subscribe to cancellation signals from the event-sourcing subscriber
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
