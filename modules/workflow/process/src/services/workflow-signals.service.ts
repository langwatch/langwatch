import { createLogger } from "@langwatch/observability";

import type { WorkflowSignals } from "../app/workflow.app.ts";

const logger = createLogger("langwatch:workflows:signals");

/** A side effect nothing waits on only logs when it fails. */
export class WorkflowSignalsService implements WorkflowSignals {
  static create(): WorkflowSignalsService {
    return new WorkflowSignalsService();
  }

  private constructor() {}

  failed(error: unknown, context: Readonly<{ projectId?: string }>): void {
    logger.error({ error, ...context }, "a workflow side effect failed");
  }
}
