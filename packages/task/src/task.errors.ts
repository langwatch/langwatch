import { HandledError } from "@langwatch/handled-error";

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
