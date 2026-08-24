import type { DatasetService } from "@langwatch/dataset-contract";
import type { WorkflowService as WorkflowServiceContract } from "@langwatch/workflow-contract";
import type { WorkflowExecutionPort } from "../ports/workflow.port";
import { PrismaWorkflowRepository, type WorkflowDatabase } from "../repositories/prisma/prisma.workflow.repository";
import { WorkflowService } from "../services/workflow.service";

export type PostgresWorkflowAdapterOptions = {
  /** Generated Prisma client supplied by the application composition root. */
  database: object;
  datasets?: DatasetService;
  execution?: WorkflowExecutionPort;
  generateId?: () => string;
};

/** Binds the private Workflow repositories to one process-owned service. */
export class PostgresWorkflowAdapter {
  static create(options: PostgresWorkflowAdapterOptions): WorkflowServiceContract {
    return WorkflowService.create({
      repository: PrismaWorkflowRepository.create(options.database as WorkflowDatabase),
      datasets: options.datasets,
      execution: options.execution,
      generateId: options.generateId,
    });
  }
}
