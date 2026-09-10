/**
 * The project environment, under the name the worker compositions still
 * construct it by.
 *
 * A delegating factory only: the rows moved to
 * `repositories/prisma/prisma.workflow-project-environment.repository.ts` and
 * the decryption to `services/workflow-project-environment.service.ts`. This
 * name goes once every process names those two instead.
 */
import type { WorkflowProjectEnvironmentPort } from "../ports/workflow.port.ts";
import { WorkflowProjectEnvironmentPrismaRepository } from "../repositories/prisma/prisma.workflow-project-environment.repository.ts";
import type { WorkflowProjectEnvironmentDatabase } from "../repositories/prisma/prisma.workflow-project-environment.repository.ts";
import {
  WorkflowProjectEnvironmentService,
  type WorkflowEnvironmentDecryptor,
} from "../services/workflow-project-environment.service.ts";

export class PrismaWorkflowProjectEnvironmentAdapter {
  static create(options: {
    database: WorkflowProjectEnvironmentDatabase;
    encryption: WorkflowEnvironmentDecryptor;
  }): WorkflowProjectEnvironmentPort {
    return WorkflowProjectEnvironmentService.create({
      repository: WorkflowProjectEnvironmentPrismaRepository.create({
        database: options.database,
      }),
      encryption: options.encryption,
    });
  }
}
