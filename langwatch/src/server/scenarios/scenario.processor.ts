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
import { createLogger } from "~/utils/logger";
import { prisma } from "../db";
import { connection } from "../redis";
import {
  createDataPrefetcherDependencies,
  prefetchScenarioData,
} from "./execution/data-prefetcher";
import type { ChildProcessJobData, ScenarioExecutionResult } from "./execution/types";
import { CHILD_PROCESS, SCENARIO_QUEUE, SCENARIO_WORKER } from "./scenario.constants";
import type { ScenarioJob, ScenarioJobResult } from "./scenario.queue";
import { ScenarioFailureHandler, type FailureEventParams } from "./scenario-failure-handler";
import { ScenarioService } from "./scenario.service";

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
    error,
    name: scenario?.name,
    description: scenario?.situation,
  });
}

const logger = createLogger("langwatch:scenarios:processor");

/**
 * Build OTEL resource attributes string for scenario labels.
 * Returns undefined if no labels are present.
 * @internal Exported for testing
 */
export function buildOtelResourceAttributes(labels: string[]): string | undefined {
  if (!labels.length) return undefined;
  // Escape backslashes first, then commas and equals per OTEL spec
  const escapedLabels = labels.map((l) => l.replace(/\\/g, "\\\\").replace(/[,=]/g, "\\$&"));
  return `scenario.labels=${escapedLabels.join(",")}`;
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
 */
export async function processScenarioJob(
  job: Job<ScenarioJob, ScenarioJobResult, string>,
): Promise<ScenarioJobResult> {
  const { projectId, scenarioId, target, setId, batchRunId } = job.data;

  logger.info(
    { jobId: job.id, scenarioId, projectId, batchRunId },
    "Processing scenario job",
  );

  // Pre-fetch all data needed for child process
  const deps = createDataPrefetcherDependencies();
  const prefetchResult = await prefetchScenarioData(
    { projectId, scenarioId, setId, batchRunId },
    target,
    deps,
  );

  if (!prefetchResult.success) {
    logger.error(
      { jobId: job.id, scenarioId, error: prefetchResult.error },
      "Failed to prefetch scenario data",
    );
    return { success: false, error: prefetchResult.error };
  }

  // Spawn child process with isolated OTEL context
  const result = await spawnScenarioChildProcess(
    job,
    prefetchResult.data,
    prefetchResult.telemetry,
  );

  logger.info(
    { jobId: job.id, scenarioId, success: result.success },
    "Scenario job completed",
  );

  return result;
}

/**
 * Spawn a child process to execute the scenario with isolated OTEL context.
 *
 * The child process is self-contained and self-reporting via LangWatch SDK.
 * We just stream its output and check the exit code.
 */
async function spawnScenarioChildProcess(
  job: Job<ScenarioJob, ScenarioJobResult, string>,
  jobData: ChildProcessJobData,
  telemetry: { endpoint: string; apiKey: string },
): Promise<ScenarioExecutionResult> {
  return new Promise((resolve) => {
    const scenarioId = jobData.scenario.id;
    const childLogger = createLogger(`langwatch:scenarios:child:${scenarioId}`);

    // Helper to log to both pino (stdout) and BullMQ job (visible in Bull Board)
    const log = (level: "info" | "warn" | "error", message: string) => {
      childLogger[level](message);
      void job.log(`[${level.toUpperCase()}] ${message}`);
    };

    // Use tsx to run the TypeScript file directly, avoiding Next.js bundling issues
    // Use __dirname instead of process.cwd() for reliable path resolution in Docker
    const childPath = path.join(__dirname, "execution/scenario-child-process.ts");

    // Build OTEL resource attributes including scenario labels
    const otelResourceAttrs = buildOtelResourceAttributes(jobData.scenario.labels);

    // Build minimal env for child process - whitelist only what's needed
    // Following the goose.ts pattern to prevent leaking sensitive vars
    // (especially OTEL_* which would corrupt telemetry isolation)
    const childEnv = buildChildProcessEnv({
      LANGWATCH_API_KEY: telemetry.apiKey,
      LANGWATCH_ENDPOINT: telemetry.endpoint,
      SCENARIO_HEADLESS: "true", // Prevent SDK from trying to open browser
      ...(otelResourceAttrs && { OTEL_RESOURCE_ATTRIBUTES: otelResourceAttrs }),
    });

    // tsx is available since the worker runs via tsx
    const child: ChildProcess = spawn("pnpm", ["exec", "tsx", childPath], {
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"],
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
      log("error", "Child process timed out");
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
      if (resolved) return;
      resolved = true;

      if (code !== 0) {
        log("error", `Child process exited with code ${code}: ${stderr}`);
        resolve({
          success: false,
          error: `Child process exited with code ${code}: ${stderr}`,
        });
        return;
      }

      log("info", "Scenario completed successfully");
      // Child reports results via LangWatch SDK, we just confirm it succeeded
      resolve({ success: true });
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
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
        log("warn", `Child stdin error: ${err.message}`);
      });
      try {
        child.stdin.write(JSON.stringify(jobData));
        child.stdin.end();
      } catch (err) {
        log("warn", `Child stdin write failed: ${(err as Error).message}`);
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
export function startScenarioProcessor(
  deps: ProcessorDependencies = createProcessorDependencies(),
): Worker<ScenarioJob, ScenarioJobResult, string> | undefined {
  if (!connection) {
    logger.info("No Redis connection, skipping scenario processor");
    return undefined;
  }

  const worker = new BullMQWorker<ScenarioJob, ScenarioJobResult, string>(
    SCENARIO_QUEUE.NAME,
    processScenarioJob,
    {
      connection,
      concurrency: SCENARIO_WORKER.CONCURRENCY,
      stalledInterval: SCENARIO_WORKER.STALLED_INTERVAL_MS,
      drainDelay: SCENARIO_WORKER.DRAIN_DELAY_MS,
    },
  );

  worker.on("ready", () => {
    logger.info("Scenario processor ready, waiting for jobs");
  });

  worker.on("failed", (job, error) => {
    logger.error(
      { jobId: job?.id, error, data: job?.data },
      "Scenario job failed",
    );
    // Emit failure events for unexpected errors (e.g., exceptions in processScenarioJob)
    if (job) {
      void handleFailedJobResult(job.data, error?.message, deps).catch((emitError) =>
        logger.error(
          { jobId: job.id, scenarioId: job.data.scenarioId, error: emitError },
          "Failed to emit failure events from failed handler",
        ),
      );
    }
  });

  worker.on("completed", async (job, result) => {
    logger.info(
      { jobId: job.id, scenarioId: job.data.scenarioId, success: result?.success },
      "Scenario job completed",
    );

    // If job failed, ensure failure events are emitted to Elasticsearch
    // so the frontend can show the error instead of timing out
    if (result && !result.success) {
      // Log the failure explicitly - even when result.error is undefined
      logger.error(
        { jobId: job.id, scenarioId: job.data.scenarioId, error: result.error ?? "No error provided" },
        "Scenario job failed",
      );

      try {
        await handleFailedJobResult(job.data, result.error, deps);
        logger.info(
          { jobId: job.id, scenarioId: job.data.scenarioId },
          "Failure events emitted",
        );
      } catch (error) {
        // Log but don't crash the worker - failure handler errors shouldn't affect other jobs
        logger.error(
          { jobId: job.id, scenarioId: job.data.scenarioId, error },
          "Failed to emit failure events",
        );
      }
    }
  });

  logger.info("Scenario processor started");
  return worker;
}
