import type {
  StudioClientEvent,
  WorkflowRunOrigin,
  WorkflowStudioSyncAnswer,
} from "@langwatch/workflow-contract";

import type { WorkflowNlpRuntime } from "../app/workflow.app.ts";

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
  }): Promise<WorkflowStudioSyncAnswer> {
    const response = await this.options.runtime.dispatch({
      projectId: input.projectId,
      body: input.event,
      origin: input.origin,
      ...(input.causalityDepth === undefined ? {} : { causalityDepth: input.causalityDepth }),
      ...(input.parentTrace ? { parentTrace: input.parentTrace } : {}),
    });

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body: WorkflowStudioSyncService.parseBody(await response.text()),
    };
  }

  /** A gateway's HTML error page stays text; the caller branches on `ok` first. */
  private static parseBody(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}
