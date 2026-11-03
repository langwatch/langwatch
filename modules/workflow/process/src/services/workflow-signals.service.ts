import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";

import type { WorkflowSignals } from "../app/workflow.app.ts";

const logger = createLogger("langwatch:workflows:signals");

/**
 * A side effect nothing waits on only logs when it fails. A handled refusal the customer fixes
 * (no model configured, say) is expected and warns; anything else is ours to look at.
 */
export class WorkflowSignalsService implements WorkflowSignals {
  static create(): WorkflowSignalsService {
    return new WorkflowSignalsService();
  }

  private constructor() {}

  failed(error: unknown, context: Readonly<{ projectId?: string }>): void {
    if (HandledError.isHandled(error) && error.fault === "customer") {
      logger.warn(
        { handledErrorCode: error.code, ...context },
        "a workflow side effect was refused for a reason the customer can fix",
      );
      return;
    }
    logger.error({ error, ...context }, "a workflow side effect failed");
  }
}
