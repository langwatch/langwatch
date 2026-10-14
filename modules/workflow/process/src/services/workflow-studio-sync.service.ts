import { createLogger } from "@langwatch/observability";
import {
  workflowRunAnswerSchema,
  WorkflowExecutionFailedError,
  type StudioClientEvent,
  type WorkflowRunAnswer,
  type WorkflowRunOrigin,
} from "@langwatch/workflow-contract";

import type { WorkflowNlpRuntime } from "../app/workflow.app.ts";

const logger = createLogger("langwatch:workflows:studio-sync");

/** A peer's prepared Studio event run to completion on its project's own engine. */
export class WorkflowStudioSyncService {
  static create(options: { runtime: WorkflowNlpRuntime }): WorkflowStudioSyncService {
    return new WorkflowStudioSyncService(options);
  }

  private constructor(private readonly options: { runtime: WorkflowNlpRuntime }) {}

  async execute(input: {
    projectId: string;
    event: StudioClientEvent;
    origin: WorkflowRunOrigin;
    causalityDepth?: number;
    parentTrace?: { traceId: string; parentSpanId: string };
  }): Promise<WorkflowRunAnswer> {
    const response = await this.options.runtime.dispatch({
      projectId: input.projectId,
      body: input.event,
      origin: input.origin,
      ...(input.causalityDepth === undefined ? {} : { causalityDepth: input.causalityDepth }),
      ...(input.parentTrace ? { parentTrace: input.parentTrace } : {}),
    });
    if (!response.ok) {
      logger.error(
        {
          status: response.status,
          statusText: response.statusText,
          projectId: input.projectId,
          origin: input.origin,
        },
        "nlpgo execute_sync returned a non-OK response",
      );

      throw new WorkflowExecutionFailedError();
    }

    return workflowRunAnswerSchema.parse(await response.json());
  }
}
