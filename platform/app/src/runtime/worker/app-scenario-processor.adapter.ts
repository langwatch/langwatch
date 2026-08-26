import {
  NodeScenarioChildProcessAdapter,
  RedisCancellationSubscriberAdapter,
  ScenarioProcessorService,
  ScenarioProcessorServiceMetricsPort,
} from "@langwatch/scenario-server";
import type { App } from "~/server/app-layer/app";
import { resolveAppPackageRoot } from "~/server/appPackageRoot";
import {
  getJobProcessingCounter,
  getJobProcessingDurationHistogram,
} from "~/server/metrics";
import path from "node:path";

class AppScenarioProcessorServiceMetrics extends ScenarioProcessorServiceMetricsPort {
  started(): void {
    getJobProcessingCounter("scenario", "processing").inc();
  }

  completed(durationMs: number): void {
    getJobProcessingCounter("scenario", "completed").inc();
    getJobProcessingDurationHistogram("scenario").observe(durationMs);
  }

  failed(): void {
    getJobProcessingCounter("scenario", "failed").inc();
  }
}

export function createAppScenarioProcessorService(
  app: App,
): ScenarioProcessorService | null {
  if (!app.redis || !app.scenarioExecutionPool) return null;

  const packageRoot = resolveAppPackageRoot();
  const childProcesses = NodeScenarioChildProcessAdapter.create({
    pool: app.scenarioExecutionPool,
    config: {
      packageRoot,
      sourcePath: path.join(
        packageRoot,
        "src",
        "runtime",
        "worker",
        "scenario-child-process.ts",
      ),
      sourceRoots: [
        path.join(packageRoot, "src", "runtime", "worker"),
        path.resolve(packageRoot, "../../packages/features/scenario/server/src"),
      ],
      nodeEnv: app.config.nodeEnv,
      isSaas: app.config.isSaas ?? false,
      parentEnvironment: app.config.scenarioExecution.childEnvironment,
    },
  });
  return ScenarioProcessorService.create({
    execution: app.scenarioExecution,
    pool: app.scenarioExecutionPool,
    cancellations: RedisCancellationSubscriberAdapter.create(app.redis.duplicate()),
    childProcesses,
    metrics: new AppScenarioProcessorServiceMetrics(),
  });
}
