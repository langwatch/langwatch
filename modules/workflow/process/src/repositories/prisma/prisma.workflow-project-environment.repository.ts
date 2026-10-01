/**
 * Project rows for Studio run environment; moved from platform app with unchanged selections.
 */
import {
  WorkflowProjectEnvironmentRepository,
  type StoredProjectEnvironment,
} from "../workflow-project-environment.repository.ts";

/** The table this repository reads, named structurally. */
export type WorkflowProjectEnvironmentDatabase = {
  projectSecret: {
    findMany(input: {
      where: { projectId: string };
      select: { name: true; encryptedValue: true; boundOrigin: true };
    }): Promise<{ name: string; encryptedValue: string; boundOrigin: string | null }[]>;
  };
};

export class WorkflowProjectEnvironmentPrismaRepository extends WorkflowProjectEnvironmentRepository {
  static create(options: {
    database: WorkflowProjectEnvironmentDatabase;
  }): WorkflowProjectEnvironmentPrismaRepository {
    return new WorkflowProjectEnvironmentPrismaRepository(options.database);
  }

  private constructor(private readonly database: WorkflowProjectEnvironmentDatabase) {
    super();
  }

  async findEnvironment(input: { projectId: string }): Promise<StoredProjectEnvironment> {
    const projectSecrets = await this.database.projectSecret.findMany({
      where: { projectId: input.projectId },
      select: { name: true, encryptedValue: true, boundOrigin: true },
    });

    return { secrets: projectSecrets };
  }
}
