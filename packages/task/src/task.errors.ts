import { HandledError } from "@langwatch/handled-error";

/**
 * Raised by {@link TaskCatalogue.get} when no task is registered under the
 * requested name. Carries the full list of available names so a caller (a
 * CLI, an operator, another task) can act on the failure instead of parsing
 * a stack trace.
 */
export class TaskNotFoundError extends HandledError {
  declare readonly code: "task_not_found";

  constructor({ task, availableNames }: { task: string; availableNames: readonly string[] }) {
    super("task_not_found", `No task named "${task}" is registered`, {
      meta: { task, availableNames: [...availableNames] },
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "TaskNotFoundError";
  }
}

/**
 * Raised by a {@link TaskHostPort} `require*` helper when the infrastructure
 * handle a task needs was never composed for this process — an environment
 * with no ClickHouse configured running `clickhouse-migrate`, for example.
 * `fault: "platform"` because the caller (deploy config, an operator running
 * the wrong task against the wrong environment) cannot fix this by retrying;
 * the environment needs the handle wired in.
 */
export class TaskInfrastructureUnavailableError extends HandledError {
  declare readonly code: "task_infrastructure_unavailable";

  constructor({ handle }: { handle: string }) {
    super(
      "task_infrastructure_unavailable",
      `This task needs ${handle}, which is not configured for this environment`,
      { meta: { handle }, httpStatus: 503, fault: "platform" },
    );
    this.name = "TaskInfrastructureUnavailableError";
  }
}
