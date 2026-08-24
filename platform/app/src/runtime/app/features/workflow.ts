import type { DatasetService } from "@langwatch/dataset-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  PostgresWorkflowAdapter,
  WorkflowExecutionPort,
} from "@langwatch/workflow-server";
import type { WorkflowService } from "@langwatch/workflow-contract";
import { WorkflowNlpExecutor } from "~/server/workflows/runWorkflow";

/**
 * Application-owned composition seam for Workflow. The App root supplies the
 * one database connection and canonical feature services; transport handlers
 * receive the returned service through App/request context.
 *
 * This file intentionally does not register itself in presets.ts. Registration
 * belongs to the parent composition change once the execution adapter is
 * available there.
 */
export type AppWorkflowRuntimeOptions = {
  database: PrismaClient;
  datasets?: DatasetService;
  execution?: WorkflowExecutionPort;
  generateId?: () => string;
};

type WorkflowExecutionInput = Parameters<WorkflowExecutionPort["execute"]>[0];

/** Binds the process-owned Workflow NLP executor to the canonical port. */
export class AppWorkflowExecutionPort extends WorkflowExecutionPort {
  static create(executor: WorkflowNlpExecutor): AppWorkflowExecutionPort {
    return new AppWorkflowExecutionPort(executor);
  }

  private constructor(private readonly executor: WorkflowNlpExecutor) {
    super();
  }

  execute(input: WorkflowExecutionInput): Promise<unknown> {
    return this.executor.execute(input);
  }
}

export class AppWorkflowRuntime {
  private constructor(private readonly options: AppWorkflowRuntimeOptions) {}

  static create(options: AppWorkflowRuntimeOptions): AppWorkflowRuntime {
    return new AppWorkflowRuntime(options);
  }

  build(): WorkflowService {
    return PostgresWorkflowAdapter.create(this.options);
  }
}
