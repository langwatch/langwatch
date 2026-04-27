/**
 * ExperimentsFacade - Entry point for the experiments API
 *
 * Provides:
 * - `init()` method to create experiment sessions (SDK-defined experiments)
 * - `run()` method to execute platform-configured experiments (Experiments Workbench)
 */

import type { LangwatchApiClient } from "@/internal/api/client";
import type { Logger } from "@/logger";
import { Experiment } from "./experiment";
import type { ExperimentInitOptions } from "./types";
import type {
  ExperimentRunResult,
  RunExperimentOptions,
  ExperimentRunSummary,
} from "./platformTypes";
import {
  ExperimentsApiError,
  ExperimentNotFoundError,
  ExperimentTimeoutError,
  ExperimentRunFailedError,
} from "./platformErrors";
import { printSummary } from "./printSummary";

const DEFAULT_POLL_INTERVAL = 2000;
const DEFAULT_TIMEOUT = 600000; // 10 minutes

type ExperimentsFacadeConfig = {
  langwatchApiClient: LangwatchApiClient;
  endpoint: string;
  apiKey: string;
  logger: Logger;
};

/**
 * Facade for creating experiment sessions and running platform-configured experiments
 */
export class ExperimentsFacade {
  private readonly config: ExperimentsFacadeConfig;

  constructor(config: ExperimentsFacadeConfig) {
    this.config = config;
  }

  /**
   * Initialize a new experiment session (SDK-defined)
   *
   * @param name - Name of the experiment (used as slug)
   * @param options - Optional configuration
   * @returns An initialized Experiment instance
   *
   * @example
   * ```typescript
   * const experiment = await langwatch.experiments.init('my-experiment');
   *
   * await experiment.run(dataset, async ({ item, index }) => {
   *   const response = await myAgent(item.question);
   *   experiment.log('accuracy', { index, score: 0.95 });
   * });
   * ```
   */
  async init(name: string, options?: ExperimentInitOptions): Promise<Experiment> {
    return Experiment.init(name, {
      apiClient: this.config.langwatchApiClient,
      endpoint: this.config.endpoint,
      apiKey: this.config.apiKey,
      logger: this.config.logger,
      ...options,
    });
  }

  /**
   * Run a platform-configured experiment (Experiments Workbench)
   *
   * This runs an experiment that was configured in the LangWatch platform.
   * The method automatically prints a summary and exits with code 1 on failure
   * (unless `exitOnFailure: false` is passed).
   *
   * @param slug - The slug of the experiment (found in the experiment URL)
   * @param options - Optional configuration
   * @returns The experiment results including pass rate and summary
   *
   * @example
   * ```typescript
   * import { LangWatch } from "langwatch";
   *
   * const langwatch = new LangWatch();
   *
   * const result = await langwatch.experiments.run("my-experiment-slug");
   * result.printSummary();
   * ```
   */
  async run(slug: string, options?: RunExperimentOptions): Promise<ExperimentRunResult> {
    this.config.logger.info(`Running platform experiment: ${slug}`);
    const result = await this.runWithPolling(slug, options);
    return result;
  }

  /**
   * Run an experiment and wait for completion using polling
   */
  private async runWithPolling(
    slug: string,
    options: RunExperimentOptions = {}
  ): Promise<ExperimentRunResult> {
    const pollInterval = options.pollInterval ?? DEFAULT_POLL_INTERVAL;
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;

    // Start the run
    const startResponse = await this.startRun(slug);
    const { runId } = startResponse;

    // Use the run URL from API but replace domain with configured endpoint
    const apiRunUrl = startResponse.runUrl ?? "";
    const runUrl = apiRunUrl ? this.replaceUrlDomain(apiRunUrl, this.config.endpoint) : "";

    console.log(`Started experiment run: ${runId}`);
    if (runUrl) {
      console.log(`Follow live: ${runUrl}`);
    }

    const total = startResponse.total;
    let lastProgress = 0;

    // Print initial progress
    if (total > 0) {
      process.stdout.write(`Progress: 0/${total} (0%)`);
    }
    options.onProgress?.(0, total);

    const startTime = Date.now();

    // Poll until complete
    while (true) {
      if (Date.now() - startTime > timeout) {
        console.log(); // Newline after progress
        const finalStatus = await this.getRunStatus(runId);
        throw new ExperimentTimeoutError(runId, finalStatus.progress, finalStatus.total);
      }

      await this.sleep(pollInterval);

      const status = await this.getRunStatus(runId);
      const progress = status.progress;

      // Update progress display if changed
      if (progress !== lastProgress && status.total > 0) {
        const percentage = Math.round((progress / status.total) * 100);
        process.stdout.write(`\rProgress: ${progress}/${status.total} (${percentage}%)`);
        lastProgress = progress;
      }

      options.onProgress?.(status.progress, status.total);

      if (status.status === "completed") {
        console.log(); // Newline after progress
        const summary = status.summary!;
        return this.buildResult(runId, "completed", summary, runUrl ?? "");
      }

      if (status.status === "failed") {
        console.log(); // Newline after progress
        throw new ExperimentRunFailedError(runId, status.error ?? "Unknown error");
      }

      if (status.status === "stopped") {
        console.log(); // Newline after progress
        return this.buildResult(runId, "stopped", status.summary ?? {
          runId,
          totalCells: status.total,
          completedCells: status.progress,
          failedCells: 0,
          duration: Date.now() - startTime,
        }, runUrl ?? "");
      }
    }
  }

  /**
   * Start an experiment run
   */
  private async startRun(slug: string): Promise<{ runId: string; total: number; runUrl?: string }> {
    const response = await this.config.langwatchApiClient.POST(
      "/api/evaluations/v3/{slug}/run",
      {
        params: {
          path: { slug },
        },
      }
    );

    if (response.error) {
      const status = response.response.status;

      if (status === 404) {
        throw new ExperimentNotFoundError(slug);
      }

      if (status === 401) {
        throw new ExperimentsApiError("Unauthorized - check your API key", 401);
      }

      const errorMessage =
        "error" in response.error ? response.error.error : `Failed to start experiment: ${slug}`;
      throw new ExperimentsApiError(errorMessage ?? `HTTP ${status}`, status);
    }

    return response.data as { runId: string; total: number; runUrl?: string };
  }

  /**
   * Get the status of a run
   */
  private async getRunStatus(runId: string): Promise<{
    status: string;
    progress: number;
    total: number;
    summary?: ExperimentRunSummary;
    error?: string;
  }> {
    const response = await this.config.langwatchApiClient.GET(
      "/api/evaluations/v3/runs/{runId}",
      {
        params: {
          path: { runId },
        },
      }
    );

    if (response.error) {
      const status = response.response.status;

      if (status === 404) {
        throw new ExperimentsApiError(`Run not found: ${runId}`, 404);
      }

      if (status === 401) {
        throw new ExperimentsApiError("Unauthorized - check your API key", 401);
      }

      const errorMessage =
        "error" in response.error ? response.error.error : `Failed to get run status: ${runId}`;
      throw new ExperimentsApiError(errorMessage ?? `HTTP ${status}`, status);
    }

    return response.data as {
      status: string;
      progress: number;
      total: number;
      summary?: ExperimentRunSummary;
      error?: string;
    };
  }

  /**
   * Build the result object from API response
   */
  private buildResult(
    runId: string,
    status: "completed" | "failed" | "stopped",
    summary: ExperimentRunSummary,
    runUrl: string
  ): ExperimentRunResult {
    const completedCells = summary.completedCells ?? 0;
    const failedCells = summary.failedCells ?? 0;
    const duration = summary.duration ?? 0;

    const totalPassed = summary.totalPassed ?? completedCells - failedCells;
    const totalFailed = summary.totalFailed ?? failedCells;
    const passRate = summary.passRate ??
      (completedCells > 0 ? (totalPassed / completedCells) * 100 : 0);

    const result: ExperimentRunResult = {
      runId,
      status,
      passed: totalPassed,
      failed: totalFailed,
      passRate,
      duration,
      runUrl,
      summary,
      printSummary: (exitOnFailure = true) => {
        printSummary({
          runId,
          status,
          passed: totalPassed,
          failed: totalFailed,
          passRate,
          duration,
          runUrl: summary.runUrl ?? runUrl,
          summary,
        });

        if (exitOnFailure && totalFailed > 0) {
          process.exit(1);
        }
      },
      toString: () =>
        `ExperimentRunResult { status: ${status.toUpperCase()}, passed: ${totalPassed}, failed: ${totalFailed}, passRate: ${passRate.toFixed(1)}%, duration: ${(duration / 1000).toFixed(1)}s }`,
    };

    // Custom Node.js inspect for console.log
    (result as Record<string | symbol, unknown>)[Symbol.for("nodejs.util.inspect.custom")] =
      () => result.toString();

    return result;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Replace the domain of a URL with a new base URL, preserving the path
   */
  private replaceUrlDomain(url: string, newBase: string): string {
    if (!url) return url;

    try {
      const parsedUrl = new URL(url);
      const parsedNewBase = new URL(newBase);

      // Replace origin with new base, keep path/query/fragment
      return `${parsedNewBase.origin}${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
    } catch {
      // If URL parsing fails, return original
      return url;
    }
  }
}
