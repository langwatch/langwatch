/**
 * The copy row's Prisma repository, under the name the worker compositions
 * still construct it by.
 *
 * A delegating factory only: the behaviour moved to
 * `repositories/prisma/prisma.workflow-row.repository.ts`, and this name goes
 * once every process names the repository instead.
 */
import { WorkflowRowPrismaRepository } from "../repositories/prisma/prisma.workflow-row.repository.ts";
import type { WorkflowRowDatabase } from "../repositories/prisma/prisma.workflow-row.repository.ts";
import type { WorkflowRowRepository } from "../repositories/workflow-row.repository.ts";

export class PrismaWorkflowRowAdapter {
  static create(options: { database: WorkflowRowDatabase }): WorkflowRowRepository {
    return WorkflowRowPrismaRepository.create(options);
  }
}
