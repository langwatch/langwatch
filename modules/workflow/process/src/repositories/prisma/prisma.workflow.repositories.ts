import type { WorkflowRepositories } from "../workflow-repositories.registry.ts";
import { PrismaWorkflowLineageRepository } from "./prisma.workflow-lineage.repository.ts";
import type { WorkflowLineageDatabase } from "./prisma.workflow-lineage.repository.ts";
import { WorkflowRowPrismaRepository } from "./prisma.workflow-row.repository.ts";
import type { WorkflowRowDatabase } from "./prisma.workflow-row.repository.ts";
import { PrismaWorkflowRepository } from "./prisma.workflow.repository.ts";
import type { WorkflowDatabase } from "./prisma.workflow.repository.ts";

/** Every table the workflow module reads or writes, as one client supplies them. */
export type WorkflowPrismaDatabase = WorkflowDatabase &
  WorkflowRowDatabase &
  WorkflowLineageDatabase;

/**
 * The live tier: the graph, the copy row and its lineage, all through the
 * process's one Prisma client.
 */
export class PostgresWorkflowRepositories {
  static readonly requires = ["prisma"] as const;

  static create(
    members: Readonly<{ prisma: WorkflowPrismaDatabase }>,
  ): Omit<WorkflowRepositories, "nlpLambdaArns" | "payloadStaging"> {
    const database = members.prisma;

    return {
      workflows: PrismaWorkflowRepository.create({ database }),
      workflowRows: WorkflowRowPrismaRepository.create({ database }),
      lineage: PrismaWorkflowLineageRepository.create({ database }),
    };
  }
}
