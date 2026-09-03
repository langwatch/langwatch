import { HandledError } from "@langwatch/handled-error";
import type { Logger } from "@langwatch/observability";
import type { TaskCatalogue } from "./task-catalogue";

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
 * Resolves a task by name from argv, runs it, and returns the process exit
 * code — never calls `process.exit` itself, so a caller can decide when to
 * actually leave. SIGINT/SIGTERM abort the signal handed to the task rather
 * than killing the process out from under it.
 *
 * Contract:
 * - no name, or an unknown name: lists the catalogue's names, exit 1, does
 *   not run anything.
 * - a known name: logs `{ task }` at start, runs it, logs
 *   `{ task, durationMs }` at finish, exit 0.
 * - the task throws: exactly one `error` log line, exit 1.
 * - `close()` always runs, whichever of the above happened.
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

    const startedAt = Date.now();
    logger.info({ task: name }, "task starting");
    try {
      await task.run({ args, signal: controller.signal });
      logger.info({ task: name, durationMs: Date.now() - startedAt }, "task finished");
      return 0;
    } catch (error) {
      logger.error(
        {
          task: name,
          durationMs: Date.now() - startedAt,
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
