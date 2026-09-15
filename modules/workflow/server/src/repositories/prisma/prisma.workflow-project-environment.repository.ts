/**
 * Project rows for Studio run environment; moved from platform app with unchanged selections.
 */
import {
  WorkflowProjectEnvironmentRepository,
  type StoredProjectEnvironment,
} from "../workflow-project-environment.repository.ts";

/** The two tables this repository reads, named structurally. */
export type WorkflowProjectEnvironmentDatabase = {
  project: {
    findUniqueOrThrow(input: {
      where: { id: string };
      select: { apiKey: true };
    }): Promise<{ apiKey: string }>;
  };
  projectSecret: {
    findMany(input: {
      where: { projectId: string };
      select: { name: true; encryptedValue: true };
    }): Promise<Array<{ name: string; encryptedValue: string }>>;
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
    const [project, projectSecrets] = await Promise.all([
      this.database.project.findUniqueOrThrow({
        where: { id: input.projectId },
        select: { apiKey: true },
      }),
      this.database.projectSecret.findMany({
        where: { projectId: input.projectId },
        select: { name: true, encryptedValue: true },
      }),
    ]);

    return { apiKey: project.apiKey, secrets: projectSecrets };
  }
}
