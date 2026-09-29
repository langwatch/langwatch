import type { WorkflowCreatedSignal } from "@langwatch/enterprise-billing-contract";
import { createLogger } from "@langwatch/observability";

import type { WorkflowSignals } from "../app/workflow.app.ts";

const logger = createLogger("langwatch:workflows:signals");

/**
 * A created workflow is announced to billing for nurturing; an announcement or
 * any other side effect nothing waits on only logs when it fails.
 */
export class WorkflowSignalsService implements WorkflowSignals {
  static create(deps: {
    announce: (input: WorkflowCreatedSignal) => Promise<void>;
  }): WorkflowSignalsService {
    return new WorkflowSignalsService(deps.announce);
  }

  private constructor(private readonly announce: (input: WorkflowCreatedSignal) => Promise<void>) {}

  workflowCreated(input: WorkflowCreatedSignal): void {
    void this.announce(input).catch((error: unknown) => {
      this.failed(error, { projectId: input.projectId });
    });
  }

  failed(error: unknown, context: Readonly<{ projectId?: string }>): void {
    logger.error({ error, ...context }, "a workflow side effect failed");
  }
}
