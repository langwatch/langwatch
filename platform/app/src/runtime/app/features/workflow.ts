import type { DatasetService } from "@langwatch/dataset-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  PostgresWorkflowAdapter,
  WorkflowExecutionPort,
} from "@langwatch/workflow-server";
import type { WorkflowService } from "@langwatch/workflow-contract";

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

/** Adapts the existing NLP execution engine without leaking it into Workflow. */
export class AppWorkflowExecutionPort extends WorkflowExecutionPort {
  static create(
    execute: (input: WorkflowExecutionInput) => Promise<unknown>,
  ): AppWorkflowExecutionPort {
    return new AppWorkflowExecutionPort(execute);
  }

  private constructor(
    private readonly executeWorkflow: (
      input: WorkflowExecutionInput,
    ) => Promise<unknown>,
  ) {
    super();
  }

  execute(input: WorkflowExecutionInput): Promise<unknown> {
    return this.executeWorkflow(input);
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
