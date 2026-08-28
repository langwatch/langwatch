import { LocalTaskExecutorPort, type LocalTaskExecution } from "@langwatch/server/task";
import { createLogger } from "@langwatch/observability";
import { createProcessPrismaConnection } from "../app/prisma-process.composition";
import { runStandaloneNlpLambdaTask } from "../task-nlp-lambda.lifecycle";
import { runStandaloneTaskWithPrisma } from "../task-prisma.lifecycle";
import { closePrismaConnection, configurePrismaConnection } from "~/server/db";

export interface LegacyPlatformTaskEnvironment {
  readonly DATABASE_URL: string;
  readonly NODE_ENV: string;
}

export interface LegacyPlatformTaskExecutorOptions {
  readonly environment: LegacyPlatformTaskEnvironment;
  readonly source: Readonly<Record<string, string | undefined>>;
}

/**
 * Compatibility executor for the generated Platform task registry.
 *
 * The physical local-orchestrator executable owns process boot, logging,
 * tracing, fatal exits, and flushing. This adapter retains the legacy registry
 * and App composition until those tasks have canonical owners.
 */
export class LegacyPlatformTaskExecutor extends LocalTaskExecutorPort {
  private static readonly appComposingTasks = new Set([
    "backfillAnnotationsToClickhouse",
    "backfillStalledSimulationRuns",
    "runTopicClustering",
  ]);

  private readonly logger = createLogger("langwatch:task");

  constructor(private readonly options: LegacyPlatformTaskExecutorOptions) {
    super();
  }

  async execute(input: LocalTaskExecution): Promise<void> {
    await runStandaloneTaskWithPrisma({
      compose: () =>
        createProcessPrismaConnection({
          databaseUrl: this.options.environment.DATABASE_URL,
          nodeEnv: this.options.environment.NODE_ENV,
        }),
      configure: configurePrismaConnection,
      execute: async (connection) => await this.executeTask(input, connection),
      closeApp: async () => {
        const { closeInitializedApp } = await import("~/server/app-layer/app");
        await closeInitializedApp();
      },
      closePrisma: closePrismaConnection,
      reportCloseError: ({ target, error }) => {
        this.logger.error({ error, taskName: input.taskName }, `failed to close the ${target}`);
      },
    });
  }

  private async executeTask(
    input: LocalTaskExecution,
    connection: ReturnType<typeof createProcessPrismaConnection>,
  ): Promise<void> {
    const { TASKS } = await import("~/tasks.generated");
    if (!input.taskName) {
      throw new Error("Please specify a task to run");
    }

    const load = TASKS[input.taskName];
    if (!load) {
      throw new Error(
        `Task "${input.taskName}" not found. Available tasks: ${Object.keys(TASKS).sort().join(", ")}`,
      );
    }

    this.logger.info({ taskName: input.taskName }, "running");
    const script = await load();
    if (LegacyPlatformTaskExecutor.appComposingTasks.has(input.taskName)) {
      const { initializeDefaultApp } = await import("~/server/app-layer/presets");
      initializeDefaultApp({ prismaConnection: connection });
    }

    if (input.taskName === "cleanupOldLambdas") {
      await this.executeCleanupOldLambdas();
      return;
    }

    await script.default(...input.args);
  }

  private async executeCleanupOldLambdas(): Promise<void> {
    const { default: cleanupOldLambdas } = await import("~/tasks/cleanupOldLambdas");
    const { resolveNlpLambdaRuntimeConfig } = await import("~/runtime/api/nlp-lambda");
    const { AppAwsClientConfiguration } = await import("~/runtime/app/aws-client.composition");
    const { createProcessNlpLambdaRuntime } = await import("~/server/app-layer/nlp-lambda.runtime");
    const { parseOutboundProxyConfig } = await import("~/server/outboundProxy");
    const aws = AppAwsClientConfiguration.create(parseOutboundProxyConfig(this.options.source));
    const nlpLambda = createProcessNlpLambdaRuntime({
      config: resolveNlpLambdaRuntimeConfig(this.options.environment),
      redis: null,
      aws,
    });
    await runStandaloneNlpLambdaTask({
      execute: async () => await cleanupOldLambdas(nlpLambda),
      closeNlpLambda: () => nlpLambda.close(),
      closeAws: () => aws.close(),
      reportCloseError: ({ target, error }) => {
        this.logger.error(
          { error, taskName: "cleanupOldLambdas" },
          `failed to close the ${target}`,
        );
      },
    });
  }
}
