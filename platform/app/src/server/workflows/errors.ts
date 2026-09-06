import { HandledError } from "@langwatch/handled-error";

/**
 * nlpgo (the Go execution engine) responded with a non-OK HTTP status while
 * running the workflow. The response's `statusText` can carry upstream
 * implementation detail, so it stays server-side (log it at the throw site)
 * — the client only gets this safe, generic message.
 */
export class WorkflowExecutionFailedError extends HandledError {
  declare readonly code: "workflow_execution_failed";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super("workflow_execution_failed", "The workflow failed to run.", {
      httpStatus: 502,
      // The execution engine is our own infra — a non-OK response from it
      // is an incident, not a caller mistake.
      fault: "platform",
      ...options,
    });
    this.name = "WorkflowExecutionFailedError";
  }
}
