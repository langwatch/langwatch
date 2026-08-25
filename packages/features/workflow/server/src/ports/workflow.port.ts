import type { DatasetService } from "@langwatch/dataset-contract";
import type { WorkflowDsl } from "@langwatch/workflow-contract";

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

/** Upgrades a persisted graph before it becomes the workflow's current version. */
export abstract class WorkflowDslMigrationPort {
  abstract migrate(dsl: WorkflowDsl): WorkflowDsl;
}

/** The service accepts canonical feature services, never their repositories. */
export type WorkflowDependencies = {
  datasets?: DatasetService;
  execution?: WorkflowExecutionPort;
  dslMigration: WorkflowDslMigrationPort;
};
