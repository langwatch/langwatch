import type { DatasetService } from "@langwatch/dataset-contract";
import type { WorkflowService as WorkflowServiceContract } from "@langwatch/workflow-contract";
import type {
  WorkflowDslMigrationPort,
  WorkflowExecutionPort,
  WorkflowLlmParametersPort,
  WorkflowProjectEnvironmentPort,
} from "../ports/workflow.port";
import {
  PrismaWorkflowRepository,
  type WorkflowDatabase,
} from "../repositories/prisma/prisma.workflow.repository";
import { StudioEventPreparerService } from "../services/studio-event-preparer.service";
import { WorkflowService } from "../services/workflow.service";

export type PostgresWorkflowAdapterOptions = {
  /** Generated Prisma client supplied by the application composition root. */
  database: WorkflowDatabase;
  datasets: DatasetService;
  execution?: WorkflowExecutionPort;
  projectEnvironment: WorkflowProjectEnvironmentPort;
  llmParameters: WorkflowLlmParametersPort;
  dslMigration: WorkflowDslMigrationPort;
  generateId?: () => string;
};

/** Binds the private Workflow repositories to one process-owned service. */
export class PostgresWorkflowAdapter {
  static create(options: PostgresWorkflowAdapterOptions): WorkflowServiceContract {
    return WorkflowService.create({
      repository: PrismaWorkflowRepository.create(options.database),
      datasets: options.datasets,
      execution: options.execution,
      studioEvents: StudioEventPreparerService.create({
        datasets: options.datasets,
        projectEnvironment: options.projectEnvironment,
        llmParameters: options.llmParameters,
      }),
      dslMigration: options.dslMigration,
      generateId: options.generateId,
    });
  }
}
