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
import { connection } from "../redis";
import { prefetchScenarioData } from "./execution/data-prefetcher";
import type { ChildProcessJobData, ScenarioExecutionResult } from "./execution/types";
import { SCENARIO_QUEUE, SCENARIO_WORKER } from "./scenario.constants";
import type { ScenarioJob, ScenarioJobResult } from "./scenario.queue";

const logger = createLogger("langwatch:scenarios:processor");

const CHILD_PROCESS_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Build OTEL resource attributes string for scenario labels.
 * Returns undefined if no labels are present.
 * @internal Exported for testing
 */
export function buildOtelResourceAttributes(labels: string[]): string | undefined {
  if (!labels.length) return undefined;
  // Escape commas and equals in label values per OTEL spec
  const escapedLabels = labels.map((l) => l.replace(/[,=]/g, "\\$&"));
  return `scenario.labels=${escapedLabels.join(",")}`;
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
  const prefetchResult = await prefetchScenarioData(
    { projectId, scenarioId, setId, batchRunId },
    target,
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
 */
async function spawnScenarioChildProcess(
  jobData: ChildProcessJobData,
  telemetry: { endpoint: string; apiKey: string },
): Promise<ScenarioExecutionResult> {
  return new Promise((resolve) => {
    // Use tsx to run the TypeScript file directly, avoiding Next.js bundling issues
    const childPath = path.resolve(
      process.cwd(),
      "src/server/scenarios/execution/scenario-child-process.ts",
    );

    // Build OTEL resource attributes including scenario labels
    const otelResourceAttrs = buildOtelResourceAttributes(jobData.scenario.labels);

    // tsx is available since the worker runs via tsx
    const child: ChildProcess = spawn("pnpm", ["exec", "tsx", childPath], {
      env: {
        ...process.env,
        LANGWATCH_API_KEY: telemetry.apiKey,
        LANGWATCH_ENDPOINT: telemetry.endpoint,
        SCENARIO_HEADLESS: "true", // Prevent SDK from trying to open browser
        ...(otelResourceAttrs && { OTEL_RESOURCE_ATTRIBUTES: otelResourceAttrs }),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        child.kill();
      }
    };

    const timeout = setTimeout(() => {
      logger.error(
        { scenarioId: jobData.scenario.id },
        "Child process timed out",
      );
      cleanup();
      resolve({
        success: false,
        error: "Scenario execution timed out",
      });
    }, CHILD_PROCESS_TIMEOUT_MS);

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (resolved) return;
      resolved = true;

      if (stderr) {
        logger.warn(
          { scenarioId: jobData.scenario.id, stderr },
          "Child process stderr",
        );
      }

      if (code !== 0) {
        logger.error(
          { scenarioId: jobData.scenario.id, code, stderr },
          "Child process exited with error",
        );
        resolve({
          success: false,
          error: `Child process exited with code ${code}: ${stderr}`,
        });
        return;
      }

      try {
        const result = JSON.parse(stdout) as ScenarioExecutionResult;
        resolve(result);
      } catch (error) {
        logger.error(
          { scenarioId: jobData.scenario.id, stdout, error },
          "Failed to parse child process output",
        );
        resolve({
          success: false,
          error: `Failed to parse result: ${stdout}`,
        });
      }
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      if (resolved) return;
      resolved = true;

      logger.error(
        { scenarioId: jobData.scenario.id, error },
        "Child process error",
      );
      resolve({
        success: false,
        error: `Child process error: ${error.message}`,
      });
    });

    // Send job data to child via stdin
    child.stdin?.write(JSON.stringify(jobData));
    child.stdin?.end();
  });
}

/**
 * Start the scenario processor (BullMQ worker).
 *
 * This should be called from a separate entry point (scenario-worker.ts)
 * to keep scenario processing isolated from the main server.
 */
export function startScenarioProcessor(): Worker<
  ScenarioJob,
  ScenarioJobResult,
  string
> | undefined {
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
  });

  worker.on("completed", (job) => {
    logger.info(
      { jobId: job.id, scenarioId: job.data.scenarioId },
      "Scenario job completed",
    );
  });

  logger.info("Scenario processor started");
  return worker;
}
