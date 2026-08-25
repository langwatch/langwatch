import type { DatasetService } from "@langwatch/dataset-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  PostgresWorkflowAdapter,
  WorkflowDslMigrationPort,
  WorkflowExecutionPort,
  type WorkflowExecutionInput,
  type WorkflowLlmParametersPort,
  type WorkflowProjectEnvironmentPort,
} from "@langwatch/workflow-server";
import type { WorkflowService } from "@langwatch/workflow-contract";
import type { WorkflowDsl } from "@langwatch/workflow-contract";
import {
  migrateWorkflowDslForExecution,
  WorkflowNlpExecutor,
} from "~/server/workflows/runWorkflow";

/** App composition supplies one WorkflowService through request context. */
export type AppWorkflowRuntimeOptions = {
  database: PrismaClient;
  datasets: DatasetService;
  execution?: WorkflowExecutionPort;
  dslMigration?: WorkflowDslMigrationPort;
  generateId?: () => string;
  projectEnvironment: WorkflowProjectEnvironmentPort;
  llmParameters: WorkflowLlmParametersPort;
};

/** Binds the process-owned Workflow NLP executor to the canonical port. */
export class AppWorkflowExecutionPort extends WorkflowExecutionPort {
  static create(): AppWorkflowExecutionPort {
    return new AppWorkflowExecutionPort();
  }

  private constructor() {
    super();
  }

  private executor: WorkflowNlpExecutor | undefined;

  connect(executor: WorkflowNlpExecutor): void {
    if (this.executor) {
      throw new Error("Workflow execution port is already connected.");
    }

    this.executor = executor;
  }

  execute(input: WorkflowExecutionInput): Promise<unknown> {
    if (!this.executor) {
      throw new Error("Workflow execution port is not connected.");
    }

    return this.executor.execute(input);
  }
}

export class AppWorkflowDslMigrationPort extends WorkflowDslMigrationPort {
  static create(): AppWorkflowDslMigrationPort {
    return new AppWorkflowDslMigrationPort();
  }

  private constructor() {
    super();
  }

  migrate(dsl: WorkflowDsl): WorkflowDsl {
    return migrateWorkflowDslForExecution(dsl);
  }
}

export class AppWorkflowRuntime {
  private constructor(private readonly options: AppWorkflowRuntimeOptions) {}

  static create(options: AppWorkflowRuntimeOptions): AppWorkflowRuntime {
    return new AppWorkflowRuntime(options);
  }

  build(): WorkflowService {
    return PostgresWorkflowAdapter.create({
      ...this.options,
      dslMigration: this.options.dslMigration ?? AppWorkflowDslMigrationPort.create(),
    });
  }
}
