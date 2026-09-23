import { HandledError } from "@langwatch/handled-error";
import type { Logger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { TaskCatalogue } from "./task-catalogue.ts";

/**
 * `argv` is the raw args after the program name: `["clickhouse-migrate",
 * "--dry-run"]`. The first element is the task name; the rest are handed to
 * the task untouched.
 */
export type RunTaskInput = {
  catalogue: TaskCatalogue;
  argv: readonly string[];
  /** Always awaited, success or failure — closes the process's real handles. */
  close: () => Promise<void>;
  logger: Logger;
};

/**
 * Runs a task by name, returning exit code. Handles signals gracefully.
 * Always calls close(), logs at start and finish.
 */
export async function runTask({ catalogue, argv, close, logger }: RunTaskInput): Promise<number> {
  const [name, ...args] = argv;

  try {
    if (!name) {
      logger.error(
        { availableNames: catalogue.names() },
        "No task name given — pass one of the available task names",
      );
      return 1;
    }

    let task;
    try {
      task = catalogue.get({ name });
    } catch (error) {
      if (error instanceof HandledError) {
        logger.error(
          { task: name, code: error.code, availableNames: catalogue.names() },
          error.message,
        );
        return 1;
      }
      throw error;
    }

    const controller = new AbortController();
    const onSignal = (): void => controller.abort();
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);

    const startedAt = nowInstant().epochMilliseconds;
    logger.info({ task: name }, "task starting");
    try {
      await task.run({ args, signal: controller.signal });
      logger.info(
        { task: name, durationMs: nowInstant().epochMilliseconds - startedAt },
        "task finished",
      );
      return 0;
    } catch (error) {
      logger.error(
        {
          task: name,
          durationMs: nowInstant().epochMilliseconds - startedAt,
          code: error instanceof HandledError ? error.code : undefined,
          error,
        },
        "task failed",
      );
      return 1;
    } finally {
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
    }
  } finally {
    await close();
  }
}
