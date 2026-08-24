import type { DatasetService } from "@langwatch/dataset-contract";

/** Execution is infrastructure: the feature supplies a dispatch port. */
export abstract class WorkflowExecutionPort {
  abstract execute(input: {
    projectId: string;
    workflowId: string;
    version: import("@langwatch/workflow-contract").WorkflowVersion;
    inputs: Record<string, unknown>;
    doNotTrace?: boolean;
    runEvaluations?: boolean;
    origin?: import("@langwatch/workflow-contract").WorkflowRunOrigin;
    causalityDepth?: number;
    parentTrace?: { traceId: string; parentSpanId: string };
  }): Promise<unknown>;
}

/** The service accepts canonical feature services, never their repositories. */
export type WorkflowDependencies = {
  datasets?: DatasetService;
  execution?: WorkflowExecutionPort;
};
