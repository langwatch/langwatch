/**
 * The project rows a Studio run's environment is built from.
 *
 * Moved from the platform app's
 * `runtime/app/features/workflow-studio-enrichment.adapter.ts`: the two reads
 * and their selections are unchanged, because what a running graph sees in its
 * environment is customer-visible behaviour. The decryption pass moved above
 * this seam - a repository reads rows and never holds a cipher.
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
