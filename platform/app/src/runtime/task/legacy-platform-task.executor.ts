import { LocalTaskExecutorPort, type LocalTaskExecution } from "@langwatch/server/task";
import { createLogger } from "@langwatch/observability";
import { createProcessPrismaConnection } from "../app/prisma-process.composition";
import { runStandaloneTaskWithPrisma } from "../task-prisma.lifecycle";
import { closePrismaConnection, configurePrismaConnection } from "~/server/db";

/**
 * The slice of the application environment a task run reads. `DATABASE_URL` is
 * optional here because it is optional in the environment itself — a
 * build-time evaluation has no database — so the requirement is asserted when
 * the connection is opened rather than asserted by a type the caller cannot
 * satisfy. The object handed in is the whole environment: the cleanup task's
 * NLP-lambda config is resolved off the same value, and reads it by its own
 * variable names — which is why the two named here are an addition to the rest
 * of the environment rather than the whole of it.
 */
export type LegacyPlatformTaskEnvironment = Readonly<{
  DATABASE_URL?: string | undefined;
  NODE_ENV: string;
}> &
  Readonly<Record<string, unknown>>;

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
  private readonly logger = createLogger("langwatch:task");

  constructor(private readonly options: LegacyPlatformTaskExecutorOptions) {
    super();
  }

  async execute(input: LocalTaskExecution): Promise<void> {
    const databaseUrl = this.options.environment.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(`DATABASE_URL must be set to run the "${input.taskName}" task.`);
    }
    await runStandaloneTaskWithPrisma({
      compose: () =>
        createProcessPrismaConnection({
          databaseUrl,
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
    await script.default(...input.args);
  }
}
