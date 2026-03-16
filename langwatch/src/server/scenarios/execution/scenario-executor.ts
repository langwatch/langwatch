/**
 * Scenario executor — spawns isolated child processes for scenario execution.
 *
 * Extracted from scenario.processor.ts to decouple from BullMQ.
 * Each scenario runs in its own process with separate OTEL context.
 */

import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { createLogger } from "~/utils/logger/server";
import {
  createDataPrefetcherDependencies,
  prefetchScenarioData,
} from "./data-prefetcher";
import type { ChildProcessJobData, ScenarioExecutionResult } from "./types";
import {
  getJobProcessingCounter,
  getJobProcessingDurationHistogram,
} from "../../metrics";
import { CHILD_PROCESS } from "../scenario.constants";

const logger = createLogger("langwatch:scenarios:executor");

/** Parameters needed to execute a scenario */
export interface ScenarioExecutionParams {
  projectId: string;
  scenarioId: string;
  scenarioRunId: string;
  batchRunId: string;
  setId: string;
  target: {
    type: "prompt" | "http" | "code";
    referenceId: string;
  };
  attempt: number;
}

/**
 * Build OTEL resource attributes string for scenario labels and platform source.
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
 * Build minimal env for child process — whitelist only what's needed.
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
 * ScenarioExecutor manages child process lifecycle for scenario execution.
 *
 * Tracks active child processes for graceful shutdown.
 */
export class ScenarioExecutor {
  private readonly activeChildren = new Map<string, ChildProcess>();
  private shutdownRequested = false;

  /**
   * Execute a scenario by prefetching data and spawning a child process.
   *
   * Returns the execution result. On success, the child process reports
   * results via the LangWatch SDK — we just confirm it succeeded.
   */
  async execute(params: ScenarioExecutionParams): Promise<ScenarioExecutionResult> {
    const {
      projectId,
      scenarioId,
      scenarioRunId,
      batchRunId,
      setId,
      target,
      attempt,
    } = params;

    const execLogger = logger.child({
      scenarioId,
      projectId,
      batchRunId,
      scenarioRunId,
      attempt,
    });

    const startTime = Date.now();
    getJobProcessingCounter("scenario", "processing").inc();
    execLogger.info("Executing scenario");

    const deps = createDataPrefetcherDependencies();
    const prefetchResult = await prefetchScenarioData(
      { projectId, scenarioId, setId, batchRunId, scenarioRunId },
      target,
      deps,
    );

    if (!prefetchResult.success) {
      execLogger.error(
        { error: prefetchResult.error, phase: "prefetch" },
        "Failed to prefetch scenario data",
      );
      return { success: false, error: prefetchResult.error };
    }

    execLogger.debug(
      { durationMs: Date.now() - startTime, phase: "prefetch" },
      "Scenario data prefetched",
    );

    const childProcessData = {
      ...prefetchResult.data,
      scenarioRunId,
    };

    const childStartTime = Date.now();
    const result = await this.spawnChildProcess(
      params,
      childProcessData,
      prefetchResult.telemetry,
    );

    const totalDurationMs = Date.now() - startTime;
    const childDurationMs = Date.now() - childStartTime;

    if (result.success) {
      getJobProcessingCounter("scenario", "completed").inc();
      getJobProcessingDurationHistogram("scenario").observe(totalDurationMs);
      execLogger.info(
        { success: true, totalDurationMs, childDurationMs },
        "Scenario execution completed",
      );
    } else {
      getJobProcessingCounter("scenario", "failed").inc();
      execLogger.warn(
        { success: false, error: result.error, totalDurationMs, childDurationMs },
        "Scenario execution completed with failure",
      );
    }

    return result;
  }

  /**
   * Spawn a child process with isolated OTEL context.
   */
  private spawnChildProcess(
    params: ScenarioExecutionParams,
    childProcessData: ChildProcessJobData,
    telemetry: { endpoint: string; apiKey: string },
  ): Promise<ScenarioExecutionResult> {
    return new Promise((resolve) => {
      const { scenarioId, projectId, batchRunId, scenarioRunId } = params;

      const childLogger = logger.child({
        scenarioId,
        projectId,
        batchRunId,
        scenarioRunId,
        component: "child-process",
      });

      const log = (
        level: "info" | "warn" | "error",
        message: string,
        extra?: Record<string, unknown>,
      ) => {
        childLogger[level](extra ?? {}, message);
      };

      const childPath = path.join(
        __dirname,
        "scenario-child-process.ts",
      );

      const otelResourceAttrs = buildOtelResourceAttributes(
        childProcessData.scenario.labels,
      );

      const childEnv = buildChildProcessEnv({
        LANGWATCH_API_KEY: telemetry.apiKey,
        LANGWATCH_ENDPOINT: telemetry.endpoint,
        SCENARIO_HEADLESS: "true",
        OTEL_RESOURCE_ATTRIBUTES: otelResourceAttrs,
      });

      const packageRoot = path.resolve(__dirname, "../../..");
      const child: ChildProcess = spawn(
        "pnpm",
        ["exec", "tsx", childPath],
        {
          env: childEnv,
          stdio: ["pipe", "pipe", "pipe"],
          cwd: packageRoot,
        },
      );

      // Track active child for shutdown
      this.activeChildren.set(scenarioRunId, child);

      let stderr = "";
      let resolved = false;

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          this.activeChildren.delete(scenarioRunId);
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
        if (resolved) return;
        resolved = true;
        this.activeChildren.delete(scenarioRunId);

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
        if (resolved) return;
        resolved = true;
        this.activeChildren.delete(scenarioRunId);

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
   * Graceful shutdown: wait for grace period, then SIGTERM, then SIGKILL.
   */
  async shutdown(gracePeriodMs = 30_000): Promise<void> {
    this.shutdownRequested = true;
    const activeCount = this.activeChildren.size;

    if (activeCount === 0) return;

    logger.info(
      { activeCount, gracePeriodMs },
      "Waiting for active scenario child processes to complete",
    );

    // Wait for grace period, checking periodically if all children finished
    const startTime = Date.now();
    while (
      this.activeChildren.size > 0 &&
      Date.now() - startTime < gracePeriodMs
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (this.activeChildren.size === 0) {
      logger.info("All scenario child processes completed within grace period");
      return;
    }

    // SIGTERM remaining children
    logger.warn(
      { remaining: this.activeChildren.size },
      "Grace period expired, sending SIGTERM to remaining child processes",
    );
    for (const [id, child] of this.activeChildren) {
      child.kill("SIGTERM");
    }

    // Wait 5s for SIGTERM
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // SIGKILL any still alive
    if (this.activeChildren.size > 0) {
      logger.warn(
        { remaining: this.activeChildren.size },
        "Sending SIGKILL to remaining child processes",
      );
      for (const [id, child] of this.activeChildren) {
        child.kill("SIGKILL");
      }
      this.activeChildren.clear();
    }
  }
}
