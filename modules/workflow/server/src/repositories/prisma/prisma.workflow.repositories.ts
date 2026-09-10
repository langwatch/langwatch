import type { WorkflowRepositories } from "../workflow-repositories.registry.ts";
import { WorkflowProjectEnvironmentPrismaRepository } from "./prisma.workflow-project-environment.repository.ts";
import { WorkflowRowPrismaRepository } from "./prisma.workflow-row.repository.ts";
import { PrismaWorkflowRepository } from "./prisma.workflow.repository.ts";
import type { WorkflowDatabase } from "./prisma.workflow.repository.ts";
import type { WorkflowProjectEnvironmentDatabase } from "./prisma.workflow-project-environment.repository.ts";
import type { WorkflowRowDatabase } from "./prisma.workflow-row.repository.ts";

/** Every table the workflow module reads or writes, as one client supplies them. */
export type WorkflowPrismaDatabase = WorkflowDatabase &
  WorkflowRowDatabase &
  WorkflowProjectEnvironmentDatabase;

/**
 * The live tier: the graph, the copy row and the project environment,
 * all through the process's one Prisma client.
 */
export class PostgresWorkflowRepositories {
  static readonly requires = ["prisma"] as const;

  static create(
    infrastructure: Readonly<{ prisma: WorkflowPrismaDatabase }>,
  ): WorkflowRepositories {
    const database = infrastructure.prisma;

    return {
      workflows: PrismaWorkflowRepository.create({ database }),
      workflowRows: WorkflowRowPrismaRepository.create({ database }),
      projectEnvironment: WorkflowProjectEnvironmentPrismaRepository.create({ database }),
    };
  }
}
