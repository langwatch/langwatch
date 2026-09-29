import { createLogger } from "@langwatch/observability";

import type { WorkflowSignals } from "../app/workflow.app.ts";

const logger = createLogger("langwatch:workflows:signals");

/** Where a created workflow and a failure nothing waits on are recorded: the log. */
export class LoggedWorkflowSignalsService implements WorkflowSignals {
  static create(): LoggedWorkflowSignalsService {
    return new LoggedWorkflowSignalsService();
  }

  private constructor() {}

  workflowCreated(input: {
    userId: string;
    workflowCount: number;
    workflowId: string;
    projectId: string;
  }): void {
    logger.info(input, "workflow created");
  }

  failed(error: unknown, context: Readonly<{ projectId?: string }>): void {
    logger.error({ error, ...context }, "a workflow side effect failed");
  }
}
